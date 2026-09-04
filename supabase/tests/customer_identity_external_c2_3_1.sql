-- Disposable local database only. Validates Customer C2.3.1 external inquiry contract.
begin;

do $$
declare
  v_owner_user_id uuid := '00000000-0000-0000-0000-00000000c231'::uuid;
  v_function_oid oid;
  v_first record;
  v_replay record;
  v_existing record;
  v_blank record;
  v_order_id uuid;
begin
  select 'public.create_external_inquiry_identity_c2_3_1(text,text,text,text,text,text,text,date)'::regprocedure::oid
  into v_function_oid;

  if to_regprocedure('public.create_external_inquiry_identity_c2_3_1(text,text,text,text,text,text,text,text,date)') is not null then
    raise exception 'source-selectable C2.3.1 RPC signature must not exist';
  end if;

  if not exists (
    select 1
    from pg_roles
    where rolname = 'trry_c2_3_1_external_inquiry_writer'
      and rolcanlogin is false
      and rolbypassrls is true
  ) then
    raise exception 'dedicated C2.3.1 NOLOGIN BYPASSRLS role missing';
  end if;

  if has_function_privilege('anon', v_function_oid, 'EXECUTE') then
    raise exception 'anon unexpectedly has C2.3.1 RPC execute privilege';
  end if;

  if has_function_privilege('authenticated', v_function_oid, 'EXECUTE') then
    raise exception 'authenticated unexpectedly has C2.3.1 RPC execute privilege';
  end if;

  if not has_function_privilege('service_role', v_function_oid, 'EXECUTE') then
    raise exception 'service_role C2.3.1 RPC execute privilege missing';
  end if;

  if not exists (
    select 1
    from pg_proc
    where oid = v_function_oid
      and prosecdef = true
      and proowner = 'trry_c2_3_1_external_inquiry_writer'::regrole
  ) then
    raise exception 'C2.3.1 RPC must be SECURITY DEFINER owned by the dedicated external inquiry role';
  end if;

  if (
    select coalesce(proconfig::text, '')
    from pg_proc
    where oid = v_function_oid
  ) not like '%search_path=%' then
    raise exception 'C2.3.1 RPC must declare fixed search_path';
  end if;

  if has_table_privilege('service_role', 'public.external_inquiry_receipts', 'INSERT') then
    raise exception 'service_role should not have direct receipt insert privilege';
  end if;

  set local role service_role;

  select *
  into v_first
  from public.create_external_inquiry_identity_c2_3_1(
    'web-c23-idem-001',
    'TRRY-C23-001',
    'C23 Web Customer',
    '0917 111 2222',
    'Need shirts for C2.3.1 validation.',
    'Custom shirt',
    '12 pcs',
    current_date + 7
  );

  if v_first.inquiry_id <> 'TRRY-C23-001' or v_first.customer_id is null or v_first.customer_created is not true then
    raise exception 'valid web inquiry did not create and link customer: %', row_to_json(v_first);
  end if;

  if (
    select customer_id
    from public.ops_inquiries
    where id = 'TRRY-C23-001'
  ) is distinct from v_first.customer_id then
    raise exception 'ops_inquiries.customer_id was not linked';
  end if;

  if (
    select customer_name = 'C23 Web Customer'
       and contact = '+639171112222'
       and source = 'Portal'
    from public.ops_inquiries
    where id = 'TRRY-C23-001'
  ) is not true then
    raise exception 'inquiry name/mobile/source snapshots were not preserved';
  end if;

  reset role;

  if (
    select external_source = 'TRRY_WEB'
    from public.external_inquiry_receipts
    where idempotency_key = 'web-c23-idem-001'
  ) is not true then
    raise exception 'external source must be internally fixed to TRRY_WEB';
  end if;

  if exists (
    select 1
    from public.external_inquiry_link_authorizations_c2_3_1
    where inquiry_id = 'TRRY-C23-001'
  ) then
    raise exception 'external inquiry link authorization was not cleaned after insert';
  end if;

  set local role service_role;

  begin
    insert into public.ops_inquiries (id, customer_id, customer_name, contact, product, quantity)
    values ('TRRY-C23-DIRECT', v_first.customer_id, 'Direct Service Role', '+639171112222', 'Blocked product', '1');
    raise exception 'direct service_role linked inquiry insert was accepted';
  exception when insufficient_privilege then null;
  end;

  select *
  into v_replay
  from public.create_external_inquiry_identity_c2_3_1(
    'web-c23-idem-001',
    'TRRY-C23-001',
    'C23 Web Customer',
    '0917 111 2222',
    'Need shirts for C2.3.1 validation.',
    'Custom shirt',
    '12 pcs',
    current_date + 7
  );

  if v_replay.inquiry_id <> v_first.inquiry_id or v_replay.customer_id is distinct from v_first.customer_id or v_replay.replay is not true then
    raise exception 'same idempotency key and payload did not replay original result';
  end if;

  begin
    perform public.create_external_inquiry_identity_c2_3_1(
      'web-c23-idem-001',
      'TRRY-C23-CHANGED',
      'C23 Web Customer Changed',
      '0917 111 2222',
      'Changed payload.',
      'Custom shirt',
      '12 pcs',
      current_date + 7
    );
    raise exception 'idempotency conflict was accepted';
  exception when unique_violation then null;
  end;

  select *
  into v_existing
  from public.create_external_inquiry_identity_c2_3_1(
    'web-c23-idem-002',
    'TRRY-C23-002',
    'C23 Existing Format',
    '+63 917 111 2222',
    'Same mobile in another format.',
    'Custom shirt',
    '24 pcs',
    current_date + 8
  );

  if v_existing.customer_id is distinct from v_first.customer_id or v_existing.customer_created is not false then
    raise exception 'alternate mobile format did not exact-match existing customer';
  end if;

  if (
    select count(*)
    from public.customers
    where mobile_normalized = '+639171112222'
  ) <> 1 then
    raise exception 'duplicate customer created for normalized mobile';
  end if;

  select *
  into v_blank
  from public.create_external_inquiry_identity_c2_3_1(
    'web-c23-idem-blank',
    'TRRY-C23-BLANK',
    'C23 Anonymous External',
    '',
    'Blank mobile generic external contract.',
    'Custom shirt',
    '6 pcs',
    current_date + 9
  );

  if v_blank.customer_id is not null or v_blank.mobile_normalized is not null then
    raise exception 'blank mobile should create unlinked inquiry only';
  end if;

  if (
    select customer_id is null and contact = ''
    from public.ops_inquiries
    where id = 'TRRY-C23-BLANK'
  ) is not true then
    raise exception 'blank mobile inquiry snapshot/link is wrong';
  end if;

  begin
    perform public.create_external_inquiry_identity_c2_3_1(
      'web-c23-idem-invalid',
      'TRRY-C23-BAD',
      'C23 Bad Mobile',
      '12345',
      'Invalid mobile should fail.',
      'Custom shirt',
      '6 pcs',
      current_date + 9
    );
    raise exception 'invalid mobile was accepted';
  exception when check_violation then null;
  end;

  reset role;
  set local role anon;

  begin
    perform public.create_external_inquiry_identity_c2_3_1(
      'web-c23-idem-anon',
      'TRRY-C23-ANON',
      'C23 Anon Blocked',
      '0917 444 5555',
      'Anon role should fail.',
      'Custom shirt',
      '6 pcs',
      current_date + 9
    );
    raise exception 'anon RPC call was accepted';
  exception when insufficient_privilege then null;
  end;

  reset role;
  set local role authenticated;

  begin
    perform public.create_external_inquiry_identity_c2_3_1(
      'web-c23-idem-auth',
      'TRRY-C23-AUTH',
      'C23 Auth Blocked',
      '0917 555 6666',
      'Authenticated role should fail.',
      'Custom shirt',
      '6 pcs',
      current_date + 9
    );
    raise exception 'authenticated RPC call was accepted';
  exception when insufficient_privilege then null;
  end;

  reset role;

  insert into auth.users (id, email)
  values (v_owner_user_id, 'owner-c23@example.test')
  on conflict (id) do nothing;

  insert into public.admin_users (user_id, email, role, display_name, is_active)
  values (v_owner_user_id, 'owner-c23@example.test', 'owner', 'C2.3 Owner', true)
  on conflict (user_id) do update
  set role = excluded.role,
      display_name = excluded.display_name,
      is_active = excluded.is_active;

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
    'TRRY-ORD-C23LNK01',
    'TRRY-C23-001',
    v_first.customer_id,
    'C23 Web Customer',
    '+639171112222',
    'Custom shirt',
    'Custom shirt',
    '12 pcs',
    100,
    100
  )
  returning id into v_order_id;

  if (
    select customer_id
    from public.orders
    where id = v_order_id
  ) is distinct from v_first.customer_id then
    raise exception 'C2.3.1 order did not preserve linked inquiry customer_id';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_user_id::text, true);
  set local role authenticated;

  begin
    update public.ops_inquiries
    set customer_id = null
    where id = 'TRRY-C23-001';
    raise exception 'post-conversion inquiry customer link change was accepted';
  exception when check_violation then null;
  end;

  reset role;

  raise notice 'Customer Identity C2.3.1 external inquiry contract validation passed';
end;
$$;

rollback;
