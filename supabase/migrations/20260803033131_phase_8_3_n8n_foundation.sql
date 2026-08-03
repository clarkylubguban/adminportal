-- Phase 8.3 n8n foundation.
-- Adds traceable planning/automation receipt records and a service-role-only
-- draft ingestion RPC. Feature flags remain disabled by default.

alter table public.task_feature_flags
  drop constraint if exists task_feature_flags_feature_check;

alter table public.task_feature_flags
  add constraint task_feature_flags_feature_check
    check (feature in (
      'TASK_DOMAIN',
      'N8N_FOUNDATION',
      'AUTO_PLAN_TODAY',
      'WORKBOARD',
      'MY_TASKS',
      'CALENDAR'
    ));

insert into public.task_feature_flags (feature, enabled)
values
  ('N8N_FOUNDATION', false),
  ('AUTO_PLAN_TODAY', false),
  ('WORKBOARD', false),
  ('MY_TASKS', false),
  ('CALENDAR', false)
on conflict (feature) do update
set enabled = false,
    updated_at = clock_timestamp();

create table if not exists public.planning_requests (
  id uuid primary key default gen_random_uuid(),
  request_code text not null,
  requested_by_user_id uuid not null references public.admin_users(user_id) on delete restrict,
  quick_direction text not null,
  active_campaign text,
  capacity_snapshot jsonb not null default '{}'::jsonb,
  maximum_tasks integer not null default 3,
  status text not null default 'REQUESTED',
  n8n_execution_id text,
  planning_context jsonb not null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planning_requests_code_key unique (request_code),
  constraint planning_requests_code_check
    check (request_code ~ '^PLN-[A-Z0-9][A-Z0-9_-]{5,63}$'),
  constraint planning_requests_direction_check
    check (length(trim(quick_direction)) between 1 and 2000),
  constraint planning_requests_campaign_check
    check (active_campaign is null or length(trim(active_campaign)) between 1 and 200),
  constraint planning_requests_capacity_check
    check (jsonb_typeof(capacity_snapshot) = 'object'),
  constraint planning_requests_context_check
    check (jsonb_typeof(planning_context) = 'object'),
  constraint planning_requests_maximum_tasks_check
    check (maximum_tasks between 1 and 10),
  constraint planning_requests_status_check
    check (status in ('REQUESTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  constraint planning_requests_execution_check
    check (n8n_execution_id is null or length(trim(n8n_execution_id)) between 1 and 200),
  constraint planning_requests_completion_check
    check (
      (status in ('REQUESTED', 'PROCESSING') and completed_at is null)
      or (status in ('COMPLETED', 'FAILED', 'CANCELLED') and completed_at is not null)
    )
);

create index if not exists planning_requests_status_idx
  on public.planning_requests (status, requested_at desc);

create table if not exists public.automation_receipts (
  id uuid primary key default gen_random_uuid(),
  planning_request_id uuid not null references public.planning_requests(id) on delete restrict,
  provider text not null,
  workflow_name text not null,
  external_execution_id text not null,
  idempotency_key text not null,
  payload_hash text not null,
  request_status text not null default 'RECEIVED',
  tasks_created integer not null default 0,
  safe_error_summary text,
  received_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_receipts_execution_key unique (provider, external_execution_id),
  constraint automation_receipts_idempotency_key unique (provider, idempotency_key),
  constraint automation_receipts_provider_check
    check (length(trim(provider)) between 1 and 80 and provider ~ '^[A-Za-z0-9._:-]+$'),
  constraint automation_receipts_workflow_check
    check (length(trim(workflow_name)) between 1 and 120),
  constraint automation_receipts_execution_check
    check (length(trim(external_execution_id)) between 1 and 200),
  constraint automation_receipts_idempotency_check
    check (length(trim(idempotency_key)) between 1 and 200),
  constraint automation_receipts_payload_hash_check
    check (payload_hash ~ '^[a-f0-9]{64}$'),
  constraint automation_receipts_status_check
    check (request_status in ('RECEIVED', 'COMPLETED', 'FAILED', 'REPLAYED', 'REJECTED_CONFLICT')),
  constraint automation_receipts_tasks_created_check
    check (tasks_created >= 0),
  constraint automation_receipts_error_check
    check (safe_error_summary is null or length(trim(safe_error_summary)) between 1 and 500),
  constraint automation_receipts_completion_check
    check (
      (request_status = 'RECEIVED' and completed_at is null)
      or (request_status in ('COMPLETED', 'FAILED', 'REPLAYED', 'REJECTED_CONFLICT') and completed_at is not null)
    )
);

create index if not exists automation_receipts_planning_idx
  on public.automation_receipts (planning_request_id, received_at desc);

alter table public.tasks
  add column if not exists planning_request_id uuid references public.planning_requests(id) on delete restrict,
  add column if not exists automation_receipt_id uuid references public.automation_receipts(id) on delete restrict,
  add column if not exists external_task_id text,
  add column if not exists automation_metadata jsonb not null default '{}'::jsonb;

alter table public.tasks
  drop constraint if exists tasks_automation_traceability_check;

alter table public.tasks
  add constraint tasks_automation_traceability_check
    check (
      (
        planning_request_id is null
        and automation_receipt_id is null
        and external_task_id is null
      )
      or (
        planning_request_id is not null
        and automation_receipt_id is not null
        and external_task_id is not null
        and source_type in ('AI_MARKETING', 'DAILY_CONTENT')
        and status = 'DRAFT'
        and assigned_user_id is null
        and completed_at is null
        and cancelled_at is null
        and archived_at is null
        and jsonb_typeof(automation_metadata) = 'object'
      )
    )
    not valid;

alter table public.tasks
  drop constraint if exists tasks_external_task_id_check;

alter table public.tasks
  add constraint tasks_external_task_id_check
    check (external_task_id is null or length(trim(external_task_id)) between 1 and 200);

create unique index if not exists tasks_automation_receipt_external_task_uidx
  on public.tasks (automation_receipt_id, external_task_id)
  where automation_receipt_id is not null and external_task_id is not null;

create index if not exists tasks_planning_request_idx
  on public.tasks (planning_request_id, created_at desc)
  where planning_request_id is not null;

create or replace function public.task_automation_child_prepare_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists planning_requests_prepare_update on public.planning_requests;
create trigger planning_requests_prepare_update
before update on public.planning_requests
for each row
execute function public.task_automation_child_prepare_update();

drop trigger if exists automation_receipts_prepare_update on public.automation_receipts;
create trigger automation_receipts_prepare_update
before update on public.automation_receipts
for each row
execute function public.task_automation_child_prepare_update();

create or replace function public.planning_requests_reject_unsafe_change()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'planning requests are audit records';
  end if;
  if old.status in ('COMPLETED', 'FAILED', 'CANCELLED') then
    raise exception using errcode = '42501', message = 'completed planning requests are immutable';
  end if;
  if old.id is distinct from new.id
     or old.request_code is distinct from new.request_code
     or old.requested_by_user_id is distinct from new.requested_by_user_id
     or old.quick_direction is distinct from new.quick_direction
     or old.active_campaign is distinct from new.active_campaign
     or old.capacity_snapshot is distinct from new.capacity_snapshot
     or old.maximum_tasks is distinct from new.maximum_tasks
     or old.planning_context is distinct from new.planning_context
     or old.requested_at is distinct from new.requested_at
     or old.created_at is distinct from new.created_at then
    raise exception using errcode = '42501', message = 'planning request context is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists planning_requests_immutable_context on public.planning_requests;
create trigger planning_requests_immutable_context
before update or delete on public.planning_requests
for each row
execute function public.planning_requests_reject_unsafe_change();

create or replace function public.automation_receipts_reject_unsafe_change()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'automation receipts are audit records';
  end if;
  if old.request_status in ('COMPLETED', 'FAILED', 'REPLAYED', 'REJECTED_CONFLICT') then
    raise exception using errcode = '42501', message = 'completed automation receipts are immutable';
  end if;
  if old.id is distinct from new.id
     or old.planning_request_id is distinct from new.planning_request_id
     or old.provider is distinct from new.provider
     or old.workflow_name is distinct from new.workflow_name
     or old.external_execution_id is distinct from new.external_execution_id
     or old.idempotency_key is distinct from new.idempotency_key
     or old.payload_hash is distinct from new.payload_hash
     or old.received_at is distinct from new.received_at
     or old.created_at is distinct from new.created_at then
    raise exception using errcode = '42501', message = 'automation receipt identity is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists automation_receipts_immutable_identity on public.automation_receipts;
create trigger automation_receipts_immutable_identity
before update or delete on public.automation_receipts
for each row
execute function public.automation_receipts_reject_unsafe_change();

create or replace function public.task_ingest_n8n_drafts(
  p_provider text,
  p_workflow_name text,
  p_external_execution_id text,
  p_planning_request_id uuid,
  p_idempotency_key text,
  p_payload_hash text,
  p_task_drafts jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_planning public.planning_requests%rowtype;
  v_receipt public.automation_receipts%rowtype;
  v_existing public.automation_receipts%rowtype;
  v_task jsonb;
  v_count integer;
  v_created integer := 0;
  v_task_ids uuid[] := '{}';
  v_task_id uuid;
  v_external_task_id text;
  v_source_type text;
  v_title text;
  v_brief text;
  v_priority text;
  v_scheduled_date date;
  v_start_deadline timestamptz;
  v_submission_deadline timestamptz;
  v_approval_deadline timestamptz;
  v_suggested_assignee jsonb;
begin
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended('n8n:' || trim(p_provider) || ':' || trim(p_external_execution_id), 0));
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended('n8n-key:' || trim(p_provider) || ':' || trim(p_idempotency_key), 0));

  if nullif(trim(p_provider), '') is null
     or nullif(trim(p_workflow_name), '') is null
     or nullif(trim(p_external_execution_id), '') is null
     or nullif(trim(p_idempotency_key), '') is null
     or p_payload_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'automation receipt identity is invalid';
  end if;
  if jsonb_typeof(p_task_drafts) <> 'array' then
    raise exception using errcode = '22023', message = 'task drafts must be an array';
  end if;

  select * into v_existing
  from public.automation_receipts
  where provider = trim(p_provider)
    and (
      external_execution_id = trim(p_external_execution_id)
      or idempotency_key = trim(p_idempotency_key)
    )
  for update;

  if found then
    if v_existing.external_execution_id <> trim(p_external_execution_id)
       or v_existing.idempotency_key <> trim(p_idempotency_key)
       or v_existing.payload_hash <> p_payload_hash
       or v_existing.planning_request_id <> p_planning_request_id then
      raise exception using
        errcode = '23505',
        message = 'automation execution or idempotency key conflicts with an earlier payload';
    end if;
    return jsonb_build_object(
      'receiptId', v_existing.id,
      'planningRequestId', v_existing.planning_request_id,
      'tasksCreated', v_existing.tasks_created,
      'taskIds', coalesce((
        select jsonb_agg(task.id order by task.created_at, task.id)
        from public.tasks task
        where task.automation_receipt_id = v_existing.id
      ), '[]'::jsonb),
      'replayed', true,
      'status', 'REPLAYED'
    );
  end if;

  select * into v_planning
  from public.planning_requests
  where id = p_planning_request_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'planning request not found';
  end if;
  if v_planning.status <> 'REQUESTED' then
    raise exception using errcode = '55000', message = 'planning request is not awaiting automation';
  end if;

  v_count := jsonb_array_length(p_task_drafts);
  if v_count < 1 or v_count > least(v_planning.maximum_tasks, 3) then
    raise exception using errcode = '22023', message = 'task draft count exceeds configured limit';
  end if;
  if (
    select count(distinct draft.value ->> 'externalTaskId')
    from jsonb_array_elements(p_task_drafts) draft(value)
  ) <> v_count then
    raise exception using errcode = '22023', message = 'duplicate external task ids are not allowed';
  end if;

  insert into public.automation_receipts (
    planning_request_id, provider, workflow_name, external_execution_id,
    idempotency_key, payload_hash, request_status
  )
  values (
    p_planning_request_id, trim(p_provider), trim(p_workflow_name), trim(p_external_execution_id),
    trim(p_idempotency_key), p_payload_hash, 'RECEIVED'
  )
  returning * into v_receipt;

  update public.planning_requests
  set status = 'PROCESSING',
      n8n_execution_id = trim(p_external_execution_id)
  where id = p_planning_request_id;

  for v_task in select value from jsonb_array_elements(p_task_drafts) loop
    v_external_task_id := nullif(trim(v_task ->> 'externalTaskId'), '');
    v_source_type := nullif(trim(v_task ->> 'sourceType'), '');
    v_title := nullif(trim(v_task ->> 'title'), '');
    v_brief := nullif(trim(v_task ->> 'brief'), '');
    v_priority := coalesce(nullif(trim(v_task ->> 'priority'), ''), 'MEDIUM');
    v_scheduled_date := nullif(trim(v_task ->> 'scheduledDate'), '')::date;
    v_start_deadline := nullif(trim(v_task ->> 'startDeadline'), '')::timestamptz;
    v_submission_deadline := nullif(trim(v_task ->> 'submissionDeadline'), '')::timestamptz;
    v_approval_deadline := nullif(trim(v_task ->> 'approvalDeadline'), '')::timestamptz;
    v_suggested_assignee := coalesce(v_task -> 'suggestedAssignee', 'null'::jsonb);

    if v_source_type not in ('AI_MARKETING', 'DAILY_CONTENT') then
      raise exception using errcode = '22023', message = 'automation source type is not allowed';
    end if;
    if v_task ? 'assignedUserId' or v_task ? 'assigneeId' or v_task ? 'status' then
      raise exception using errcode = '22023', message = 'automation drafts may not assign or set status';
    end if;

    insert into public.tasks (
      title, brief, source_type, source_record_type, source_record_id,
      status, priority, time_tracking_mode, assigned_user_id, reviewer_user_id,
      created_by_user_id, draft_approval_required, scheduled_date, start_deadline,
      submission_deadline, approval_deadline, external_workflow_id,
      external_task_number, idempotency_key, planning_request_id,
      automation_receipt_id, external_task_id, automation_metadata
    )
    values (
      v_title, v_brief, v_source_type, 'PLANNING_REQUEST', p_planning_request_id::text,
      'DRAFT', v_priority, 'EXPECTED', null, null,
      v_planning.requested_by_user_id, true, v_scheduled_date, v_start_deadline,
      v_submission_deadline, v_approval_deadline, trim(p_external_execution_id),
      v_external_task_id, trim(p_idempotency_key) || ':' || v_external_task_id,
      p_planning_request_id, v_receipt.id, v_external_task_id,
      jsonb_build_object('suggestedAssignee', v_suggested_assignee)
    )
    returning id into v_task_id;

    insert into public.task_events (
      task_id, event_type, actor_kind, actor_user_id, actor_role,
      previous_status, next_status, field_changes, reason, idempotency_key, staff_visible
    )
    values (
      v_task_id, 'TASK_CREATED', 'AUTOMATION', null, 'automation',
      null, 'DRAFT',
      jsonb_build_object(
        'planningRequestId', p_planning_request_id,
        'automationReceiptId', v_receipt.id,
        'externalTaskId', v_external_task_id,
        'sourceType', v_source_type,
        'suggestedAssigneeIsNonAuthoritative', true,
        '_requestFingerprint', p_payload_hash
      ),
      null, trim(p_idempotency_key) || ':' || v_external_task_id, false
    );

    v_created := v_created + 1;
    v_task_ids := array_append(v_task_ids, v_task_id);
  end loop;

  update public.automation_receipts
  set request_status = 'COMPLETED',
      tasks_created = v_created,
      completed_at = clock_timestamp()
  where id = v_receipt.id
  returning * into v_receipt;

  update public.planning_requests
  set status = 'COMPLETED',
      completed_at = clock_timestamp()
  where id = p_planning_request_id;

  return jsonb_build_object(
    'receiptId', v_receipt.id,
    'planningRequestId', p_planning_request_id,
    'tasksCreated', v_created,
    'taskIds', to_jsonb(v_task_ids),
    'replayed', false,
    'status', 'COMPLETED'
  );
exception
  when others then
    raise;
end;
$$;

alter table public.planning_requests enable row level security;
alter table public.automation_receipts enable row level security;

drop policy if exists "Task managers can read planning requests" on public.planning_requests;
create policy "Task managers can read planning requests"
on public.planning_requests
for select
to authenticated
using (
  public.task_domain_enabled()
  and exists (
    select 1
    from public.admin_users actor
    where actor.user_id = (select auth.uid())
      and actor.is_active = true
      and coalesce(actor.is_test, false) = false
      and actor.role in ('owner', 'admin')
  )
);

drop policy if exists "Task managers can read automation receipts" on public.automation_receipts;
create policy "Task managers can read automation receipts"
on public.automation_receipts
for select
to authenticated
using (
  public.task_domain_enabled()
  and exists (
    select 1
    from public.admin_users actor
    where actor.user_id = (select auth.uid())
      and actor.is_active = true
      and coalesce(actor.is_test, false) = false
      and actor.role in ('owner', 'admin')
  )
);

revoke all on table public.planning_requests from public, anon, authenticated, service_role;
revoke all on table public.automation_receipts from public, anon, authenticated, service_role;
grant select on table public.planning_requests to authenticated;
grant select on table public.automation_receipts to authenticated;
grant select, insert, update on table public.planning_requests to service_role;
grant select, insert, update on table public.automation_receipts to service_role;
grant insert on table public.tasks to service_role;
grant insert on table public.task_events to service_role;

revoke all on function public.task_automation_child_prepare_update() from public, anon, authenticated, service_role;
revoke all on function public.planning_requests_reject_unsafe_change() from public, anon, authenticated, service_role;
revoke all on function public.automation_receipts_reject_unsafe_change() from public, anon, authenticated, service_role;
revoke all on function public.task_ingest_n8n_drafts(text, text, text, uuid, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.task_ingest_n8n_drafts(text, text, text, uuid, text, text, jsonb)
to service_role;

comment on table public.planning_requests is
  'Immutable planning request context approved before automation. Created by future owner-only planning UI.';

comment on table public.automation_receipts is
  'Append-only automation receipt records for signed n8n task-draft ingestion.';

comment on function public.task_ingest_n8n_drafts(text, text, text, uuid, text, text, jsonb) is
  'Service-role-only transactional n8n draft ingestion. The HTTP endpoint verifies HMAC before calling this function.';
