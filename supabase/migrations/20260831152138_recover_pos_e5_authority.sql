-- OS-BASELINE-1A: recover accepted production POS/E5 authority.
--
-- This migration intentionally restores only the canonical production access
-- paths required by the baseline:
--   1. minimal POS staff identity/read authority from M3B
--   2. E5 temporary access read-only authority for Inventory and Purchasing
--   3. POS cashier branch-scoped inventory read authority from M9B4C
--
-- Do not add E7 role/module access here. In particular, this file must not
-- create has_admin_module_access(...) or role/module permission tables.

do $$
declare
  required_table text;
  required_function text;
begin
  foreach required_table in array array[
    'public.admin_users',
    'public.branches',
    'public.inventory_locations',
    'public.inventory_balances',
    'public.stock_movements',
    'public.suppliers',
    'public.purchase_orders',
    'public.purchase_order_lines',
    'public.purchase_order_receipts',
    'public.purchase_order_receipt_lines'
  ]
  loop
    if to_regclass(required_table) is null then
      raise exception 'OS_BASELINE_1A_POS_E5_AUTHORITY_DEPENDENCY_MISSING: %', required_table
        using errcode = '55000';
    end if;
  end loop;

  foreach required_function in array array[
    'public.set_updated_at()',
    'public.is_active_admin_user(text[])',
    'private.m2b_is_owner_admin()'
  ]
  loop
    if to_regprocedure(required_function) is null then
      raise exception 'OS_BASELINE_1A_POS_E5_AUTHORITY_DEPENDENCY_MISSING: %', required_function
        using errcode = '55000';
    end if;
  end loop;
end $$;

create table if not exists public.pos_staff_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  display_name text not null,
  role text not null,
  active boolean not null default true,
  default_branch_id uuid references public.branches(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_staff_profiles_display_name_not_blank check (btrim(display_name) <> ''),
  constraint pos_staff_profiles_role_check check (role in ('OWNER', 'ADMIN', 'CASHIER'))
);

create index if not exists pos_staff_profiles_branch_idx
  on public.pos_staff_profiles (default_branch_id);

drop trigger if exists set_pos_staff_profiles_updated_at on public.pos_staff_profiles;
create trigger set_pos_staff_profiles_updated_at
before update on public.pos_staff_profiles
for each row execute function public.set_updated_at();

create or replace function private.m3b_current_pos_staff()
returns public.pos_staff_profiles
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select staff.*
  from public.pos_staff_profiles staff
  where staff.user_id = auth.uid()
    and staff.active is true
  limit 1
$$;

create or replace function private.m3b_is_active_pos_staff()
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select exists (
    select 1
    from public.pos_staff_profiles staff
    where staff.user_id = auth.uid()
      and staff.active is true
      and staff.role in ('OWNER', 'ADMIN', 'CASHIER')
  )
$$;

alter table public.pos_staff_profiles enable row level security;
alter table public.pos_staff_profiles force row level security;

drop policy if exists pos_staff_profiles_m3b_select on public.pos_staff_profiles;
create policy pos_staff_profiles_m3b_select
on public.pos_staff_profiles
for select
to authenticated
using (
  private.m3b_is_active_pos_staff()
  and (
    user_id = (select auth.uid())
    or default_branch_id = (private.m3b_current_pos_staff()).default_branch_id
  )
);

revoke all on public.pos_staff_profiles from anon, authenticated;
grant select on public.pos_staff_profiles to authenticated;
grant all on public.pos_staff_profiles to service_role;

revoke all on function private.m3b_current_pos_staff() from public;
revoke all on function private.m3b_current_pos_staff() from anon;
grant execute on function private.m3b_current_pos_staff() to authenticated;
grant execute on function private.m3b_is_active_pos_staff() to authenticated;

create table if not exists public.employee_temporary_access_grants (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.admin_users(id) on delete restrict,
  module_code text not null,
  granted_by uuid not null references public.admin_users(id) on delete restrict,
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  reason text,
  revoked_at timestamptz,
  revoked_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint employee_temporary_access_module_code_check check (
    module_code in (
      'production',
      'design_artwork',
      'inventory',
      'purchasing_suppliers',
      'pos_sales',
      'orders',
      'inquiries',
      'master_catalog',
      'workboard',
      'calendar',
      'pricing_discounts',
      'people_access'
    )
  ),
  constraint employee_temporary_access_window_check check (starts_at < expires_at)
);

create unique index if not exists employee_temp_access_active_day_unique
  on public.employee_temporary_access_grants (employee_id, module_code, expires_at)
  where revoked_at is null;

create index if not exists employee_temp_access_employee_idx
  on public.employee_temporary_access_grants (employee_id);

create index if not exists employee_temp_access_expires_idx
  on public.employee_temporary_access_grants (expires_at);

create index if not exists employee_temp_access_revoked_idx
  on public.employee_temporary_access_grants (revoked_at);

create index if not exists employee_temp_access_module_idx
  on public.employee_temporary_access_grants (module_code);

create index if not exists employee_temporary_access_grants_granted_by_fkey_idx
  on public.employee_temporary_access_grants (granted_by);

create index if not exists employee_temporary_access_grants_revoked_by_fkey_idx
  on public.employee_temporary_access_grants (revoked_by);

alter table public.employee_temporary_access_grants enable row level security;

revoke all on public.employee_temporary_access_grants from anon, authenticated;
grant all on public.employee_temporary_access_grants to service_role;

create or replace function public.has_active_employee_temporary_access(p_module_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employee_temporary_access_grants grant_row
    join public.admin_users employee
      on employee.id = grant_row.employee_id
    where employee.user_id = (select auth.uid())
      and employee.role = 'staff'
      and employee.is_active is true
      and grant_row.module_code = p_module_code
      and grant_row.starts_at <= now()
      and grant_row.expires_at > now()
      and grant_row.revoked_at is null
  );
$$;

revoke all on function public.has_active_employee_temporary_access(text) from public;
revoke all on function public.has_active_employee_temporary_access(text) from anon;
grant execute on function public.has_active_employee_temporary_access(text) to authenticated;
grant execute on function public.has_active_employee_temporary_access(text) to service_role;

drop policy if exists "inventory locations read active admin" on public.inventory_locations;
drop policy if exists "Active authorized users can read inventory locations" on public.inventory_locations;
drop policy if exists inventory_locations_m2b_owner_admin_select on public.inventory_locations;
drop policy if exists inventory_locations_m9b4c_cashier_select on public.inventory_locations;
drop policy if exists inventory_locations_effective_select on public.inventory_locations;
create policy inventory_locations_effective_select
on public.inventory_locations
for select
to authenticated
using (
  public.is_active_admin_user(array['owner','admin'])
  or public.has_active_employee_temporary_access('inventory'::text)
  or private.m2b_is_owner_admin()
);

drop policy if exists "inventory balances read active admin" on public.inventory_balances;
drop policy if exists "Active authorized users can read inventory balances" on public.inventory_balances;
drop policy if exists inventory_balances_m2b_owner_admin_select on public.inventory_balances;
drop policy if exists inventory_balances_m9b4c_cashier_select on public.inventory_balances;
drop policy if exists inventory_balances_effective_select on public.inventory_balances;
create policy inventory_balances_effective_select
on public.inventory_balances
for select
to authenticated
using (
  public.is_active_admin_user(array['owner','admin'])
  or public.has_active_employee_temporary_access('inventory'::text)
  or private.m2b_is_owner_admin()
);

drop policy if exists "stock movements read active admin" on public.stock_movements;
drop policy if exists "Active authorized users can read stock movements" on public.stock_movements;
drop policy if exists stock_movements_m2b_owner_admin_select on public.stock_movements;
drop policy if exists stock_movements_effective_select on public.stock_movements;
create policy stock_movements_effective_select
on public.stock_movements
for select
to authenticated
using (
  public.is_active_admin_user(array['owner','admin'])
  or public.has_active_employee_temporary_access('inventory'::text)
  or private.m2b_is_owner_admin()
);

drop policy if exists "Active admins can read suppliers" on public.suppliers;
drop policy if exists "suppliers read active admin or purchasing temp" on public.suppliers;
drop policy if exists "suppliers read admin or purchasing temp" on public.suppliers;
create policy "suppliers read admin or purchasing temp"
on public.suppliers
for select
to authenticated
using (
  public.is_active_admin_user(array['owner','admin'])
  or public.has_active_employee_temporary_access('purchasing_suppliers')
);

drop policy if exists "purchase orders read active admin" on public.purchase_orders;
drop policy if exists "purchase orders read active admin or purchasing temp" on public.purchase_orders;
drop policy if exists "purchase orders read admin or purchasing temp" on public.purchase_orders;
create policy "purchase orders read admin or purchasing temp"
on public.purchase_orders
for select
to authenticated
using (
  public.is_active_admin_user(array['owner','admin'])
  or public.has_active_employee_temporary_access('purchasing_suppliers')
);

drop policy if exists "purchase order lines read active admin" on public.purchase_order_lines;
drop policy if exists "purchase order lines read active admin or purchasing temp" on public.purchase_order_lines;
drop policy if exists "purchase order lines read admin or purchasing temp" on public.purchase_order_lines;
create policy "purchase order lines read admin or purchasing temp"
on public.purchase_order_lines
for select
to authenticated
using (
  public.is_active_admin_user(array['owner','admin'])
  or public.has_active_employee_temporary_access('purchasing_suppliers')
);

drop policy if exists "purchase order receipts read active admin" on public.purchase_order_receipts;
drop policy if exists "purchase order receipts read active admin or purchasing temp" on public.purchase_order_receipts;
drop policy if exists "po receipts read admin or purchasing temp" on public.purchase_order_receipts;
create policy "po receipts read admin or purchasing temp"
on public.purchase_order_receipts
for select
to authenticated
using (
  public.is_active_admin_user(array['owner','admin'])
  or public.has_active_employee_temporary_access('purchasing_suppliers')
);

drop policy if exists "purchase order receipt lines read active admin" on public.purchase_order_receipt_lines;
drop policy if exists "purchase order receipt lines read active admin or purchasing temp" on public.purchase_order_receipt_lines;
drop policy if exists "purchase order receipt lines read active admin or purchasing te" on public.purchase_order_receipt_lines;
drop policy if exists "po receipt lines read admin or purchasing temp" on public.purchase_order_receipt_lines;
create policy "po receipt lines read admin or purchasing temp"
on public.purchase_order_receipt_lines
for select
to authenticated
using (
  public.is_active_admin_user(array['owner','admin'])
  or public.has_active_employee_temporary_access('purchasing_suppliers')
);

create or replace function public.get_pos_sales_effective_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_employee public.admin_users%rowtype;
  v_grant public.employee_temporary_access_grants%rowtype;
begin
  if (select auth.uid()) is null then
    return jsonb_build_object(
      'allowed', false,
      'source', 'none',
      'expires_at', null,
      'grant_id', null
    );
  end if;

  select *
    into v_employee
  from public.admin_users
  where user_id = (select auth.uid())
    and is_active is true
  limit 1;

  if v_employee.id is null then
    return jsonb_build_object(
      'allowed', false,
      'source', 'none',
      'expires_at', null,
      'grant_id', null
    );
  end if;

  if lower(v_employee.role::text) in ('owner', 'admin') then
    return jsonb_build_object(
      'allowed', true,
      'source', 'permanent',
      'expires_at', null,
      'grant_id', null
    );
  end if;

  if lower(v_employee.role::text) <> 'staff' then
    return jsonb_build_object(
      'allowed', false,
      'source', 'none',
      'expires_at', null,
      'grant_id', null
    );
  end if;

  select *
    into v_grant
  from public.employee_temporary_access_grants
  where employee_id = v_employee.id
    and module_code = 'pos_sales'
    and starts_at <= v_now
    and v_now < expires_at
    and revoked_at is null
  order by expires_at asc
  limit 1;

  if v_grant.id is null then
    return jsonb_build_object(
      'allowed', false,
      'source', 'none',
      'expires_at', null,
      'grant_id', null
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'source', 'temporary',
    'expires_at', v_grant.expires_at,
    'grant_id', v_grant.id
  );
end;
$$;

revoke execute on function public.get_pos_sales_effective_access() from public;
revoke execute on function public.get_pos_sales_effective_access() from anon;
grant execute on function public.get_pos_sales_effective_access() to authenticated;
grant execute on function public.get_pos_sales_effective_access() to service_role;

create or replace function private.m9b4c_is_active_cashier_for_branch(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select p_branch_id is not null
    and exists (
      select 1
      from public.admin_users admin_user
      join public.pos_staff_profiles staff on staff.user_id = admin_user.user_id
      join public.branches branch on branch.id = staff.default_branch_id
      where admin_user.user_id = auth.uid()
        and admin_user.is_active is true
        and lower(admin_user.role::text) = 'staff'
        and staff.active is true
        and staff.role = 'CASHIER'
        and staff.default_branch_id = p_branch_id
        and branch.id = p_branch_id
        and branch.active is true
    )
$$;

create or replace function private.m9b4c_cashier_can_read_inventory_location(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select exists (
    select 1
    from public.inventory_locations location
    join public.branches branch on branch.id = location.branch_id
    where location.id = p_location_id
      and location.active is true
      and branch.active is true
      and private.m9b4c_is_active_cashier_for_branch(location.branch_id)
  )
$$;

revoke all on function private.m9b4c_is_active_cashier_for_branch(uuid) from public;
revoke all on function private.m9b4c_cashier_can_read_inventory_location(uuid) from public;
revoke all on function private.m9b4c_is_active_cashier_for_branch(uuid) from anon;
revoke all on function private.m9b4c_cashier_can_read_inventory_location(uuid) from anon;
grant execute on function private.m9b4c_is_active_cashier_for_branch(uuid) to authenticated;
grant execute on function private.m9b4c_cashier_can_read_inventory_location(uuid) to authenticated;

drop policy if exists branches_m2b_owner_admin_select on public.branches;
drop policy if exists branches_m9b4c_cashier_select on public.branches;
drop policy if exists branches_effective_select on public.branches;
create policy branches_effective_select
on public.branches
for select
to authenticated
using (
  private.m2b_is_owner_admin()
  or private.m9b4c_is_active_cashier_for_branch(id)
);

drop policy if exists inventory_locations_effective_select on public.inventory_locations;
create policy inventory_locations_effective_select
on public.inventory_locations
for select
to authenticated
using (
  public.is_active_admin_user(array['owner','admin'])
  or public.has_active_employee_temporary_access('inventory'::text)
  or private.m2b_is_owner_admin()
  or private.m9b4c_cashier_can_read_inventory_location(id)
);

drop policy if exists inventory_balances_effective_select on public.inventory_balances;
create policy inventory_balances_effective_select
on public.inventory_balances
for select
to authenticated
using (
  public.is_active_admin_user(array['owner','admin'])
  or public.has_active_employee_temporary_access('inventory'::text)
  or private.m2b_is_owner_admin()
  or private.m9b4c_cashier_can_read_inventory_location(location_id)
);

drop policy if exists stock_movements_effective_select on public.stock_movements;
create policy stock_movements_effective_select
on public.stock_movements
for select
to authenticated
using (
  public.is_active_admin_user(array['owner','admin'])
  or public.has_active_employee_temporary_access('inventory'::text)
  or private.m2b_is_owner_admin()
);

do $$
begin
  if to_regprocedure('public.has_admin_module_access(text)') is not null then
    raise exception 'OS_BASELINE_1A_E7_OBJECT_FORBIDDEN: public.has_admin_module_access(text)'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'admin_modules',
        'admin_actions',
        'admin_access_roles',
        'admin_role_module_permissions',
        'admin_role_action_permissions',
        'admin_temporary_module_grants',
        'admin_employee_activity_events',
        'admin_employee_shift_defaults',
        'admin_employee_attendance'
      )
  ) then
    raise exception 'OS_BASELINE_1A_E7_OBJECT_FORBIDDEN: role/module access table present'
      using errcode = '55000';
  end if;
end $$;
