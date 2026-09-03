-- Disposable local database only. Validates Customer Ecosystem C2.1 linking contract.
begin;

do $$
declare
  v_owner_user_id uuid := '00000000-0000-0000-0000-00000000a201'::uuid;
  v_admin_user_id uuid := '00000000-0000-0000-0000-00000000a202'::uuid;
  v_staff_user_id uuid := '00000000-0000-0000-0000-00000000a203'::uuid;
  v_viewer_user_id uuid := '00000000-0000-0000-0000-00000000a204'::uuid;
  v_inactive_user_id uuid := '00000000-0000-0000-0000-00000000a205'::uuid;
  v_customer_id uuid;
  v_existing_customer_id uuid;
  v_second_customer_id uuid;
  v_order_id uuid;
  v_function_oid oid;
  v_constraint_names text[];
begin
  insert into auth.users (id, email)
  values
    (v_owner_user_id, 'owner-c2@example.test'),
    (v_admin_user_id, 'admin-c2@example.test'),
    (v_staff_user_id, 'staff-c2@example.test'),
    (v_viewer_user_id, 'viewer-c2@example.test'),
    (v_inactive_user_id, 'inactive-c2@example.test')
  on conflict (id) do nothing;

  insert into public.admin_users (user_id, email, role, display_name, is_active)
  values
    (v_owner_user_id, 'owner-c2@example.test', 'owner', 'C2 Owner', true),
    (v_admin_user_id, 'admin-c2@example.test', 'admin', 'C2 Admin', true),
    (v_staff_user_id, 'staff-c2@example.test', 'staff', 'C2 Staff', true),
    (v_viewer_user_id, 'viewer-c2@example.test', 'viewer', 'C2 Viewer', true),
    (v_inactive_user_id, 'inactive-c2@example.test', 'staff', 'Inactive C2 Staff', false)
  on conflict (user_id) do update
  set email = excluded.email,
      role = excluded.role,
      display_name = excluded.display_name,
      is_active = excluded.is_active;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ops_inquiries'
      and column_name = 'customer_id'
      and is_nullable = 'YES'
      and data_type = 'uuid'
  ) then
    raise exception 'ops_inquiries.customer_id nullable uuid column missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'customer_id'
      and is_nullable = 'YES'
      and data_type = 'uuid'
  ) then
    raise exception 'orders.customer_id nullable uuid column missing';
  end if;

  select array_agg(conname::text order by conname)
  into v_constraint_names
  from pg_constraint
  where conrelid in ('public.ops_inquiries'::regclass, 'public.orders'::regclass)
    and conname in ('ops_inquiries_customer_id_fkey', 'orders_customer_id_fkey');

  if v_constraint_names <> array['ops_inquiries_customer_id_fkey', 'orders_customer_id_fkey'] then
    raise exception 'C2 customer FK constraints missing: %', v_constraint_names;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_customer_id_fkey'
      and pg_get_constraintdef(oid) ilike '%ON DELETE RESTRICT%'
  ) then
    raise exception 'orders customer_id FK must preserve immutable order links with ON DELETE RESTRICT';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'ops_inquiries_customer_id_idx'
  ) then
    raise exception 'ops_inquiries customer_id index missing';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'orders_customer_id_idx'
  ) then
    raise exception 'orders customer_id index missing';
  end if;

  select 'public.find_or_create_customer_identity_c2_1(text,text,text)'::regprocedure::oid
  into v_function_oid;

  if has_function_privilege('anon', v_function_oid, 'EXECUTE') then
    raise exception 'anon unexpectedly has C2.1 RPC execute privilege';
  end if;

  if not has_function_privilege('authenticated', v_function_oid, 'EXECUTE') then
    raise exception 'authenticated C2.1 RPC execute privilege missing';
  end if;

  if exists (
    select 1
    from pg_proc
    where oid = v_function_oid
      and prosecdef = true
  ) then
    raise exception 'C2.1 RPC should remain SECURITY INVOKER';
  end if;

  insert into public.ops_inquiries (id, customer_name, contact, product, quantity)
  values ('C2-HIST-INQ', 'Historical Customer', '09170000001', 'Legacy product', '1')
  on conflict (id) do nothing;

  insert into public.orders (
    order_reference,
    source_inquiry_id,
    customer_name,
    customer_contact,
    product,
    quantity
  )
  values (
    'TRRY-ORD-HIST0001',
    'C2-HIST-INQ',
    'Historical Customer',
    '09170000001',
    'Legacy product',
    '1'
  )
  on conflict (source_inquiry_id) do nothing;

  if (select customer_id from public.ops_inquiries where id = 'C2-HIST-INQ') is not null then
    raise exception 'historical inquiry should remain nullable';
  end if;

  if (select customer_id from public.orders where source_inquiry_id = 'C2-HIST-INQ') is not null then
    raise exception 'historical order should remain nullable';
  end if;

  perform set_config('request.jwt.claim.sub', v_staff_user_id::text, true);
  set local role authenticated;

  select result.customer_id
  into v_customer_id
  from public.find_or_create_customer_identity_c2_1(
    'C2 Staff Customer',
    '0917 222 3333',
    'ADMIN_MANUAL'
  ) as result;

  if v_customer_id is null then
    raise exception 'staff RPC did not return customer id';
  end if;

  select result.customer_id
  into v_existing_customer_id
  from public.find_or_create_customer_identity_c2_1(
    'Alternate Mobile Format',
    '+63 917 222 3333',
    'TRRY_WEB'
  ) as result;

  if v_existing_customer_id is distinct from v_customer_id then
    raise exception 'alternate PH mobile format did not return existing customer';
  end if;

  if (
    select count(*)
    from public.customers
    where mobile_normalized = '+639172223333'
  ) <> 1 then
    raise exception 'duplicate customer created for alternate mobile formatting';
  end if;

  begin
    perform public.find_or_create_customer_identity_c2_1('Bad Mobile', '12345', 'ADMIN_MANUAL');
    raise exception 'invalid mobile was accepted';
  exception when check_violation then null;
  end;

  begin
    perform public.find_or_create_customer_identity_c2_1('Blank Mobile', '   ', 'ADMIN_MANUAL');
    raise exception 'blank mobile was accepted';
  exception when check_violation then null;
  end;

  begin
    perform public.find_or_create_customer_identity_c2_1('   ', '0918 222 3333', 'ADMIN_MANUAL');
    raise exception 'blank name was accepted';
  exception when check_violation then null;
  end;

  begin
    perform public.find_or_create_customer_identity_c2_1('Bad Source', '09192223333', 'MESSENGER');
    raise exception 'non-allowed source was accepted';
  exception when check_violation then null;
  end;

  insert into public.ops_inquiries (id, customer_name, contact, product, quantity, customer_id)
  values ('C2-LINK-STAFF', 'C2 Staff Customer', '0917 222 3333', 'Capture product', '2', v_customer_id);

  insert into public.ops_inquiries (id, customer_name, contact, product, quantity)
  values ('C2-LINK-LATE', 'C2 Staff Customer', '0917 222 3333', 'Late link product', '3');

  update public.ops_inquiries
  set customer_id = v_customer_id
  where id = 'C2-LINK-LATE';

  update public.customers
  set full_name = 'Blocked Staff Profile Update'
  where id = v_customer_id;

  reset role;

  if (
    select full_name = 'Blocked Staff Profile Update'
    from public.customers
    where id = v_customer_id
  ) then
    raise exception 'staff customer profile update was accepted';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_user_id::text, true);
  set local role authenticated;

  select result.customer_id
  into v_second_customer_id
  from public.find_or_create_customer_identity_c2_1(
    'C2 Owner Correction Customer',
    '0918 222 3333',
    'ADMIN_MANUAL'
  ) as result;

  update public.ops_inquiries
  set customer_id = v_second_customer_id
  where id = 'C2-LINK-LATE';

  if (
    select customer_id
    from public.ops_inquiries
    where id = 'C2-LINK-LATE'
  ) is distinct from v_second_customer_id then
    raise exception 'Owner/Admin inquiry link correction failed';
  end if;

  insert into public.ops_inquiries (
    id,
    customer_id,
    customer_name,
    contact,
    product,
    product_desc,
    quantity,
    quote_status,
    quoted_amount,
    amount_due,
    quote_approved_at,
    artwork_status,
    due_date
  )
  values (
    'C2-CONVERT',
    v_customer_id,
    'Immutable Name',
    '0917 222 3333',
    'C2 Product',
    'C2 Product Description',
    '5',
    'approved',
    500,
    500,
    now(),
    'approved',
    current_date + 7
  );

  reset role;

  insert into public.orders (
    order_reference,
    source_inquiry_id,
    customer_id,
    customer_name,
    customer_contact,
    product,
    product_desc,
    quantity,
    quoted_amount,
    amount_due
  )
  values (
    'TRRY-ORD-C2LINK01',
    'C2-CONVERT',
    (select customer_id from public.ops_inquiries where id = 'C2-CONVERT'),
    (select customer_name from public.ops_inquiries where id = 'C2-CONVERT'),
    (select contact from public.ops_inquiries where id = 'C2-CONVERT'),
    'C2 Product',
    'C2 Product Description',
    '5',
    500,
    500
  )
  returning id into v_order_id;

  if (
    select orders.customer_id
    from public.orders
    where id = v_order_id
  ) is distinct from v_customer_id then
    raise exception 'inquiry customer_id was not copied to order';
  end if;

  begin
    update public.orders
    set customer_id = v_second_customer_id
    where id = v_order_id;
    raise exception 'order customer_id mutation was accepted';
  exception when check_violation then null;
  end;

  begin
    update public.orders
    set customer_name = 'Changed Snapshot'
    where id = v_order_id;
    raise exception 'order customer_name snapshot mutation was accepted';
  exception when check_violation then null;
  end;

  begin
    update public.orders
    set customer_contact = '0999 999 9999'
    where id = v_order_id;
    raise exception 'order customer_contact snapshot mutation was accepted';
  exception when check_violation then null;
  end;

  perform set_config('request.jwt.claim.sub', v_owner_user_id::text, true);
  set local role authenticated;

  begin
    update public.ops_inquiries
    set customer_id = v_second_customer_id
    where id = 'C2-CONVERT';
    raise exception 'post-conversion inquiry customer link correction was accepted';
  exception when check_violation then null;
  end;

  reset role;

  perform set_config('request.jwt.claim.sub', v_staff_user_id::text, true);
  set local role authenticated;

  begin
    update public.ops_inquiries
    set customer_id = v_customer_id
    where id = 'C2-LINK-LATE';
    raise exception 'staff customer link correction was accepted';
  exception when insufficient_privilege then null;
  end;

  reset role;

  perform set_config('request.jwt.claim.sub', v_viewer_user_id::text, true);
  set local role authenticated;

  begin
    perform public.find_or_create_customer_identity_c2_1('Viewer Blocked', '0920 222 3333', 'ADMIN_MANUAL');
    raise exception 'viewer RPC call was accepted';
  exception when insufficient_privilege then null;
  end;

  reset role;

  perform set_config('request.jwt.claim.sub', v_inactive_user_id::text, true);
  set local role authenticated;

  begin
    perform public.find_or_create_customer_identity_c2_1('Inactive Blocked', '0921 222 3333', 'ADMIN_MANUAL');
    raise exception 'inactive user RPC call was accepted';
  exception when insufficient_privilege then null;
  end;

  reset role;

  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;

  begin
    perform public.find_or_create_customer_identity_c2_1('Anon Blocked', '0922 222 3333', 'ADMIN_MANUAL');
    raise exception 'anon RPC call was accepted';
  exception when insufficient_privilege then null;
  end;

  reset role;

  if has_table_privilege('authenticated', 'public.customers', 'DELETE') then
    raise exception 'authenticated unexpectedly has customer delete privilege';
  end if;

  raise notice 'Customer Identity C2.1 contract validation passed';
end;
$$;

rollback;
