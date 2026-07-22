-- Harden Admin Portal authorization without deleting existing users or data.
-- Supabase Auth remains the identity source; public.admin_users is the portal authorization profile.

alter table public.admin_users
  add column if not exists display_name text,
  add column if not exists is_active boolean not null default true;

alter table public.admin_users
  drop constraint if exists admin_users_role_check;

alter table public.admin_users
  add constraint admin_users_role_check
  check (role in ('owner', 'admin', 'staff', 'viewer'));

create or replace function public.is_active_admin_user(required_roles text[] default array['owner','admin','staff'])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
      and is_active = true
      and role = any(required_roles)
  );
$$;

revoke all on function public.is_active_admin_user(text[]) from public;
grant execute on function public.is_active_admin_user(text[]) to authenticated;

drop policy if exists "Admin users can read own row" on public.admin_users;
create policy "Admin users can read own active row"
on public.admin_users
for select
to authenticated
using ((select auth.uid()) = user_id and is_active = true and role in ('owner', 'admin', 'staff'));

drop policy if exists "Admin users can read ops inquiries" on public.ops_inquiries;
create policy "Active admins can read ops inquiries"
on public.ops_inquiries
for select
to authenticated
using (public.is_active_admin_user());

drop policy if exists "Admin and staff can insert ops inquiries" on public.ops_inquiries;
create policy "Active admins can insert ops inquiries"
on public.ops_inquiries
for insert
to authenticated
with check (public.is_active_admin_user());

drop policy if exists "Admin and staff can update ops inquiries" on public.ops_inquiries;
create policy "Active admins can update ops inquiries"
on public.ops_inquiries
for update
to authenticated
using (public.is_active_admin_user())
with check (public.is_active_admin_user());

drop policy if exists "Admin users can read clients" on public.clients;
create policy "Active admins can read clients"
on public.clients
for select
to authenticated
using (public.is_active_admin_user());

drop policy if exists "Admin users can read reorder requests" on public.reorder_requests;
create policy "Active admins can read reorder requests"
on public.reorder_requests
for select
to authenticated
using (public.is_active_admin_user());

drop policy if exists "Admin users can read request items" on public.request_items;
create policy "Active admins can read request items"
on public.request_items
for select
to authenticated
using (public.is_active_admin_user());

drop policy if exists "Admin users can read catalog products" on public.catalog_products;
create policy "Active admins can read catalog products"
on public.catalog_products
for select
to authenticated
using (public.is_active_admin_user());

drop policy if exists "Admin and staff can insert catalog products" on public.catalog_products;
create policy "Active admins can insert catalog products"
on public.catalog_products
for insert
to authenticated
with check (public.is_active_admin_user());

drop policy if exists "Admin and staff can update catalog products" on public.catalog_products;
create policy "Active admins can update catalog products"
on public.catalog_products
for update
to authenticated
using (public.is_active_admin_user())
with check (public.is_active_admin_user());
