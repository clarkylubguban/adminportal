-- Disposable local database only. Validates Customer Ecosystem C1 identity contract.
begin;

do $$
declare
  v_customer_id uuid;
  v_reference text;
  v_normalized text;
  v_first_seen_at timestamptz;
  v_owner_user_id uuid := '00000000-0000-0000-0000-0000000000a1'::uuid;
  v_staff_user_id uuid := '00000000-0000-0000-0000-0000000000b2'::uuid;
  v_inactive_user_id uuid := '00000000-0000-0000-0000-0000000000c3'::uuid;
  v_other_user_id uuid := '00000000-0000-0000-0000-0000000000d4'::uuid;
  v_spoof_customer_id uuid;
  v_columns text[];
  v_forbidden_columns text[];
  v_policy_names text[];
begin
  insert into auth.users (id, email)
  values
    (v_owner_user_id, 'owner-c1@example.test'),
    (v_staff_user_id, 'staff-c1@example.test'),
    (v_inactive_user_id, 'inactive-c1@example.test'),
    (v_other_user_id, 'other-c1@example.test')
  on conflict (id) do nothing;

  insert into public.admin_users (user_id, email, role, display_name, is_active)
  values
    (v_owner_user_id, 'owner-c1@example.test', 'owner', 'C1 Owner', true),
    (v_staff_user_id, 'staff-c1@example.test', 'staff', 'C1 Staff', true),
    (v_inactive_user_id, 'inactive-c1@example.test', 'staff', 'Inactive Staff', false),
    (v_other_user_id, 'other-c1@example.test', 'staff', 'Other Staff', true)
  on conflict (user_id) do update
  set email = excluded.email,
      role = excluded.role,
      display_name = excluded.display_name,
      is_active = excluded.is_active;

  select array_agg(column_name::text order by ordinal_position)
  into v_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'customers';

  if v_columns <> array[
    'id',
    'customer_reference',
    'full_name',
    'mobile_raw',
    'mobile_normalized',
    'first_source',
    'first_seen_at',
    'active',
    'created_at',
    'updated_at',
    'created_by_user_id',
    'updated_by_user_id',
    'archived_at'
  ] then
    raise exception 'customers C1 column shape mismatch: %', v_columns;
  end if;

  select array_agg(column_name::text order by column_name)
  into v_forbidden_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'customers'
    and column_name in (
      'lifetime_spend',
      'order_count',
      'journey_step',
      'journey_progress',
      'discount_percent',
      'benefit_id',
      'loyalty_points',
      'points'
    );

  if v_forbidden_columns is not null then
    raise exception 'C1 scope drift columns present: %', v_forbidden_columns;
  end if;

  if public.normalize_ph_mobile('0917 123 4567') <> '+639171234567' then
    raise exception 'local PH mobile normalization failed';
  end if;

  if public.normalize_ph_mobile('+63 917 123 4567') <> '+639171234567' then
    raise exception 'E.164 PH mobile normalization failed';
  end if;

  if public.normalize_ph_mobile('639171234567') <> '+639171234567' then
    raise exception '63-prefix PH mobile normalization failed';
  end if;

  if public.normalize_ph_mobile('9171234567') <> '+639171234567' then
    raise exception 'bare PH mobile normalization failed';
  end if;

  if public.normalize_ph_mobile('063 221 1234') is not null then
    raise exception 'invalid non-mobile number normalized unexpectedly';
  end if;

  insert into public.customers (full_name, mobile_raw, first_source)
  values ('Juan Dela Cruz', '0917 123 4567', 'POS_WALK_IN')
  returning id, customer_reference, mobile_normalized, first_seen_at
  into v_customer_id, v_reference, v_normalized, v_first_seen_at;

  if v_reference !~ '^CUS-[0-9]{6,}$' then
    raise exception 'customer reference format mismatch: %', v_reference;
  end if;

  if v_normalized <> '+639171234567' then
    raise exception 'stored normalized mobile mismatch: %', v_normalized;
  end if;

  begin
    insert into public.customers (full_name, mobile_raw, first_source)
    values ('Juan Duplicate', '+63 917 123 4567', 'STLO_WEB');
    raise exception 'same mobile in another format was accepted as a duplicate customer';
  exception when unique_violation then null;
  end;

  begin
    insert into public.customers (full_name, mobile_raw, first_source)
    values ('Invalid Mobile', '12345', 'POS_WALK_IN');
    raise exception 'invalid mobile was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.customers (full_name, mobile_raw, first_source)
    values ('   ', '09181234567', 'POS_WALK_IN');
    raise exception 'blank customer name was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.customers (full_name, mobile_raw, first_source)
    values ('Bad Source', '09181234567', 'MESSENGER');
    raise exception 'non-canonical first_source was accepted';
  exception when check_violation then null;
  end;

  begin
    update public.customers
    set first_source = 'STLO_WEB'
    where id = v_customer_id;
    raise exception 'first_source mutation was accepted';
  exception when check_violation then null;
  end;

  begin
    update public.customers
    set first_seen_at = v_first_seen_at + interval '1 hour'
    where id = v_customer_id;
    raise exception 'first_seen_at mutation was accepted';
  exception when check_violation then null;
  end;

  update public.customers
  set full_name = 'Juan Dela Cruz Updated'
  where id = v_customer_id;

  if (select full_name from public.customers where id = v_customer_id) <> 'Juan Dela Cruz Updated' then
    raise exception 'ordinary customer profile update failed';
  end if;

  perform set_config('request.jwt.claim.sub', v_staff_user_id::text, true);
  set local role authenticated;

  insert into public.customers (
    full_name,
    mobile_raw,
    first_source,
    created_by_user_id,
    updated_by_user_id
  )
  values (
    'Spoof Attempt',
    '09191234567',
    'ADMIN_MANUAL',
    v_other_user_id,
    v_other_user_id
  )
  returning id into v_spoof_customer_id;

  reset role;

  if (
    select created_by_user_id <> v_staff_user_id
      or updated_by_user_id <> v_staff_user_id
    from public.customers
    where id = v_spoof_customer_id
  ) then
    raise exception 'authenticated caller spoofed customer audit users';
  end if;

  perform set_config('request.jwt.claim.sub', v_staff_user_id::text, true);
  set local role authenticated;

  update public.customers
  set full_name = 'Staff Unauthorized Update'
  where id = v_spoof_customer_id;

  reset role;

  if (
    select full_name = 'Staff Unauthorized Update'
    from public.customers
    where id = v_spoof_customer_id
  ) then
    raise exception 'staff customer profile update was accepted';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_user_id::text, true);
  set local role authenticated;

  update public.customers
  set full_name = 'Owner Authorized Update',
      updated_by_user_id = v_other_user_id
  where id = v_spoof_customer_id;

  reset role;

  if (
    select full_name <> 'Owner Authorized Update'
      or updated_by_user_id <> v_owner_user_id
    from public.customers
    where id = v_spoof_customer_id
  ) then
    raise exception 'owner update failed or update audit user was spoofed';
  end if;

  perform set_config('request.jwt.claim.sub', v_inactive_user_id::text, true);
  set local role authenticated;

  begin
    insert into public.customers (full_name, mobile_raw, first_source)
    values ('Inactive Capture', '09201234567', 'ADMIN_MANUAL');
    raise exception 'inactive user customer capture was accepted';
  exception when insufficient_privilege or check_violation then null;
  end;

  reset role;

  if not (select relrowsecurity from pg_class where oid = 'public.customers'::regclass) then
    raise exception 'customers RLS is not enabled';
  end if;

  if has_table_privilege('anon', 'public.customers', 'SELECT')
     or has_table_privilege('anon', 'public.customers', 'INSERT')
     or has_table_privilege('anon', 'public.customers', 'UPDATE') then
    raise exception 'anon unexpectedly has direct customers privileges';
  end if;

  if not has_table_privilege('authenticated', 'public.customers', 'SELECT')
     or not has_table_privilege('authenticated', 'public.customers', 'INSERT')
     or not has_table_privilege('authenticated', 'public.customers', 'UPDATE') then
    raise exception 'authenticated customer privileges missing';
  end if;

  if has_table_privilege('authenticated', 'public.customers', 'DELETE') then
    raise exception 'authenticated unexpectedly has customer delete privilege';
  end if;

  select array_agg(policyname::text order by policyname)
  into v_policy_names
  from pg_policies
  where schemaname = 'public'
    and tablename = 'customers';

  if v_policy_names <> array[
    'Active admins can read customers',
    'Active operators can capture customers',
    'Active owners and admins can update customers'
  ] then
    raise exception 'customers RLS policy contract mismatch: %', v_policy_names;
  end if;

  raise notice 'Customer Identity C1 contract validation passed';
end;
$$;

rollback;
