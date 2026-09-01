-- Disposable local Supabase/PostgreSQL only. Exercises authenticated RLS and
-- role behavior with synthetic identities. All changes are rolled back.
begin;
create extension if not exists pgtap;
select plan(1);

do $$
declare
  v_owner uuid := '94000000-0000-4000-8000-000000000001';
  v_admin uuid := '94000000-0000-4000-8000-000000000002';
  v_staff_a uuid := '94000000-0000-4000-8000-000000000003';
  v_staff_b uuid := '94000000-0000-4000-8000-000000000004';
  v_disabled uuid := '94000000-0000-4000-8000-000000000005';
  v_staff_c uuid := '94000000-0000-4000-8000-000000000006';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  select
    '00000000-0000-0000-0000-000000000000', fixture.id,
    'authenticated', 'authenticated', fixture.email, '', clock_timestamp(),
    '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()
  from (values
    (v_owner, 'rls-owner@invalid.example'),
    (v_admin, 'rls-admin@invalid.example'),
    (v_staff_a, 'rls-staff-a@invalid.example'),
    (v_staff_b, 'rls-staff-b@invalid.example'),
    (v_disabled, 'rls-disabled@invalid.example'),
    (v_staff_c, 'rls-staff-c@invalid.example')
  ) fixture(id, email);

  insert into public.admin_users (
    user_id, email, role, display_name, is_active, is_test
  ) values
    (v_owner, 'rls-owner@invalid.example', 'owner', 'Synthetic Owner', true, false),
    (v_admin, 'rls-admin@invalid.example', 'admin', 'Synthetic Admin', true, false),
    (v_staff_a, 'rls-staff-a@invalid.example', 'staff', 'Synthetic Staff A', true, false),
    (v_staff_b, 'rls-staff-b@invalid.example', 'staff', 'Synthetic Staff B', true, true),
    (v_disabled, 'rls-disabled@invalid.example', 'staff', 'Synthetic Disabled', false, false),
    (v_staff_c, 'rls-staff-c@invalid.example', 'staff', 'Synthetic Staff C', true, false);
end;
$$;

update public.task_feature_flags set enabled = true where feature = 'TASK_DOMAIN';
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);

do $$
declare
  v_owner uuid := '94000000-0000-4000-8000-000000000001';
  v_staff_a uuid := '94000000-0000-4000-8000-000000000003';
  v_staff_b uuid := '94000000-0000-4000-8000-000000000004';
  v_staff_c uuid := '94000000-0000-4000-8000-000000000006';
  v_a jsonb;
  v_b jsonb;
  v_task_a uuid;
  v_task_b uuid;
  v_version bigint;
begin
  v_a := public.task_create(
    'Synthetic RLS task A', 'Disposable.', 'MANUAL', null, null, 'HIGH',
    null, v_owner, false, null, null, null, null, null, null, 'rls-create-a'
  );
  v_task_a := (v_a ->> 'id')::uuid;
  v_version := (v_a ->> 'version')::bigint;
  v_a := public.task_update_draft(
    v_task_a, v_version, 'Synthetic RLS task A updated', 'Disposable updated.',
    'URGENT', null, v_owner, false, null, null, null, null, 'rls-update-a', 'EXPECTED', null, null
  );
  v_version := (v_a ->> 'version')::bigint;
  perform public.task_update_draft(
    v_task_a, v_version - 1, 'Synthetic RLS task A updated', 'Disposable updated.',
    'URGENT', null, v_owner, false, null, null, null, null, 'rls-update-a', 'EXPECTED', null, null
  );
  begin
    perform public.task_update_draft(
      v_task_a, v_version - 1, 'Conflicting draft title', 'Disposable updated.',
      'URGENT', null, v_owner, false, null, null, null, null, 'rls-update-a', 'EXPECTED', null, null
    );
    raise exception 'conflicting draft update replay was accepted';
  exception when unique_violation then null;
  end;
  v_a := public.task_assign(v_task_a, v_version, v_staff_a, 'rls-assign-a');
  v_version := (v_a ->> 'version')::bigint;
  perform public.task_assign(v_task_a, v_version - 1, v_staff_a, 'rls-assign-a');
  begin
    perform public.task_assign(v_task_a, v_version - 1, v_staff_b, 'rls-assign-a');
    raise exception 'conflicting assignment replay was accepted';
  exception when unique_violation then null;
  end;
  v_a := public.task_approve_draft(v_task_a, v_version, 'rls-approve-a');

  begin
    perform public.task_create(
      'Synthetic RLS task B', 'Disposable.', 'MANUAL', null, null, 'MEDIUM',
      v_staff_b, v_owner, false, null, null, null, null, null, null, 'rls-create-b'
    );
    raise exception 'active is_test account was assignment eligible';
  exception when invalid_parameter_value then null;
  end;
  v_b := public.task_create(
    'Synthetic RLS task B', 'Disposable.', 'MANUAL', null, null, 'MEDIUM',
    v_staff_c, v_owner, false, null, null, null, null, null, null, 'rls-create-b-valid'
  );
  v_task_b := (v_b ->> 'id')::uuid;
  v_b := public.task_approve_draft(
    v_task_b, (v_b ->> 'version')::bigint, 'rls-approve-b'
  );

  if (select count(id) from public.tasks) <> 2 then
    raise exception 'owner cannot read all tasks';
  end if;
  if not exists (
    select 1 from public.tasks where id = v_task_b and assigned_user_id = v_staff_c
  ) then raise exception 'eligible staff account was excluded from assignment'; end if;

  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  if (select count(id) from public.tasks) <> 1 then
    raise exception 'staff A task visibility is not assignment-scoped';
  end if;
  if exists (
    select 1 from public.task_events
    where task_id = v_task_a and event_type in ('TASK_CREATED', 'DRAFT_UPDATED')
  ) then raise exception 'manager-only draft events leaked to staff'; end if;

  begin
    perform public.task_start_work(v_task_b, (v_b ->> 'version')::bigint, 'rls-non-assignee');
    raise exception 'staff started another assignee task';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.task_create(
      'Forbidden staff create', 'Disposable.', 'MANUAL', null, null, 'LOW',
      v_staff_a, v_owner, false, null, null, null, null, null, null, 'rls-staff-create'
    );
    raise exception 'staff create was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.tasks set status = 'DONE' where id = v_task_a;
    raise exception 'direct task status mutation was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.task_events (
      task_id, event_type, actor_kind, actor_user_id, actor_role
    ) values (v_task_a, 'COMPLETED', 'USER', v_staff_a, 'staff');
    raise exception 'direct event insertion was accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Admin manager scope and owner-only restrictions.
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000002', true);
do $$
declare
  v_owner uuid := '94000000-0000-4000-8000-000000000001';
  v_admin uuid := '94000000-0000-4000-8000-000000000002';
  v_staff_a uuid := '94000000-0000-4000-8000-000000000003';
  v_task jsonb;
begin
  if (select count(id) from public.tasks) <> 2 then
    raise exception 'admin manager read scope failed';
  end if;
  v_task := public.task_create(
    'Synthetic admin manual task', 'Disposable.', 'MANUAL', null, null, 'LOW',
    v_staff_a, v_admin, false, null, null, null, null, null, null, 'rls-admin-create'
  );
  begin
    perform public.task_create(
      'Forbidden admin AI task', 'Disposable.', 'AI_MARKETING', null, null, 'LOW',
      v_staff_a, v_owner, true, null, null, null, null, null, null, 'rls-admin-ai'
    );
    raise exception 'admin AI task creation was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.task_correct_time_entry(
      (v_task ->> 'id')::uuid,
      '94000000-0000-4000-8000-000000000099',
      (v_task ->> 'version')::bigint,
      clock_timestamp(), null, 'Forbidden.', 'rls-admin-correction'
    );
    raise exception 'admin timer correction was accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Disabled accounts cannot invoke commands.
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000005', true);
do $$
begin
  begin
    perform public.task_create(
      'Forbidden disabled task', 'Disposable.', 'MANUAL', null, null, 'LOW',
      null, null, false, null, null, null, null, null, null, 'rls-disabled-create'
    );
    raise exception 'disabled account mutation was accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
update public.task_feature_flags set enabled = false where feature = 'TASK_DOMAIN';
set local role authenticated;
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);
do $$
begin
  if (select count(id) from public.tasks) <> 0 then
    raise exception 'feature-off RLS exposed tasks';
  end if;
  begin
    perform public.task_create(
      'Feature-off task', 'Disposable.', 'MANUAL', null, null, 'LOW',
      null, null, false, null, null, null, null, null, null, 'rls-feature-off'
    );
    raise exception 'feature-off command was accepted';
  exception when sqlstate '55000' then null;
  end;
end;
$$;

reset role;
select pass('task domain RLS contract');
select * from finish();
rollback;
