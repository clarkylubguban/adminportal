-- Disposable local database only. Validates canonical schema constraints.
begin;

do $$
declare
  v_task_id uuid := '92000000-0000-4000-8000-000000000001';
begin
  insert into public.tasks (
    id, task_code, title, brief, source_type, status, priority
  )
  values (
    v_task_id, 'TSK-920001', 'Synthetic constraint task',
    'Rolled back after local validation.', 'MANUAL', 'DRAFT', 'MEDIUM'
  );

  begin
    insert into public.tasks (task_code, title, brief, source_type, status, priority)
    values ('TSK-920002', 'Invalid status', 'Synthetic.', 'MANUAL', 'APPROVED', 'MEDIUM');
    raise exception 'invalid status was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.tasks (task_code, title, brief, source_type, status, priority)
    values ('TSK-920003', 'Invalid source', 'Synthetic.', 'CALENDAR', 'DRAFT', 'MEDIUM');
    raise exception 'invalid source was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.tasks (task_code, title, brief, source_type, status, priority)
    values ('TSK-920004', 'Invalid priority', 'Synthetic.', 'MANUAL', 'DRAFT', 'CRITICAL');
    raise exception 'invalid priority was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.tasks (
      task_code, title, brief, source_type, source_record_type, status, priority
    )
    values (
      'TSK-920005', 'Half source pair', 'Synthetic.', 'PRODUCTION',
      'production-job', 'DRAFT', 'MEDIUM'
    );
    raise exception 'half-present source reference was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.tasks (task_code, title, brief, source_type, status, priority)
    values ('TSK-920001', 'Duplicate code', 'Synthetic.', 'MANUAL', 'DRAFT', 'MEDIUM');
    raise exception 'duplicate task code was accepted';
  exception when unique_violation then null;
  end;

  begin
    insert into public.tasks (
      task_code, title, brief, source_type, status, priority, completed_at
    )
    values (
      'TSK-920006', 'Invalid lifecycle timestamp', 'Synthetic.',
      'MANUAL', 'TO_DO', 'MEDIUM', clock_timestamp()
    );
    raise exception 'nonterminal completion timestamp was accepted';
  exception when check_violation then null;
  end;

  begin
    update public.tasks set archived_at = clock_timestamp() where id = v_task_id;
    raise exception 'nonterminal archive was accepted';
  exception when check_violation then null;
  end;
end;
$$;

rollback;