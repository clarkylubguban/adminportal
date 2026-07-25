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
$$;

create or replace function public.task_command_result(
  p_task_id uuid,
  p_actor_user_id uuid,
  p_actor_role text,
  p_replayed boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select jsonb_strip_nulls(
    jsonb_build_object(
      'id', task.id,
      'taskCode', task.task_code,
      'title', task.title,
      'brief', task.brief,
      'sourceType', task.source_type,
      'sourceRecordType', task.source_record_type,
      'sourceRecordId', task.source_record_id,
      'status', task.status,
      'priority', task.priority,
      'timeTrackingMode', task.time_tracking_mode,
      'assignedUserId', task.assigned_user_id,
      'reviewerUserId', task.reviewer_user_id,
      'draftApprovalRequired', task.draft_approval_required,
      'scheduledDate', task.scheduled_date,
      'startDeadline', task.start_deadline,
      'submissionDeadline', task.submission_deadline,
      'approvalDeadline', task.approval_deadline,
      'version', task.version,
      'completedAt', task.completed_at,
      'cancelledAt', task.cancelled_at,
      'archivedAt', task.archived_at,
      'createdAt', task.created_at,
      'updatedAt', task.updated_at,
      'replayed', p_replayed,
      'serverTime', clock_timestamp(),
      'totalTrackedSeconds', coalesce((
        select sum(extract(epoch from (entry.ended_at - entry.started_at)))::bigint
        from public.task_time_entries entry
        where entry.task_id = task.id
          and entry.ended_at is not null
      ), 0),
      'openTimeEntry', (
        select jsonb_build_object(
          'id', entry.id,
          'cycleNumber', entry.cycle_number,
          'startedAt', entry.started_at
        )
        from public.task_time_entries entry
        where entry.task_id = task.id
          and entry.ended_at is null
      ),
      'latestSubmission', (
        select jsonb_build_object(
          'id', submission.id,
          'cycleNumber', submission.cycle_number,
          'submittedByUserId', submission.submitted_by_user_id,
          'submissionNote', submission.submission_note,
          'proofUrl', submission.proof_url,
          'submittedAt', submission.submitted_at,
          'timeRecordingStatus', submission.time_recording_status,
          'noTimeReason', submission.no_time_reason,
          'recordedDurationSeconds', case
            when submission.time_recording_status = 'RECORDED' then (
              select coalesce(sum(extract(epoch from (entry.ended_at - entry.started_at)))::bigint, 0)
              from public.task_time_entries entry
              where entry.task_id = submission.task_id
                and entry.cycle_number = submission.cycle_number
                and entry.ended_at is not null
            )
            else null
          end,
          'reviewDecision', submission.review_decision,
          'reviewedAt', submission.reviewed_at
        )
        from public.task_submissions submission
        where submission.task_id = task.id
        order by submission.cycle_number desc
        limit 1
      ),
      'managerMetadata', case
        when p_actor_role in ('owner', 'admin') then jsonb_build_object(
          'createdByUserId', task.created_by_user_id,
          'externalWorkflowId', task.external_workflow_id,
          'externalTaskNumber', task.external_task_number
        )
        else null
      end
    )
  )
  from public.tasks task
  where task.id = p_task_id
    and (
      p_actor_role in ('owner', 'admin')
      or (
        p_actor_role = 'staff'
        and task.assigned_user_id = p_actor_user_id
        and task.status <> 'DRAFT'
      )
    );
$$;

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
$$;

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
$$;

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
$$;

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
$$;

revoke all on function public.task_assert_enabled() from public, anon, authenticated, service_role;
revoke all on function public.task_current_actor() from public, anon, authenticated, service_role;
revoke all on function public.task_require_idempotency_key(text) from public, anon, authenticated, service_role;
revoke all on function public.task_active_user_role(uuid) from public, anon, authenticated, service_role;
revoke all on function public.task_assert_assignment(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.task_assert_reviewer(uuid) from public, anon, authenticated, service_role;
revoke all on function public.task_idempotency_replay(uuid, text[], text) from public, anon, authenticated, service_role;
revoke all on function public.task_assert_replay_fingerprint(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.task_write_event(uuid, text, uuid, text, text, text, jsonb, text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.task_command_result(uuid, uuid, text, boolean) from public, anon, authenticated, service_role;

revoke all on function public.task_create(text, text, text, text, text, text, uuid, uuid, boolean, date, timestamptz, timestamptz, timestamptz, text, text, text, text) from public, anon, service_role;
revoke all on function public.task_update_draft(uuid, bigint, text, text, text, uuid, uuid, boolean, date, timestamptz, timestamptz, timestamptz, text, text) from public, anon, service_role;
revoke all on function public.task_assign(uuid, bigint, uuid, text) from public, anon, service_role;
revoke all on function public.task_approve_draft(uuid, bigint, text) from public, anon, service_role;
revoke all on function public.task_start_work(uuid, bigint, text) from public, anon, service_role;
revoke all on function public.task_submit_for_review(uuid, bigint, text, text, text) from public, anon, service_role;
revoke all on function public.task_submit_without_time(uuid, bigint, text, text, text) from public, anon, service_role;
revoke all on function public.task_request_revision(uuid, bigint, text, text) from public, anon, service_role;
revoke all on function public.task_start_revision(uuid, bigint, text) from public, anon, service_role;
revoke all on function public.task_approve_work(uuid, bigint, text, text) from public, anon, service_role;
revoke all on function public.task_cancel(uuid, bigint, text, text) from public, anon, service_role;
revoke all on function public.task_reopen(uuid, bigint, text, text) from public, anon, service_role;
revoke all on function public.task_correct_time_entry(uuid, uuid, bigint, timestamptz, timestamptz, text, text) from public, anon, service_role;
revoke all on function public.task_archive(uuid, bigint, text) from public, anon, service_role;

grant execute on function public.task_create(text, text, text, text, text, text, uuid, uuid, boolean, date, timestamptz, timestamptz, timestamptz, text, text, text, text) to authenticated;
grant execute on function public.task_update_draft(uuid, bigint, text, text, text, uuid, uuid, boolean, date, timestamptz, timestamptz, timestamptz, text, text) to authenticated;
grant execute on function public.task_assign(uuid, bigint, uuid, text) to authenticated;
grant execute on function public.task_approve_draft(uuid, bigint, text) to authenticated;
grant execute on function public.task_start_work(uuid, bigint, text) to authenticated;
grant execute on function public.task_submit_for_review(uuid, bigint, text, text, text) to authenticated;
grant execute on function public.task_submit_without_time(uuid, bigint, text, text, text) to authenticated;
grant execute on function public.task_request_revision(uuid, bigint, text, text) to authenticated;
grant execute on function public.task_start_revision(uuid, bigint, text) to authenticated;
grant execute on function public.task_approve_work(uuid, bigint, text, text) to authenticated;
grant execute on function public.task_cancel(uuid, bigint, text, text) to authenticated;
grant execute on function public.task_reopen(uuid, bigint, text, text) to authenticated;
grant execute on function public.task_correct_time_entry(uuid, uuid, bigint, timestamptz, timestamptz, text, text) to authenticated;
grant execute on function public.task_archive(uuid, bigint, text) to authenticated;

comment on function public.task_create(text, text, text, text, text, text, uuid, uuid, boolean, date, timestamptz, timestamptz, timestamptz, text, text, text, text) is
  'Creates a hidden DRAFT task. This function performs no source-system mutation.';
