-- Forgot-to-start and NONE-mode contract. Disposable local Supabase only.
begin;
create extension if not exists pgtap;
select plan(1);

do $$
declare
  v_owner uuid := '97000000-0000-4000-8000-000000000001';
  v_staff_a uuid := '97000000-0000-4000-8000-000000000002';
  v_staff_b uuid := '97000000-0000-4000-8000-000000000003';
  v_disabled uuid := '97000000-0000-4000-8000-000000000004';
  v_constraint_task uuid := '97100000-0000-4000-8000-000000000001';
  v_expected jsonb;
  v_expected_id uuid;
  v_none jsonb;
  v_none_id uuid;
  v_direct jsonb;
  v_direct_id uuid;
  v_result jsonb;
  v_version bigint;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values
    ('00000000-0000-0000-0000-000000000000', v_owner, 'authenticated', 'authenticated', 'no-time-owner@invalid.example', '', clock_timestamp(), '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()),
    ('00000000-0000-0000-0000-000000000000', v_staff_a, 'authenticated', 'authenticated', 'no-time-staff-a@invalid.example', '', clock_timestamp(), '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()),
    ('00000000-0000-0000-0000-000000000000', v_staff_b, 'authenticated', 'authenticated', 'no-time-staff-b@invalid.example', '', clock_timestamp(), '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()),
    ('00000000-0000-0000-0000-000000000000', v_disabled, 'authenticated', 'authenticated', 'no-time-disabled@invalid.example', '', clock_timestamp(), '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp());

  insert into public.admin_users (user_id, email, role, display_name, is_active, is_test)
  values
    (v_owner, 'no-time-owner@invalid.example', 'owner', 'Synthetic Owner', true, false),
    (v_staff_a, 'no-time-staff-a@invalid.example', 'staff', 'Synthetic Staff A', true, false),
    (v_staff_b, 'no-time-staff-b@invalid.example', 'staff', 'Synthetic Staff B', true, false),
    (v_disabled, 'no-time-disabled@invalid.example', 'staff', 'Synthetic Disabled Staff', false, false);

  update public.task_feature_flags set enabled = true where feature = 'TASK_DOMAIN';
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  begin
    insert into public.tasks (
      id, task_code, title, brief, source_type, priority, time_tracking_mode,
      assigned_user_id, reviewer_user_id, created_by_user_id
    )
    values (
      v_constraint_task, 'TSK-971001', 'Invalid mode', 'Disposable.',
      'MANUAL', 'MEDIUM', 'INVALID', v_staff_a, v_owner, v_owner
    );
    raise exception 'invalid time_tracking_mode was accepted';
  exception when check_violation then null;
  end;

  insert into public.tasks (
    id, task_code, title, brief, source_type, priority, time_tracking_mode,
    status, assigned_user_id, reviewer_user_id, created_by_user_id
  )
  values (
    v_constraint_task, 'TSK-971001', 'Constraint fixture', 'Disposable.',
    'MANUAL', 'MEDIUM', 'EXPECTED', 'TO_DO', v_staff_a, v_owner, v_owner
  );

  begin
    insert into public.task_submissions (
      task_id, cycle_number, submitted_by_user_id, submission_note,
      time_recording_status
    ) values (v_constraint_task, 1, v_staff_a, 'Invalid.', 'INVALID');
    raise exception 'invalid time_recording_status was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.task_submissions (
      task_id, cycle_number, submitted_by_user_id, submission_note,
      time_recording_status
    ) values (v_constraint_task, 1, v_staff_a, 'Invalid.', 'NOT_RECORDED');
    raise exception 'NOT_RECORDED without reason was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.task_submissions (
      task_id, cycle_number, submitted_by_user_id, submission_note,
      time_recording_status, no_time_reason
    ) values (v_constraint_task, 1, v_staff_a, 'Invalid.', 'RECORDED', 'Not allowed.');
    raise exception 'RECORDED with no-time reason was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.task_submissions (
      task_id, cycle_number, submitted_by_user_id, submission_note,
      time_recording_status, no_time_reason
    ) values (v_constraint_task, 1, v_staff_a, 'Invalid.', 'NOT_REQUIRED', 'Not allowed.');
    raise exception 'NOT_REQUIRED with no-time reason was accepted';
  exception when check_violation then null;
  end;

  v_expected := public.task_create(
    'Expected task', 'Disposable expected-time task.', 'MANUAL',
    null, null, 'MEDIUM', v_staff_a, v_owner, false,
    null, null, null, null, null, null, 'no-time-create-expected', 'EXPECTED'
  );
  v_expected_id := (v_expected ->> 'id')::uuid;
  v_result := public.task_approve_draft(
    v_expected_id, (v_expected ->> 'version')::bigint, 'no-time-approve-expected'
  );

  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  v_result := public.task_start_work(
    v_expected_id, (v_result ->> 'version')::bigint, 'no-time-start-expected'
  );
  v_result := public.task_submit_for_review(
    v_expected_id, (v_result ->> 'version')::bigint,
    'Synthetic timed submission.', null, 'no-time-submit-recorded'
  );
  if v_result ->> 'status' <> 'FOR_REVIEW' then
    raise exception 'timed submission did not reach FOR_REVIEW';
  end if;
  if not exists (
    select 1 from public.task_submissions
    where task_id = v_expected_id and cycle_number = 1
      and time_recording_status = 'RECORDED' and no_time_reason is null
  ) then
    raise exception 'timed submission was not RECORDED';
  end if;
  if exists (
    select 1 from public.task_time_entries
    where task_id = v_expected_id and ended_at is null
  ) then
    raise exception 'timed submission left timer open';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  v_result := public.task_request_revision(
    v_expected_id, (v_result ->> 'version')::bigint,
    'Synthetic revision.', 'no-time-request-revision'
  );
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  v_version := (v_result ->> 'version')::bigint;

  begin
    perform public.task_submit_without_time(
      v_expected_id, v_version, 'Synthetic revision completed.', null,
      'no-time-missing-reason'
    );
    raise exception 'fallback without reason was accepted';
  exception when invalid_parameter_value then null;
  end;

  v_result := public.task_submit_without_time(
    v_expected_id, v_version, 'Synthetic revision completed.',
    'Forgot to start the timer.', 'no-time-fallback-revision'
  );
  if v_result ->> 'status' <> 'FOR_REVIEW' then
    raise exception 'revision fallback did not reach FOR_REVIEW';
  end if;
  if not exists (
    select 1 from public.task_submissions
    where task_id = v_expected_id and cycle_number = 2
      and time_recording_status = 'NOT_RECORDED'
      and no_time_reason = 'Forgot to start the timer.'
  ) then
    raise exception 'revision fallback did not preserve NOT_RECORDED reason';
  end if;
  if (select count(*) from public.task_time_entries where task_id = v_expected_id) <> 1 then
    raise exception 'revision fallback fabricated a time entry';
  end if;
  if not exists (
    select 1 from public.task_events
    where task_id = v_expected_id
      and event_type = 'SUBMITTED_WITHOUT_TIME'
      and reason = 'Forgot to start the timer.'
  ) then
    raise exception 'fallback audit event was not written';
  end if;

  v_result := public.task_submit_without_time(
    v_expected_id, v_version, 'Synthetic revision completed.',
    'Forgot to start the timer.', 'no-time-fallback-revision'
  );
  if not (v_result ->> 'replayed')::boolean then
    raise exception 'fallback replay was not explicit';
  end if;
  if (select count(*) from public.task_submissions where task_id = v_expected_id and cycle_number = 2) <> 1
     or (select count(*) from public.task_events where task_id = v_expected_id and event_type = 'SUBMITTED_WITHOUT_TIME') <> 1 then
    raise exception 'fallback replay duplicated submission or event';
  end if;
  begin
    perform public.task_submit_without_time(
      v_expected_id, v_version, 'Conflicting note.',
      'Forgot to start the timer.', 'no-time-fallback-revision'
    );
    raise exception 'conflicting fallback replay was accepted';
  exception when unique_violation then null;
  end;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  v_none := public.task_create(
    'No tracking task', 'Disposable no-tracking task.', 'MANUAL',
    null, null, 'LOW', v_staff_a, v_owner, false,
    null, null, null, null, null, null, 'no-time-create-none', 'NONE'
  );
  v_none_id := (v_none ->> 'id')::uuid;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  v_result := public.task_approve_draft(
    v_none_id, (v_none ->> 'version')::bigint, 'no-time-approve-none'
  );
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  begin
    perform public.task_start_work(
      v_none_id, (v_result ->> 'version')::bigint, 'no-time-invalid-start-none'
    );
    raise exception 'NONE task allowed Start Work';
  exception when sqlstate '55000' then null;
  end;
  v_result := public.task_submit_for_review(
    v_none_id, (v_result ->> 'version')::bigint,
    'Synthetic no-tracking submission.', null, 'no-time-submit-none'
  );
  if not exists (
    select 1 from public.task_submissions
    where task_id = v_none_id and cycle_number = 1
      and time_recording_status = 'NOT_REQUIRED' and no_time_reason is null
  ) then
    raise exception 'NONE submission was not NOT_REQUIRED';
  end if;
  if exists (select 1 from public.task_time_entries where task_id = v_none_id) then
    raise exception 'NONE submission fabricated time';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  v_result := public.task_request_revision(
    v_none_id, (v_result ->> 'version')::bigint,
    'Synthetic no-tracking revision.', 'no-time-revise-none'
  );
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  begin
    perform public.task_start_revision(
      v_none_id, (v_result ->> 'version')::bigint, 'no-time-invalid-revision-start'
    );
    raise exception 'NONE task allowed Start Revision';
  exception when sqlstate '55000' then null;
  end;
  v_result := public.task_submit_for_review(
    v_none_id, (v_result ->> 'version')::bigint,
    'Synthetic no-tracking revision complete.', null, 'no-time-submit-none-revision'
  );
  if not exists (
    select 1 from public.task_submissions
    where task_id = v_none_id and cycle_number = 2
      and time_recording_status = 'NOT_REQUIRED'
  ) then
    raise exception 'NONE revision did not use the next submission cycle';
  end if;
  begin
    perform public.task_submit_without_time(
      v_none_id, (v_result ->> 'version')::bigint,
      'Invalid fallback.', 'Invalid for NONE.', 'no-time-invalid-none-fallback'
    );
    raise exception 'NONE task accepted forgot-to-start fallback';
  exception when sqlstate '55000' then null;
  end;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  v_direct := public.task_create(
    'Direct fallback task', 'Disposable direct fallback task.', 'MANUAL',
    null, null, 'MEDIUM', v_staff_a, v_owner, false,
    null, null, null, null, null, null, 'no-time-create-direct', 'EXPECTED'
  );
  v_direct_id := (v_direct ->> 'id')::uuid;
  v_result := public.task_approve_draft(
    v_direct_id, (v_direct ->> 'version')::bigint, 'no-time-approve-direct'
  );

  perform set_config('request.jwt.claim.sub', v_staff_b::text, true);
  begin
    perform public.task_submit_without_time(
      v_direct_id, (v_result ->> 'version')::bigint,
      'Unauthorized.', 'Synthetic reason.',
      'no-time-wrong-assignee'
    );
    raise exception 'non-assignee submitted without time';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  v_result := public.task_submit_without_time(
    v_direct_id, (v_result ->> 'version')::bigint,
    'Synthetic direct fallback.', 'Forgot to start the timer.',
    'no-time-direct-fallback'
  );
  if v_result ->> 'status' <> 'FOR_REVIEW'
     or not exists (
       select 1 from public.task_submissions
       where task_id = v_direct_id and cycle_number = 1
         and time_recording_status = 'NOT_RECORDED'
     )
     or exists (
       select 1 from public.task_time_entries where task_id = v_direct_id
     ) then
    raise exception 'direct TO_DO fallback contract failed';
  end if;

  update public.admin_users set is_active = false where user_id = v_staff_a;
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  begin
    perform public.task_submit_without_time(
      v_constraint_task, 1, 'Disabled.', 'Synthetic reason.',
      'no-time-disabled-user'
    );
    raise exception 'disabled assignee submitted without time';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select pass('task domain no-time submission contract');
select * from finish();
rollback;
