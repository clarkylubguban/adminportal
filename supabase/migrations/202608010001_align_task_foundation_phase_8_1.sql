-- Phase 8.1 locked task foundation alignment.
-- Forward-only patch: keep the existing task domain, tighten invariants, and
-- keep all task UI/domain exposure flags disabled by default.

update public.task_feature_flags
set enabled = false,
    updated_at = clock_timestamp()
where feature = 'TASK_DOMAIN';

alter table public.task_events
  drop constraint if exists task_events_type_check;

alter table public.task_events
  add constraint task_events_type_check
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
        'DISCARDED',
        'REOPENED',
        'ARCHIVED',
        'TIME_ENTRY_CORRECTED'
      )
    );

alter table public.tasks
  drop constraint if exists tasks_active_assignee_check;

alter table public.tasks
  add constraint tasks_active_assignee_check
    check (
      status not in ('TO_DO', 'IN_PROGRESS', 'FOR_REVIEW', 'NEEDS_REVISION')
      or assigned_user_id is not null
    )
    not valid;

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
    and coalesce(actor.is_test, false) = false
    and actor.role in ('owner', 'admin', 'staff')
  limit 1;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'active task-domain account required';
  end if;
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
    and coalesce(account.is_test, false) = false
    and account.role in ('owner', 'admin', 'staff');

  if v_role is null then
    raise exception using
      errcode = '22023',
      message = 'target user is not an eligible task-domain assignee';
  end if;

  return v_role;
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
  v_event_type text;
  v_fingerprint text := md5(jsonb_build_object(
    'command', 'task_cancel',
    'reason', trim(p_reason)
  )::text);
begin
  select * into v_actor from public.task_current_actor();
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'task not found'; end if;
  if public.task_idempotency_replay(p_task_id, array['CANCELLED', 'DISCARDED'], v_key) then
    perform public.task_assert_replay_fingerprint(p_task_id, v_key, v_fingerprint);
    return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role, true);
  end if;
  if v_task.status not in ('DRAFT', 'TO_DO', 'IN_PROGRESS', 'NEEDS_REVISION') then
    raise exception using errcode = '55000', message = 'task cannot be cancelled in its current state';
  end if;
  if v_task.version <> p_expected_version then raise exception using errcode = '40001', message = 'task version conflict'; end if;
  if nullif(trim(p_reason), '') is null then raise exception using errcode = '22023', message = 'cancellation or discard reason is required'; end if;
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

  v_event_type := case when v_task.status = 'DRAFT' then 'DISCARDED' else 'CANCELLED' end;

  update public.tasks set status = 'CANCELLED', cancelled_at = v_now where id = p_task_id;
  perform public.task_write_event(
    p_task_id, v_event_type, v_actor.user_id, v_actor.actor_role,
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
  v_next_status text;
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

  if v_task.status = 'DONE' then
    perform public.task_active_user_role(v_task.assigned_user_id);
    v_next_status := 'TO_DO';
  else
    v_next_status := 'DRAFT';
  end if;

  update public.tasks
  set status = v_next_status, completed_at = null, cancelled_at = null, archived_at = null
  where id = p_task_id;
  perform public.task_write_event(
    p_task_id, 'REOPENED', v_actor.user_id, v_actor.actor_role,
    v_task.status, v_next_status,
    jsonb_build_object('_requestFingerprint', v_fingerprint),
    trim(p_reason), v_key, true
  );
  return public.task_command_result(p_task_id, v_actor.user_id, v_actor.actor_role);
end;
$$;

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
      and coalesce(actor.is_test, false) = false
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
      and coalesce(actor.is_test, false) = false
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
      and coalesce(actor.is_test, false) = false
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
      and coalesce(actor.is_test, false) = false
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
