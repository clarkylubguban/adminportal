-- E5H — Temporary Purchasing & Suppliers read access.
-- Temporary Staff access is read-only and must not satisfy PO, supplier, receiving, or inventory writes.

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

revoke execute on function public.has_active_employee_temporary_access(text) from public;
revoke execute on function public.has_active_employee_temporary_access(text) from anon;
grant execute on function public.has_active_employee_temporary_access(text) to authenticated;

do $$
begin
  if to_regclass('public.suppliers') is not null then
    alter table public.suppliers enable row level security;

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
  end if;

  if to_regclass('public.purchase_orders') is not null then
    alter table public.purchase_orders enable row level security;

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
  end if;

  if to_regclass('public.purchase_order_lines') is not null then
    alter table public.purchase_order_lines enable row level security;

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
  end if;

  if to_regclass('public.purchase_order_receipts') is not null then
    alter table public.purchase_order_receipts enable row level security;

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
  end if;

  if to_regclass('public.purchase_order_receipt_lines') is not null then
    alter table public.purchase_order_receipt_lines enable row level security;

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
  end if;
end $$;
