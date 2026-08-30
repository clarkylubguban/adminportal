-- Disposable local database only. Validates Customer Ecosystem C1 identity contract.
begin;

do $$
declare
  v_customer_id uuid;
  v_reference text;
  v_normalized text;
  v_first_seen_at timestamptz;
  v_columns text[];
  v_forbidden_columns text[];
  v_policy_names text[];
begin
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
