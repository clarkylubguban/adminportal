begin;
create extension if not exists pgtap;
select plan(9);

do $$
declare
  v_owner uuid := '97000000-0000-4000-8000-000000000001';
  v_admin uuid := '97000000-0000-4000-8000-000000000002';
  v_staff uuid := '97000000-0000-4000-8000-000000000003';
  v_planning uuid;
  v_result jsonb;
  v_task_id uuid;
  v_task_version bigint;
  v_event_count integer;
  v_missing_message text;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values
    ('00000000-0000-0000-0000-000000000000', v_owner, 'authenticated', 'authenticated', 'phase88-owner@invalid.example', '', clock_timestamp(), '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()),
    ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated', 'phase88-admin@invalid.example', '', clock_timestamp(), '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()),
    ('00000000-0000-0000-0000-000000000000', v_staff, 'authenticated', 'authenticated', 'phase88-staff@invalid.example', '', clock_timestamp(), '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp());

  insert into public.admin_users (user_id, email, role, display_name, is_active, is_test)
  values
    (v_owner, 'phase88-owner@invalid.example', 'owner', 'Phase 8.8 Owner', true, false),
    (v_admin, 'phase88-admin@invalid.example', 'admin', 'Phase 8.8 Admin', true, false),
    (v_staff, 'phase88-staff@invalid.example', 'staff', 'Phase 8.8 Staff', true, false);

  update public.task_feature_flags set enabled = true where feature = 'TASK_DOMAIN';

  insert into public.planning_requests (
    request_code, requested_by_user_id, quick_direction, maximum_tasks, status, planning_context
  )
  values (
    'PLN-PHASE88TEST', v_owner, 'Phase 8.8 disposable SQL test.', 3, 'REQUESTED', '{}'::jsonb
  )
  returning id into v_planning;

  v_result := public.task_ingest_n8n_drafts(
    'n8n-local',
    'TRRY STAGING - AUTO PLAN TODAY VERIFIER',
    'phase88-exec-ok',
    v_planning,
    'phase88-ingest-ok',
    repeat('a', 64),
    jsonb_build_array(jsonb_build_object(
      'externalTaskId', 'phase88-draft-1',
      'sourceType', 'DAILY_CONTENT',
      'title', 'Phase 8.8 SQL draft',
      'brief', 'Disposable AI draft created by SQL regression.',
      'priority', 'LOW'
    ))
  );
  v_task_id := ((v_result -> 'taskIds') ->> 0)::uuid;

  if not exists (
    select 1 from public.tasks
    where id = v_task_id
      and status = 'DRAFT'
      and assigned_user_id is null
      and reviewer_user_id is null
      and planning_request_id is not null
      and automation_receipt_id is not null
      and external_task_id is not null
  ) then
    raise exception 'AI ingestion did not create an unassigned traceable draft';
  end if;

  insert into public.planning_requests (
    request_code, requested_by_user_id, quick_direction, maximum_tasks, status, planning_context
  )
  values (
    'PLN-PHASE88BAD', v_owner, 'Phase 8.8 disposable rejected SQL test.', 3, 'REQUESTED', '{}'::jsonb
  )
  returning id into v_planning;

  begin
    perform public.task_ingest_n8n_drafts(
      'n8n-local',
      'TRRY STAGING - AUTO PLAN TODAY VERIFIER',
      'phase88-exec-bad',
      v_planning,
      'phase88-ingest-bad',
      repeat('b', 64),
      jsonb_build_array(jsonb_build_object(
        'externalTaskId', 'phase88-bad-1',
        'sourceType', 'DAILY_CONTENT',
        'title', 'Phase 8.8 bad SQL draft',
        'brief', 'This payload must be rejected.',
        'priority', 'LOW',
        'status', 'TO_DO',
        'assignedUserId', v_staff
      ))
    );
    raise exception 'automation ingestion accepted assigned or active payload';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    insert into public.tasks (
      title, brief, source_type, status, priority, time_tracking_mode,
      assigned_user_id, reviewer_user_id, draft_approval_required
    )
    values (
      'Missing trace SQL draft', 'Missing traceability must fail.',
      'DAILY_CONTENT', 'DRAFT', 'LOW', 'EXPECTED', null, null, true
    );
    raise exception 'AI task without traceability fields was accepted';
  exception when check_violation then
    null;
  end;

  select version into v_task_version from public.tasks where id = v_task_id;

  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
    perform public.task_approve_and_assign(v_task_id, v_task_version, v_staff, v_admin, null, null, null, 'phase88-admin-denied');
    raise exception 'admin activated an AI/Daily draft';
  exception when insufficient_privilege then
    null;
  end;

  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  begin
    perform public.task_approve_and_assign(v_task_id, v_task_version, v_staff, v_owner, null, null, null, 'phase88-staff-denied');
    raise exception 'staff activated an AI/Daily draft';
  exception when insufficient_privilege then
    null;
  end;

  if exists (
    select 1 from public.tasks
    where id = v_task_id
      and (status <> 'DRAFT' or assigned_user_id is not null or reviewer_user_id is not null)
  ) or exists (
    select 1 from public.task_events
    where task_id = v_task_id
      and event_type = 'DRAFT_APPROVED'
  ) then
    raise exception 'denied activation left a partial assignment or event';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  begin
    perform public.task_approve_and_assign(v_task_id, v_task_version, v_staff, v_owner, null, null, null, 'phase88-owner-missing-deadline');
    raise exception 'owner activated an incomplete AI/Daily draft';
  exception when invalid_parameter_value then
    get stacked diagnostics v_missing_message = message_text;
    if v_missing_message not like '%submission deadline%' then
      raise exception 'missing deadline error was not specific: %', v_missing_message;
    end if;
  end;

  if exists (
    select 1 from public.tasks
    where id = v_task_id
      and (status <> 'DRAFT' or assigned_user_id is not null or reviewer_user_id is not null)
  ) or exists (
    select 1 from public.task_events
    where task_id = v_task_id
      and event_type = 'DRAFT_APPROVED'
  ) then
    raise exception 'failed incomplete activation left a partial assignment or event';
  end if;

  begin
    perform public.task_update_draft(
      v_task_id, v_task_version, 'Phase 8.8 SQL draft', 'Disposable AI draft created by SQL regression.',
      'LOW', null, v_owner, true, null, null, clock_timestamp() + interval '1 day', null,
      'phase88-owner-reviewer-denied', 'EXPECTED', null, null
    );
    raise exception 'owner assigned reviewer during AI/Daily draft update';
  exception when check_violation then
    null;
  end;

  if exists (
    select 1 from public.tasks
    where id = v_task_id
      and (status <> 'DRAFT' or assigned_user_id is not null or reviewer_user_id is not null)
  ) or exists (
    select 1 from public.task_events
    where task_id = v_task_id
      and event_type = 'DRAFT_UPDATED'
      and idempotency_key = 'phase88-owner-reviewer-denied'
  ) then
    raise exception 'rejected reviewer draft update left a partial assignment or event';
  end if;

  v_result := public.task_update_draft(
    v_task_id, v_task_version, 'Phase 8.8 SQL draft', 'Disposable AI draft created by SQL regression.',
    'LOW', null, null, true, null, null, clock_timestamp() + interval '1 day', null,
    'phase88-owner-complete-draft', 'EXPECTED', null, null
  );
  v_task_version := (v_result ->> 'version')::bigint;

  v_result := public.task_approve_and_assign(v_task_id, v_task_version, v_staff, v_owner, null, null, null, 'phase88-owner-approve');

  if v_result ->> 'status' <> 'TO_DO'
     or v_result ->> 'assignedUserId' <> v_staff::text
     or v_result ->> 'reviewerUserId' <> v_owner::text then
    raise exception 'owner approve-and-assign did not activate atomically';
  end if;

  select count(*) into v_event_count
  from public.task_events
  where task_id = v_task_id
    and event_type = 'DRAFT_APPROVED';
  if v_event_count <> 1 then
    raise exception 'owner approve-and-assign did not write exactly one immutable event';
  end if;
end;
$$;

select pass('AI ingestion creates unassigned traceable DRAFT tasks');
select pass('AI ingestion rejects assigned or active payloads');
select pass('missing AI traceability fields are rejected');
select pass('admin cannot activate AI/Daily drafts');
select pass('staff cannot activate AI/Daily drafts');
select pass('denied activation leaves no partial assignment or event');
select pass('owner cannot activate incomplete AI/Daily draft or assign reviewer before activation');
select pass('owner approve-and-assign activates AI/Daily draft');
select pass('owner approve-and-assign writes one immutable event');
select * from finish();
rollback;
