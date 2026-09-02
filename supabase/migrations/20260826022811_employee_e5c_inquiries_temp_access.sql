create or replace function public.has_active_employee_temporary_access(p_module_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users actor
    join public.employee_temporary_access_grants grant_row
      on grant_row.employee_id = actor.id
    where actor.user_id = (select auth.uid())
      and actor.is_active = true
      and actor.role = 'staff'
      and grant_row.module_code = lower(btrim(coalesce(p_module_code, '')))
      and grant_row.starts_at <= now()
      and grant_row.expires_at > now()
      and grant_row.revoked_at is null
  );
$$;

revoke all on function public.has_active_employee_temporary_access(text) from public;
revoke all on function public.has_active_employee_temporary_access(text) from anon;
grant execute on function public.has_active_employee_temporary_access(text) to authenticated;

drop policy if exists "Active admins can read ops inquiries" on public.ops_inquiries;
create policy "Owners admins and temporary inquiries staff can read ops inquiries"
on public.ops_inquiries
for select
to authenticated
using (
  public.is_active_admin_user(array['owner','admin'])
  or public.has_active_employee_temporary_access('inquiries')
);

drop policy if exists "Active admins can insert ops inquiries" on public.ops_inquiries;
create policy "Owners admins and temporary inquiries staff can insert ops inquiries"
on public.ops_inquiries
for insert
to authenticated
with check (
  public.is_active_admin_user(array['owner','admin'])
  or public.has_active_employee_temporary_access('inquiries')
);

drop policy if exists "Active admins can update ops inquiries" on public.ops_inquiries;
create policy "Owners admins and temporary inquiries staff can update ops inquiries"
on public.ops_inquiries
for update
to authenticated
using (
  public.is_active_admin_user(array['owner','admin'])
  or public.has_active_employee_temporary_access('inquiries')
)
with check (
  public.is_active_admin_user(array['owner','admin'])
  or public.has_active_employee_temporary_access('inquiries')
);
