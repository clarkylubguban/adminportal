create or replace function public.task_submit_without_time(
  p_task_id uuid,
  p_expected_version bigint,
  p_submission_note text,
  p_no_time_reason text,
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
  v_submission_id uuid;
  v_now timestamptz := clock_timestamp();
  v_key text := public.task_require_idempotency_key(p_idempotency_key);
  v_fingerprint text := md5(jsonb_build_object(
    'command', 'task_submit_without_time',
    'submissionNote', trim(p_submission_note),
    'noTimeReason', trim(p_no_time_reason)
  )::text);
begin
  select * into v_actor from public.task_current_actor();
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'task not found'; end if;
  if public.task_idempotency_replay(p_task_id, array['SUBMITTED_WITHOUT_TIME'], v_key) then
    perform public.task_assert_replay_fingerprint(p_task_id, v_key, v_fingerprint);
    return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role, true);
  end if;
  if v_task.time_tracking_mode <> 'EXPECTED' then raise exception using errcode = '55000', message = 'no-time fallback requires expected time tracking'; end if;
  if v_task.status not in ('TO_DO', 'NEEDS_REVISION') then raise exception using errcode = '55000', message = 'task cannot be submitted without time in its current state'; end if;
  if v_task.archived_at is not null then raise exception using errcode = '55000', message = 'archived task cannot be submitted'; end if;
  if v_task.assigned_user_id <> v_actor.user_id then raise exception using errcode = '42501', message = 'only the assignee may submit work'; end if;
  if v_task.version <> p_expected_version then raise exception using errcode = '40001', message = 'task version conflict'; end if;
  if nullif(trim(p_submission_note), '') is null then raise exception using errcode = '22023', message = 'submission note is required'; end if;
  if nullif(trim(p_no_time_reason), '') is null or length(trim(p_no_time_reason)) > 2000 then
    raise exception using errcode = '22023', message = 'no-time reason must contain 1 to 2000 characters';
  end if;
  if exists (select 1 from public.task_time_entries where task_id = p_task_id and ended_at is null) then
    raise exception using errcode = '55000', message = 'task with an open timer cannot use no-time fallback';
  end if;

  select coalesce(max(cycle.cycle_number), 0) + 1
  into v_cycle
  from (
    select entry.cycle_number from public.task_time_entries entry where entry.task_id = p_task_id
    union all
    select submission.cycle_number from public.task_submissions submission where submission.task_id = p_task_id
  ) cycle;

  insert into public.task_submissions (
    task_id, cycle_number, submitted_by_user_id, submission_note, proof_url,
    submitted_at, time_recording_status, no_time_reason
  )
  values (
    p_task_id, v_cycle, v_actor.user_id, trim(p_submission_note), null,
    v_now, 'NOT_RECORDED', trim(p_no_time_reason)
  )
  returning id into v_submission_id;
  update public.tasks set status = 'FOR_REVIEW' where id = p_task_id;
  perform public.task_write_event(
    p_task_id, 'SUBMITTED_WITHOUT_TIME', v_actor.user_id, v_actor.actor_role,
    v_task.status, 'FOR_REVIEW',
    jsonb_build_object(
      'cycleNumber', v_cycle,
      'submissionId', v_submission_id,
      'timeRecordingStatus', 'NOT_RECORDED',
      '_requestFingerprint', v_fingerprint
    ),
    trim(p_no_time_reason), v_key, true
  );
  return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role);
end;
$$;

create or replace function public.task_request_revision(
  p_task_id uuid,
  p_expected_version bigint,
  p_review_note text,
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
  v_submission_id uuid;
  v_now timestamptz := clock_timestamp();
  v_key text := public.task_require_idempotency_key(p_idempotency_key);
  v_fingerprint text := md5(jsonb_build_object(
    'command', 'task_request_revision',
    'reviewNote', trim(p_review_note)
  )::text);
begin
  select * into v_actor from public.task_current_actor();
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'task not found'; end if;
  if public.task_idempotency_replay(p_task_id, array['REVISION_REQUESTED'], v_key) then
    perform public.task_assert_replay_fingerprint(p_task_id, v_key, v_fingerprint);
    return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role, true);
  end if;
  if v_task.status <> 'FOR_REVIEW' then raise exception using errcode = '55000', message = 'task is not awaiting review'; end if;
  if v_task.version <> p_expected_version then raise exception using errcode = '40001', message = 'task version conflict'; end if;
  if nullif(trim(p_review_note), '') is null then raise exception using errcode = '22023', message = 'revision note is required'; end if;
  if not (
    v_actor.actor_role = 'owner'
    or (v_actor.actor_role = 'admin' and v_task.reviewer_user_id = v_actor.user_id)
  ) then
    raise exception using errcode = '42501', message = 'only the owner or designated admin reviewer may review';
  end if;

  select id into v_submission_id
  from public.task_submissions
  where task_id = p_task_id and review_decision = 'PENDING'
  for update;
  if not found then raise exception using errcode = '55000', message = 'pending submission not found'; end if;

  update public.task_submissions
  set review_decision = 'REVISION_REQUESTED',
      reviewer_user_id = v_actor.user_id,
      review_note = trim(p_review_note),
      reviewed_at = v_now
  where id = v_submission_id;
  update public.tasks set status = 'NEEDS_REVISION' where id = p_task_id;
  perform public.task_write_event(
    p_task_id, 'REVISION_REQUESTED', v_actor.user_id, v_actor.actor_role,
    'FOR_REVIEW', 'NEEDS_REVISION',
    jsonb_build_object('_requestFingerprint', v_fingerprint),
    trim(p_review_note), v_key, true
  );
  return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role);
end;
$$;

create or replace function public.task_start_revision(
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
  if public.task_idempotency_replay(p_task_id, array['REVISION_STARTED'], v_key) then
    return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role, true);
  end if;
  if v_task.status <> 'NEEDS_REVISION' then raise exception using errcode = '55000', message = 'task does not need revision'; end if;
  if v_task.time_tracking_mode <> 'EXPECTED' then raise exception using errcode = '55000', message = 'task does not use time tracking'; end if;
  if v_task.assigned_user_id <> v_actor.user_id then raise exception using errcode = '42501', message = 'only the assignee may start revision'; end if;
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
    p_task_id, 'REVISION_STARTED', v_actor.user_id, v_actor.actor_role,
    'NEEDS_REVISION', 'IN_PROGRESS', jsonb_build_object('cycleNumber', v_cycle),
    null, v_key, true
  );
  return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role);
end;
$$;

create or replace function public.task_approve_work(
  p_task_id uuid,
  p_expected_version bigint,
  p_review_note text,
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
  v_submission_id uuid;
  v_now timestamptz := clock_timestamp();
  v_key text := public.task_require_idempotency_key(p_idempotency_key);
  v_fingerprint text := md5(jsonb_build_object(
    'command', 'task_approve_work',
    'reviewNote', nullif(trim(p_review_note), '')
  )::text);
begin
  select * into v_actor from public.task_current_actor();
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'task not found'; end if;
  if public.task_idempotency_replay(p_task_id, array['WORK_APPROVED', 'COMPLETED'], v_key) then
    perform public.task_assert_replay_fingerprint(p_task_id, v_key, v_fingerprint);
    return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role, true);
  end if;
  if v_task.status <> 'FOR_REVIEW' then raise exception using errcode = '55000', message = 'task is not awaiting review'; end if;
  if v_task.version <> p_expected_version then raise exception using errcode = '40001', message = 'task version conflict'; end if;
  if not (
    v_actor.actor_role = 'owner'
    or (v_actor.actor_role = 'admin' and v_task.reviewer_user_id = v_actor.user_id)
  ) then
    raise exception using errcode = '42501', message = 'only the owner or designated admin reviewer may approve';
  end if;

  select id into v_submission_id
  from public.task_submissions
  where task_id = p_task_id and review_decision = 'PENDING'
  for update;
  if not found then raise exception using errcode = '55000', message = 'pending submission not found'; end if;

  update public.task_submissions
  set review_decision = 'APPROVED',
      reviewer_user_id = v_actor.user_id,
      review_note = nullif(trim(p_review_note), ''),
      reviewed_at = v_now
  where id = v_submission_id;
  update public.tasks set status = 'DONE', completed_at = v_now where id = p_task_id;
  perform public.task_write_event(
    p_task_id, 'WORK_APPROVED', v_actor.user_id, v_actor.actor_role,
    'FOR_REVIEW', 'DONE',
    jsonb_build_object('_requestFingerprint', v_fingerprint),
    nullif(trim(p_review_note), ''), v_key, true
  );
  perform public.task_write_event(
    p_task_id, 'COMPLETED', v_actor.user_id, v_actor.actor_role,
    'FOR_REVIEW', 'DONE', '{}'::jsonb, null, null, true
  );
  return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role);
end;
$$;;
