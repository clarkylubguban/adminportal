-- E5E: temporary Production access opens the Production module at Staff scope.
-- Staff reads stay assignment-scoped, and the grant never satisfies Orders,
-- payment, reassignment, fulfillment, inventory, or manager-only writes.

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

drop policy if exists "Owners admins temp inquiries and assigned production can read ops inquiries" on public.ops_inquiries;
drop policy if exists "Owners admins and temporary inquiries staff can read ops inquiries" on public.ops_inquiries;
create policy "Owners admins temp inquiries and assigned production can read ops inquiries"
on public.ops_inquiries
for select
to authenticated
using (
  public.is_active_admin_user(array['owner','admin'])
  or public.has_active_employee_temporary_access('inquiries')
  or (
    public.has_active_employee_temporary_access('production')
    and assigned_user_id = (select auth.uid())
    and status = 'won'
    and (
      production_updated_at is not null
      or lower(coalesce(production_stage, '')) in (
        'queued',
        'printing',
        'embroidery',
        'screen_printing',
        'in_production',
        'qc',
        'qc_finishing',
        'ready',
        'ready_for_fulfillment',
        'completed'
      )
    )
  )
);

drop policy if exists "Active authorized users can read orders" on public.orders;
create policy "Active authorized users can read orders"
on public.orders
for select
to authenticated
using (
  public.is_active_admin_user(array['owner','admin'])
  or public.has_active_employee_temporary_access('orders')
  or (
    public.has_active_employee_temporary_access('production')
    and exists (
      select 1
      from public.ops_inquiries inquiry
      where inquiry.id = orders.source_inquiry_id
        and inquiry.assigned_user_id = (select auth.uid())
        and inquiry.status = 'won'
        and (
          inquiry.production_updated_at is not null
          or lower(coalesce(inquiry.production_stage, '')) in (
            'queued',
            'printing',
            'embroidery',
            'screen_printing',
            'in_production',
            'qc',
            'qc_finishing',
            'ready',
            'ready_for_fulfillment',
            'completed'
          )
        )
    )
  )
);
