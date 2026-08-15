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
  'Append-only audit history. Manager-only events must set staff_visible=false.';;
