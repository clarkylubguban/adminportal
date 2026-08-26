-- Facebook / Meta Inbox F4 reply and ownership workflow.
-- Additive only. F4 consumes the canonical People & Access action contract.
-- Meta Page access tokens remain server-only environment variables.

do $$
begin
  if to_regclass('public.admin_actions') is null then
    raise exception using errcode = '42P01', message = 'PEOPLE_ACCESS_ACTIONS_REQUIRED';
  end if;

  if to_regclass('public.admin_role_action_permissions') is null then
    raise exception using errcode = '42P01', message = 'PEOPLE_ACCESS_ACTION_PERMISSIONS_REQUIRED';
  end if;

  if to_regclass('public.admin_temporary_module_grants') is null then
    raise exception using errcode = '42P01', message = 'PEOPLE_ACCESS_TEMPORARY_MODULE_GRANTS_REQUIRED';
  end if;

  if to_regprocedure('public.has_admin_action_permission(text)') is null then
    raise exception using errcode = '42883', message = 'PEOPLE_ACCESS_ACTION_PERMISSION_FUNCTION_REQUIRED';
  end if;

  if to_regprocedure('public.admin_legacy_role_to_access_role(text)') is null then
    raise exception using errcode = '42883', message = 'PEOPLE_ACCESS_LEGACY_ROLE_MAPPING_REQUIRED';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'admin_users'
      and column_name = 'access_role_key'
  ) then
    raise exception using errcode = '42703', message = 'PEOPLE_ACCESS_ROLE_KEY_REQUIRED';
  end if;
end;
$$;

insert into public.admin_actions (action_key, name, is_protected)
values
  ('inbox_reply', 'Reply to Inbox customers', false),
  ('inbox_take_ownership', 'Take Inbox ownership', false),
  ('inbox_reassign', 'Reassign Inbox conversations', true),
  ('inbox_internal_note', 'Add Inbox internal notes', false),
  ('inbox_manage_state', 'Manage Inbox follow-up / close', true)
on conflict (action_key) do update
set name = excluded.name,
    is_protected = excluded.is_protected;

insert into public.admin_role_action_permissions (role_key, action_key, can_perform)
values
  ('owner_admin', 'inbox_reply', true),
  ('owner_admin', 'inbox_take_ownership', true),
  ('owner_admin', 'inbox_reassign', true),
  ('owner_admin', 'inbox_internal_note', true),
  ('owner_admin', 'inbox_manage_state', true),
  ('admin_operations', 'inbox_reply', true),
  ('admin_operations', 'inbox_take_ownership', true),
  ('admin_operations', 'inbox_reassign', true),
  ('admin_operations', 'inbox_internal_note', true),
  ('admin_operations', 'inbox_manage_state', true),
  ('cashier_front_desk', 'inbox_reply', true),
  ('cashier_front_desk', 'inbox_take_ownership', true),
  ('cashier_front_desk', 'inbox_reassign', false),
  ('cashier_front_desk', 'inbox_internal_note', true),
  ('cashier_front_desk', 'inbox_manage_state', true),
  ('production_staff', 'inbox_reply', false),
  ('production_staff', 'inbox_take_ownership', false),
  ('production_staff', 'inbox_reassign', false),
  ('production_staff', 'inbox_internal_note', false),
  ('production_staff', 'inbox_manage_state', false),
  ('staff', 'inbox_reply', false),
  ('staff', 'inbox_take_ownership', false),
  ('staff', 'inbox_reassign', false),
  ('staff', 'inbox_internal_note', false),
  ('staff', 'inbox_manage_state', false),
  ('viewer', 'inbox_reply', false),
  ('viewer', 'inbox_take_ownership', false),
  ('viewer', 'inbox_reassign', false),
  ('viewer', 'inbox_internal_note', false),
  ('viewer', 'inbox_manage_state', false)
on conflict (role_key, action_key) do update
set can_perform = excluded.can_perform;

create table if not exists public.inbox_outbound_attempts (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.inbox_conversations(id) on delete cascade,
  actor_user_id uuid not null references public.admin_users(user_id) on delete restrict,
  idempotency_key text not null,
  body_hash text not null,
  status text not null default 'sending',
  external_message_id text,
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inbox_outbound_attempts_idempotency_unique unique (idempotency_key),
  constraint inbox_outbound_attempts_status_check check (status in ('sending','sent','failed','unknown')),
  constraint inbox_outbound_attempts_idempotency_check check (length(btrim(idempotency_key)) between 8 and 240),
  constraint inbox_outbound_attempts_hash_check check (length(btrim(body_hash)) between 16 and 128),
  constraint inbox_outbound_attempts_external_check check (
    external_message_id is null or length(btrim(external_message_id)) between 1 and 500
  ),
  constraint inbox_outbound_attempts_error_check check (
    error_code is null or length(btrim(error_code)) between 1 and 120
  )
);

create unique index if not exists inbox_outbound_attempts_active_conversation_uidx
  on public.inbox_outbound_attempts (conversation_id)
  where status in ('sending','unknown');

create index if not exists inbox_outbound_attempts_conversation_idx
  on public.inbox_outbound_attempts (conversation_id, created_at desc);

drop trigger if exists inbox_outbound_attempts_set_updated_at on public.inbox_outbound_attempts;
create trigger inbox_outbound_attempts_set_updated_at
before update on public.inbox_outbound_attempts
for each row execute function public.inbox_set_updated_at();

alter table public.inbox_outbound_attempts enable row level security;
revoke all on table public.inbox_outbound_attempts from public, anon, authenticated;
grant select, insert, update, delete on table public.inbox_outbound_attempts to service_role;

create or replace function public.inbox_f4_access_role(admin_row public.admin_users)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(admin_row.access_role_key, ''),
    public.admin_legacy_role_to_access_role(admin_row.role)
  )
$$;

create or replace function public.inbox_f4_user_has_action(p_actor_user_id uuid, p_action_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users admin_user
    join public.admin_role_action_permissions permission
      on permission.role_key = public.inbox_f4_access_role(admin_user)
     and permission.action_key = p_action_key
     and permission.can_perform = true
    where admin_user.user_id = p_actor_user_id
      and admin_user.is_active = true
  )
$$;

create or replace function public.inbox_f4_user_can_access_module(p_user_id uuid, p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users admin_user
    where admin_user.user_id = p_user_id
      and admin_user.is_active = true
      and coalesce(admin_user.is_test, false) = false
      and (
        exists (
          select 1
          from public.admin_role_module_permissions permission
          where permission.role_key = public.inbox_f4_access_role(admin_user)
            and permission.module_key = p_module_key
            and permission.can_access = true
        )
        or exists (
          select 1
          from public.admin_temporary_module_grants grant_row
          where grant_row.user_id = p_user_id
            and grant_row.module_key = p_module_key
            and grant_row.revoked_at is null
            and grant_row.starts_at <= now()
            and grant_row.expires_at > now()
        )
      )
  )
$$;

create or replace function public.inbox_f4_conversation_payload(p_conversation_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select to_jsonb(conversation)
  from (
    select id, state, owner_user_id, closed_at, snoozed_until, last_message_at,
      last_inbound_at, last_outbound_at, reply_window_expires_at, updated_at
    from public.inbox_conversations
    where id = p_conversation_id
  ) conversation
$$;

create or replace function public.inbox_clear_inactive_snooze()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state <> 'follow_up' then
    new.snoozed_until := null;
  end if;
  return new;
end;
$$;

drop trigger if exists inbox_conversations_clear_inactive_snooze on public.inbox_conversations;
create trigger inbox_conversations_clear_inactive_snooze
before insert or update on public.inbox_conversations
for each row execute function public.inbox_clear_inactive_snooze();

create or replace function public.reserve_inbox_reply(
  p_conversation_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_body_hash text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation_row public.inbox_conversations%rowtype;
  identity_row public.inbox_channel_identities%rowtype;
  page_row public.meta_page_connections%rowtype;
  existing_attempt public.inbox_outbound_attempts%rowtype;
  attempt_id uuid;
begin
  if not public.inbox_f4_user_has_action(p_actor_user_id, 'inbox_reply') then
    return jsonb_build_object('ok', false, 'error', 'INBOX_REPLY_DENIED');
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then
    return jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_KEY_REQUIRED');
  end if;

  select * into existing_attempt
  from public.inbox_outbound_attempts
  where idempotency_key = p_idempotency_key;

  if found then
    if existing_attempt.body_hash <> p_body_hash then
      return jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_BODY_MISMATCH');
    end if;
    if existing_attempt.status = 'sent' then
      return jsonb_build_object('ok', true, 'replay', true, 'attemptId', existing_attempt.id);
    end if;
    if existing_attempt.status = 'unknown' then
      return jsonb_build_object('ok', false, 'error', 'SEND_STATUS_UNKNOWN');
    end if;
    return jsonb_build_object('ok', false, 'error', 'SEND_IN_PROGRESS');
  end if;

  select * into conversation_row
  from public.inbox_conversations
  where id = p_conversation_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'CONVERSATION_NOT_FOUND');
  end if;
  if p_expected_updated_at is not null and conversation_row.updated_at <> p_expected_updated_at then
    return jsonb_build_object('ok', false, 'error', 'CONVERSATION_CHANGED');
  end if;
  if conversation_row.state = 'closed' then
    return jsonb_build_object('ok', false, 'error', 'CONVERSATION_CLOSED');
  end if;
  if conversation_row.reply_window_expires_at is null or conversation_row.reply_window_expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'REPLY_WINDOW_CLOSED');
  end if;
  if conversation_row.owner_user_id is null then
    if not public.inbox_f4_user_has_action(p_actor_user_id, 'inbox_take_ownership') then
      return jsonb_build_object('ok', false, 'error', 'INBOX_TAKE_OWNERSHIP_DENIED');
    end if;
    update public.inbox_conversations
    set owner_user_id = p_actor_user_id
    where id = p_conversation_id
    returning * into conversation_row;
    insert into public.inbox_conversation_events (conversation_id, event_type, actor_user_id, actor_kind, idempotency_key)
    values (p_conversation_id, 'owner_claimed', p_actor_user_id, 'user', p_idempotency_key || ':claim')
    on conflict do nothing;
  elsif conversation_row.owner_user_id <> p_actor_user_id then
    return jsonb_build_object('ok', false, 'error', 'CONVERSATION_OWNED_BY_OTHER');
  end if;

  if exists (
    select 1 from public.inbox_outbound_attempts
    where conversation_id = p_conversation_id and status = 'unknown'
  ) then
    return jsonb_build_object('ok', false, 'error', 'SEND_STATUS_UNKNOWN');
  end if;

  if exists (
    select 1 from public.inbox_outbound_attempts
    where conversation_id = p_conversation_id and status = 'sending'
  ) then
    return jsonb_build_object('ok', false, 'error', 'SEND_IN_PROGRESS');
  end if;

  select * into identity_row
  from public.inbox_channel_identities
  where id = conversation_row.channel_identity_id;

  select * into page_row
  from public.meta_page_connections
  where id = identity_row.page_connection_id;

  insert into public.inbox_outbound_attempts (
    conversation_id, actor_user_id, idempotency_key, body_hash, status
  )
  values (p_conversation_id, p_actor_user_id, p_idempotency_key, p_body_hash, 'sending')
  returning id into attempt_id;

  return jsonb_build_object(
    'ok', true,
    'attemptId', attempt_id,
    'pageId', page_row.page_id,
    'customerPsid', identity_row.external_user_id,
    'conversationId', p_conversation_id
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'SEND_IN_PROGRESS');
end;
$$;

create or replace function public.complete_inbox_reply(
  p_attempt_id uuid,
  p_external_message_id text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_row public.inbox_outbound_attempts%rowtype;
  message_row public.inbox_messages%rowtype;
begin
  select * into attempt_row
  from public.inbox_outbound_attempts
  where id = p_attempt_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'ATTEMPT_NOT_FOUND');
  end if;
  if attempt_row.status = 'sent' then
    return jsonb_build_object('ok', true, 'message', null, 'conversation', public.inbox_f4_conversation_payload(attempt_row.conversation_id));
  end if;

  update public.inbox_outbound_attempts
  set status = 'sent',
      external_message_id = p_external_message_id,
      error_code = null,
      completed_at = now()
  where id = p_attempt_id;

  insert into public.inbox_messages (
    conversation_id,
    provider,
    external_message_id,
    direction,
    message_type,
    body,
    sender_user_id,
    is_echo,
    sent_at,
    metadata
  )
  values (
    attempt_row.conversation_id,
    'meta',
    p_external_message_id,
    'outbound',
    'text',
    p_body,
    attempt_row.actor_user_id,
    false,
    now(),
    '{}'::jsonb
  )
  on conflict (provider, external_message_id) where external_message_id is not null do update
  set
    sender_user_id = coalesce(public.inbox_messages.sender_user_id, excluded.sender_user_id),
    body = coalesce(public.inbox_messages.body, excluded.body)
  returning * into message_row;

  update public.inbox_conversations
  set state = 'waiting',
      snoozed_until = null
  where id = attempt_row.conversation_id;

  insert into public.inbox_conversation_events (conversation_id, event_type, actor_user_id, actor_kind, idempotency_key)
  values (attempt_row.conversation_id, 'reply_sent', attempt_row.actor_user_id, 'user', attempt_row.idempotency_key || ':sent')
  on conflict do nothing;

  return jsonb_build_object(
    'ok', true,
    'message', to_jsonb(message_row),
    'conversation', public.inbox_f4_conversation_payload(attempt_row.conversation_id)
  );
end;
$$;

create or replace function public.fail_inbox_reply(
  p_attempt_id uuid,
  p_status text,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('failed', 'unknown') then
    return jsonb_build_object('ok', false, 'error', 'ATTEMPT_STATUS_INVALID');
  end if;

  update public.inbox_outbound_attempts
  set status = p_status,
      error_code = nullif(btrim(p_error_code), ''),
      completed_at = case when p_status = 'failed' then now() else completed_at end
  where id = p_attempt_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.mutate_inbox_assignment(
  p_conversation_id uuid,
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_expected_updated_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation_row public.inbox_conversations%rowtype;
  event_type text;
begin
  select * into conversation_row
  from public.inbox_conversations
  where id = p_conversation_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'CONVERSATION_NOT_FOUND');
  end if;
  if p_expected_updated_at is not null and conversation_row.updated_at <> p_expected_updated_at then
    return jsonb_build_object('ok', false, 'error', 'CONVERSATION_CHANGED');
  end if;
  if conversation_row.state = 'closed' then
    return jsonb_build_object('ok', false, 'error', 'CONVERSATION_CLOSED');
  end if;
  if not public.inbox_f4_user_can_access_module(p_target_user_id, 'inbox') then
    return jsonb_build_object('ok', false, 'error', 'ASSIGNMENT_TARGET_DENIED');
  end if;

  if p_target_user_id = p_actor_user_id and conversation_row.owner_user_id is null then
    if not public.inbox_f4_user_has_action(p_actor_user_id, 'inbox_take_ownership') then
      return jsonb_build_object('ok', false, 'error', 'INBOX_TAKE_OWNERSHIP_DENIED');
    end if;
    event_type := 'owner_claimed';
  else
    if not public.inbox_f4_user_has_action(p_actor_user_id, 'inbox_reassign') then
      return jsonb_build_object('ok', false, 'error', 'INBOX_REASSIGN_DENIED');
    end if;
    event_type := 'owner_reassigned';
  end if;

  update public.inbox_conversations
  set owner_user_id = p_target_user_id
  where id = p_conversation_id;

  insert into public.inbox_conversation_events (conversation_id, event_type, actor_user_id, actor_kind, payload, idempotency_key)
  values (
    p_conversation_id,
    event_type,
    p_actor_user_id,
    'user',
    jsonb_build_object('previousOwnerUserId', conversation_row.owner_user_id, 'newOwnerUserId', p_target_user_id),
    p_idempotency_key
  )
  on conflict do nothing;

  return jsonb_build_object('ok', true, 'conversation', public.inbox_f4_conversation_payload(p_conversation_id));
end;
$$;

create or replace function public.add_inbox_internal_note(
  p_conversation_id uuid,
  p_actor_user_id uuid,
  p_body text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  note_row public.inbox_conversation_notes%rowtype;
begin
  if not public.inbox_f4_user_has_action(p_actor_user_id, 'inbox_internal_note') then
    return jsonb_build_object('ok', false, 'error', 'INBOX_INTERNAL_NOTE_DENIED');
  end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 4000 then
    return jsonb_build_object('ok', false, 'error', 'NOTE_BODY_INVALID');
  end if;
  if exists (select 1 from public.inbox_conversation_events where idempotency_key = p_idempotency_key) then
    return jsonb_build_object('ok', true, 'note', null, 'conversation', public.inbox_f4_conversation_payload(p_conversation_id));
  end if;

  insert into public.inbox_conversation_notes (conversation_id, body, created_by_user_id)
  values (p_conversation_id, btrim(p_body), p_actor_user_id)
  returning * into note_row;

  insert into public.inbox_conversation_events (conversation_id, event_type, actor_user_id, actor_kind, idempotency_key)
  values (p_conversation_id, 'internal_note_added', p_actor_user_id, 'user', p_idempotency_key)
  on conflict do nothing;

  return jsonb_build_object('ok', true, 'note', to_jsonb(note_row), 'conversation', public.inbox_f4_conversation_payload(p_conversation_id));
end;
$$;

create or replace function public.schedule_inbox_follow_up(
  p_conversation_id uuid,
  p_actor_user_id uuid,
  p_snoozed_until timestamptz,
  p_reason text,
  p_expected_updated_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation_row public.inbox_conversations%rowtype;
begin
  if not public.inbox_f4_user_has_action(p_actor_user_id, 'inbox_manage_state') then
    return jsonb_build_object('ok', false, 'error', 'INBOX_MANAGE_STATE_DENIED');
  end if;
  if p_snoozed_until is null or p_snoozed_until <= now() then
    return jsonb_build_object('ok', false, 'error', 'FOLLOW_UP_TIME_INVALID');
  end if;

  select * into conversation_row
  from public.inbox_conversations
  where id = p_conversation_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'CONVERSATION_NOT_FOUND');
  end if;
  if p_expected_updated_at is not null and conversation_row.updated_at <> p_expected_updated_at then
    return jsonb_build_object('ok', false, 'error', 'CONVERSATION_CHANGED');
  end if;
  if conversation_row.state = 'closed' then
    return jsonb_build_object('ok', false, 'error', 'CONVERSATION_CLOSED');
  end if;

  update public.inbox_conversations
  set state = 'follow_up',
      snoozed_until = p_snoozed_until
  where id = p_conversation_id;

  insert into public.inbox_conversation_events (conversation_id, event_type, actor_user_id, actor_kind, payload, idempotency_key)
  values (
    p_conversation_id,
    'follow_up_scheduled',
    p_actor_user_id,
    'user',
    jsonb_build_object('snoozedUntil', p_snoozed_until, 'reason', nullif(btrim(coalesce(p_reason, '')), '')),
    p_idempotency_key
  )
  on conflict do nothing;

  return jsonb_build_object('ok', true, 'conversation', public.inbox_f4_conversation_payload(p_conversation_id));
end;
$$;

create or replace function public.close_inbox_conversation(
  p_conversation_id uuid,
  p_actor_user_id uuid,
  p_expected_updated_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation_row public.inbox_conversations%rowtype;
begin
  if not public.inbox_f4_user_has_action(p_actor_user_id, 'inbox_manage_state') then
    return jsonb_build_object('ok', false, 'error', 'INBOX_MANAGE_STATE_DENIED');
  end if;

  select * into conversation_row
  from public.inbox_conversations
  where id = p_conversation_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'CONVERSATION_NOT_FOUND');
  end if;
  if p_expected_updated_at is not null and conversation_row.updated_at <> p_expected_updated_at then
    return jsonb_build_object('ok', false, 'error', 'CONVERSATION_CHANGED');
  end if;

  update public.inbox_conversations
  set state = 'closed',
      closed_at = coalesce(closed_at, now()),
      snoozed_until = null
  where id = p_conversation_id;

  insert into public.inbox_conversation_events (conversation_id, event_type, actor_user_id, actor_kind, idempotency_key)
  values (p_conversation_id, 'conversation_closed', p_actor_user_id, 'user', p_idempotency_key)
  on conflict do nothing;

  return jsonb_build_object('ok', true, 'conversation', public.inbox_f4_conversation_payload(p_conversation_id));
end;
$$;

revoke all on function public.inbox_f4_access_role(public.admin_users) from public, anon, authenticated;
revoke all on function public.inbox_f4_user_has_action(uuid, text) from public, anon, authenticated;
revoke all on function public.inbox_f4_user_can_access_module(uuid, text) from public, anon, authenticated;
revoke all on function public.inbox_f4_conversation_payload(uuid) from public, anon, authenticated;
revoke all on function public.inbox_clear_inactive_snooze() from public, anon, authenticated;
revoke all on function public.reserve_inbox_reply(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_inbox_reply(uuid, text, text) from public, anon, authenticated;
revoke all on function public.fail_inbox_reply(uuid, text, text) from public, anon, authenticated;
revoke all on function public.mutate_inbox_assignment(uuid, uuid, uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.add_inbox_internal_note(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.schedule_inbox_follow_up(uuid, uuid, timestamptz, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.close_inbox_conversation(uuid, uuid, timestamptz, text) from public, anon, authenticated;

grant execute on function public.reserve_inbox_reply(uuid, uuid, text, text, timestamptz) to service_role;
grant execute on function public.complete_inbox_reply(uuid, text, text) to service_role;
grant execute on function public.fail_inbox_reply(uuid, text, text) to service_role;
grant execute on function public.mutate_inbox_assignment(uuid, uuid, uuid, timestamptz, text) to service_role;
grant execute on function public.add_inbox_internal_note(uuid, uuid, text, text) to service_role;
grant execute on function public.schedule_inbox_follow_up(uuid, uuid, timestamptz, text, timestamptz, text) to service_role;
grant execute on function public.close_inbox_conversation(uuid, uuid, timestamptz, text) to service_role;
