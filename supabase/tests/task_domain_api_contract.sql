-- API-specific replay contract. Disposable local Supabase database only.
begin;
create extension if not exists pgtap;
select plan(1);

do $$
declare
  v_owner uuid := '96000000-0000-4000-8000-000000000001';
  v_staff uuid := '96000000-0000-4000-8000-000000000002';
  v_admin uuid := '96000000-0000-4000-8000-000000000003';
  v_first jsonb;
  v_replay jsonb;
  v_second jsonb;
  v_production jsonb;
  v_daily jsonb;
  v_approved jsonb;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values
    (
      '00000000-0000-0000-0000-000000000000', v_owner,
      'authenticated', 'authenticated', 'api-owner@invalid.example', '',
      clock_timestamp(), '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()
    ),
    (
      '00000000-0000-0000-0000-000000000000', v_staff,
      'authenticated', 'authenticated', 'api-staff@invalid.example', '',
      clock_timestamp(), '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()
    ),
    (
      '00000000-0000-0000-0000-000000000000', v_admin,
      'authenticated', 'authenticated', 'api-admin@invalid.example', '',
      clock_timestamp(), '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()
    );

  insert into public.admin_users (
    user_id, email, role, display_name, is_active, is_test
  )
  values
    (v_owner, 'api-owner@invalid.example', 'owner', 'Synthetic API Owner', true, false),
    (v_staff, 'api-staff@invalid.example', 'staff', 'Synthetic API Staff', true, false),
    (v_admin, 'api-admin@invalid.example', 'admin', 'Synthetic API Admin', true, false);

  update public.task_feature_flags set enabled = true where feature = 'TASK_DOMAIN';
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  v_first := public.task_create(
    'Synthetic API task one', 'Disposable API contract task.', 'MANUAL',
    null, null, 'MEDIUM', v_staff, v_owner, false,
    null, null, null, null, null, null, 'api-create-one'
  );
  if (v_first ->> 'replayed')::boolean then
    raise exception 'first command incorrectly reported replay';
  end if;

  v_replay := public.task_create(
    'Synthetic API task one', 'Disposable API contract task.', 'MANUAL',
    null, null, 'MEDIUM', v_staff, v_owner, false,
    null, null, null, null, null, null, 'api-create-one'
  );
  if not (v_replay ->> 'replayed')::boolean
     or v_replay ->> 'id' <> v_first ->> 'id' then
    raise exception 'identical replay was not explicit and canonical';
  end if;

  v_second := public.task_create(
    'Synthetic API task two', 'Disposable API contract task.', 'MANUAL',
    null, null, 'MEDIUM', v_staff, v_owner, false,
    null, null, null, null, null, null, 'api-create-two'
  );

  perform public.task_assign(
    (v_first ->> 'id')::uuid,
    (v_first ->> 'version')::bigint,
    v_staff,
    'api-global-mutation-key'
  );

  begin
    perform public.task_assign(
      (v_second ->> 'id')::uuid,
      (v_second ->> 'version')::bigint,
      v_staff,
      'api-global-mutation-key'
    );
    raise exception 'one idempotency key mutated two tasks';
  exception when unique_violation then null;
  end;

  begin
    perform public.task_assign(
      (v_second ->> 'id')::uuid,
      (v_second ->> 'version')::bigint,
      v_staff,
      'api-create-one'
    );
    raise exception 'create idempotency key was reused by a mutation';
  exception when unique_violation then null;
  end;

  begin
    perform public.task_create(
      'Synthetic forbidden third task', 'Disposable API contract task.', 'MANUAL',
      null, null, 'MEDIUM', v_staff, v_owner, false,
      null, null, null, null, null, null, 'api-global-mutation-key'
    );
    raise exception 'mutation idempotency key was reused by create';
  exception when unique_violation then null;
  end;

  if (select count(*) from public.tasks) <> 2 then
    raise exception 'idempotency conflicts changed canonical task count';
  end if;

  v_production := public.task_create(
    'Synthetic API production draft', 'Disposable API contract task.', 'PRODUCTION',
    null, null, 'MEDIUM', null, null, false,
    null, null, null, null, null, null, 'api-create-production'
  );

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  v_approved := public.task_approve_and_assign(
    (v_production ->> 'id')::uuid,
    (v_production ->> 'version')::bigint,
    v_staff,
    v_admin,
    null,
    clock_timestamp() + interval '1 day',
    null,
    'api-approve-assign-production'
  );
  if v_approved ->> 'status' <> 'TO_DO'
     or v_approved ->> 'assignedUserId' <> v_staff::text
     or v_approved ->> 'reviewerUserId' <> v_admin::text then
    raise exception 'approve-and-assign did not atomically activate and assign';
  end if;
  if (
    select count(*)
    from public.task_events
    where task_id = (v_production ->> 'id')::uuid
      and event_type = 'DRAFT_APPROVED'
  ) <> 1 then
    raise exception 'approve-and-assign did not write exactly one approval event';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  v_daily := public.task_create(
    'Synthetic API daily draft', 'Disposable API contract task.', 'DAILY_CONTENT',
    null, null, 'MEDIUM', null, null, true,
    null, null, null, null, null, null, 'api-create-daily'
  );

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
    perform public.task_approve_and_assign(
      (v_daily ->> 'id')::uuid,
      (v_daily ->> 'version')::bigint,
      v_staff,
      v_admin,
      null,
      null,
      null,
      'api-approve-assign-daily-admin'
    );
    raise exception 'admin activated a daily content draft';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  begin
    perform public.task_approve_and_assign(
      (v_daily ->> 'id')::uuid,
      (v_daily ->> 'version')::bigint,
      v_staff,
      v_admin,
      null,
      null,
      null,
      'api-approve-assign-daily-staff'
    );
    raise exception 'staff activated a draft';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  v_approved := public.task_approve_and_assign(
    (v_daily ->> 'id')::uuid,
    (v_daily ->> 'version')::bigint,
    v_staff,
    v_owner,
    null,
    null,
    null,
    'api-approve-assign-daily-owner'
  );
  if v_approved ->> 'status' <> 'TO_DO' then
    raise exception 'owner did not activate daily content draft';
  end if;
end;
$$;

select pass('task domain API idempotency contract');
select * from finish();
rollback;
