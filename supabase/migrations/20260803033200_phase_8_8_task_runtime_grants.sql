-- Phase 8.8 staging hardening: align runtime grants with the deployed Task API.
-- The caller-scoped API reads newer task projection columns added after the
-- original column-level grant, and server-side automation needs a readback after
-- n8n ingestion completes.

grant execute on function public.task_domain_enabled() to service_role;

grant select (
  planning_request_id,
  automation_receipt_id,
  external_task_id,
  automation_metadata
) on public.tasks to authenticated;

grant select on table public.tasks to service_role;
