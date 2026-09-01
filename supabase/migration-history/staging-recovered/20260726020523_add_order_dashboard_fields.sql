alter table public.ops_inquiries
  add column if not exists assigned_staff text,
  add column if not exists production_stage text,
  add column if not exists production_note text,
  add column if not exists production_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ops_inquiries_production_stage_check'
      and conrelid = 'public.ops_inquiries'::regclass
  ) then
    alter table public.ops_inquiries
      add constraint ops_inquiries_production_stage_check
      check (
        production_stage is null
        or production_stage in (
          'queued',
          'in_production',
          'qc_finishing',
          'ready_for_fulfillment',
          'completed'
        )
      );
  end if;
end $$;;
