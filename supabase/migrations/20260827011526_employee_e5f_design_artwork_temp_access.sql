-- E5F: temporary Design & Artwork read access for the existing Inquiry artwork surface.
-- Owner/Admin retain permanent access. Staff with design_artwork temporary access
-- may read only assigned artwork-bearing inquiry rows. Writes remain API-mediated.

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
grant execute on function public.has_active_employee_temporary_access(text) to authenticated;

drop policy if exists "Owners admins temp inquiries production design can read ops inquiries" on public.ops_inquiries;
drop policy if exists "Owners admins temp inquiries and assigned production can read ops inquiries" on public.ops_inquiries;
drop policy if exists "Owners admins temp inquiries and assigned production can read o" on public.ops_inquiries;

create policy "Owners admins temp inquiries production design can read ops inquiries"
on public.ops_inquiries
for select
to authenticated
using (
  exists (
    select 1
    from public.admin_users users
    where users.user_id = (select auth.uid())
      and users.is_active = true
      and users.role in ('owner', 'admin')
  )
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
  or (
    public.has_active_employee_temporary_access('design_artwork')
    and assigned_user_id = (select auth.uid())
    and (
      nullif(btrim(coalesce(artwork_url, '')), '') is not null
      or lower(coalesce(artwork_status, '')) in (
        'missing',
        'submitted',
        'under_review',
        'approval_required',
        'approved',
        'revision_requested'
      )
    )
  )
);
