create or replace function public.task_cancel(
  p_task_id uuid,
  p_expected_version bigint,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_actor record;
  v_task public.tasks%rowtype;
  v_now timestamptz := clock_timestamp();
  v_key text := public.task_require_idempotency_key(p_idempotency_key);
  v_fingerprint text := md5(jsonb_build_object(
    'command', 'task_cancel',
    'reason', trim(p_reason)
  )::text);
begin
  select * into v_actor from public.task_current_actor();
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'task not found'; end if;
  if public.task_idempotency_replay(p_task_id, array['CANCELLED'], v_key) then
    perform public.task_assert_replay_fingerprint(p_task_id, v_key, v_fingerprint);
    return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role, true);
  end if;
  if v_task.status not in ('DRAFT', 'TO_DO', 'IN_PROGRESS', 'NEEDS_REVISION') then
    raise exception using errcode = '55000', message = 'task cannot be cancelled in its current state';
  end if;
  if v_task.version <> p_expected_version then raise exception using errcode = '40001', message = 'task version conflict'; end if;
  if nullif(trim(p_reason), '') is null then raise exception using errcode = '22023', message = 'cancellation reason is required'; end if;
  if not (
    v_actor.actor_role = 'owner'
    or (
      v_actor.actor_role = 'admin'
      and v_task.source_type = 'MANUAL'
      and (v_task.created_by_user_id = v_actor.user_id or v_task.reviewer_user_id = v_actor.user_id)
    )
  ) then
    raise exception using errcode = '42501', message = 'cancellation is outside the current role scope';
  end if;

  if v_task.status = 'IN_PROGRESS' then
    update public.task_time_entries
    set ended_at = v_now, close_reason = 'TASK_CANCELLED'
    where task_id = p_task_id and ended_at is null;
    if not found then raise exception using errcode = '55000', message = 'in-progress task has no open timer'; end if;
  end if;
  update public.tasks set status = 'CANCELLED', cancelled_at = v_now where id = p_task_id;
  perform public.task_write_event(
    p_task_id, 'CANCELLED', v_actor.user_id, v_actor.actor_role,
    v_task.status, 'CANCELLED',
    jsonb_build_object('_requestFingerprint', v_fingerprint),
    trim(p_reason), v_key, true
  );
  return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role);
end;
$$;

create or replace function public.task_reopen(
  p_task_id uuid,
  p_expected_version bigint,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_actor record;
  v_task public.tasks%rowtype;
  v_key text := public.task_require_idempotency_key(p_idempotency_key);
  v_fingerprint text := md5(jsonb_build_object(
    'command', 'task_reopen', 'reason', trim(p_reason)
  )::text);
begin
  select * into v_actor from public.task_current_actor();
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'task not found'; end if;
  if public.task_idempotency_replay(p_task_id, array['REOPENED'], v_key) then
    perform public.task_assert_replay_fingerprint(p_task_id, v_key, v_fingerprint);
    return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role, true);
  end if;
  if v_actor.actor_role <> 'owner' then raise exception using errcode = '42501', message = 'only owner may reopen tasks'; end if;
  if v_task.status not in ('DONE', 'CANCELLED') then raise exception using errcode = '55000', message = 'only terminal tasks may be reopened'; end if;
  if v_task.version <> p_expected_version then raise exception using errcode = '40001', message = 'task version conflict'; end if;
  if nullif(trim(p_reason), '') is null then raise exception using errcode = '22023', message = 'reopen reason is required'; end if;

  update public.tasks
  set status = 'TO_DO', completed_at = null, cancelled_at = null, archived_at = null
  where id = p_task_id;
  perform public.task_write_event(
    p_task_id, 'REOPENED', v_actor.user_id, v_actor.actor_role,
    v_task.status, 'TO_DO',
    jsonb_build_object('_requestFingerprint', v_fingerprint),
    trim(p_reason), v_key, true
  );
  return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role);
end;
$$;

create or replace function public.task_correct_time_entry(
  p_task_id uuid,
  p_time_entry_id uuid,
  p_expected_version bigint,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_actor record;
  v_task public.tasks%rowtype;
  v_entry public.task_time_entries%rowtype;
  v_key text := public.task_require_idempotency_key(p_idempotency_key);
  v_fingerprint text := md5(jsonb_build_object(
    'command', 'task_correct_time_entry', 'timeEntryId', p_time_entry_id,
    'startedAt', p_started_at, 'endedAt', p_ended_at, 'reason', trim(p_reason)
  )::text);
begin
  select * into v_actor from public.task_current_actor();
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'task not found'; end if;
  if public.task_idempotency_replay(p_task_id, array['TIME_ENTRY_CORRECTED'], v_key) then
    perform public.task_assert_replay_fingerprint(p_task_id, v_key, v_fingerprint);
    return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role, true);
  end if;
  if v_actor.actor_role <> 'owner' then raise exception using errcode = '42501', message = 'only owner may correct time entries'; end if;
  if v_task.version <> p_expected_version then raise exception using errcode = '40001', message = 'task version conflict'; end if;
  if nullif(trim(p_reason), '') is null then raise exception using errcode = '22023', message = 'correction reason is required'; end if;
  if p_started_at is null or (p_ended_at is not null and p_ended_at < p_started_at) then
    raise exception using errcode = '22023', message = 'corrected time range is invalid';
  end if;

  select * into v_entry
  from public.task_time_entries
  where id = p_time_entry_id and task_id = p_task_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'time entry not found'; end if;
  if (v_entry.ended_at is null) <> (p_ended_at is null) then
    raise exception using errcode = '55000', message = 'correction cannot open or close a timer';
  end if;
  if exists (
    select 1
    from public.task_time_entries other_entry
    where other_entry.user_id = v_entry.user_id
      and other_entry.id <> v_entry.id
      and tstzrange(
        other_entry.started_at,
        coalesce(other_entry.ended_at, 'infinity'::timestamptz),
        '[)'
      ) && tstzrange(
        p_started_at,
        coalesce(p_ended_at, 'infinity'::timestamptz),
        '[)'
      )
  ) then
    raise exception using errcode = '23P01', message = 'corrected time overlaps another entry';
  end if;

  update public.task_time_entries
  set started_at = p_started_at,
      ended_at = p_ended_at,
      corrected_at = clock_timestamp(),
      corrected_by_user_id = v_actor.user_id,
      correction_reason = trim(p_reason)
  where id = p_time_entry_id;
  update public.tasks set updated_at = clock_timestamp() where id = p_task_id;
  perform public.task_write_event(
    p_task_id, 'TIME_ENTRY_CORRECTED', v_actor.user_id, v_actor.actor_role,
    v_task.status, v_task.status,
    jsonb_build_object(
      'timeEntryId', p_time_entry_id,
      'oldStartedAt', v_entry.started_at,
      'oldEndedAt', v_entry.ended_at,
      'closeReason', v_entry.close_reason,
      'newStartedAt', p_started_at,
      'newEndedAt', p_ended_at,
      '_requestFingerprint', v_fingerprint
    ),
    trim(p_reason), v_key, false
  );
  return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role);
end;
$$;

create or replace function public.task_archive(
  p_task_id uuid,
  p_expected_version bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_actor record;
  v_task public.tasks%rowtype;
  v_key text := public.task_require_idempotency_key(p_idempotency_key);
begin
  select * into v_actor from public.task_current_actor();
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'task not found'; end if;
  if public.task_idempotency_replay(p_task_id, array['ARCHIVED'], v_key) then
    return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role, true);
  end if;
  if v_task.status not in ('DONE', 'CANCELLED') then raise exception using errcode = '55000', message = 'only terminal tasks may be archived'; end if;
  if v_task.archived_at is not null then raise exception using errcode = '55000', message = 'task is already archived'; end if;
  if v_task.version <> p_expected_version then raise exception using errcode = '40001', message = 'task version conflict'; end if;
  if not (
    v_actor.actor_role = 'owner'
    or (
      v_actor.actor_role = 'admin'
      and v_task.source_type = 'MANUAL'
      and (v_task.created_by_user_id = v_actor.user_id or v_task.reviewer_user_id = v_actor.user_id)
    )
  ) then
    raise exception using errcode = '42501', message = 'archive is outside the current role scope';
  end if;
  if exists (select 1 from public.task_time_entries where task_id = p_task_id and ended_at is null) then
    raise exception using errcode = '55000', message = 'task with an open timer cannot be archived';
  end if;

  update public.tasks set archived_at = clock_timestamp() where id = p_task_id;
  perform public.task_write_event(
    p_task_id, 'ARCHIVED', v_actor.user_id, v_actor.actor_role,
    v_task.status, v_task.status, '{}'::jsonb, null, v_key, false
  );
  return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role);
end;
$$;;
