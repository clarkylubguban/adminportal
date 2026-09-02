-- E5I.3 — POS Sales shared effective-access foundation.
-- This exposes a minimum server-derived result for the shared Admin/POS database.

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
