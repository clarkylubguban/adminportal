-- Hidden task-domain foundation. The feature flag is intentionally OFF.
-- This migration is additive and does not modify existing operational tables.

create table if not exists public.task_feature_flags (
  feature text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint task_feature_flags_feature_check
    check (feature in ('TASK_DOMAIN'))
);

insert into public.task_feature_flags (feature, enabled)
values ('TASK_DOMAIN', false)
on conflict (feature) do nothing;

create sequence if not exists public.task_code_seq;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  task_code text not null default (
    'TSK-' || lpad(nextval('public.task_code_seq')::text, 6, '0')
  ),
  title text not null,
  brief text not null,
  source_type text not null,
  source_record_type text,
  source_record_id text,
  status text not null default 'DRAFT',
  priority text not null default 'MEDIUM',
  time_tracking_mode text not null default 'EXPECTED',
  assigned_user_id uuid references public.admin_users(user_id) on delete restrict,
  reviewer_user_id uuid references public.admin_users(user_id) on delete restrict,
  created_by_user_id uuid references public.admin_users(user_id) on delete restrict,
  draft_approval_required boolean not null default false,
  scheduled_date date,
  start_deadline timestamptz,
  submission_deadline timestamptz,
  approval_deadline timestamptz,
  version bigint not null default 1,
  completed_at timestamptz,
  cancelled_at timestamptz,
  archived_at timestamptz,
  external_workflow_id text,
  external_task_number text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_task_code_key unique (task_code),
  constraint tasks_task_code_format_check
    check (task_code ~ '^TSK-[0-9]{6,}$'),
  constraint tasks_title_check
    check (length(trim(title)) between 1 and 200),
  constraint tasks_brief_check
    check (length(trim(brief)) between 1 and 10000),
  constraint tasks_source_type_check
    check (source_type in ('MANUAL', 'PRODUCTION', 'SHOP_TASK', 'AI_MARKETING', 'DAILY_CONTENT')),
  constraint tasks_source_reference_pair_check
    check (
      (source_record_type is null and source_record_id is null)
      or (
        source_record_type is not null
        and source_record_id is not null
        and length(trim(source_record_type)) between 1 and 64
        and length(trim(source_record_id)) between 1 and 200
      )
    ),
  constraint tasks_status_check
    check (status in ('DRAFT', 'TO_DO', 'IN_PROGRESS', 'FOR_REVIEW', 'NEEDS_REVISION', 'DONE', 'CANCELLED')),
  constraint tasks_priority_check
    check (priority in ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  constraint tasks_time_tracking_mode_check
    check (time_tracking_mode in ('EXPECTED', 'NONE')),
  constraint tasks_version_check
    check (version >= 1),
  constraint tasks_external_workflow_id_check
    check (external_workflow_id is null or length(trim(external_workflow_id)) between 1 and 200),
  constraint tasks_external_task_number_check
    check (external_task_number is null or length(trim(external_task_number)) between 1 and 200),
  constraint tasks_idempotency_key_check
    check (idempotency_key is null or length(trim(idempotency_key)) between 1 and 200),
  constraint tasks_terminal_timestamps_check
    check (
      (
        status = 'DONE'
        and completed_at is not null
        and cancelled_at is null
      )
      or (
        status = 'CANCELLED'
        and cancelled_at is not null
        and completed_at is null
      )
      or (
        status not in ('DONE', 'CANCELLED')
        and completed_at is null
        and cancelled_at is null
      )
    ),
  constraint tasks_archive_check
    check (archived_at is null or status in ('DONE', 'CANCELLED'))
);

create unique index if not exists tasks_idempotency_key_uidx
  on public.tasks (idempotency_key)
  where idempotency_key is not null;

create unique index if not exists tasks_external_identity_uidx
  on public.tasks (source_type, external_workflow_id, external_task_number)
  where external_workflow_id is not null and external_task_number is not null;

create index if not exists tasks_status_idx
  on public.tasks (status, updated_at desc);

create index if not exists tasks_assigned_user_idx
  on public.tasks (assigned_user_id, status, submission_deadline);

create index if not exists tasks_reviewer_user_idx
  on public.tasks (reviewer_user_id, status);

create index if not exists tasks_schedule_idx
  on public.tasks (scheduled_date, submission_deadline);

create table if not exists public.task_time_entries (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete restrict,
  user_id uuid not null references public.admin_users(user_id) on delete restrict,
  cycle_number integer not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  close_reason text,
  corrected_at timestamptz,
  corrected_by_user_id uuid references public.admin_users(user_id) on delete restrict,
  correction_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_time_entries_cycle_check
    check (cycle_number >= 1),
  constraint task_time_entries_range_check
    check (ended_at is null or ended_at >= started_at),
  constraint task_time_entries_close_check
    check (
      (ended_at is null and close_reason is null)
      or (
        ended_at is not null
        and close_reason in ('SUBMITTED', 'TASK_CANCELLED', 'OWNER_CORRECTION')
      )
    ),
  constraint task_time_entries_correction_check
    check (
      (
        corrected_at is null
        and corrected_by_user_id is null
        and correction_reason is null
      )
      or (
        corrected_at is not null
        and corrected_by_user_id is not null
        and length(trim(correction_reason)) between 1 and 2000
      )
    ),
  constraint task_time_entries_task_cycle_key
    unique (task_id, cycle_number)
);

create unique index if not exists task_time_entries_one_open_task_uidx
  on public.task_time_entries (task_id)
  where ended_at is null;

create unique index if not exists task_time_entries_one_open_user_uidx
  on public.task_time_entries (user_id)
  where ended_at is null;

create index if not exists task_time_entries_task_idx
  on public.task_time_entries (task_id, cycle_number);

create index if not exists task_time_entries_user_idx
  on public.task_time_entries (user_id, started_at desc);

create table if not exists public.task_submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete restrict,
  cycle_number integer not null,
  submitted_by_user_id uuid not null references public.admin_users(user_id) on delete restrict,
  submission_note text not null,
  proof_url text,
  time_recording_status text not null default 'RECORDED',
  no_time_reason text,
  submitted_at timestamptz not null default now(),
  reviewer_user_id uuid references public.admin_users(user_id) on delete restrict,
  review_decision text not null default 'PENDING',
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_submissions_cycle_check
    check (cycle_number >= 1),
  constraint task_submissions_note_check
    check (length(trim(submission_note)) between 1 and 5000),
  constraint task_submissions_proof_url_check
    check (
      proof_url is null
      or (
        length(proof_url) <= 2048
        and proof_url ~* '^https://[^[:space:]]+$'
      )
    ),
  constraint task_submissions_time_recording_status_check
    check (time_recording_status in ('RECORDED', 'NOT_RECORDED', 'NOT_REQUIRED')),
  constraint task_submissions_time_recording_consistency_check
    check (
      (
        time_recording_status = 'RECORDED'
        and no_time_reason is null
      )
      or (
        time_recording_status = 'NOT_RECORDED'
        and no_time_reason is not null
        and length(trim(no_time_reason)) between 1 and 2000
      )
      or (
        time_recording_status = 'NOT_REQUIRED'
        and no_time_reason is null
      )
    ),
  constraint task_submissions_decision_check
    check (review_decision in ('PENDING', 'REVISION_REQUESTED', 'APPROVED')),
  constraint task_submissions_review_consistency_check
    check (
      (
        review_decision = 'PENDING'
        and reviewer_user_id is null
        and reviewed_at is null
        and review_note is null
      )
      or (
        review_decision = 'REVISION_REQUESTED'
        and reviewer_user_id is not null
        and reviewed_at is not null
        and length(trim(review_note)) between 1 and 5000
      )
      or (
        review_decision = 'APPROVED'
        and reviewer_user_id is not null
        and reviewed_at is not null
        and (review_note is null or length(trim(review_note)) <= 5000)
      )
    ),
  constraint task_submissions_task_cycle_key
    unique (task_id, cycle_number)
);

create unique index if not exists task_submissions_one_pending_review_uidx
  on public.task_submissions (task_id)
  where review_decision = 'PENDING';

create index if not exists task_submissions_task_idx
  on public.task_submissions (task_id, submitted_at desc);

create table if not exists public.task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete restrict,
  event_type text not null,
  actor_kind text not null,
  actor_user_id uuid references public.admin_users(user_id) on delete restrict,
  actor_role text not null,
  occurred_at timestamptz not null default now(),
  previous_status text,
  next_status text,
  field_changes jsonb not null default '{}'::jsonb,
  reason text,
  idempotency_key text,
  staff_visible boolean not null default true,
  constraint task_events_type_check
    check (
      event_type in (
        'TASK_CREATED',
        'DRAFT_UPDATED',
        'ASSIGNED',
        'REASSIGNED',
        'DRAFT_APPROVED',
        'STARTED',
        'SUBMITTED',
        'SUBMITTED_WITHOUT_TIME',
        'REVISION_REQUESTED',
        'REVISION_STARTED',
        'WORK_APPROVED',
        'COMPLETED',
        'CANCELLED',
        'REOPENED',
        'ARCHIVED',
        'TIME_ENTRY_CORRECTED'
      )
    ),
  constraint task_events_actor_kind_check
    check (actor_kind in ('USER', 'SYSTEM', 'AUTOMATION')),
  constraint task_events_actor_role_check
    check (actor_role in ('owner', 'admin', 'staff', 'system', 'automation')),
  constraint task_events_actor_consistency_check
    check (
      (
        actor_kind = 'USER'
        and actor_user_id is not null
        and actor_role in ('owner', 'admin', 'staff')
      )
      or (
        actor_kind in ('SYSTEM', 'AUTOMATION')
        and actor_user_id is null
        and actor_role in ('system', 'automation')
      )
    ),
  constraint task_events_previous_status_check
    check (
      previous_status is null
      or previous_status in ('DRAFT', 'TO_DO', 'IN_PROGRESS', 'FOR_REVIEW', 'NEEDS_REVISION', 'DONE', 'CANCELLED')
    ),
  constraint task_events_next_status_check
    check (
      next_status is null
      or next_status in ('DRAFT', 'TO_DO', 'IN_PROGRESS', 'FOR_REVIEW', 'NEEDS_REVISION', 'DONE', 'CANCELLED')
    ),
  constraint task_events_field_changes_check
    check (jsonb_typeof(field_changes) = 'object'),
  constraint task_events_reason_check
    check (reason is null or length(trim(reason)) between 1 and 5000),
  constraint task_events_idempotency_key_check
    check (idempotency_key is null or length(trim(idempotency_key)) between 1 and 200)
);

create unique index if not exists task_events_idempotency_uidx
  on public.task_events (idempotency_key)
  where idempotency_key is not null;

create index if not exists task_events_task_idx
  on public.task_events (task_id, occurred_at, id);

create or replace function public.task_domain_enabled()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce(
    (
      select enabled
      from public.task_feature_flags
      where feature = 'TASK_DOMAIN'
    ),
    false
  );
$$;

create or replace function public.task_prepare_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.version := old.version + 1;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists tasks_prepare_update on public.tasks;
create trigger tasks_prepare_update
before update on public.tasks
for each row
execute function public.task_prepare_update();

create or replace function public.task_child_prepare_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists task_time_entries_prepare_update on public.task_time_entries;
create trigger task_time_entries_prepare_update
before update on public.task_time_entries
for each row
execute function public.task_child_prepare_update();

drop trigger if exists task_submissions_prepare_update on public.task_submissions;
create trigger task_submissions_prepare_update
before update on public.task_submissions
for each row
execute function public.task_child_prepare_update();

create or replace function public.task_events_reject_change()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'task events are immutable';
end;
$$;

drop trigger if exists task_events_immutable on public.task_events;
create trigger task_events_immutable
before update or delete on public.task_events
for each row
execute function public.task_events_reject_change();

alter table public.task_feature_flags enable row level security;
alter table public.tasks enable row level security;
alter table public.task_time_entries enable row level security;
alter table public.task_submissions enable row level security;
alter table public.task_events enable row level security;

drop policy if exists "Task managers and assignees can read tasks" on public.tasks;
create policy "Task managers and assignees can read tasks"
on public.tasks
for select
to authenticated
using (
  public.task_domain_enabled()
  and exists (
    select 1
    from public.admin_users actor
    where actor.user_id = (select auth.uid())
      and actor.is_active = true
      and (
        actor.role in ('owner', 'admin')
        or (
          actor.role = 'staff'
          and tasks.assigned_user_id = actor.user_id
          and tasks.status <> 'DRAFT'
        )
      )
  )
);

drop policy if exists "Task users can read permitted time entries" on public.task_time_entries;
create policy "Task users can read permitted time entries"
on public.task_time_entries
for select
to authenticated
using (
  public.task_domain_enabled()
  and exists (
    select 1
    from public.admin_users actor
    join public.tasks task on task.id = task_time_entries.task_id
    where actor.user_id = (select auth.uid())
      and actor.is_active = true
      and (
        actor.role in ('owner', 'admin')
        or (
          actor.role = 'staff'
          and task.assigned_user_id = actor.user_id
          and task_time_entries.user_id = actor.user_id
          and task.status <> 'DRAFT'
        )
      )
  )
);

drop policy if exists "Task users can read permitted submissions" on public.task_submissions;
create policy "Task users can read permitted submissions"
on public.task_submissions
for select
to authenticated
using (
  public.task_domain_enabled()
  and exists (
    select 1
    from public.admin_users actor
    join public.tasks task on task.id = task_submissions.task_id
    where actor.user_id = (select auth.uid())
      and actor.is_active = true
      and (
        actor.role in ('owner', 'admin')
        or (
          actor.role = 'staff'
          and task.assigned_user_id = actor.user_id
          and task_submissions.submitted_by_user_id = actor.user_id
          and task.status <> 'DRAFT'
        )
      )
  )
);

drop policy if exists "Task users can read permitted events" on public.task_events;
create policy "Task users can read permitted events"
on public.task_events
for select
to authenticated
using (
  public.task_domain_enabled()
  and exists (
    select 1
    from public.admin_users actor
    join public.tasks task on task.id = task_events.task_id
    where actor.user_id = (select auth.uid())
      and actor.is_active = true
      and (
        actor.role in ('owner', 'admin')
        or (
          actor.role = 'staff'
          and task.assigned_user_id = actor.user_id
          and task.status <> 'DRAFT'
          and task_events.staff_visible = true
        )
      )
  )
);

revoke all on table public.task_feature_flags from public, anon, authenticated;
revoke all on table public.tasks from public, anon, authenticated, service_role;
revoke all on table public.task_time_entries from public, anon, authenticated, service_role;
revoke all on table public.task_submissions from public, anon, authenticated, service_role;
revoke all on table public.task_events from public, anon, authenticated, service_role;
revoke all on sequence public.task_code_seq from public, anon, authenticated, service_role;

grant select, update on table public.task_feature_flags to service_role;

grant select (
  id,
  task_code,
  title,
  brief,
  source_type,
  source_record_type,
  source_record_id,
  status,
  priority,
  time_tracking_mode,
  assigned_user_id,
  reviewer_user_id,
  draft_approval_required,
  scheduled_date,
  start_deadline,
  submission_deadline,
  approval_deadline,
  version,
  completed_at,
  cancelled_at,
  archived_at,
  created_at,
  updated_at
) on public.tasks to authenticated;

grant select (
  id,
  task_id,
  user_id,
  cycle_number,
  started_at,
  ended_at,
  close_reason,
  corrected_at,
  created_at,
  updated_at
) on public.task_time_entries to authenticated;

grant select on table public.task_submissions to authenticated;
grant select on table public.task_events to authenticated;

revoke all on function public.task_domain_enabled() from public, anon, authenticated, service_role;
grant execute on function public.task_domain_enabled() to authenticated;

revoke all on function public.task_prepare_update() from public, anon, authenticated, service_role;
revoke all on function public.task_child_prepare_update() from public, anon, authenticated, service_role;
revoke all on function public.task_events_reject_change() from public, anon, authenticated, service_role;

comment on table public.tasks is
  'Canonical hidden task records shared by future Workboard and My Tasks surfaces.';

comment on column public.tasks.source_record_id is
  'Opaque reference only. Supported source types and existence are validated by future server contracts; no source data is copied here.';

comment on table public.task_events is
  'Append-only audit history. Manager-only events must set staff_visible=false.';
