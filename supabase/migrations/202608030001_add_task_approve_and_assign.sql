-- Phase 8.2 Task API command: atomic DRAFT -> TO_DO approval with assignment.
-- The API must not emulate this with separate assign and approve calls.

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
  if p_assigned_user_id is null or p_reviewer_user_id is null then
    raise exception using errcode = '22023', message = 'draft requires an assignee and reviewer';
  end if;
  if length(trim(v_task.title)) = 0 or length(trim(v_task.brief)) = 0 then
    raise exception using errcode = '22023', message = 'draft requires an approved brief';
  end if;

  perform public.task_assert_assignment(v_actor.actor_role, p_assigned_user_id);
  perform public.task_assert_reviewer(p_reviewer_user_id);

  if v_actor.actor_role = 'owner' then
    null;
  elsif v_actor.actor_role = 'admin'
        and v_task.source_type in ('MANUAL', 'PRODUCTION', 'SHOP_TASK')
        and v_task.draft_approval_required = false then
    null;
  else
    raise exception using errcode = '42501', message = 'owner approval is required for this draft';
  end if;

  update public.tasks
  set status = 'TO_DO',
      assigned_user_id = p_assigned_user_id,
      reviewer_user_id = p_reviewer_user_id,
      start_deadline = coalesce(p_start_deadline, start_deadline),
      submission_deadline = coalesce(p_submission_deadline, submission_deadline),
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

revoke all on function public.task_approve_and_assign(uuid, bigint, uuid, uuid, timestamptz, timestamptz, timestamptz, text)
from public, anon, service_role;
grant execute on function public.task_approve_and_assign(uuid, bigint, uuid, uuid, timestamptz, timestamptz, timestamptz, text)
to authenticated;
