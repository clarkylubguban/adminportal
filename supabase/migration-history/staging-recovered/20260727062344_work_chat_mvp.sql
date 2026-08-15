-- Work Chat MVP foundation for the staging Admin Portal.
-- Additive only. Does not modify existing workflow/payment/task tables.

create table if not exists public.work_chat_channels (
  id uuid primary key default gen_random_uuid(),
  channel_key text not null,
  channel_type text not null,
  name text not null,
  source_record_type text,
  source_record_id text,
  created_by_user_id uuid references public.admin_users(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_chat_channels_key_unique unique (channel_key),
  constraint work_chat_channels_type_check check (channel_type in ('STANDARD', 'ORDER')),
  constraint work_chat_channels_name_check check (length(btrim(name)) between 1 and 120),
  constraint work_chat_channels_source_check check (
    (
      channel_type = 'STANDARD'
      and source_record_type is null
      and source_record_id is null
    )
    or (
      channel_type = 'ORDER'
      and source_record_type = 'ops_inquiries'
      and source_record_id is not null
      and length(btrim(source_record_id)) between 1 and 200
    )
  )
);

create unique index if not exists work_chat_order_source_uidx
  on public.work_chat_channels (source_record_type, source_record_id)
  where channel_type = 'ORDER';

create index if not exists work_chat_channels_type_updated_idx
  on public.work_chat_channels (channel_type, updated_at desc);

create table if not exists public.work_chat_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.work_chat_channels(id) on delete cascade,
  sender_user_id uuid not null references public.admin_users(user_id) on delete restrict,
  body text,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint work_chat_messages_body_check check (
    body is null or length(btrim(body)) between 1 and 4000
  )
);

create index if not exists work_chat_messages_channel_created_idx
  on public.work_chat_messages (channel_id, created_at desc, id desc);

create index if not exists work_chat_messages_sender_created_idx
  on public.work_chat_messages (sender_user_id, created_at desc);

create table if not exists public.work_chat_mentions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.work_chat_messages(id) on delete cascade,
  channel_id uuid not null references public.work_chat_channels(id) on delete cascade,
  mentioned_user_id uuid not null references public.admin_users(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint work_chat_mentions_message_user_unique unique (message_id, mentioned_user_id)
);

create index if not exists work_chat_mentions_user_read_idx
  on public.work_chat_mentions (mentioned_user_id, read_at, created_at desc);

create table if not exists public.work_chat_channel_reads (
  channel_id uuid not null references public.work_chat_channels(id) on delete cascade,
  user_id uuid not null references public.admin_users(user_id) on delete cascade,
  last_read_message_id uuid references public.work_chat_messages(id) on delete set null,
  last_read_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create index if not exists work_chat_channel_reads_user_idx
  on public.work_chat_channel_reads (user_id, updated_at desc);

create table if not exists public.work_chat_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.work_chat_messages(id) on delete cascade,
  bucket_id text not null default 'work-chat-files',
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  uploaded_by_user_id uuid not null references public.admin_users(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint work_chat_attachments_path_unique unique (bucket_id, storage_path),
  constraint work_chat_attachments_filename_check check (length(btrim(original_filename)) between 1 and 240),
  constraint work_chat_attachments_size_check check (size_bytes between 1 and 10485760)
);

create index if not exists work_chat_attachments_message_idx
  on public.work_chat_attachments (message_id, created_at);

create table if not exists public.work_chat_prepared_attachments (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null default 'work-chat-files',
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  uploaded_by_user_id uuid not null references public.admin_users(user_id) on delete restrict,
  expires_at timestamptz not null default (now() + interval '2 hours'),
  linked_message_id uuid references public.work_chat_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint work_chat_prepared_path_unique unique (bucket_id, storage_path),
  constraint work_chat_prepared_filename_check check (length(btrim(original_filename)) between 1 and 240),
  constraint work_chat_prepared_size_check check (size_bytes between 1 and 10485760)
);

create index if not exists work_chat_prepared_owner_idx
  on public.work_chat_prepared_attachments (uploaded_by_user_id, linked_message_id, expires_at);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'work-chat-files',
  'work-chat-files',
  false,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.work_chat_active_admin_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.admin_users admin_user
    where admin_user.user_id = p_user_id
      and admin_user.is_active = true
      and admin_user.role in ('owner', 'admin', 'staff')
  );
$$;

create or replace function public.work_chat_touch_channel()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  update public.work_chat_channels
  set updated_at = clock_timestamp()
  where id = new.channel_id;
  return new;
end;
$$;

drop trigger if exists work_chat_messages_touch_channel on public.work_chat_messages;
create trigger work_chat_messages_touch_channel
after insert on public.work_chat_messages
for each row execute function public.work_chat_touch_channel();

create or replace function public.work_chat_read_prepare_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists work_chat_reads_prepare_update on public.work_chat_channel_reads;
create trigger work_chat_reads_prepare_update
before update on public.work_chat_channel_reads
for each row execute function public.work_chat_read_prepare_update();

create or replace function public.work_chat_send_message(
  p_channel_id uuid,
  p_sender_user_id uuid,
  p_body text,
  p_mentioned_user_ids uuid[] default '{}'::uuid[],
  p_prepared_attachment_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_message_id uuid;
  v_body text := nullif(btrim(p_body), '');
  v_has_attachments boolean := coalesce(array_length(p_prepared_attachment_ids, 1), 0) > 0;
  v_mentioned_user_id uuid;
  v_attachment public.work_chat_prepared_attachments%rowtype;
begin
  if not public.work_chat_active_admin_user(p_sender_user_id) then
    raise exception using errcode = '42501', message = 'active work-chat account required';
  end if;

  if not exists (select 1 from public.work_chat_channels where id = p_channel_id) then
    raise exception using errcode = 'P0002', message = 'work chat channel not found';
  end if;

  if v_body is null and not v_has_attachments then
    raise exception using errcode = '22023', message = 'message text or attachment is required';
  end if;
  if v_body is not null and length(v_body) > 4000 then
    raise exception using errcode = '22023', message = 'message text cannot exceed 4000 characters';
  end if;

  insert into public.work_chat_messages (channel_id, sender_user_id, body)
  values (p_channel_id, p_sender_user_id, v_body)
  returning id into v_message_id;

  foreach v_mentioned_user_id in array coalesce(p_mentioned_user_ids, '{}'::uuid[]) loop
    if public.work_chat_active_admin_user(v_mentioned_user_id) then
      insert into public.work_chat_mentions (message_id, channel_id, mentioned_user_id)
      values (v_message_id, p_channel_id, v_mentioned_user_id)
      on conflict (message_id, mentioned_user_id) do nothing;
    end if;
  end loop;

  for v_attachment in
    select *
    from public.work_chat_prepared_attachments prepared
    where prepared.id = any(coalesce(p_prepared_attachment_ids, '{}'::uuid[]))
    for update
  loop
    if v_attachment.uploaded_by_user_id <> p_sender_user_id
       or v_attachment.expires_at < clock_timestamp()
       or v_attachment.linked_message_id is not null then
      raise exception using errcode = '42501', message = 'attachment upload is not available';
    end if;

    if not exists (
      select 1
      from storage.objects stored
      where stored.bucket_id = v_attachment.bucket_id
        and stored.name = v_attachment.storage_path
    ) then
      raise exception using errcode = 'P0002', message = 'uploaded attachment file not found';
    end if;

    insert into public.work_chat_attachments (
      message_id,
      bucket_id,
      storage_path,
      original_filename,
      mime_type,
      size_bytes,
      uploaded_by_user_id
    )
    values (
      v_message_id,
      v_attachment.bucket_id,
      v_attachment.storage_path,
      v_attachment.original_filename,
      v_attachment.mime_type,
      v_attachment.size_bytes,
      v_attachment.uploaded_by_user_id
    );

    update public.work_chat_prepared_attachments
    set linked_message_id = v_message_id
    where id = v_attachment.id;
  end loop;

  insert into public.work_chat_channel_reads (channel_id, user_id, last_read_message_id, last_read_at)
  values (p_channel_id, p_sender_user_id, v_message_id, clock_timestamp())
  on conflict (channel_id, user_id)
  do update set last_read_message_id = excluded.last_read_message_id,
                last_read_at = excluded.last_read_at;

  return jsonb_build_object('messageId', v_message_id);
end;
$$;

create or replace function public.work_chat_mark_read(
  p_channel_id uuid,
  p_user_id uuid,
  p_message_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
begin
  if not public.work_chat_active_admin_user(p_user_id) then
    raise exception using errcode = '42501', message = 'active work-chat account required';
  end if;
  if p_message_id is not null and not exists (
    select 1 from public.work_chat_messages message
    where message.id = p_message_id and message.channel_id = p_channel_id
  ) then
    raise exception using errcode = 'P0002', message = 'work chat message not found';
  end if;

  insert into public.work_chat_channel_reads (channel_id, user_id, last_read_message_id, last_read_at)
  values (p_channel_id, p_user_id, p_message_id, clock_timestamp())
  on conflict (channel_id, user_id)
  do update set last_read_message_id = excluded.last_read_message_id,
                last_read_at = excluded.last_read_at;

  update public.work_chat_mentions
  set read_at = clock_timestamp()
  where channel_id = p_channel_id
    and mentioned_user_id = p_user_id
    and read_at is null
    and (
      p_message_id is null
      or created_at <= (
        select created_at from public.work_chat_messages where id = p_message_id
      )
    );
end;
$$;

alter table public.work_chat_channels enable row level security;
alter table public.work_chat_messages enable row level security;
alter table public.work_chat_mentions enable row level security;
alter table public.work_chat_channel_reads enable row level security;
alter table public.work_chat_attachments enable row level security;
alter table public.work_chat_prepared_attachments enable row level security;

drop policy if exists "active staff can read work chat channels" on public.work_chat_channels;
create policy "active staff can read work chat channels"
on public.work_chat_channels
for select
to authenticated
using (public.work_chat_active_admin_user((select auth.uid())));

drop policy if exists "active staff can read work chat messages" on public.work_chat_messages;
create policy "active staff can read work chat messages"
on public.work_chat_messages
for select
to authenticated
using (public.work_chat_active_admin_user((select auth.uid())));

drop policy if exists "active staff can read their work chat mentions" on public.work_chat_mentions;
create policy "active staff can read their work chat mentions"
on public.work_chat_mentions
for select
to authenticated
using (
  mentioned_user_id = (select auth.uid())
  and public.work_chat_active_admin_user((select auth.uid()))
);

drop policy if exists "active staff can read own work chat reads" on public.work_chat_channel_reads;
create policy "active staff can read own work chat reads"
on public.work_chat_channel_reads
for select
to authenticated
using (
  user_id = (select auth.uid())
  and public.work_chat_active_admin_user((select auth.uid()))
);

drop policy if exists "active staff can read work chat attachments" on public.work_chat_attachments;
create policy "active staff can read work chat attachments"
on public.work_chat_attachments
for select
to authenticated
using (public.work_chat_active_admin_user((select auth.uid())));

drop policy if exists "active staff can read own prepared attachments" on public.work_chat_prepared_attachments;
create policy "active staff can read own prepared attachments"
on public.work_chat_prepared_attachments
for select
to authenticated
using (
  uploaded_by_user_id = (select auth.uid())
  and public.work_chat_active_admin_user((select auth.uid()))
);

revoke all on table public.work_chat_channels from public, anon, authenticated, service_role;
revoke all on table public.work_chat_messages from public, anon, authenticated, service_role;
revoke all on table public.work_chat_mentions from public, anon, authenticated, service_role;
revoke all on table public.work_chat_channel_reads from public, anon, authenticated, service_role;
revoke all on table public.work_chat_attachments from public, anon, authenticated, service_role;
revoke all on table public.work_chat_prepared_attachments from public, anon, authenticated, service_role;

grant select on table public.work_chat_channels to authenticated;
grant select on table public.work_chat_messages to authenticated;
grant select on table public.work_chat_mentions to authenticated;
grant select on table public.work_chat_channel_reads to authenticated;
grant select on table public.work_chat_attachments to authenticated;
grant select on table public.work_chat_prepared_attachments to authenticated;

grant select, insert, update, delete on table public.work_chat_channels to service_role;
grant select, insert, update, delete on table public.work_chat_messages to service_role;
grant select, insert, update, delete on table public.work_chat_mentions to service_role;
grant select, insert, update, delete on table public.work_chat_channel_reads to service_role;
grant select, insert, update, delete on table public.work_chat_attachments to service_role;
grant select, insert, update, delete on table public.work_chat_prepared_attachments to service_role;

revoke all on function public.work_chat_active_admin_user(uuid) from public, anon, authenticated, service_role;
grant execute on function public.work_chat_active_admin_user(uuid) to authenticated;

revoke all on function public.work_chat_touch_channel() from public, anon, authenticated, service_role;
revoke all on function public.work_chat_read_prepare_update() from public, anon, authenticated, service_role;
revoke all on function public.work_chat_send_message(uuid, uuid, text, uuid[], uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.work_chat_mark_read(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.work_chat_send_message(uuid, uuid, text, uuid[], uuid[]) to service_role;
grant execute on function public.work_chat_mark_read(uuid, uuid, uuid) to service_role;

insert into public.work_chat_channels (channel_key, channel_type, name)
values
  ('general', 'STANDARD', 'GENERAL'),
  ('front-desk', 'STANDARD', 'FRONT DESK'),
  ('production', 'STANDARD', 'PRODUCTION')
on conflict (channel_key) do update
set name = excluded.name,
    channel_type = excluded.channel_type,
    updated_at = clock_timestamp();

do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'work_chat_messages'
  ) then
    alter publication supabase_realtime add table public.work_chat_messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'work_chat_mentions'
  ) then
    alter publication supabase_realtime add table public.work_chat_mentions;
  end if;
end $$;

comment on table public.work_chat_channels is
  'Internal Admin Portal Work Chat channels, including global channels and order-scoped threads.';

comment on table public.work_chat_attachments is
  'Metadata for private work-chat file attachments. File bytes remain in the private work-chat-files bucket.';;
