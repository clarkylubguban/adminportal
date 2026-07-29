-- Enable the task domain only after its schema and functions are installed.
-- This migration intentionally does not create feature rows or task records.

do $$
begin
  update public.task_feature_flags
  set enabled = true,
      updated_at = clock_timestamp()
  where feature = 'TASK_DOMAIN';

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_DOMAIN feature flag row does not exist';
  end if;
end;
$$;
