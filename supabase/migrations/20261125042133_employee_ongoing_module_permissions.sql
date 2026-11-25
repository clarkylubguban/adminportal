-- An unbounded timestamp lets the existing per-module SQL policies and POS write
-- checks use the same audited grant records for both durations.
create or replace function public.set_employee_ongoing_permissions(
  p_actor uuid, p_employee uuid, p_modules text[], p_expected text[]
) returns text[]
language plpgsql security invoker set search_path = ''
as $$
declare
  v_current text[];
  v_allowed constant text[] := array['production','design_artwork','inventory','purchasing_suppliers','pos_sales','orders','inquiries','master_catalog','workboard','calendar'];
begin
  if not exists (select 1 from public.admin_users where id = p_actor and is_active and role in ('owner','admin') for share) then
    raise exception 'Access management is restricted' using errcode = '42501';
  end if;
  perform 1 from public.admin_users where id = p_employee and id <> p_actor and role = 'staff' and is_active for update;
  if not found then
    raise exception 'Select an active staff employee' using errcode = '42501';
  end if;
  if p_modules is null or p_expected is null or array_position(p_modules,null) is not null or not (p_modules <@ v_allowed) then
    raise exception 'Invalid module selection' using errcode = '22023';
  end if;
  select array(select module_code from public.employee_temporary_access_grants
    where employee_id = p_employee and expires_at = 'infinity' and revoked_at is null order by module_code) into v_current;
  if v_current <@ p_modules and p_modules <@ v_current then return v_current; end if;
  if not (v_current <@ p_expected and p_expected <@ v_current) then
    raise exception 'Permissions changed. Reload the selection and try again.' using errcode = '40001';
  end if;
  update public.employee_temporary_access_grants set revoked_at = now(), revoked_by = p_actor
    where employee_id = p_employee and expires_at = 'infinity' and revoked_at is null
      and not (module_code = any(p_modules));
  insert into public.employee_temporary_access_grants(employee_id,module_code,granted_by,starts_at,expires_at)
    select distinct p_employee, code, p_actor, now(), 'infinity'::timestamptz from unnest(p_modules) code
    where not (code = any(v_current));
  return array(select distinct code from unnest(p_modules) code order by code);
end;
$$;
revoke all on function public.set_employee_ongoing_permissions(uuid,uuid,text[],text[]) from public, anon, authenticated;
grant execute on function public.set_employee_ongoing_permissions(uuid,uuid,text[],text[]) to service_role;

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
  order by (expires_at = 'infinity'::timestamptz) desc, expires_at asc
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
    'source', case when isfinite(v_grant.expires_at) then 'temporary' else 'assigned' end,
    'expires_at', case when isfinite(v_grant.expires_at) then v_grant.expires_at end,
    'grant_id', v_grant.id
  );
end;
$$;

revoke execute on function public.get_pos_sales_effective_access() from public;
revoke execute on function public.get_pos_sales_effective_access() from anon;
grant execute on function public.get_pos_sales_effective_access() to authenticated;
