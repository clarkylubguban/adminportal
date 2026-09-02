-- E5D: temporary Orders access is read-only.
-- Owner/Admin retain permanent Orders access. Staff need an active `orders`
-- temporary grant for Orders reads, and that grant never satisfies writes.

create or replace function public.has_active_employee_temporary_access(p_module_code text)
returns boolean
language sql
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
      and grants.revoked_at is null
      and grants.starts_at <= now()
      and grants.expires_at > now()
  );
$$;

revoke all on function public.has_active_employee_temporary_access(text) from public;
grant execute on function public.has_active_employee_temporary_access(text) to authenticated;

drop policy if exists "Active admins can read orders" on public.orders;
drop policy if exists "Active authorized users can read orders" on public.orders;
create policy "Active authorized users can read orders"
on public.orders
for select
to authenticated
using (
  public.is_active_admin_user(array['owner','admin'])
  or public.has_active_employee_temporary_access('orders')
);

drop policy if exists "Active staff can insert orders" on public.orders;
drop policy if exists "Active owners and admins can insert orders" on public.orders;
create policy "Active owners and admins can insert orders"
on public.orders
for insert
to authenticated
with check (public.is_active_admin_user(array['owner','admin']));

drop policy if exists "Active staff can update orders" on public.orders;
drop policy if exists "Active owners and admins can update orders" on public.orders;
create policy "Active owners and admins can update orders"
on public.orders
for update
to authenticated
using (public.is_active_admin_user(array['owner','admin']))
with check (public.is_active_admin_user(array['owner','admin']));

drop policy if exists "Admin users can read reorder requests" on public.reorder_requests;
drop policy if exists "Active admins can read reorder requests" on public.reorder_requests;
drop policy if exists "Active authorized users can read reorder requests" on public.reorder_requests;
create policy "Active authorized users can read reorder requests"
on public.reorder_requests
for select
to authenticated
using (
  public.is_active_admin_user(array['owner','admin'])
  or public.has_active_employee_temporary_access('orders')
);

drop policy if exists "Admin users can read request items" on public.request_items;
drop policy if exists "Active admins can read request items" on public.request_items;
drop policy if exists "Active authorized users can read request items" on public.request_items;
create policy "Active authorized users can read request items"
on public.request_items
for select
to authenticated
using (
  public.is_active_admin_user(array['owner','admin'])
  or public.has_active_employee_temporary_access('orders')
);

drop policy if exists "Admin users can read clients" on public.clients;
drop policy if exists "Active admins can read clients" on public.clients;
drop policy if exists "Active authorized users can read clients for orders" on public.clients;
create policy "Active authorized users can read clients for orders"
on public.clients
for select
to authenticated
using (
  public.is_active_admin_user(array['owner','admin'])
  or public.has_active_employee_temporary_access('orders')
);
