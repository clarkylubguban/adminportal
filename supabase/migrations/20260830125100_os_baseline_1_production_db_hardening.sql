-- OS-BASELINE-1A production DB hardening source-control recovery.
-- This file records the direct August 30 production hardening as forward-only,
-- idempotent source of truth without promoting staging-only E7 module access.
--
-- Production remote migration history:
--   20260830124435_harden_purchase_order_trigger_functions
--   20260830124526_optimize_rls_auth_uid_initplan
--   20260830124734_add_missing_foreign_key_indexes
--   20260830124855_consolidate_permissive_select_policies
--   20260830125053_revoke_direct_task_domain_helper_execute
--
-- Staging has different August 30 version numbers and includes E7 policy
-- expansions using public.has_admin_module_access(...). Those are intentionally
-- not represented here.

do $$
begin
  if to_regprocedure('public.set_purchase_order_updated_at()') is not null then
    alter function public.set_purchase_order_updated_at()
      set search_path = 'pg_catalog', 'public';

    revoke execute on function public.set_purchase_order_updated_at()
      from public, anon, authenticated;
  end if;

  if to_regprocedure('public.set_purchase_order_audit_users()') is not null then
    alter function public.set_purchase_order_audit_users()
      set search_path = 'pg_catalog', 'public';

    revoke execute on function public.set_purchase_order_audit_users()
      from public, anon, authenticated;
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.employees') is not null and exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'employees'
      and policyname = 'Allow approved admin read employees'
  ) then
    alter policy "Allow approved admin read employees"
    on public.employees
    using (
      exists (
        select 1
        from public.admin_users au
        where au.user_id = (select auth.uid())
          and au.role = any (array['admin'::text, 'staff'::text, 'viewer'::text])
      )
    );
  end if;

  if to_regclass('public.approved_products') is not null and exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'approved_products'
      and policyname = 'Allow approved admin read approved products'
  ) then
    alter policy "Allow approved admin read approved products"
    on public.approved_products
    using (
      exists (
        select 1
        from public.admin_users au
        where au.user_id = (select auth.uid())
          and au.role = any (array['admin'::text, 'staff'::text, 'viewer'::text])
      )
    );
  end if;

  if to_regclass('public.pos_staff_profiles') is not null and exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'pos_staff_profiles'
      and policyname = 'pos_staff_profiles_m3b_select'
  ) then
    alter policy pos_staff_profiles_m3b_select
    on public.pos_staff_profiles
    using (
      private.m3b_is_active_pos_staff()
      and (
        user_id = (select auth.uid())
        or default_branch_id = (private.m3b_current_pos_staff()).default_branch_id
      )
    );
  end if;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    with fk as (
      select c.conrelid, c.conname, c.conkey
      from pg_constraint c
      where c.contype = 'f'
        and c.connamespace = 'public'::regnamespace
    ), missing as (
      select fk.*
      from fk
      where not exists (
        select 1
        from pg_index i
        where i.indrelid = fk.conrelid
          and i.indisvalid
          and i.indisready
          and (
            select array_agg(k.attnum::smallint order by k.ord)
            from unnest(i.indkey) with ordinality as k(attnum, ord)
            where k.ord <= cardinality(fk.conkey)
          ) = fk.conkey
      )
    )
    select n.nspname as schema_name,
           cls.relname as table_name,
           m.conname,
           string_agg(quote_ident(a.attname), ', ' order by u.ord) as column_list
    from missing m
    join pg_class cls on cls.oid = m.conrelid
    join pg_namespace n on n.oid = cls.relnamespace
    cross join unnest(m.conkey) with ordinality as u(attnum, ord)
    join pg_attribute a on a.attrelid = m.conrelid and a.attnum = u.attnum
    group by n.nspname, cls.relname, m.conname
    order by cls.relname, m.conname
  loop
    execute format(
      'create index if not exists %I on %I.%I (%s)',
      left(r.conname || '_idx', 63),
      r.schema_name,
      r.table_name,
      r.column_list
    );
  end loop;
end;
$$;

do $$
begin
  if to_regclass('public.branches') is not null
    and to_regprocedure('private.m9b4c_is_active_cashier_for_branch(uuid)') is not null then
    execute $policy$
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
    $policy$;
  end if;

  if to_regclass('public.inventory_balances') is not null
    and to_regprocedure('public.has_active_employee_temporary_access(text)') is not null
    and to_regprocedure('private.m9b4c_cashier_can_read_inventory_location(uuid)') is not null then
    execute $policy$
      drop policy if exists "Active authorized users can read inventory balances" on public.inventory_balances;
      drop policy if exists inventory_balances_m2b_owner_admin_select on public.inventory_balances;
      drop policy if exists inventory_balances_m9b4c_cashier_select on public.inventory_balances;
      drop policy if exists inventory_balances_effective_select on public.inventory_balances;
      create policy inventory_balances_effective_select
      on public.inventory_balances
      for select
      to authenticated
      using (
        public.is_active_admin_user(array['owner'::text, 'admin'::text])
        or public.has_active_employee_temporary_access('inventory'::text)
        or private.m2b_is_owner_admin()
        or private.m9b4c_cashier_can_read_inventory_location(location_id)
      );
    $policy$;
  end if;

  if to_regclass('public.inventory_locations') is not null
    and to_regprocedure('public.has_active_employee_temporary_access(text)') is not null
    and to_regprocedure('private.m9b4c_cashier_can_read_inventory_location(uuid)') is not null then
    execute $policy$
      drop policy if exists "Active authorized users can read inventory locations" on public.inventory_locations;
      drop policy if exists inventory_locations_m2b_owner_admin_select on public.inventory_locations;
      drop policy if exists inventory_locations_m9b4c_cashier_select on public.inventory_locations;
      drop policy if exists inventory_locations_effective_select on public.inventory_locations;
      create policy inventory_locations_effective_select
      on public.inventory_locations
      for select
      to authenticated
      using (
        public.is_active_admin_user(array['owner'::text, 'admin'::text])
        or public.has_active_employee_temporary_access('inventory'::text)
        or private.m2b_is_owner_admin()
        or private.m9b4c_cashier_can_read_inventory_location(id)
      );
    $policy$;
  end if;

  if to_regclass('public.stock_movements') is not null
    and to_regprocedure('public.has_active_employee_temporary_access(text)') is not null then
    execute $policy$
      drop policy if exists "Active authorized users can read stock movements" on public.stock_movements;
      drop policy if exists stock_movements_m2b_owner_admin_select on public.stock_movements;
      drop policy if exists stock_movements_effective_select on public.stock_movements;
      create policy stock_movements_effective_select
      on public.stock_movements
      for select
      to authenticated
      using (
        public.is_active_admin_user(array['owner'::text, 'admin'::text])
        or public.has_active_employee_temporary_access('inventory'::text)
        or private.m2b_is_owner_admin()
      );
    $policy$;
  end if;

  if to_regclass('public.purchase_orders') is not null
    and to_regprocedure('public.has_active_employee_temporary_access(text)') is not null then
    execute $policy$
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
    $policy$;
  end if;

  if to_regclass('public.purchase_order_lines') is not null
    and to_regprocedure('public.has_active_employee_temporary_access(text)') is not null then
    execute $policy$
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
    $policy$;
  end if;

  if to_regclass('public.purchase_order_receipts') is not null
    and to_regprocedure('public.has_active_employee_temporary_access(text)') is not null then
    execute $policy$
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
    $policy$;
  end if;

  if to_regclass('public.purchase_order_receipt_lines') is not null
    and to_regprocedure('public.has_active_employee_temporary_access(text)') is not null then
    execute $policy$
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
    $policy$;
  end if;
end;
$$;

do $$
begin
  if to_regprocedure('public.task_domain_enabled()') is not null then
    revoke execute on function public.task_domain_enabled()
      from public, anon, authenticated;
  end if;
end;
$$;
