-- Phase 8.8 staging repair: require complete planning before DRAFT activation.
--
-- Locked invariant:
-- - AI_MARKETING / DAILY_CONTENT automation may create only traceable, unassigned
--   DRAFT tasks.
-- - Owner activation remains the single atomic task_approve_and_assign command.
-- - Activation requires title, brief, priority, time tracking mode, assignee,
--   reviewer, and submission deadline. scheduled/start/approval dates remain
--   optional planning fields.

drop function if exists public.task_update_draft(uuid, bigint, text, text, text, uuid, uuid, boolean, date, timestamptz, timestamptz, timestamptz, text, text);

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
  p_time_tracking_mode text default 'EXPECTED',
  p_source_record_type text default null,
  p_source_record_id text default null
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
  v_source_record_type text := nullif(trim(p_source_record_type), '');
  v_source_record_id text := nullif(trim(p_source_record_id), '');
  v_assigned_user_id uuid;
  v_key text := public.task_require_idempotency_key(p_idempotency_key);
  v_fingerprint text;
begin
  select * into v_actor from public.task_current_actor();
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'task not found'; end if;
  v_assigned_user_id := case
    when v_task.source_type in ('AI_MARKETING', 'DAILY_CONTENT') then null
    else p_assigned_user_id
  end;
  v_fingerprint := md5(jsonb_build_object(
    'command', 'task_update_draft', 'title', trim(p_title), 'brief', trim(p_brief),
    'priority', p_priority, 'timeTrackingMode', p_time_tracking_mode,
    'assignedUserId', v_assigned_user_id,
    'reviewerUserId', p_reviewer_user_id,
    'draftApprovalRequired', coalesce(p_draft_approval_required, false),
    'scheduledDate', p_scheduled_date, 'startDeadline', p_start_deadline,
    'submissionDeadline', p_submission_deadline, 'approvalDeadline', p_approval_deadline,
    'sourceRecordType', v_source_record_type, 'sourceRecordId', v_source_record_id
  )::text);
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
  if (v_source_record_type is null) <> (v_source_record_id is null) then
    raise exception using errcode = '22023', message = 'source record type and id must be provided together';
  end if;

  perform public.task_assert_assignment(v_actor.actor_role, v_assigned_user_id);
  if p_reviewer_user_id is not null then perform public.task_assert_reviewer(p_reviewer_user_id); end if;

  update public.tasks
  set title = trim(p_title),
      brief = trim(p_brief),
      priority = p_priority,
      time_tracking_mode = p_time_tracking_mode,
      source_record_type = v_source_record_type,
      source_record_id = v_source_record_id,
      assigned_user_id = v_assigned_user_id,
      reviewer_user_id = p_reviewer_user_id,
      draft_approval_required = coalesce(p_draft_approval_required, false)
        or source_type in ('AI_MARKETING', 'DAILY_CONTENT')
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
      'sourceRecordType', v_source_record_type,
      'sourceRecordId', v_source_record_id,
      'assignedUserId', v_assigned_user_id,
      'reviewerUserId', p_reviewer_user_id,
      '_requestFingerprint', v_fingerprint
    ),
    null, v_key, false
  );
  return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role);
end;
$$;

create or replace function public.task_approve_and_assign(
  p_task_id uuid,
  p_expected_version bigint,
  p_assigned_user_id uuid,
  p_reviewer_user_id uuid,
  p_start_deadline timestamptz,
  p_submission_deadline timestamptz,
  p_approval_deadline timestamptz,
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
  v_final_submission_deadline timestamptz;
  v_missing text[] := array[]::text[];
  v_fingerprint text := md5(jsonb_build_object(
    'command', 'task_approve_and_assign',
    'assignedUserId', p_assigned_user_id,
    'reviewerUserId', p_reviewer_user_id,
    'startDeadline', p_start_deadline,
    'submissionDeadline', p_submission_deadline,
    'approvalDeadline', p_approval_deadline
  )::text);
begin
  select * into v_actor from public.task_current_actor();
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  if public.task_idempotency_replay(p_task_id, array['DRAFT_APPROVED'], v_key) then
    perform public.task_assert_replay_fingerprint(p_task_id, v_key, v_fingerprint);
    return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role, true);
  end if;

  if v_task.status <> 'DRAFT' then
    raise exception using errcode = '55000', message = 'task is not a draft';
  end if;
  if v_task.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'task version conflict';
  end if;

  if v_actor.actor_role = 'owner' then
    null;
  elsif v_actor.actor_role = 'admin'
        and v_task.source_type in ('MANUAL', 'PRODUCTION', 'SHOP_TASK')
        and v_task.draft_approval_required = false then
    null;
  else
    raise exception using errcode = '42501', message = 'owner approval is required for this draft';
  end if;

  v_final_submission_deadline := coalesce(p_submission_deadline, v_task.submission_deadline);

  if length(trim(coalesce(v_task.title, ''))) = 0 then v_missing := array_append(v_missing, 'title'); end if;
  if length(trim(coalesce(v_task.brief, ''))) = 0 then v_missing := array_append(v_missing, 'brief/instructions'); end if;
  if v_task.priority not in ('LOW', 'MEDIUM', 'HIGH', 'URGENT') then v_missing := array_append(v_missing, 'priority'); end if;
  if v_task.time_tracking_mode not in ('EXPECTED', 'NONE') then v_missing := array_append(v_missing, 'time tracking mode'); end if;
  if p_assigned_user_id is null then v_missing := array_append(v_missing, 'assignee'); end if;
  if p_reviewer_user_id is null then v_missing := array_append(v_missing, 'reviewer'); end if;
  if v_final_submission_deadline is null then v_missing := array_append(v_missing, 'submission deadline'); end if;

  if array_length(v_missing, 1) is not null then
    raise exception using
      errcode = '22023',
      message = 'draft activation missing required fields: ' || array_to_string(v_missing, ', ');
  end if;

  perform public.task_assert_assignment(v_actor.actor_role, p_assigned_user_id);
  perform public.task_assert_reviewer(p_reviewer_user_id);

  update public.tasks
  set status = 'TO_DO',
      assigned_user_id = p_assigned_user_id,
      reviewer_user_id = p_reviewer_user_id,
      start_deadline = coalesce(p_start_deadline, start_deadline),
      submission_deadline = v_final_submission_deadline,
      approval_deadline = coalesce(p_approval_deadline, approval_deadline)
  where id = p_task_id;

  perform public.task_write_event(
    p_task_id, 'DRAFT_APPROVED', v_actor.user_id, v_actor.actor_role,
    'DRAFT', 'TO_DO',
    jsonb_build_object(
      'assignmentChanged', v_task.assigned_user_id is distinct from p_assigned_user_id,
      'assignedUserId', p_assigned_user_id,
      'reviewerUserId', p_reviewer_user_id,
      '_requestFingerprint', v_fingerprint
    ),
    null, v_key, true
  );

  return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role);
end;
$$;

revoke all on function public.task_update_draft(uuid, bigint, text, text, text, uuid, uuid, boolean, date, timestamptz, timestamptz, timestamptz, text, text, text, text)
from public, anon, service_role;
grant execute on function public.task_update_draft(uuid, bigint, text, text, text, uuid, uuid, boolean, date, timestamptz, timestamptz, timestamptz, text, text, text, text)
to authenticated;

revoke all on function public.task_approve_and_assign(uuid, bigint, uuid, uuid, timestamptz, timestamptz, timestamptz, text)
from public, anon, service_role;
grant execute on function public.task_approve_and_assign(uuid, bigint, uuid, uuid, timestamptz, timestamptz, timestamptz, text)
to authenticated;

-- Rollback SQL:
-- Re-apply supabase/migrations/202607250002_create_task_domain_functions.sql
-- function public.task_update_draft(...) definition and
-- supabase/migrations/202608030001_add_task_approve_and_assign.sql function
-- public.task_approve_and_assign(...) definition.
