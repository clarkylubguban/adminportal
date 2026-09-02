-- E5G: temporary Inventory access is read-only.
-- Owner/Admin retain permanent Inventory access. Staff need an active
-- `inventory` temporary grant for Inventory reads, and that grant never
-- satisfies stock movement, receive, adjustment, transfer, catalog, PO, or POS writes.

create or replace function public.has_active_employee_temporary_access(p_module_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employee_temporary_access_grants grants
    join public.admin_users users
      on users.id = grants.employee_id
    where users.user_id = (select auth.uid())
      and users.is_active = true
      and users.role = 'staff'
      and grants.module_code = lower(btrim(p_module_code))
      and grants.starts_at <= now()
      and grants.expires_at > now()
      and grants.revoked_at is null
  );
$$;

revoke all on function public.has_active_employee_temporary_access(text) from public;
revoke all on function public.has_active_employee_temporary_access(text) from anon;
grant execute on function public.has_active_employee_temporary_access(text) to authenticated;

do $$
begin
  if to_regclass('public.inventory_locations') is not null then
    execute 'alter table public.inventory_locations enable row level security';
    execute 'grant select on table public.inventory_locations to authenticated';
    execute 'drop policy if exists "inventory locations read active admin" on public.inventory_locations';
    execute 'drop policy if exists "Active authorized users can read inventory locations" on public.inventory_locations';
    execute 'create policy "Active authorized users can read inventory locations"
      on public.inventory_locations
      for select
      to authenticated
      using (
        public.is_active_admin_user(array[''owner'',''admin''])
        or public.has_active_employee_temporary_access(''inventory'')
      )';
  end if;

  if to_regclass('public.inventory_balances') is not null then
    execute 'alter table public.inventory_balances enable row level security';
    execute 'grant select on table public.inventory_balances to authenticated';
    execute 'drop policy if exists "inventory balances read active admin" on public.inventory_balances';
    execute 'drop policy if exists "Active authorized users can read inventory balances" on public.inventory_balances';
    execute 'create policy "Active authorized users can read inventory balances"
      on public.inventory_balances
      for select
      to authenticated
      using (
        public.is_active_admin_user(array[''owner'',''admin''])
        or public.has_active_employee_temporary_access(''inventory'')
      )';
  end if;

  if to_regclass('public.stock_movements') is not null then
    execute 'alter table public.stock_movements enable row level security';
    execute 'grant select on table public.stock_movements to authenticated';
    execute 'drop policy if exists "stock movements read active admin" on public.stock_movements';
    execute 'drop policy if exists "Active authorized users can read stock movements" on public.stock_movements';
    execute 'create policy "Active authorized users can read stock movements"
      on public.stock_movements
      for select
      to authenticated
      using (
        public.is_active_admin_user(array[''owner'',''admin''])
        or public.has_active_employee_temporary_access(''inventory'')
      )';
  end if;
end;
$$;
