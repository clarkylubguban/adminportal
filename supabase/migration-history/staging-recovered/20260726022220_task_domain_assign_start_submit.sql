create or replace function public.task_assign(
  p_task_id uuid,
  p_expected_version bigint,
  p_assigned_user_id uuid,
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
  v_event text;
  v_fingerprint text := md5(jsonb_build_object(
    'command', 'task_assign', 'assignedUserId', p_assigned_user_id
  )::text);
begin
  select * into v_actor from public.task_current_actor();
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'task not found'; end if;
  if public.task_idempotency_replay(p_task_id, array['ASSIGNED', 'REASSIGNED'], v_key) then
    perform public.task_assert_replay_fingerprint(p_task_id, v_key, v_fingerprint);
    return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role, true);
  end if;
  if v_actor.actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'only owner or admin may assign tasks';
  end if;
  if v_task.status not in ('DRAFT', 'TO_DO', 'NEEDS_REVISION') then
    raise exception using errcode = '55000', message = 'task cannot be assigned in its current state';
  end if;
  if v_task.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'task version conflict';
  end if;
  if exists (select 1 from public.task_time_entries where task_id = p_task_id and ended_at is null) then
    raise exception using errcode = '55000', message = 'task with an open timer cannot be reassigned';
  end if;

  perform public.task_assert_assignment(v_actor.actor_role, p_assigned_user_id);
  v_event := case when v_task.assigned_user_id is null then 'ASSIGNED' else 'REASSIGNED' end;
  update public.tasks set assigned_user_id = p_assigned_user_id where id = p_task_id;
  perform public.task_write_event(
    p_task_id, v_event, v_actor.user_id, v_actor.actor_role,
    v_task.status, v_task.status,
    jsonb_build_object(
      'assignmentChanged', v_task.assigned_user_id is distinct from p_assigned_user_id,
      '_requestFingerprint', v_fingerprint
    ),
    null, v_key, v_task.status <> 'DRAFT'
  );
  return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role);
end;
$$;

create or replace function public.task_approve_draft(
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
  if public.task_idempotency_replay(p_task_id, array['DRAFT_APPROVED'], v_key) then
    return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role, true);
  end if;
  if v_task.status <> 'DRAFT' then raise exception using errcode = '55000', message = 'task is not a draft'; end if;
  if v_task.version <> p_expected_version then raise exception using errcode = '40001', message = 'task version conflict'; end if;
  if v_task.assigned_user_id is null or v_task.reviewer_user_id is null then
    raise exception using errcode = '22023', message = 'draft requires an assignee and reviewer';
  end if;
  perform public.task_active_user_role(v_task.assigned_user_id);
  perform public.task_assert_reviewer(v_task.reviewer_user_id);
  if v_actor.actor_role = 'owner' then null;
  elsif v_actor.actor_role = 'admin'
        and v_task.source_type = 'MANUAL'
        and v_task.draft_approval_required = false then null;
  else
    raise exception using errcode = '42501', message = 'owner approval is required for this draft';
  end if;

  update public.tasks set status = 'TO_DO' where id = p_task_id;
  perform public.task_write_event(
    p_task_id, 'DRAFT_APPROVED', v_actor.user_id, v_actor.actor_role,
    'DRAFT', 'TO_DO', '{}'::jsonb, null, v_key, true
  );
  return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role);
end;
$$;

create or replace function public.task_start_work(
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
  v_cycle integer;
  v_now timestamptz := clock_timestamp();
  v_key text := public.task_require_idempotency_key(p_idempotency_key);
begin
  select * into v_actor from public.task_current_actor();
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'task not found'; end if;
  if public.task_idempotency_replay(p_task_id, array['STARTED'], v_key) then
    return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role, true);
  end if;
  if v_task.status <> 'TO_DO' then raise exception using errcode = '55000', message = 'task is not ready to start'; end if;
  if v_task.time_tracking_mode <> 'EXPECTED' then raise exception using errcode = '55000', message = 'task does not use time tracking'; end if;
  if v_task.assigned_user_id <> v_actor.user_id then raise exception using errcode = '42501', message = 'only the assignee may start work'; end if;
  if v_task.version <> p_expected_version then raise exception using errcode = '40001', message = 'task version conflict'; end if;

  select coalesce(max(cycle.cycle_number), 0) + 1
  into v_cycle
  from (
    select entry.cycle_number from public.task_time_entries entry where entry.task_id = p_task_id
    union all
    select submission.cycle_number from public.task_submissions submission where submission.task_id = p_task_id
  ) cycle;

  insert into public.task_time_entries (task_id, user_id, cycle_number, started_at)
  values (p_task_id, v_actor.user_id, v_cycle, v_now);
  update public.tasks set status = 'IN_PROGRESS' where id = p_task_id;
  perform public.task_write_event(
    p_task_id, 'STARTED', v_actor.user_id, v_actor.actor_role,
    'TO_DO', 'IN_PROGRESS', jsonb_build_object('cycleNumber', v_cycle),
    null, v_key, true
  );
  return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role);
end;
$$;

create or replace function public.task_submit_for_review(
  p_task_id uuid,
  p_expected_version bigint,
  p_submission_note text,
  p_proof_url text,
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
  v_previous_status text;
  v_time_status text;
  v_cycle integer;
  v_submission_id uuid;
  v_now timestamptz := clock_timestamp();
  v_key text := public.task_require_idempotency_key(p_idempotency_key);
  v_fingerprint text := md5(jsonb_build_object(
    'command', 'task_submit_for_review',
    'submissionNote', trim(p_submission_note),
    'proofUrl', nullif(trim(p_proof_url), '')
  )::text);
begin
  select * into v_actor from public.task_current_actor();
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'task not found'; end if;
  if public.task_idempotency_replay(p_task_id, array['SUBMITTED'], v_key) then
    perform public.task_assert_replay_fingerprint(p_task_id, v_key, v_fingerprint);
    return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role, true);
  end if;
  if v_task.assigned_user_id <> v_actor.user_id then raise exception using errcode = '42501', message = 'only the assignee may submit work'; end if;
  if v_task.version <> p_expected_version then raise exception using errcode = '40001', message = 'task version conflict'; end if;
  if nullif(trim(p_submission_note), '') is null then raise exception using errcode = '22023', message = 'submission note is required'; end if;
  if v_task.archived_at is not null then raise exception using errcode = '55000', message = 'archived task cannot be submitted'; end if;

  v_previous_status := v_task.status;
  if v_task.time_tracking_mode = 'EXPECTED' then
    if v_task.status <> 'IN_PROGRESS' then raise exception using errcode = '55000', message = 'expected-time task is not in progress'; end if;
    select * into v_entry
    from public.task_time_entries
    where task_id = p_task_id and ended_at is null
    for update;
    if not found or v_entry.user_id <> v_actor.user_id then
      raise exception using errcode = '55000', message = 'the assignee must have an open timer';
    end if;
    update public.task_time_entries
    set ended_at = v_now, close_reason = 'SUBMITTED'
    where id = v_entry.id;
    v_cycle := v_entry.cycle_number;
    v_time_status := 'RECORDED';
  elsif v_task.time_tracking_mode = 'NONE' then
    if v_task.status not in ('TO_DO', 'NEEDS_REVISION') then
      raise exception using errcode = '55000', message = 'no-time task cannot be submitted in its current state';
    end if;
    if exists (select 1 from public.task_time_entries where task_id = p_task_id and ended_at is null) then
      raise exception using errcode = '55000', message = 'no-time task has an unexpected open timer';
    end if;
    select coalesce(max(cycle.cycle_number), 0) + 1
    into v_cycle
    from (
      select entry.cycle_number from public.task_time_entries entry where entry.task_id = p_task_id
      union all
      select submission.cycle_number from public.task_submissions submission where submission.task_id = p_task_id
    ) cycle;
    v_time_status := 'NOT_REQUIRED';
  else
    raise exception using errcode = '22023', message = 'task time tracking mode is invalid';
  end if;

  insert into public.task_submissions (
    task_id, cycle_number, submitted_by_user_id, submission_note, proof_url,
    submitted_at, time_recording_status, no_time_reason
  )
  values (
    p_task_id, v_cycle, v_actor.user_id, trim(p_submission_note),
    nullif(trim(p_proof_url), ''), v_now, v_time_status, null
  )
  returning id into v_submission_id;
  update public.tasks set status = 'FOR_REVIEW' where id = p_task_id;
  perform public.task_write_event(
    p_task_id, 'SUBMITTED', v_actor.user_id, v_actor.actor_role,
    v_previous_status, 'FOR_REVIEW',
    jsonb_build_object(
      'cycleNumber', v_cycle,
      'submissionId', v_submission_id,
      'timeRecordingStatus', v_time_status,
      'hasProof', nullif(trim(p_proof_url), '') is not null,
      '_requestFingerprint', v_fingerprint
    ),
    null, v_key, true
  );
  return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role);
end;
$$;;
