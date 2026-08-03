-- Phase 8.8 staging repair: allow approved AI/Daily drafts to leave DRAFT.
--
-- Previous invariant required every traceable AI_MARKETING / DAILY_CONTENT task
-- to remain DRAFT and unassigned forever. That contradicted the locked Workboard
-- command model where n8n creates only unassigned drafts and the Owner later
-- activates one task with the atomic task_approve_and_assign RPC.

alter table public.tasks
  drop constraint if exists tasks_automation_traceability_check;

alter table public.tasks
  add constraint tasks_automation_traceability_check
    check (
      (
        source_type not in ('AI_MARKETING', 'DAILY_CONTENT')
        and planning_request_id is null
        and automation_receipt_id is null
        and external_task_id is null
      )
      or (
        source_type in ('AI_MARKETING', 'DAILY_CONTENT')
        and planning_request_id is not null
        and automation_receipt_id is not null
        and external_task_id is not null
        and jsonb_typeof(automation_metadata) = 'object'
        and (
          (
            status = 'DRAFT'
            and assigned_user_id is null
            and reviewer_user_id is null
            and completed_at is null
            and cancelled_at is null
            and archived_at is null
          )
          or (
            status in ('TO_DO', 'IN_PROGRESS', 'FOR_REVIEW', 'NEEDS_REVISION', 'DONE')
            and assigned_user_id is not null
            and reviewer_user_id is not null
            and cancelled_at is null
          )
          or (
            status = 'CANCELLED'
            and completed_at is null
            and cancelled_at is not null
          )
        )
      )
    )
    not valid;

comment on constraint tasks_automation_traceability_check on public.tasks is
  'AI/Daily tasks require complete automation trace identity. n8n-created DRAFT rows remain unassigned; approved non-DRAFT rows require assignee and reviewer.';

-- Rollback SQL:
-- alter table public.tasks
--   drop constraint if exists tasks_automation_traceability_check;
-- alter table public.tasks
--   add constraint tasks_automation_traceability_check
--     check (
--       (
--         planning_request_id is null
--         and automation_receipt_id is null
--         and external_task_id is null
--       )
--       or (
--         planning_request_id is not null
--         and automation_receipt_id is not null
--         and external_task_id is not null
--         and source_type in ('AI_MARKETING', 'DAILY_CONTENT')
--         and status = 'DRAFT'
--         and assigned_user_id is null
--         and completed_at is null
--         and cancelled_at is null
--         and archived_at is null
--         and jsonb_typeof(automation_metadata) = 'object'
--       )
--     )
--     not valid;
