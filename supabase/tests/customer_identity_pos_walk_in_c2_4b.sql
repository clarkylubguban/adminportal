-- Disposable local database only. Validates Customer C2.4B POS identity bridge.
begin;

do $$
declare
  v_owner_user_id uuid := '00000000-0000-0000-0000-00000000c401'::uuid;
  v_pos_staff_user_id uuid := '00000000-0000-0000-0000-00000000c402'::uuid;
  v_non_pos_staff_user_id uuid := '00000000-0000-0000-0000-00000000c403'::uuid;
  v_inactive_user_id uuid := '00000000-0000-0000-0000-00000000c404'::uuid;
  v_customer_id uuid;
  v_existing_customer_id uuid;
  v_function_oid oid;
  v_function_source text;
begin
  insert into auth.users (id, email)
  values
    (v_owner_user_id, 'owner-c24b@example.test'),
    (v_pos_staff_user_id, 'pos-staff-c24b@example.test'),
    (v_non_pos_staff_user_id, 'non-pos-staff-c24b@example.test'),
    (v_inactive_user_id, 'inactive-c24b@example.test')
  on conflict (id) do nothing;

  insert into public.admin_users (user_id, email, role, display_name, is_active)
  values
    (v_owner_user_id, 'owner-c24b@example.test', 'owner', 'C2.4B Owner', true),
    (v_pos_staff_user_id, 'pos-staff-c24b@example.test', 'staff', 'C2.4B POS Staff', true),
    (v_non_pos_staff_user_id, 'non-pos-staff-c24b@example.test', 'staff', 'C2.4B Non POS Staff', true),
    (v_inactive_user_id, 'inactive-c24b@example.test', 'staff', 'C2.4B Inactive Staff', false)
  on conflict (user_id) do update
  set email = excluded.email,
      role = excluded.role,
      display_name = excluded.display_name,
      is_active = excluded.is_active;

  insert into public.employee_temporary_access_grants (
    employee_id,
    module_code,
    granted_by,
    starts_at,
    expires_at,
    reason
  )
  select
    pos_staff.id,
    'pos_sales',
    owner_user.id,
    now() - interval '1 minute',
    now() + interval '1 hour',
    'C2.4B local contract validation'
  from public.admin_users pos_staff
  join public.admin_users owner_user on owner_user.user_id = v_owner_user_id
  where pos_staff.user_id = v_pos_staff_user_id;

  select 'public.resolve_pos_walk_in_customer_identity_c2_4b(text,text)'::regprocedure::oid
  into v_function_oid;

  if has_function_privilege('anon', v_function_oid, 'EXECUTE') then
    raise exception 'anon unexpectedly has C2.4B RPC execute privilege';
  end if;

  if has_function_privilege('service_role', v_function_oid, 'EXECUTE') then
    raise exception 'service_role unexpectedly has C2.4B RPC execute privilege';
  end if;

  if not has_function_privilege('authenticated', v_function_oid, 'EXECUTE') then
    raise exception 'authenticated C2.4B RPC execute privilege missing';
  end if;

  if exists (select 1 from pg_proc where oid = v_function_oid and prosecdef = true) then
    raise exception 'C2.4B RPC must remain SECURITY INVOKER';
  end if;

  select pg_get_functiondef(v_function_oid) into v_function_source;
  if v_function_source not like '%POS_WALK_IN%' then
    raise exception 'C2.4B RPC does not fix the source to POS_WALK_IN';
  end if;

  perform set_config('request.jwt.claim.sub', v_pos_staff_user_id::text, true);
  set local role authenticated;

  select result.customer_id
  into v_customer_id
  from public.resolve_pos_walk_in_customer_identity_c2_4b(
    'C2.4B POS Customer',
    '0917 444 5555'
  ) as result;

  if v_customer_id is null then
    raise exception 'authorized POS staff did not receive a customer id';
  end if;

  if (
    select first_source
    from public.customers
    where id = v_customer_id
  ) <> 'POS_WALK_IN' then
    raise exception 'C2.4B customer source was not fixed to POS_WALK_IN';
  end if;

  if (
    select created_by_user_id
    from public.customers
    where id = v_customer_id
  ) is distinct from v_pos_staff_user_id then
    raise exception 'C2.4B customer audit actor did not preserve auth.uid()';
  end if;

  select result.customer_id
  into v_existing_customer_id
  from public.resolve_pos_walk_in_customer_identity_c2_4b(
    'Different Name Does Not Rematch',
    '+63 917 444 5555'
  ) as result;

  if v_existing_customer_id is distinct from v_customer_id then
    raise exception 'alternate mobile format did not reuse the POS customer';
  end if;

  if (
    select count(*)
    from public.customers
    where mobile_normalized = '+639174445555'
  ) <> 1 then
    raise exception 'C2.4B created duplicate normalized mobile customers';
  end if;

  begin
    perform public.resolve_pos_walk_in_customer_identity_c2_4b('Bad POS Mobile', '12345');
    raise exception 'C2.4B accepted an invalid mobile';
  exception when check_violation then null;
  end;

  begin
    perform public.resolve_pos_walk_in_customer_identity_c2_4b('Blank POS Mobile', '');
    raise exception 'C2.4B accepted a blank mobile';
  exception when check_violation then null;
  end;

  reset role;

  perform set_config('request.jwt.claim.sub', v_non_pos_staff_user_id::text, true);
  set local role authenticated;
  begin
    perform public.resolve_pos_walk_in_customer_identity_c2_4b('Non POS Staff', '0917 444 5556');
    raise exception 'non-POS staff was allowed to resolve a POS walk-in customer';
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform set_config('request.jwt.claim.sub', v_inactive_user_id::text, true);
  set local role authenticated;
  begin
    perform public.resolve_pos_walk_in_customer_identity_c2_4b('Inactive POS Staff', '0917 444 5557');
    raise exception 'inactive user was allowed to resolve a POS walk-in customer';
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  begin
    perform public.resolve_pos_walk_in_customer_identity_c2_4b('Anon POS', '0917 444 5558');
    raise exception 'anon C2.4B RPC call was accepted';
  exception when insufficient_privilege then null;
  end;
  reset role;

  set local role service_role;
  begin
    perform public.resolve_pos_walk_in_customer_identity_c2_4b('Service POS', '0917 444 5559');
    raise exception 'service_role C2.4B RPC call was accepted';
  exception when insufficient_privilege then null;
  end;
  reset role;

  raise notice 'Customer C2.4B POS walk-in identity contract validation passed';
end;
$$;

rollback;
