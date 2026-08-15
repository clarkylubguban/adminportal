-- Transactional command boundary for the hidden task domain.
-- Direct table mutation remains revoked; clients must use these functions.

create or replace function public.task_assert_enabled()
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  if not public.task_domain_enabled() then
    raise exception using
      errcode = '55000',
      message = 'task domain is disabled';
  end if;
end;
$$;

create or replace function public.task_current_actor()
returns table (user_id uuid, actor_role text)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  perform public.task_assert_enabled();

  return query
  select actor.user_id, actor.role
  from public.admin_users actor
  where actor.user_id = auth.uid()
    and actor.is_active = true
    and actor.role in ('owner', 'admin', 'staff')
  limit 1;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'active task-domain account required';
  end if;
end;
$$;

create or replace function public.task_require_idempotency_key(p_key text)
returns text
language plpgsql
volatile
set search_path = pg_catalog
as $$
declare
  v_key text := nullif(trim(p_key), '');
begin
  if v_key is null or length(v_key) > 200 then
    raise exception using
      errcode = '22023',
      message = 'idempotency key must contain 1 to 200 characters';
  end if;
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key, 0));
  return v_key;
end;
$$;

create or replace function public.task_active_user_role(p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_role text;
begin
  if p_user_id is null then
    return null;
  end if;

  select account.role
  into v_role
  from public.admin_users account
  where account.user_id = p_user_id
    and account.is_active = true
    and account.role in ('owner', 'admin', 'staff');

  if v_role is null then
    raise exception using
      errcode = '22023',
      message = 'target user is not an active task-domain account';
  end if;

  return v_role;
end;
$$;

create or replace function public.task_assert_assignment(
  p_actor_role text,
  p_assigned_user_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_target_role text;
begin
  if p_assigned_user_id is null then
    return;
  end if;

  v_target_role := public.task_active_user_role(p_assigned_user_id);
  if p_actor_role = 'owner' then
    return;
  end if;
  if p_actor_role = 'admin' and v_target_role = 'staff' then
    return;
  end if;

  raise exception using
    errcode = '42501',
    message = 'assignment is outside the current role scope';
end;
$$;

create or replace function public.task_assert_reviewer(p_reviewer_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_role text;
begin
  if p_reviewer_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'an active owner or admin reviewer is required';
  end if;

  v_role := public.task_active_user_role(p_reviewer_user_id);
  if v_role not in ('owner', 'admin') then
    raise exception using
      errcode = '22023',
      message = 'reviewer must be an active owner or admin';
  end if;
end;
$$;

create or replace function public.task_idempotency_replay(
  p_task_id uuid,
  p_expected_event_types text[],
  p_idempotency_key text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_task_id uuid;
  v_event_type text;
begin
  select event_record.task_id, event_record.event_type
  into v_task_id, v_event_type
  from public.task_events event_record
  where event_record.idempotency_key = p_idempotency_key
  order by event_record.occurred_at, event_record.id
  limit 1;

  if v_event_type is null then
    if exists (
      select 1
      from public.tasks task
      where task.idempotency_key = p_idempotency_key
    ) then
      raise exception using
        errcode = '23505',
        message = 'idempotency key was already used for another task command';
    end if;
    return false;
  end if;
  if v_task_id = p_task_id and v_event_type = any (p_expected_event_types) then
    return true;
  end if;

  raise exception using
    errcode = '23505',
    message = 'idempotency key was already used for another task command';
end;
$$;

create or replace function public.task_assert_replay_fingerprint(
  p_task_id uuid,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_existing_fingerprint text;
begin
  select event_record.field_changes ->> '_requestFingerprint'
  into v_existing_fingerprint
  from public.task_events event_record
  where event_record.task_id = p_task_id
    and event_record.idempotency_key = p_idempotency_key
    and event_record.field_changes ? '_requestFingerprint'
  order by event_record.occurred_at, event_record.id
  limit 1;

  if v_existing_fingerprint is null
     or v_existing_fingerprint <> p_request_fingerprint then
    raise exception using
      errcode = '23505',
      message = 'idempotency key was reused with a conflicting payload';
  end if;
end;
$$;

create or replace function public.task_write_event(
  p_task_id uuid,
  p_event_type text,
  p_actor_user_id uuid,
  p_actor_role text,
  p_previous_status text,
  p_next_status text,
  p_field_changes jsonb,
  p_reason text,
  p_idempotency_key text,
  p_staff_visible boolean
)
returns void
language sql
volatile
security definer
set search_path = pg_catalog
as $$
  insert into public.task_events (
    task_id,
    event_type,
    actor_kind,
    actor_user_id,
    actor_role,
    previous_status,
    next_status,
    field_changes,
    reason,
    idempotency_key,
    staff_visible
  )
  values (
    p_task_id,
    p_event_type,
    'USER',
    p_actor_user_id,
    p_actor_role,
    p_previous_status,
    p_next_status,
    coalesce(p_field_changes, '{}'::jsonb),
    nullif(trim(p_reason), ''),
    p_idempotency_key,
    p_staff_visible
  );
$$;;
