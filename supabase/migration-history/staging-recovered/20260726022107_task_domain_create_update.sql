create or replace function public.task_create(
  p_title text,
  p_brief text,
  p_source_type text,
  p_source_record_type text,
  p_source_record_id text,
  p_priority text,
  p_assigned_user_id uuid,
  p_reviewer_user_id uuid,
  p_draft_approval_required boolean,
  p_scheduled_date date,
  p_start_deadline timestamptz,
  p_submission_deadline timestamptz,
  p_approval_deadline timestamptz,
  p_external_workflow_id text,
  p_external_task_number text,
  p_idempotency_key text,
  p_time_tracking_mode text default 'EXPECTED'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_actor record;
  v_task_id uuid;
  v_key text := public.task_require_idempotency_key(p_idempotency_key);
  v_requires_approval boolean;
  v_fingerprint text := md5(jsonb_build_object(
    'command', 'task_create',
    'title', trim(p_title),
    'brief', trim(p_brief),
    'sourceType', p_source_type,
    'sourceRecordType', nullif(trim(p_source_record_type), ''),
    'sourceRecordId', nullif(trim(p_source_record_id), ''),
    'priority', p_priority,
    'timeTrackingMode', p_time_tracking_mode,
    'assignedUserId', p_assigned_user_id,
    'reviewerUserId', p_reviewer_user_id,
    'draftApprovalRequired', coalesce(p_draft_approval_required, false),
    'scheduledDate', p_scheduled_date,
    'startDeadline', p_start_deadline,
    'submissionDeadline', p_submission_deadline,
    'approvalDeadline', p_approval_deadline,
    'externalWorkflowId', nullif(trim(p_external_workflow_id), ''),
    'externalTaskNumber', nullif(trim(p_external_task_number), '')
  )::text);
begin
  select * into v_actor from public.task_current_actor();
  if v_actor.actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'only owner or admin may create tasks';
  end if;
  if v_actor.actor_role = 'admin' and p_source_type <> 'MANUAL' then
    raise exception using errcode = '42501', message = 'admin creation is limited to manual tasks';
  end if;

  select task.id into v_task_id
  from public.tasks task
  where task.idempotency_key = v_key;
  if v_task_id is not null then
    perform public.task_assert_replay_fingerprint(v_task_id, v_key, v_fingerprint);
    return public.task_command_result(v_task_id, v_actor.user_id, v_actor.actor_role, true);
  end if;
  if exists (
    select 1
    from public.task_events event_record
    where event_record.idempotency_key = v_key
  ) then
    raise exception using
      errcode = '23505',
      message = 'idempotency key was already used for another task command';
  end if;

  perform public.task_assert_assignment(v_actor.actor_role, p_assigned_user_id);
  if p_reviewer_user_id is not null then
    perform public.task_assert_reviewer(p_reviewer_user_id);
  end if;

  v_requires_approval :=
    coalesce(p_draft_approval_required, false)
    or p_source_type = 'AI_MARKETING'
    or p_external_workflow_id is not null;

  insert into public.tasks (
    title, brief, source_type, source_record_type, source_record_id,
    priority, time_tracking_mode, assigned_user_id, reviewer_user_id, created_by_user_id,
    draft_approval_required, scheduled_date, start_deadline,
    submission_deadline, approval_deadline, external_workflow_id,
    external_task_number, idempotency_key
  )
  values (
    trim(p_title), trim(p_brief), p_source_type,
    nullif(trim(p_source_record_type), ''), nullif(trim(p_source_record_id), ''),
    p_priority, p_time_tracking_mode, p_assigned_user_id, p_reviewer_user_id, v_actor.user_id,
    v_requires_approval, p_scheduled_date, p_start_deadline,
    p_submission_deadline, p_approval_deadline,
    nullif(trim(p_external_workflow_id), ''),
    nullif(trim(p_external_task_number), ''), v_key
  )
  on conflict (idempotency_key)
    where idempotency_key is not null
    do nothing
  returning id into v_task_id;

  if v_task_id is null then
    select task.id into v_task_id
    from public.tasks task
    where task.idempotency_key = v_key;
    perform public.task_assert_replay_fingerprint(v_task_id, v_key, v_fingerprint);
    return public.task_command_result(v_task_id, v_actor.user_id, v_actor.actor_role, true);
  end if;

  perform public.task_write_event(
    v_task_id, 'TASK_CREATED', v_actor.user_id, v_actor.actor_role,
    null, 'DRAFT',
    jsonb_build_object(
      'sourceType', p_source_type,
      'timeTrackingMode', p_time_tracking_mode,
      'assignedUserId', p_assigned_user_id,
      'reviewerUserId', p_reviewer_user_id,
      'draftApprovalRequired', v_requires_approval,
      '_requestFingerprint', v_fingerprint
    ),
    null, v_key, false
  );

  return public.task_command_result(v_task_id, v_actor.user_id, v_actor.actor_role);
end;
$$;

create or replace function public.task_update_draft(
  p_task_id uuid,
  p_expected_version bigint,
  p_title text,
  p_brief text,
  p_priority text,
  p_assigned_user_id uuid,
  p_reviewer_user_id uuid,
  p_draft_approval_required boolean,
  p_scheduled_date date,
  p_start_deadline timestamptz,
  p_submission_deadline timestamptz,
  p_approval_deadline timestamptz,
  p_idempotency_key text,
  p_time_tracking_mode text default 'EXPECTED'
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
    'command', 'task_update_draft', 'title', trim(p_title), 'brief', trim(p_brief),
    'priority', p_priority, 'timeTrackingMode', p_time_tracking_mode,
    'assignedUserId', p_assigned_user_id,
    'reviewerUserId', p_reviewer_user_id,
    'draftApprovalRequired', coalesce(p_draft_approval_required, false),
    'scheduledDate', p_scheduled_date, 'startDeadline', p_start_deadline,
    'submissionDeadline', p_submission_deadline, 'approvalDeadline', p_approval_deadline
  )::text);
begin
  select * into v_actor from public.task_current_actor();
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'task not found'; end if;
  if public.task_idempotency_replay(p_task_id, array['DRAFT_UPDATED'], v_key) then
    perform public.task_assert_replay_fingerprint(p_task_id, v_key, v_fingerprint);
    return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role, true);
  end if;
  if v_actor.actor_role not in ('owner', 'admin')
     or (v_actor.actor_role = 'admin' and v_task.source_type <> 'MANUAL') then
    raise exception using errcode = '42501', message = 'draft update is outside the current role scope';
  end if;
  if v_task.status <> 'DRAFT' then
    raise exception using errcode = '55000', message = 'only draft tasks may be edited';
  end if;
  if v_task.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'task version conflict';
  end if;

  perform public.task_assert_assignment(v_actor.actor_role, p_assigned_user_id);
  if p_reviewer_user_id is not null then perform public.task_assert_reviewer(p_reviewer_user_id); end if;

  update public.tasks
  set title = trim(p_title),
      brief = trim(p_brief),
      priority = p_priority,
      time_tracking_mode = p_time_tracking_mode,
      assigned_user_id = p_assigned_user_id,
      reviewer_user_id = p_reviewer_user_id,
      draft_approval_required = coalesce(p_draft_approval_required, false)
        or source_type = 'AI_MARKETING'
        or external_workflow_id is not null,
      scheduled_date = p_scheduled_date,
      start_deadline = p_start_deadline,
      submission_deadline = p_submission_deadline,
      approval_deadline = p_approval_deadline
  where id = p_task_id;

  perform public.task_write_event(
    p_task_id, 'DRAFT_UPDATED', v_actor.user_id, v_actor.actor_role,
    'DRAFT', 'DRAFT',
    jsonb_build_object(
      'titleChanged', v_task.title is distinct from trim(p_title),
      'briefChanged', v_task.brief is distinct from trim(p_brief),
      'priority', p_priority,
      'timeTrackingMode', p_time_tracking_mode,
      'assignedUserId', p_assigned_user_id,
      'reviewerUserId', p_reviewer_user_id,
      '_requestFingerprint', v_fingerprint
    ),
    null, v_key, false
  );
  return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role);
end;
$$;;
