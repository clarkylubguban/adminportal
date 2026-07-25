-- Run only against a disposable local Supabase database. Exercises lifecycle,
-- role, timer, stale-version, revision, cancellation, reopen, and archive paths.
begin;

do $$
declare
  v_owner_id uuid := '93000000-0000-4000-8000-000000000001';
  v_admin_id uuid := '93000000-0000-4000-8000-000000000002';
  v_staff_id uuid := '93000000-0000-4000-8000-000000000003';
  v_disabled_id uuid := '93000000-0000-4000-8000-000000000004';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  select
    '00000000-0000-0000-0000-000000000000', fixture.id,
    'authenticated', 'authenticated', fixture.email, '', clock_timestamp(),
    '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()
  from (values
    (v_owner_id, 'branch-owner@invalid.example'),
    (v_admin_id, 'branch-admin@invalid.example'),
    (v_staff_id, 'branch-staff@invalid.example'),
    (v_disabled_id, 'branch-disabled@invalid.example')
  ) as fixture(id, email);

  insert into public.admin_users (
    user_id, email, role, display_name, is_active, is_test
  )
  values
    (v_owner_id, 'branch-owner@invalid.example', 'owner', 'Synthetic Owner', true, true),
    (v_admin_id, 'branch-admin@invalid.example', 'admin', 'Synthetic Admin', true, true),
    (v_staff_id, 'branch-staff@invalid.example', 'staff', 'Synthetic Staff', true, true),
    (v_disabled_id, 'branch-disabled@invalid.example', 'staff', 'Synthetic Disabled', false, true);
end;
$$;

update public.task_feature_flags
set enabled = true, updated_at = clock_timestamp()
where feature = 'TASK_DOMAIN';

do $$
declare
  v_owner_id uuid := '93000000-0000-4000-8000-000000000001';
  v_admin_id uuid := '93000000-0000-4000-8000-000000000002';
  v_staff_id uuid := '93000000-0000-4000-8000-000000000003';
  v_disabled_id uuid := '93000000-0000-4000-8000-000000000004';
  v_result jsonb;
  v_task_id uuid;
  v_version bigint;
  v_gated_id uuid;
  v_gated_version bigint;
  v_disabled_task_id uuid;
  v_disabled_version bigint;
  v_entry_id uuid;
  v_entry_started_at timestamptz;
  v_entry_ended_at timestamptz;
  v_admin_task_id uuid;
  v_admin_version bigint;
  v_total_before bigint;
  v_overlap_task_id uuid := '93000000-0000-4000-8000-000000000099';
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);

  v_result := public.task_create(
    'Synthetic revision lifecycle', 'Disposable.', 'MANUAL', null, null,
    'HIGH', v_staff_id, v_owner_id, false, null, null, null, null,
    null, null, 'branches-create'
  );
  v_task_id := (v_result ->> 'id')::uuid;
  v_version := (v_result ->> 'version')::bigint;
  v_result := public.task_approve_draft(v_task_id, v_version, 'branches-approve');
  v_version := (v_result ->> 'version')::bigint;

  begin
    perform public.task_approve_work(v_task_id, v_version, null, 'branches-shortcut');
    raise exception 'TO_DO to DONE shortcut was accepted';
  exception when sqlstate '55000' then null;
  end;

  perform set_config('request.jwt.claim.sub', v_staff_id::text, true);
  begin
    perform public.task_start_work(v_task_id, v_version - 1, 'branches-stale');
    raise exception 'stale version was accepted';
  exception when sqlstate '40001' then null;
  end;
  v_result := public.task_start_work(v_task_id, v_version, 'branches-start');
  v_version := (v_result ->> 'version')::bigint;
  perform public.task_start_work(v_task_id, v_version - 1, 'branches-start');
  if (select count(*) from public.task_time_entries where task_id = v_task_id and ended_at is null) <> 1 then
    raise exception 'idempotent Start created a duplicate timer';
  end if;

  begin
    perform public.task_create(
      'Forbidden staff create', 'Disposable.', 'MANUAL', null, null,
      'LOW', v_staff_id, v_owner_id, false, null, null, null, null,
      null, null, 'branches-staff-create'
    );
    raise exception 'staff create was accepted';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  v_result := public.task_cancel(v_task_id, v_version, 'Synthetic cancellation.', 'branches-cancel');
  v_version := (v_result ->> 'version')::bigint;
  if v_result ->> 'status' <> 'CANCELLED' then raise exception 'cancel failed'; end if;
  perform public.task_cancel(
    v_task_id, v_version - 1, 'Synthetic cancellation.', 'branches-cancel'
  );
  begin
    perform public.task_cancel(
      v_task_id, v_version - 1, 'Conflicting cancellation.', 'branches-cancel'
    );
    raise exception 'conflicting Cancel replay was accepted';
  exception when unique_violation then null;
  end;
  if not exists (
    select 1 from public.task_time_entries
    where task_id = v_task_id and close_reason = 'TASK_CANCELLED' and ended_at is not null
  ) then raise exception 'active cancellation did not close timer'; end if;

  select id, started_at, ended_at
  into v_entry_id, v_entry_started_at, v_entry_ended_at
  from public.task_time_entries
  where task_id = v_task_id and close_reason = 'TASK_CANCELLED';
  v_total_before := (v_result ->> 'totalTrackedSeconds')::bigint;

  insert into public.tasks (
    id, task_code, title, brief, source_type, status, priority
  ) values (
    v_overlap_task_id, 'TSK-930099', 'Synthetic overlap task', 'Disposable.',
    'MANUAL', 'DRAFT', 'LOW'
  );
  insert into public.task_time_entries (
    task_id, user_id, cycle_number, started_at, ended_at, close_reason
  ) values (
    v_overlap_task_id, v_staff_id, 1,
    v_entry_started_at - interval '10 seconds',
    v_entry_ended_at + interval '10 seconds', 'OWNER_CORRECTION'
  );
  begin
    perform public.task_correct_time_entry(
      v_task_id, v_entry_id, v_version,
      v_entry_started_at - interval '1 second', v_entry_ended_at,
      'Overlapping correction.', 'branches-overlap-time'
    );
    raise exception 'overlapping timer correction was accepted';
  exception when exclusion_violation then null;
  end;
  delete from public.task_time_entries where task_id = v_overlap_task_id;
  delete from public.tasks where id = v_overlap_task_id;

  v_result := public.task_correct_time_entry(
    v_task_id, v_entry_id, v_version,
    v_entry_started_at - interval '1 second', v_entry_ended_at,
    'Synthetic timer correction.', 'branches-correct-time'
  );
  v_version := (v_result ->> 'version')::bigint;
  perform public.task_correct_time_entry(
    v_task_id, v_entry_id, v_version - 1,
    v_entry_started_at - interval '1 second', v_entry_ended_at,
    'Synthetic timer correction.', 'branches-correct-time'
  );
  begin
    perform public.task_correct_time_entry(
      v_task_id, v_entry_id, v_version - 1,
      v_entry_started_at - interval '2 seconds', v_entry_ended_at,
      'Synthetic timer correction.', 'branches-correct-time'
    );
    raise exception 'conflicting time correction replay was accepted';
  exception when unique_violation then null;
  end;
  if not exists (
    select 1 from public.task_events
    where task_id = v_task_id and event_type = 'TIME_ENTRY_CORRECTED'
      and reason = 'Synthetic timer correction.'
      and field_changes ->> 'oldStartedAt' is not null
      and field_changes ->> 'newStartedAt' is not null
  ) then raise exception 'valid timer correction was not fully audited'; end if;
  if (v_result ->> 'totalTrackedSeconds')::bigint <= v_total_before then
    raise exception 'corrected duration was not reflected in task totals';
  end if;
  begin
    perform public.task_correct_time_entry(
      v_task_id, v_entry_id, v_version,
      v_entry_ended_at + interval '1 second', v_entry_ended_at,
      'Impossible range.', 'branches-invalid-time'
    );
    raise exception 'impossible timer correction was accepted';
  exception when sqlstate '22023' then null;
  end;

  v_result := public.task_reopen(v_task_id, v_version, 'Synthetic reopen.', 'branches-reopen');
  v_version := (v_result ->> 'version')::bigint;
  perform public.task_reopen(
    v_task_id, v_version - 1, 'Synthetic reopen.', 'branches-reopen'
  );
  begin
    perform public.task_reopen(
      v_task_id, v_version - 1, 'Conflicting reopen.', 'branches-reopen'
    );
    raise exception 'conflicting reopen replay was accepted';
  exception when unique_violation then null;
  end;

  perform set_config('request.jwt.claim.sub', v_staff_id::text, true);
  v_result := public.task_start_work(v_task_id, v_version, 'branches-restart');
  v_version := (v_result ->> 'version')::bigint;
  v_result := public.task_submit_for_review(
    v_task_id, v_version, 'First synthetic submission.', null, 'branches-submit-one'
  );
  v_version := (v_result ->> 'version')::bigint;
  perform public.task_submit_for_review(
    v_task_id, v_version - 1, 'First synthetic submission.', null, 'branches-submit-one'
  );
  begin
    perform public.task_submit_for_review(
      v_task_id, v_version - 1, 'Conflicting submission.', null, 'branches-submit-one'
    );
    raise exception 'conflicting Submit replay was accepted';
  exception when unique_violation then null;
  end;

  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  v_result := public.task_request_revision(
    v_task_id, v_version, 'Synthetic revision note.', 'branches-revision'
  );
  v_version := (v_result ->> 'version')::bigint;
  perform public.task_request_revision(
    v_task_id, v_version - 1, 'Synthetic revision note.', 'branches-revision'
  );
  begin
    perform public.task_request_revision(
      v_task_id, v_version - 1, 'Conflicting revision note.', 'branches-revision'
    );
    raise exception 'conflicting Revision replay was accepted';
  exception when unique_violation then null;
  end;

  perform set_config('request.jwt.claim.sub', v_staff_id::text, true);
  v_result := public.task_start_revision(v_task_id, v_version, 'branches-start-revision');
  v_version := (v_result ->> 'version')::bigint;
  v_result := public.task_submit_for_review(
    v_task_id, v_version, 'Revised synthetic submission.', null, 'branches-submit-two'
  );
  v_version := (v_result ->> 'version')::bigint;

  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  v_result := public.task_approve_work(v_task_id, v_version, null, 'branches-complete');
  v_version := (v_result ->> 'version')::bigint;
  perform public.task_approve_work(v_task_id, v_version - 1, null, 'branches-complete');
  begin
    perform public.task_approve_work(
      v_task_id, v_version - 1, 'Conflicting approval note.', 'branches-complete'
    );
    raise exception 'conflicting Approve replay was accepted';
  exception when unique_violation then null;
  end;
  v_result := public.task_archive(v_task_id, v_version, 'branches-archive');
  if v_result ->> 'archivedAt' is null then raise exception 'terminal archive failed'; end if;
  if (select count(*) from public.task_submissions where task_id = v_task_id) <> 2 then
    raise exception 'revision cycle did not create two canonical submissions';
  end if;
  v_version := (v_result ->> 'version')::bigint;
  v_result := public.task_reopen(
    v_task_id, v_version, 'Synthetic DONE reopen.', 'branches-reopen-done'
  );
  if v_result ->> 'status' <> 'TO_DO' or v_result ->> 'archivedAt' is not null then
    raise exception 'DONE reopen did not restore TO_DO and clear archive';
  end if;
  v_version := (v_result ->> 'version')::bigint;
  v_result := public.task_cancel(
    v_task_id, v_version, 'Synthetic TO_DO cancellation.', 'branches-cancel-todo'
  );
  if v_result ->> 'status' <> 'CANCELLED' then raise exception 'TO_DO cancellation failed'; end if;

  v_result := public.task_create(
    'Synthetic DRAFT cancellation', 'Disposable.', 'MANUAL', null, null,
    'LOW', null, null, false, null, null, null, null,
    null, null, 'branches-draft-cancel-create'
  );
  v_result := public.task_cancel(
    (v_result ->> 'id')::uuid, (v_result ->> 'version')::bigint,
    'Synthetic DRAFT cancellation.', 'branches-draft-cancel'
  );
  if v_result ->> 'status' <> 'CANCELLED' then raise exception 'DRAFT cancellation failed'; end if;

  v_result := public.task_create(
    'Synthetic owner-gated draft', 'Disposable.', 'MANUAL', null, null,
    'MEDIUM', v_staff_id, v_admin_id, true, null, null, null, null,
    null, null, 'branches-gated-create'
  );
  v_gated_id := (v_result ->> 'id')::uuid;
  v_gated_version := (v_result ->> 'version')::bigint;

  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  begin
    perform public.task_approve_draft(v_gated_id, v_gated_version, 'branches-gated-admin');
    raise exception 'admin bypassed owner-required approval';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.task_create(
      'Forbidden admin automation', 'Disposable.', 'AI_MARKETING', null, null,
      'MEDIUM', v_staff_id, v_owner_id, true, null, null, null, null,
      null, null, 'branches-admin-ai'
    );
    raise exception 'admin AI task creation was accepted';
  exception when insufficient_privilege then null;
  end;
  v_result := public.task_create(
    'Permitted admin manual draft', 'Disposable.', 'MANUAL', null, null,
    'MEDIUM', v_staff_id, v_admin_id, false, null, null, null, null,
    null, null, 'branches-admin-manual'
  );
  v_admin_task_id := (v_result ->> 'id')::uuid;
  v_admin_version := (v_result ->> 'version')::bigint;
  v_result := public.task_approve_draft(
    v_admin_task_id, v_admin_version, 'branches-admin-manual-approve'
  );
  if v_result ->> 'status' <> 'TO_DO' then
    raise exception 'permitted admin manual draft approval failed';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  update public.admin_users set is_active = true where user_id = v_disabled_id;
  v_result := public.task_create(
    'Synthetic later-disabled assignee', 'Disposable.', 'MANUAL', null, null,
    'LOW', v_disabled_id, v_owner_id, false, null, null, null, null,
    null, null, 'branches-disabled-create'
  );
  v_disabled_task_id := (v_result ->> 'id')::uuid;
  v_disabled_version := (v_result ->> 'version')::bigint;
  v_result := public.task_approve_draft(
    v_disabled_task_id, v_disabled_version, 'branches-disabled-approve'
  );
  v_disabled_version := (v_result ->> 'version')::bigint;
  update public.admin_users set is_active = false where user_id = v_disabled_id;

  perform set_config('request.jwt.claim.sub', v_disabled_id::text, true);
  begin
    perform public.task_start_work(
      v_disabled_task_id, v_disabled_version, 'branches-disabled-start'
    );
    raise exception 'disabled account mutation was accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;