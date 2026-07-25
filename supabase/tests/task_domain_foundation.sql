-- Run only against a disposable local Supabase database after both 202607250001
-- and 202607250002 migrations have applied. This test rolls back all fixtures.

begin;

do $$
declare
  v_owner_id uuid := '91000000-0000-4000-8000-000000000001';
  v_staff_id uuid := '91000000-0000-4000-8000-000000000002';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values
    (
      '00000000-0000-0000-0000-000000000000', v_owner_id,
      'authenticated', 'authenticated', 'task-owner@invalid.example', '',
      clock_timestamp(), '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()
    ),
    (
      '00000000-0000-0000-0000-000000000000', v_staff_id,
      'authenticated', 'authenticated', 'task-staff@invalid.example', '',
      clock_timestamp(), '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()
    );

  insert into public.admin_users (
    user_id, email, role, display_name, is_active, is_test
  )
  values
    (v_owner_id, 'task-owner@invalid.example', 'owner', 'Synthetic Owner', true, true),
    (v_staff_id, 'task-staff@invalid.example', 'staff', 'Synthetic Staff', true, true);
end;
$$;

update public.task_feature_flags
set enabled = true, updated_at = clock_timestamp()
where feature = 'TASK_DOMAIN';

do $$
declare
  v_owner_id uuid := '91000000-0000-4000-8000-000000000001';
  v_staff_id uuid := '91000000-0000-4000-8000-000000000002';
  v_result jsonb;
  v_replay jsonb;
  v_task_id uuid;
  v_version bigint;
begin
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  v_result := public.task_create(
    'Synthetic lifecycle test',
    'Disposable task used only inside a rolled-back local test.',
    'MANUAL',
    null,
    null,
    'MEDIUM',
    v_staff_id,
    v_owner_id,
    false,
    current_date,
    null,
    clock_timestamp() + interval '1 day',
    clock_timestamp() + interval '2 days',
    null,
    null,
    'foundation-create'
  );
  v_task_id := (v_result ->> 'id')::uuid;
  v_version := (v_result ->> 'version')::bigint;

  if v_result ->> 'status' <> 'DRAFT' then
    raise exception 'create must persist DRAFT';
  end if;

  v_replay := public.task_create(
    'Synthetic lifecycle test',
    'Disposable task used only inside a rolled-back local test.',
    'MANUAL',
    null,
    null,
    'MEDIUM',
    v_staff_id,
    v_owner_id,
    false,
    (v_result ->> 'scheduledDate')::date,
    null,
    (v_result ->> 'submissionDeadline')::timestamptz,
    (v_result ->> 'approvalDeadline')::timestamptz,
    null,
    null,
    'foundation-create'
  );
  if v_replay ->> 'id' <> v_task_id::text then
    raise exception 'create idempotency did not return the original task';
  end if;

  begin
    perform public.task_create(
      'Conflicting replay title',
      'Disposable task used only inside a rolled-back local test.',
      'MANUAL', null, null, 'MEDIUM', v_staff_id, v_owner_id, false,
      (v_result ->> 'scheduledDate')::date, null,
      (v_result ->> 'submissionDeadline')::timestamptz,
      (v_result ->> 'approvalDeadline')::timestamptz,
      null, null, 'foundation-create'
    );
    raise exception 'conflicting create replay was accepted';
  exception when unique_violation then null;
  end;

  v_result := public.task_approve_draft(v_task_id, v_version, 'foundation-approve-draft');
  v_version := (v_result ->> 'version')::bigint;
  if v_result ->> 'status' <> 'TO_DO' then
    raise exception 'draft approval must transition to TO_DO';
  end if;

  perform set_config('request.jwt.claim.sub', v_staff_id::text, true);
  v_result := public.task_start_work(v_task_id, v_version, 'foundation-start');
  v_version := (v_result ->> 'version')::bigint;
  if v_result ->> 'status' <> 'IN_PROGRESS' then
    raise exception 'start must transition to IN_PROGRESS';
  end if;

  begin
    perform public.task_start_work(v_task_id, v_version, 'foundation-invalid-start');
    raise exception 'invalid repeated start was accepted';
  exception
    when sqlstate '55000' then null;
  end;

  begin
    insert into public.task_time_entries (task_id, user_id, cycle_number)
    values (v_task_id, v_staff_id, 2);
    raise exception 'second open timer for the same task was accepted';
  exception when unique_violation then null;
  end;

  begin
    insert into public.task_time_entries (
      task_id, user_id, cycle_number, started_at, ended_at, close_reason
    ) values (
      v_task_id, v_staff_id, 99, clock_timestamp(),
      clock_timestamp() - interval '1 minute', 'OWNER_CORRECTION'
    );
    raise exception 'time entry ending before its start was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.task_submissions (
      task_id, cycle_number, submitted_by_user_id, submission_note, proof_url
    ) values (v_task_id, 98, v_staff_id, 'Synthetic.', 'http://invalid.example/proof');
    raise exception 'non-HTTPS proof URL was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.task_submissions (
      task_id, cycle_number, submitted_by_user_id, submission_note, proof_url
    ) values (
      v_task_id, 98, v_staff_id, 'Synthetic.',
      'https://invalid.example/' || repeat('x', 2048)
    );
    raise exception 'oversized proof URL was accepted';
  exception when check_violation then null;
  end;

  insert into public.task_submissions (
    task_id, cycle_number, submitted_by_user_id, submission_note
  ) values (v_task_id, 98, v_staff_id, 'Synthetic pending review.');
  begin
    insert into public.task_submissions (
      task_id, cycle_number, submitted_by_user_id, submission_note
    ) values (v_task_id, 97, v_staff_id, 'Second synthetic pending review.');
    raise exception 'second pending submission was accepted';
  exception when unique_violation then null;
  end;
  delete from public.task_submissions where task_id = v_task_id and cycle_number = 98;

  insert into public.tasks (
    id, task_code, title, brief, source_type, status, priority
  ) values (
    '91000000-0000-4000-8000-000000000099', 'TSK-910099',
    'Synthetic second timer task', 'Disposable.', 'MANUAL', 'DRAFT', 'LOW'
  );
  begin
    insert into public.task_time_entries (task_id, user_id, cycle_number)
    values ('91000000-0000-4000-8000-000000000099', v_staff_id, 1);
    raise exception 'second open timer for the same user was accepted';
  exception when unique_violation then null;
  end;

  v_result := public.task_submit_for_review(
    v_task_id,
    v_version,
    'Synthetic submission.',
    'https://invalid.example/proof',
    'foundation-submit'
  );
  v_version := (v_result ->> 'version')::bigint;
  if v_result ->> 'status' <> 'FOR_REVIEW' then
    raise exception 'submit must transition to FOR_REVIEW';
  end if;

  if exists (
    select 1 from public.task_time_entries
    where task_id = v_task_id and ended_at is null
  ) then
    raise exception 'submit must close the open timer';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  v_result := public.task_approve_work(
    v_task_id,
    v_version,
    'Synthetic approval.',
    'foundation-approve-work'
  );
  if v_result ->> 'status' <> 'DONE' or v_result ->> 'completedAt' is null then
    raise exception 'approval must complete the task with a server timestamp';
  end if;

  if (
    select count(*)
    from public.task_events
    where task_id = v_task_id
  ) <> 6 then
    raise exception 'unexpected lifecycle event count';
  end if;

  begin
    update public.task_events
    set reason = 'must fail'
    where task_id = v_task_id;
    raise exception 'immutable event update was accepted';
  exception
    when sqlstate '42501' then null;
  end;
end;
$$;

-- RLS smoke: authenticated staff can read the assigned non-draft task and
-- cannot mutate canonical records directly.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '91000000-0000-4000-8000-000000000002',
  true
);

do $$
begin
  if (select count(*) from public.tasks) <> 1 then
    raise exception 'assigned staff task was not visible through RLS';
  end if;

  begin
    update public.tasks set title = 'must fail';
    raise exception 'direct authenticated task mutation was accepted';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
rollback;
