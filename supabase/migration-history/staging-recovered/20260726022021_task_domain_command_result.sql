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
$$;;
