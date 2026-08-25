-- Facebook / Meta Inbox F1 data foundation.
-- Additive only except one intentional permission alignment:
-- cashier_front_desk receives access to the existing non-sensitive inbox module,
-- matching the locked Figma Source of Truth.
--
-- No Meta tokens are stored in these tables.
-- Raw webhook payloads are service-role only.
-- Existing ops_inquiries and orders are not modified.

do $$
begin
  if to_regclass('public.admin_role_module_permissions') is null then
    raise exception using
      errcode = '42P01',
      message = 'PEOPLE_ACCESS_PERMISSION_FOUNDATION_REQUIRED',
      detail = 'Facebook Inbox F1 requires public.admin_role_module_permissions from the canonical People & Access foundation.';
  end if;

  if to_regprocedure('public.has_admin_module_access(text)') is null then
    raise exception using
      errcode = '42883',
      message = 'PEOPLE_ACCESS_MODULE_ACCESS_FUNCTION_REQUIRED',
      detail = 'Facebook Inbox F1 requires public.has_admin_module_access(text) from the canonical People & Access foundation.';
  end if;
end;
$$;

create table if not exists public.meta_page_connections (
  id uuid primary key default gen_random_uuid(),
  page_id text not null,
  page_name text,
  instagram_account_id text,
  status text not null default 'testing',
  webhook_subscribed_at timestamptz,
  last_webhook_at timestamptz,
  last_error_at timestamptz,
  last_error_summary text,
  token_expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_page_connections_page_id_unique unique (page_id),
  constraint meta_page_connections_page_id_check check (length(btrim(page_id)) between 1 and 200),
  constraint meta_page_connections_status_check check (status in ('disabled','testing','active','error')),
  constraint meta_page_connections_error_summary_check check (
    last_error_summary is null or length(last_error_summary) <= 1000
  ),
  constraint meta_page_connections_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists meta_page_connections_status_idx
  on public.meta_page_connections (status, updated_at desc);

create table if not exists public.inbox_contacts (
  id uuid primary key default gen_random_uuid(),
  display_name text,
  primary_phone text,
  primary_email text,
  company_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inbox_contacts_display_name_check check (
    display_name is null or length(btrim(display_name)) between 1 and 200
  ),
  constraint inbox_contacts_phone_check check (
    primary_phone is null or length(btrim(primary_phone)) between 3 and 40
  ),
  constraint inbox_contacts_email_check check (
    primary_email is null or length(btrim(primary_email)) between 3 and 254
  ),
  constraint inbox_contacts_company_check check (
    company_name is null or length(btrim(company_name)) between 1 and 200
  ),
  constraint inbox_contacts_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists inbox_contacts_display_name_idx
  on public.inbox_contacts (lower(display_name))
  where display_name is not null;

create index if not exists inbox_contacts_phone_idx
  on public.inbox_contacts (primary_phone)
  where primary_phone is not null;

create table if not exists public.inbox_channel_identities (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.inbox_contacts(id) on delete cascade,
  page_connection_id uuid not null references public.meta_page_connections(id) on delete restrict,
  channel text not null,
  external_user_id text not null,
  external_username text,
  display_name text,
  profile_picture_url text,
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inbox_channel_identities_unique unique (
    page_connection_id,
    channel,
    external_user_id
  ),
  constraint inbox_channel_identities_channel_check check (
    channel in ('facebook_messenger','instagram_dm')
  ),
  constraint inbox_channel_identities_external_user_check check (
    length(btrim(external_user_id)) between 1 and 240
  ),
  constraint inbox_channel_identities_username_check check (
    external_username is null or length(btrim(external_username)) between 1 and 240
  ),
  constraint inbox_channel_identities_display_name_check check (
    display_name is null or length(btrim(display_name)) between 1 and 240
  ),
  constraint inbox_channel_identities_profile_url_check check (
    profile_picture_url is null or length(profile_picture_url) <= 2048
  ),
  constraint inbox_channel_identities_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists inbox_channel_identities_contact_idx
  on public.inbox_channel_identities (contact_id, updated_at desc);

create index if not exists inbox_channel_identities_external_idx
  on public.inbox_channel_identities (channel, external_user_id);

create table if not exists public.inbox_conversations (
  id uuid primary key default gen_random_uuid(),
  channel_identity_id uuid not null references public.inbox_channel_identities(id) on delete restrict,
  external_thread_id text,
  state text not null default 'needs_reply',
  owner_user_id uuid references public.admin_users(user_id) on delete restrict,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  snoozed_until timestamptz,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  reply_window_expires_at timestamptz,
  entry_source text,
  referral_ref text,
  campaign_id text,
  campaign_name text,
  ad_id text,
  ad_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inbox_conversations_state_check check (
    state in ('needs_reply','waiting','follow_up','converted','closed')
  ),
  constraint inbox_conversations_thread_check check (
    external_thread_id is null or length(btrim(external_thread_id)) between 1 and 240
  ),
  constraint inbox_conversations_closed_check check (
    (state = 'closed' and closed_at is not null)
    or
    (state <> 'closed' and closed_at is null)
  ),
  constraint inbox_conversations_entry_source_check check (
    entry_source is null or length(btrim(entry_source)) between 1 and 120
  ),
  constraint inbox_conversations_referral_check check (
    referral_ref is null or length(referral_ref) <= 1000
  ),
  constraint inbox_conversations_campaign_id_check check (
    campaign_id is null or length(btrim(campaign_id)) between 1 and 240
  ),
  constraint inbox_conversations_campaign_name_check check (
    campaign_name is null or length(btrim(campaign_name)) between 1 and 500
  ),
  constraint inbox_conversations_ad_id_check check (
    ad_id is null or length(btrim(ad_id)) between 1 and 240
  ),
  constraint inbox_conversations_ad_name_check check (
    ad_name is null or length(btrim(ad_name)) between 1 and 500
  ),
  constraint inbox_conversations_metadata_check check (jsonb_typeof(metadata) = 'object')
);

-- One active operational work unit per Page-scoped identity.
-- After a conversation is closed, a later customer request can open a new
-- internal conversation and become a new inquiry.
create unique index if not exists inbox_conversations_one_open_per_identity_uidx
  on public.inbox_conversations (channel_identity_id)
  where state <> 'closed';

create index if not exists inbox_conversations_work_queue_idx
  on public.inbox_conversations (state, owner_user_id, last_message_at desc nulls last);

create index if not exists inbox_conversations_snoozed_idx
  on public.inbox_conversations (snoozed_until)
  where snoozed_until is not null and state <> 'closed';

create index if not exists inbox_conversations_external_thread_idx
  on public.inbox_conversations (external_thread_id)
  where external_thread_id is not null;

create table if not exists public.meta_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null,
  object_type text,
  page_id text,
  event_type text not null,
  payload jsonb not null,
  processing_status text not null default 'received',
  attempt_count integer not null default 0,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error_summary text,
  constraint meta_webhook_events_key_unique unique (event_key),
  constraint meta_webhook_events_key_check check (length(btrim(event_key)) between 8 and 500),
  constraint meta_webhook_events_type_check check (length(btrim(event_type)) between 1 and 120),
  constraint meta_webhook_events_payload_check check (jsonb_typeof(payload) = 'object'),
  constraint meta_webhook_events_status_check check (
    processing_status in ('received','processed','ignored','failed')
  ),
  constraint meta_webhook_events_attempt_check check (attempt_count >= 0),
  constraint meta_webhook_events_error_check check (
    last_error_summary is null or length(last_error_summary) <= 1000
  )
);

create index if not exists meta_webhook_events_processing_idx
  on public.meta_webhook_events (processing_status, received_at);

create index if not exists meta_webhook_events_page_received_idx
  on public.meta_webhook_events (page_id, received_at desc)
  where page_id is not null;

create table if not exists public.inbox_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.inbox_conversations(id) on delete cascade,
  webhook_event_id uuid references public.meta_webhook_events(id) on delete set null,
  provider text not null default 'meta',
  external_message_id text,
  direction text not null,
  message_type text not null default 'text',
  body text,
  sender_external_id text,
  sender_user_id uuid references public.admin_users(user_id) on delete restrict,
  is_echo boolean not null default false,
  sent_at timestamptz not null,
  delivered_at timestamptz,
  read_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint inbox_messages_provider_check check (provider in ('meta')),
  constraint inbox_messages_direction_check check (
    direction in ('inbound','outbound','system')
  ),
  constraint inbox_messages_type_check check (
    message_type in ('text','image','file','audio','video','sticker','share','unknown')
  ),
  constraint inbox_messages_external_id_check check (
    external_message_id is null or length(btrim(external_message_id)) between 1 and 500
  ),
  constraint inbox_messages_body_check check (
    body is null or length(body) <= 10000
  ),
  constraint inbox_messages_sender_check check (
    sender_external_id is null or length(btrim(sender_external_id)) between 1 and 240
  ),
  constraint inbox_messages_direction_sender_check check (
    (direction = 'outbound' and (sender_user_id is not null or is_echo = true))
    or
    (direction <> 'outbound')
  ),
  constraint inbox_messages_delivery_order_check check (
    delivered_at is null or delivered_at >= sent_at
  ),
  constraint inbox_messages_read_order_check check (
    read_at is null or read_at >= sent_at
  ),
  constraint inbox_messages_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists inbox_messages_external_message_uidx
  on public.inbox_messages (provider, external_message_id)
  where external_message_id is not null;

create index if not exists inbox_messages_conversation_sent_idx
  on public.inbox_messages (conversation_id, sent_at desc, id desc);

create index if not exists inbox_messages_webhook_event_idx
  on public.inbox_messages (webhook_event_id)
  where webhook_event_id is not null;

create table if not exists public.inbox_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.inbox_messages(id) on delete cascade,
  provider text not null default 'meta',
  external_attachment_id text,
  attachment_type text not null,
  source_url text,
  bucket_id text not null default 'inbox-files',
  storage_path text,
  original_filename text,
  mime_type text,
  size_bytes bigint,
  ingestion_status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  stored_at timestamptz,
  constraint inbox_attachments_provider_check check (provider in ('meta')),
  constraint inbox_attachments_type_check check (
    attachment_type in ('image','file','audio','video','sticker','unknown')
  ),
  constraint inbox_attachments_external_check check (
    external_attachment_id is null or length(btrim(external_attachment_id)) between 1 and 500
  ),
  constraint inbox_attachments_source_url_check check (
    source_url is null or length(source_url) <= 4096
  ),
  constraint inbox_attachments_path_check check (
    storage_path is null or length(btrim(storage_path)) between 1 and 1000
  ),
  constraint inbox_attachments_filename_check check (
    original_filename is null or length(btrim(original_filename)) between 1 and 240
  ),
  constraint inbox_attachments_mime_check check (
    mime_type is null or length(btrim(mime_type)) between 1 and 200
  ),
  constraint inbox_attachments_size_check check (
    size_bytes is null or size_bytes between 1 and 20971520
  ),
  constraint inbox_attachments_status_check check (
    ingestion_status in ('pending','stored','failed','external_only')
  ),
  constraint inbox_attachments_reference_check check (
    source_url is not null or storage_path is not null or external_attachment_id is not null
  ),
  constraint inbox_attachments_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists inbox_attachments_storage_path_uidx
  on public.inbox_attachments (bucket_id, storage_path)
  where storage_path is not null;

create index if not exists inbox_attachments_message_idx
  on public.inbox_attachments (message_id, created_at);

create table if not exists public.inbox_conversation_notes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.inbox_conversations(id) on delete cascade,
  body text not null,
  created_by_user_id uuid not null references public.admin_users(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint inbox_conversation_notes_body_check check (
    length(btrim(body)) between 1 and 4000
  )
);

create index if not exists inbox_conversation_notes_conversation_idx
  on public.inbox_conversation_notes (conversation_id, created_at desc);

create table if not exists public.inbox_conversation_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.inbox_conversations(id) on delete cascade,
  event_type text not null,
  actor_user_id uuid references public.admin_users(user_id) on delete restrict,
  actor_kind text not null default 'system',
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  idempotency_key text,
  constraint inbox_conversation_events_type_check check (
    length(btrim(event_type)) between 1 and 120
  ),
  constraint inbox_conversation_events_actor_kind_check check (
    actor_kind in ('user','system','meta')
  ),
  constraint inbox_conversation_events_payload_check check (jsonb_typeof(payload) = 'object'),
  constraint inbox_conversation_events_idempotency_check check (
    idempotency_key is null or length(btrim(idempotency_key)) between 8 and 240
  )
);

create unique index if not exists inbox_conversation_events_idempotency_uidx
  on public.inbox_conversation_events (idempotency_key)
  where idempotency_key is not null;

create index if not exists inbox_conversation_events_conversation_idx
  on public.inbox_conversation_events (conversation_id, occurred_at desc);

create table if not exists public.inbox_inquiry_links (
  conversation_id uuid primary key references public.inbox_conversations(id) on delete restrict,
  inquiry_id text not null references public.ops_inquiries(id) on delete restrict,
  converted_by_user_id uuid not null references public.admin_users(user_id) on delete restrict,
  idempotency_key text not null,
  converted_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint inbox_inquiry_links_inquiry_unique unique (inquiry_id),
  constraint inbox_inquiry_links_idempotency_unique unique (idempotency_key),
  constraint inbox_inquiry_links_idempotency_check check (
    length(btrim(idempotency_key)) between 8 and 240
  ),
  constraint inbox_inquiry_links_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists inbox_inquiry_links_converted_at_idx
  on public.inbox_inquiry_links (converted_at desc);

-- Private attachment bucket. Message ingestion copies Meta attachments here in F2.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inbox-files',
  'inbox-files',
  false,
  20971520,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/svg+xml',
    'application/pdf',
    'application/zip',
    'application/postscript',
    'text/plain'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.inbox_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists meta_page_connections_set_updated_at on public.meta_page_connections;
create trigger meta_page_connections_set_updated_at
before update on public.meta_page_connections
for each row execute function public.inbox_set_updated_at();

drop trigger if exists inbox_contacts_set_updated_at on public.inbox_contacts;
create trigger inbox_contacts_set_updated_at
before update on public.inbox_contacts
for each row execute function public.inbox_set_updated_at();

drop trigger if exists inbox_channel_identities_set_updated_at on public.inbox_channel_identities;
create trigger inbox_channel_identities_set_updated_at
before update on public.inbox_channel_identities
for each row execute function public.inbox_set_updated_at();

drop trigger if exists inbox_conversations_set_updated_at on public.inbox_conversations;
create trigger inbox_conversations_set_updated_at
before update on public.inbox_conversations
for each row execute function public.inbox_set_updated_at();

drop trigger if exists inbox_conversation_notes_set_updated_at on public.inbox_conversation_notes;
create trigger inbox_conversation_notes_set_updated_at
before update on public.inbox_conversation_notes
for each row execute function public.inbox_set_updated_at();

create or replace function public.inbox_touch_conversation_from_message()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.inbox_conversations conversation
  set
    last_message_at = greatest(
      coalesce(conversation.last_message_at, new.sent_at),
      new.sent_at
    ),
    last_inbound_at = case
      when new.direction = 'inbound'
        then greatest(coalesce(conversation.last_inbound_at, new.sent_at), new.sent_at)
      else conversation.last_inbound_at
    end,
    last_outbound_at = case
      when new.direction = 'outbound'
        then greatest(coalesce(conversation.last_outbound_at, new.sent_at), new.sent_at)
      else conversation.last_outbound_at
    end,
    reply_window_expires_at = case
      when new.direction = 'inbound'
        then greatest(
          coalesce(conversation.reply_window_expires_at, new.sent_at + interval '24 hours'),
          new.sent_at + interval '24 hours'
        )
      else conversation.reply_window_expires_at
    end
  where conversation.id = new.conversation_id;

  return new;
end;
$$;

drop trigger if exists inbox_messages_touch_conversation on public.inbox_messages;
create trigger inbox_messages_touch_conversation
after insert on public.inbox_messages
for each row execute function public.inbox_touch_conversation_from_message();

alter table public.meta_page_connections enable row level security;
alter table public.inbox_contacts enable row level security;
alter table public.inbox_channel_identities enable row level security;
alter table public.inbox_conversations enable row level security;
alter table public.inbox_messages enable row level security;
alter table public.inbox_attachments enable row level security;
alter table public.inbox_conversation_notes enable row level security;
alter table public.inbox_conversation_events enable row level security;
alter table public.inbox_inquiry_links enable row level security;
alter table public.meta_webhook_events enable row level security;

-- Read access follows the existing Admin Portal module permissions.
drop policy if exists "inbox module can read meta page connections" on public.meta_page_connections;
create policy "inbox module can read meta page connections"
on public.meta_page_connections
for select
to authenticated
using (public.has_admin_module_access('inbox'));

drop policy if exists "inbox module can read inbox contacts" on public.inbox_contacts;
create policy "inbox module can read inbox contacts"
on public.inbox_contacts
for select
to authenticated
using (public.has_admin_module_access('inbox'));

drop policy if exists "inbox module can read channel identities" on public.inbox_channel_identities;
create policy "inbox module can read channel identities"
on public.inbox_channel_identities
for select
to authenticated
using (public.has_admin_module_access('inbox'));

drop policy if exists "inbox module can read conversations" on public.inbox_conversations;
create policy "inbox module can read conversations"
on public.inbox_conversations
for select
to authenticated
using (public.has_admin_module_access('inbox'));

drop policy if exists "inbox module can read messages" on public.inbox_messages;
create policy "inbox module can read messages"
on public.inbox_messages
for select
to authenticated
using (public.has_admin_module_access('inbox'));

drop policy if exists "inbox or inquiries can read attachments" on public.inbox_attachments;
create policy "inbox or inquiries can read attachments"
on public.inbox_attachments
for select
to authenticated
using (
  public.has_admin_module_access('inbox')
  or public.has_admin_module_access('inquiries')
);

drop policy if exists "inbox module can read conversation notes" on public.inbox_conversation_notes;
create policy "inbox module can read conversation notes"
on public.inbox_conversation_notes
for select
to authenticated
using (public.has_admin_module_access('inbox'));

drop policy if exists "inbox module can read conversation events" on public.inbox_conversation_events;
create policy "inbox module can read conversation events"
on public.inbox_conversation_events
for select
to authenticated
using (public.has_admin_module_access('inbox'));

drop policy if exists "inbox or inquiries can read inquiry links" on public.inbox_inquiry_links;
create policy "inbox or inquiries can read inquiry links"
on public.inbox_inquiry_links
for select
to authenticated
using (
  public.has_admin_module_access('inbox')
  or public.has_admin_module_access('inquiries')
);

-- Raw Meta webhook payloads intentionally have no authenticated policy.
-- Only service-role server code should read/write this table.

drop policy if exists "inbox or inquiries can read inbox files" on storage.objects;
create policy "inbox or inquiries can read inbox files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'inbox-files'
  and (
    public.has_admin_module_access('inbox')
    or public.has_admin_module_access('inquiries')
  )
);

-- Revoke table access first, then grant the minimum needed.
revoke all on table public.meta_page_connections from public, anon, authenticated;
revoke all on table public.inbox_contacts from public, anon, authenticated;
revoke all on table public.inbox_channel_identities from public, anon, authenticated;
revoke all on table public.inbox_conversations from public, anon, authenticated;
revoke all on table public.inbox_messages from public, anon, authenticated;
revoke all on table public.inbox_attachments from public, anon, authenticated;
revoke all on table public.inbox_conversation_notes from public, anon, authenticated;
revoke all on table public.inbox_conversation_events from public, anon, authenticated;
revoke all on table public.inbox_inquiry_links from public, anon, authenticated;
revoke all on table public.meta_webhook_events from public, anon, authenticated;

grant select on table public.meta_page_connections to authenticated;
grant select on table public.inbox_contacts to authenticated;
grant select on table public.inbox_channel_identities to authenticated;
grant select on table public.inbox_conversations to authenticated;
grant select on table public.inbox_messages to authenticated;
grant select on table public.inbox_attachments to authenticated;
grant select on table public.inbox_conversation_notes to authenticated;
grant select on table public.inbox_conversation_events to authenticated;
grant select on table public.inbox_inquiry_links to authenticated;

grant select, insert, update, delete on table public.meta_page_connections to service_role;
grant select, insert, update, delete on table public.inbox_contacts to service_role;
grant select, insert, update, delete on table public.inbox_channel_identities to service_role;
grant select, insert, update, delete on table public.inbox_conversations to service_role;
grant select, insert, update, delete on table public.inbox_messages to service_role;
grant select, insert, update, delete on table public.inbox_attachments to service_role;
grant select, insert, update, delete on table public.inbox_conversation_notes to service_role;
grant select, insert, update, delete on table public.inbox_conversation_events to service_role;
grant select, insert, update, delete on table public.inbox_inquiry_links to service_role;
grant select, insert, update, delete on table public.meta_webhook_events to service_role;

revoke all on function public.inbox_set_updated_at() from public, anon, authenticated;
revoke all on function public.inbox_touch_conversation_from_message() from public, anon, authenticated;

-- Align locked Figma Source of Truth: Cashier / Front Desk has Inbox visible.
insert into public.admin_role_module_permissions (role_key, module_key, can_access)
values ('cashier_front_desk', 'inbox', true)
on conflict (role_key, module_key)
do update set can_access = excluded.can_access;
