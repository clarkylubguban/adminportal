import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const name = `trry-stlolab-sw3-${process.pid}`;
const image = process.env.TRRY_VERIFY_POSTGRES_IMAGE || 'postgres:16-alpine';
const ownerId = '96000000-0000-4000-8000-000000000001';
const posUserId = '96000000-0000-4000-8000-000000000002';
const posM3bMigration = process.env.TRRY_POS_M3B_MIGRATION || '';
const posCompatibilityMigrations = JSON.parse(process.env.TRRY_POS_COMPAT_MIGRATIONS_JSON || '[]');
const checkoutPermissionMigration = '20260916082231_stlolab_sw3_checkout_service_role_permissions.sql';
const orderAccessMigration = '20260917034542_stlolab_order_access_lifecycle.sql';
const productionEnvironmentMigration = '20260920111117_stlolab_production_environment_release.sql';
const psqlBridge = process.env.TRRY_VERIFY_PSQL_BRIDGE || '';
let started = false;

try {
  if (!psqlBridge) {
    run(['run', '--rm', '-d', '--name', name, '-e', 'POSTGRES_PASSWORD=postgres', '-e', 'POSTGRES_DB=trry_verify', image]);
    started = true;
  }
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (psqlRun('select 1', { allow: true }).status === 0) { ready = true; break; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  if (!ready) throw new Error('Disposable Postgres did not become ready.');

  sql(`create extension if not exists pgcrypto;create schema auth;create schema storage;
    do $$begin create role anon;exception when duplicate_object then null;end$$;
    do $$begin create role authenticated;exception when duplicate_object then null;end$$;
    do $$begin create role service_role bypassrls;exception when duplicate_object then null;end$$;
    create table auth.users(id uuid primary key,email text);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to public;`);
  for (const file of [
    '202607110001_create_catalog_products.sql', '202607220001_harden_admin_auth_profiles.sql',
    '202608080001_phase3d_native_orders.sql', '202608110001_add_master_catalog_m0_foundation.sql',
    '202608110002_add_master_catalog_m1_governance.sql', '20260816104008_add_brand_foundation.sql',
    '20260820000000_m2b_inventory_foundation.sql', '20260831021438_add_customer_identity_c1.sql',
    '20260902142917_repair_customer_identity_c1_audit_users.sql', '20260903010100_customer_identity_linking_c2_1.sql',
    '20260911110045_stlolab_sw3_checkout_foundation.sql', '20260911113647_stlolab_sw3_inventory_reservations.sql',
    '20260911130719_stlolab_sw3_fulfillment_lifecycle.sql', '20260911134759_stlolab_sw3_admin_order_actions.sql',
    '20260911142227_stlolab_sw3_preserve_shared_stock_authority.sql',
  ]) {
    sql(readFileSync(`supabase/migrations/${file}`, 'utf8'));
    if (file === '20260820000000_m2b_inventory_foundation.sql' && posM3bMigration) {
      sql(readFileSync(posM3bMigration, 'utf8'));
      for (const compatibilityMigration of posCompatibilityMigrations) {
        sql(readFileSync(compatibilityMigration, 'utf8'));
      }
    }
  }
  sql(`grant all privileges on all tables in schema public to service_role;
    grant all privileges on all sequences in schema public to service_role;
    grant execute on all functions in schema public to service_role;`);

  sql(`insert into public.product_categories(name,code) values('Tees','TEE');
    insert into public.products(category_id,brand_id,master_product_id,product_code,name,active,product_type,readiness_status,sellable,eligible_channels)
      select c.id,b.id,'MASTER-SW3','PRD-260911-8DC1A1','Glow N Underground',true,'PHYSICAL','READY_FOR_SALE',true,array['STLOLAB']
      from public.product_categories c,public.brands b where c.code='TEE' and b.brand_code='STLO';
    insert into public.product_variants(product_id,master_variant_id,sku,global_sku,size,color,selling_price,active)
      select id,'VAR-S','STLO-S','GLOBAL-STLO-S','S','Black',790,true from public.products where product_code='PRD-260911-8DC1A1';
    insert into public.product_variants(product_id,master_variant_id,sku,global_sku,size,color,selling_price,active)
      select id,'VAR-LAST','STLO-LAST','GLOBAL-STLO-LAST','XL','Black',790,true from public.products where product_code='PRD-260911-8DC1A1';
    insert into public.branches(branch_code,name) values('SW3-TEST','SW3 Test');
    insert into public.inventory_locations(branch_id,location_code,name,is_default_retail)
      select id,'MAIN-RETAIL','Main Retail Stock',true from public.branches where branch_code='SW3-TEST';
    insert into public.inventory_balances(location_id,variant_id,quantity_on_hand)
      select l.id,v.id,case when v.sku='STLO-LAST' then 1 else 30 end
      from public.inventory_locations l,public.product_variants v
      where l.location_code='MAIN-RETAIL' and v.sku in('STLO-S','STLO-LAST');
    insert into auth.users(id,email) values('${ownerId}','owner@example.test');
    insert into public.admin_users(user_id,email,role,is_active) values('${ownerId}','owner@example.test','owner',true);`);
  if (posM3bMigration) {
    sql(`insert into auth.users(id,email) values('${posUserId}','pos@example.test');
      insert into public.pos_staff_profiles(user_id,display_name,role,active,default_branch_id)
      select '${posUserId}','SW3 POS Tester','CASHIER',true,id from public.branches where branch_code='SW3-TEST';
      insert into public.pos_staff_profiles(user_id,display_name,role,active,default_branch_id)
      select '${ownerId}','SW3 POS Owner','OWNER',true,id from public.branches where branch_code='SW3-TEST';`);
  }

  const variant = one(`select id from public.product_variants where sku='STLO-S'`).id;
  const lastVariant = one(`select id from public.product_variants where sku='STLO-LAST'`).id;
  const location = one(`select id from public.inventory_locations where location_code='MAIN-RETAIL'`).id;
  const pickup = `jsonb_build_object('method','pickup','optionCode','SHOP_PICKUP','pickupCode','TRRY-SHOP','address',jsonb_build_object())`;
  const delivery = (code, barangay) => `jsonb_build_object('method','delivery','optionCode','${code}','address',jsonb_build_object('line1','Test street','barangay','${barangay}','city','Iligan City','province','Lanao del Norte','postalCode','9200'))`;
  const callOld = (key = 'ABCDEFGHIJKLMNOP', price = 79000, qty = 2, token = 'b'.repeat(64), fulfillment = pickup, variantId = variant) =>
    `select trry_api.create_stlolab_order_sw3('staging','${key}','${createHash('sha256').update([key, price, qty, variantId, fulfillment].join(':')).digest('hex')}','${token}',jsonb_build_object('fullName','SW3 Staging Tester','mobile','09171234567','email','sw3@example.test'),${fulfillment},jsonb_build_array(jsonb_build_object('variantId','${variantId}','quantity',${qty},'unitPriceMinor',${price}))) as result`;
  const call = (key = 'ABCDEFGHIJKLMNOP', price = 79000, qty = 2, token = 'b'.repeat(64), fulfillment = pickup, variantId = variant) =>
    callOld(key, price, qty, token, fulfillment, variantId).replace('))) as result', `)),clock_timestamp()+interval '30 days') as result`);
  const payment = (orderId, reference, key, amount = 790, method = 'gcash') =>
    `select trry_api.confirm_stlolab_order_payment_sw3('${orderId}',${amount},'${method}','${reference}',null,'${key}') as result`;

  fails(`set role anon;select trry_api.adjust_inventory('${location}','${variant}',-1,'denied adjustment','SW3-ADJUST-DENIED-ANON','SW3-ADJUST-DENIED')`, /permission denied/);
  fails(`set role authenticated;set request.jwt.claim.sub='97000000-0000-4000-8000-000000000001';select trry_api.adjust_inventory('${location}','${variant}',-1,'denied adjustment','SW3-ADJUST-DENIED-USER','SW3-ADJUST-DENIED')`, /Owner\/Admin identity is required/);
  const adjustmentBefore = balance(variant);
  sql(staff(`select trry_api.adjust_inventory('${location}','${variant}',-1,'disposable adjustment fixture','SW3-ADJUST-RETRY-01','SW3-ADJUST-FIXTURE')`));
  sql(staff(`select trry_api.adjust_inventory('${location}','${variant}',-1,'disposable adjustment fixture','SW3-ADJUST-RETRY-01','SW3-ADJUST-FIXTURE')`));
  assert.deepEqual(balance(variant), { quantity_on_hand: adjustmentBefore.quantity_on_hand - 1, reserved_quantity: adjustmentBefore.reserved_quantity });
  assert.equal(one(`select count(*)::int as count from public.stock_movements where idempotency_key='SW3-ADJUST-RETRY-01' and movement_type='ADJUSTMENT' and source_reference='SW3-ADJUST-FIXTURE'`).count, 1);

  fails(service(callOld()), /permission denied for schema private/);
  sql(readFileSync(`supabase/migrations/${checkoutPermissionMigration}`, 'utf8'));
  assert.equal(one(`select has_schema_privilege('service_role','private','usage') as allowed`).allowed, true);
  assert.equal(one(`select has_function_privilege('service_role','private.stlolab_place_key(text)','execute') as allowed`).allowed, true);
  assert.equal(one(`select has_function_privilege('service_role','private.stlolab_reserve_order_item_sw3()','execute') as allowed`).allowed, false);
  sql(readFileSync(`supabase/migrations/${orderAccessMigration}`, 'utf8'));
  sql(readFileSync(`supabase/migrations/${productionEnvironmentMigration}`, 'utf8'));
  for (const role of ['anon', 'authenticated']) {
    assert.equal(one(`select has_schema_privilege('${role}','private','usage') as allowed`).allowed, false);
    assert.equal(one(`select has_function_privilege('${role}','private.stlolab_place_key(text)','execute') as allowed`).allowed, false);
    fails(`set role ${role};select private.stlolab_place_key('Poblacion')`, /permission denied/);
    fails(`set role ${role};${call()}`, /permission denied/);
  }
  fails(service(call()), /not enabled/);
  sql(`insert into public.stlolab_checkout_config(environment,enabled,inventory_policy,inventory_location_id)
      values('staging',true,'RESERVE_ON_SUBMIT','${location}');
    insert into public.stlolab_fulfillment_options(environment,option_code,method,enabled,fee_amount,requires_address,pickup_code,customer_label,coverage_mode,coverage_rules,customer_instructions)
      values
      ('staging','SHOP_PICKUP','pickup',true,0,false,'TRRY-SHOP','TRRY Apparel Shop','PICKUP','{}','Torralba St., Brgy. Poblacion, Iligan City; daily 10 AM-6 PM Philippine time.'),
      ('staging','LOCAL_DELIVERY','delivery',true,60,true,null,'Local delivery','EXPLICIT_BARANGAYS',jsonb_build_object('allowedBarangays',jsonb_build_array('Poblacion'),'excludedBarangays',jsonb_build_array('Buru-un','Linamon','Dalipuga','Pugaan','Suarez','Santa Elena')),null),
      ('staging','NATIONWIDE_DELIVERY','delivery',true,120,true,null,'Nationwide delivery','NATIONWIDE','{}',null);`);
  fails(service(callOld('LEGACYBYPASSKEY1')), /durable confirmation access is required/);

  const created = oneAsService(call()).result;
  const replay = oneAsService(call()).result;
  assert.equal(created.orderId, replay.orderId);
  assert.equal(created.orderReference, replay.orderReference);
  assert.equal(created.totalMinor, 158000);
  assert.equal(created.lines[0].size, 'S');
  assert.equal(created.lines[0].quantity, 2);
  assert.deepEqual(one(`select confirmation_access_version as version,confirmation_token_revoked_at is null as active,
    extract(epoch from (confirmation_token_expires_at-confirmation_token_issued_at))::int between 2591900 and 2592000 as ttl_ok
    from public.orders where id='${created.orderId}'`), {version:1,active:true,ttl_ok:true});
  sql(`update public.orders set confirmation_token_revoked_at=clock_timestamp() where id='${created.orderId}'`);
  assert.equal(one(`select trry_api.get_stlolab_order_confirmation_sw3('${created.orderId}','${'b'.repeat(64)}') as result`).result, null);
  assert.equal(one(`select trry_api.cancel_stlolab_order_sw3('${created.orderId}','${'b'.repeat(64)}','REVOKEDCANCELKEY1',null) as result`).result, null);
  sql(`update public.orders set confirmation_token_revoked_at=null,
    confirmation_token_issued_at=clock_timestamp()-interval '2 days',confirmation_token_expires_at=clock_timestamp()-interval '1 day'
    where id='${created.orderId}'`);
  assert.equal(one(`select trry_api.get_stlolab_order_confirmation_sw3('${created.orderId}','${'b'.repeat(64)}') as result`).result, null);
  assert.equal(one(`select trry_api.cancel_stlolab_order_sw3('${created.orderId}','${'b'.repeat(64)}','EXPIREDCANCELKEY1',null) as result`).result, null);
  sql(`update public.orders set confirmation_token_issued_at=clock_timestamp(),confirmation_token_expires_at=clock_timestamp()+interval '30 days'
    where id='${created.orderId}'`);
  assert.equal(one(`select extract(epoch from (reservation_expires_at-created_at))::int as seconds from public.orders where id='${created.orderId}'`).seconds, 259200);
  assert.equal(one(`select count(*)::int as count from public.orders where source_type='STLOLAB_RETAIL'`).count, 1);
  assert.equal(one(`select count(*)::int as count from public.order_items`).count, 1);
  assert.equal(balance(variant).reserved_quantity, 2);

  sql(`insert into public.stlolab_checkout_config(environment,enabled,inventory_policy,inventory_location_id)
      values('production',true,'RESERVE_ON_SUBMIT','${location}');
    insert into public.stlolab_fulfillment_options(environment,option_code,method,enabled,fee_amount,requires_address,pickup_code,customer_label,coverage_mode,coverage_rules,customer_instructions)
      values('production','SHOP_PICKUP','pickup',true,0,false,'TRRY-SHOP','TRRY Apparel Shop','PICKUP','{}','Production pickup fixture.');`);
  const productionCreated = oneAsService(call('PRODUCTIONORDER01',79000,1,'c'.repeat(64)).replace("create_stlolab_order_sw3('staging'", "create_stlolab_order_sw3('production'")).result;
  assert.equal(one(`select checkout_environment as environment from public.orders where id='${productionCreated.orderId}'`).environment, 'production');
  assert.equal(one(`select count(*)::int as count from public.inventory_reservations where order_id='${productionCreated.orderId}' and status='ACTIVE'`).count, 1);

  if (posCompatibilityMigrations.length) {
    const compatibilityBefore = balance(variant);
    sql(owner(`select private.m2b_record_sale_void_stock_movement('${location}','${variant}',1,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','SW3-M4-VOID','SW3-M4-VOID-1')`));
    sql(owner(`select private.m2b_record_sale_void_stock_movement('${location}','${variant}',1,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','SW3-M4-VOID','SW3-M4-VOID-1')`));
    assert.deepEqual(balance(variant), { quantity_on_hand: compatibilityBefore.quantity_on_hand + 1, reserved_quantity: compatibilityBefore.reserved_quantity });
    assert.equal(one(`select count(*)::int as count from public.stock_movements where idempotency_key='SW3-M4-VOID-1'`).count, 1);
    fails(pos(`select private.m2b_record_sale_void_stock_movement('${location}','${variant}',1,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac','SW3-M4-DENIED','SW3-M4-DENIED-1')`), /Owner or Admin role/);

    sql(owner(`select trry_api.receive_inventory('${location}','${variant}',1,'SW3-E7-RECEIVE-1','SW3-E7-RECEIVE','authorized compatibility receiving')`));
    sql(owner(`select trry_api.receive_inventory('${location}','${variant}',1,'SW3-E7-RECEIVE-1','SW3-E7-RECEIVE','authorized compatibility receiving')`));
    assert.deepEqual(balance(variant), { quantity_on_hand: compatibilityBefore.quantity_on_hand + 2, reserved_quantity: compatibilityBefore.reserved_quantity });
    assert.equal(one(`select count(*)::int as count from public.stock_movements where idempotency_key='SW3-E7-RECEIVE-1'`).count, 1);
    fails(pos(`select trry_api.receive_inventory('${location}','${variant}',1,'SW3-E7-DENIED-1','SW3-E7-DENIED','unauthorized compatibility receiving')`), /Inventory receiving permission|Owner\/Admin identity/);
  }

  await Promise.all([asyncSql(service(call('CONCURRENTKEY123', 79000, 1, 'e'.repeat(64)))), asyncSql(service(call('CONCURRENTKEY123', 79000, 1, 'e'.repeat(64))))]);
  assert.equal(one(`select count(*)::int as count from public.stlolab_checkout_requests where idempotency_key='CONCURRENTKEY123'`).count, 1);
  const lastRace = await Promise.allSettled([
    asyncSql(service(call('LASTITEMORDER001', 79000, 1, '1'.repeat(64), pickup, lastVariant))),
    asyncSql(service(call('LASTITEMORDER002', 79000, 1, '2'.repeat(64), pickup, lastVariant))),
  ]);
  assert.equal(lastRace.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(lastRace.filter(result => result.status === 'rejected').length, 1);
  assert.match(lastRace.find(result => result.status === 'rejected').reason.message, /variant is unavailable/);
  const reservedFloorBefore = balance(lastVariant);
  fails(staff(`select trry_api.adjust_inventory('${location}','${lastVariant}',-1,'must not consume reserved stock','SW3-ADJUST-RESERVED-01','SW3-ADJUST-RESERVED')`), /consume reserved inventory/);
  assert.deepEqual(balance(lastVariant), reservedFloorBefore);
  assert.equal(one(`select count(*)::int as count from public.stock_movements where idempotency_key='SW3-ADJUST-RESERVED-01'`).count, 0);
  fails(service(call('ABCDEFGHIJKLMNOP', 79000, 1)), /different checkout data/);
  fails(service(call('QRSTUVWXYZABCDEF', 1, 1)), /canonical price/);
  fails(service(call('ZYXWVUTSRQPONMLK', 79000, 31)), /unavailable/);
  fails(service(call('DELIVERYTESTKEY1', 79000, 1, 'c'.repeat(64), `jsonb_build_object('method','delivery','optionCode','LOCAL_DELIVERY','address',jsonb_build_object())`)), /including barangay/);
  fails(service(call('LOCALBANNEDKEY01', 79000, 1, 'c'.repeat(64), delivery('LOCAL_DELIVERY', 'Buru-un'))), /excluded from local/);
  fails(service(call('LOCALUNKNOWNKEY1', 79000, 1, 'c'.repeat(64), delivery('LOCAL_DELIVERY', 'Unknown'))), /not in configured local/);
  const local = oneAsService(call('LOCALALLOWEDKEY1', 79000, 1, 'd'.repeat(64), delivery('LOCAL_DELIVERY', 'Poblacion'))).result;
  const nationwide = oneAsService(call('NATIONWIDEKEY001', 79000, 1, 'f'.repeat(64), delivery('NATIONWIDE_DELIVERY', 'Unknown'))).result;
  assert.equal(local.fulfillmentMinor, 6000);
  assert.equal(nationwide.fulfillmentMinor, 12000);
  assert.equal(one(`select trry_api.get_stlolab_order_confirmation_sw3('${created.orderId}','${'c'.repeat(64)}') as result`).result, null);

  const cancelled = one(`select trry_api.cancel_stlolab_order_sw3('${created.orderId}','${'b'.repeat(64)}','CANCELTESTKEY001','owner-approved cancellation') as result`).result;
  const repeated = one(`select trry_api.cancel_stlolab_order_sw3('${created.orderId}','${'b'.repeat(64)}','CANCELTESTKEY002','repeat') as result`).result;
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(repeated.status, 'cancelled');
  assert.equal(one(`select count(*)::int as count from public.inventory_reservations where order_id='${created.orderId}' and status='RELEASED' and release_reason='CUSTOMER_CANCELLATION'`).count, 1);

  const winningLast = one(`select order_id from public.stlolab_checkout_requests where idempotency_key in('LASTITEMORDER001','LASTITEMORDER002')`).order_id;
  const winningKey = one(`select idempotency_key from public.stlolab_checkout_requests where order_id='${winningLast}'`).idempotency_key;
  const winningToken = winningKey === 'LASTITEMORDER001' ? '1'.repeat(64) : '2'.repeat(64);
  assert.equal(one(`select trry_api.cancel_stlolab_order_sw3('${winningLast}','${'9'.repeat(64)}','WRONGTOKENCANCEL1',null) as result`).result, null);
  fails(owner(`select private.m2b_apply_stock_movement('${location}','${lastVariant}','SALE',-1,'SALE','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','POS-RESERVED','POS-RESERVED-1',null)`), /consume reserved inventory/);
  if (posM3bMigration) {
    fails(pos(`select private.m2b_apply_stock_movement('${location}','${lastVariant}','SALE',-1,'SALE','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','POS-RESERVED-CASHIER','POS-RESERVED-CASHIER-1',null)`), /consume reserved inventory/);
  }
  one(`select trry_api.cancel_stlolab_order_sw3('${winningLast}','${winningToken}','CANCELLASTITEM01',null) as result`);
  sql((posM3bMigration ? pos : owner)(`select private.m2b_apply_stock_movement('${location}','${lastVariant}','SALE',-1,'SALE','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','POS-AFTER-RELEASE','POS-AFTER-RELEASE-1',null)`));
  assert.deepEqual(balance(lastVariant), { quantity_on_hand: 0, reserved_quantity: 0 });

  const expiryOrder = oneAsService(call('EXPIRYORDERKEY01', 79000, 1, '3'.repeat(64))).result.orderId;
  makeExpired(expiryOrder);
  const beforeExpiry = balance(variant).quantity_on_hand;
  assert.equal(one(`select trry_api.expire_stlolab_reservations_sw3('2026-09-04T00:00:00Z',100) as result`).result.expiredCount, 1);
  assert.equal(one(`select trry_api.expire_stlolab_reservations_sw3('2026-09-04T00:00:00Z',100) as result`).result.expiredCount, 0);
  assert.deepEqual(orderState(expiryOrder), { status: 'expired', payment_state: 'UNPAID', fulfillment_state: 'PENDING' });
  assert.equal(balance(variant).quantity_on_hand, beforeExpiry);
  assert.equal(one(`select count(*)::int as count from public.inventory_reservations where order_id='${expiryOrder}' and status='EXPIRED' and release_reason='UNPAID_72_HOUR_EXPIRY'`).count, 1);

  const pickupOrder = oneAsService(call('PICKUPHANDOVER01', 79000, 1, '4'.repeat(64))).result.orderId;
  const pickupBefore = balance(variant).quantity_on_hand;
  sql(staff(`select trry_api.handover_stlolab_order_sw3('${pickupOrder}','CUSTOMER_PICKUP','PICKUPHANDOVERKEY1')`));
  sql(staff(`select trry_api.handover_stlolab_order_sw3('${pickupOrder}','CUSTOMER_PICKUP','PICKUPHANDOVERKEY2')`));
  fails(staff(`select trry_api.handover_stlolab_order_sw3('${pickupOrder}','COURIER_HANDOVER','PICKUPHANDOVERKEY3')`), /replay conflicts/);
  assert.equal(balance(variant).quantity_on_hand, pickupBefore - 1);
  assert.deepEqual(orderState(pickupOrder), { status: 'released', payment_state: 'UNPAID', fulfillment_state: 'HANDED_OVER' });
  assert.equal(one(`select count(*)::int as count from public.stock_movements where source_id='${pickupOrder}'`).count, 1);
  fails(`select trry_api.cancel_stlolab_order_sw3('${pickupOrder}','${'4'.repeat(64)}','CANCELAFTERPICKUP',null)`, /after payment, expiry, or handover/);

  const courierOrder = oneAsService(call('COURIERHANDOVER1', 79000, 1, '5'.repeat(64), delivery('NATIONWIDE_DELIVERY', 'Unknown'))).result.orderId;
  sql(staff(`select trry_api.handover_stlolab_order_sw3('${courierOrder}','COURIER_HANDOVER','COURIERHANDOVERKEY')`));
  assert.equal(orderState(courierOrder).payment_state, 'UNPAID');

  const paidOrder = oneAsService(call('PAIDORDERTEST001', 79000, 1, '6'.repeat(64))).result.orderId;
  sql(staff(payment(paidOrder, 'PAY-TEST-001', 'PAYMENTIDEMPOTENT1')));
  sql(staff(payment(paidOrder, 'PAY-TEST-001', 'PAYMENTIDEMPOTENT1')));
  fails(staff(payment(paidOrder, 'PAY-TEST-001', 'PAYMENTIDEMPOTENT2')), /already confirmed/);
  assert.equal(one(`select count(*)::int as count from public.order_payment_events where order_id='${paidOrder}'`).count, 1);
  assert.equal(one(`select payment_reference from public.orders where id='${paidOrder}'`).payment_reference, 'PAY-TEST-001');
  makeExpired(paidOrder);
  one(`select trry_api.expire_stlolab_reservations_sw3('2026-09-04T00:00:00Z',100) as result`);
  assert.equal(orderState(paidOrder).payment_state, 'PAID');
  assert.equal(one(`select status from public.inventory_reservations where order_id='${paidOrder}'`).status, 'ACTIVE');
  fails(`select trry_api.cancel_stlolab_order_sw3('${paidOrder}','${'6'.repeat(64)}','CANCELPAIDORDER01',null)`, /after payment/);

  await raceExpiryPayment();
  await raceExpiryCancellation();
  await raceExpiryHandover();
  await racePaymentHandover();
  await raceCancellationHandover();

  fails(`set role anon;select trry_api.expire_stlolab_reservations_sw3(clock_timestamp(),1)`, /permission denied/);
  fails(`select trry_api.expire_stlolab_reservations_sw3(clock_timestamp()+interval '1 hour',1)`, /cannot be in the future/);
  fails(`set role anon;select trry_api.handover_stlolab_order_sw3('${pickupOrder}','CUSTOMER_PICKUP','UNAUTHORIZEDTEST1')`, /permission denied/);
  fails(`set role authenticated;set request.jwt.claim.sub='97000000-0000-4000-8000-000000000001';select trry_api.handover_stlolab_order_sw3('${paidOrder}','CUSTOMER_PICKUP','UNAUTHORIZEDTEST2')`, /Owner\/Admin identity is required/);
  fails(`set role authenticated;set request.jwt.claim.sub='${ownerId}';select trry_api.mark_stlolab_order_paid_sw3('${paidOrder}','BROWSER-CLAIM','DIRECTBROWSERCLAIM')`, /permission denied/);
  const tamperedPaymentOrder = oneAsService(call('TAMPEREDPAYMENT01', 79000, 1, 'd'.repeat(64))).result.orderId;
  fails(staff(payment(tamperedPaymentOrder, 'PAY-TAMPERED', 'TAMPEREDPAYMENTKEY', 1)), /canonical order amount/);
  assert.equal(one(`select count(*)::int as count from public.order_payment_events where order_id='${tamperedPaymentOrder}'`).count, 0);
  fails(`update public.stlolab_checkout_config set inventory_policy='DEDUCT_ON_SUBMIT' where environment='staging'`, /inventory_policy/);
  console.log('PASS STLOLAB SW3 reservation expiry, payment/cancellation/handover races, authenticated adjustment denial/retry/reservation floor, atomic handover deduction, delivery coverage, POS exclusion, M4/E7 compatibility, and idempotency');

  async function raceExpiryPayment() {
    const id = oneAsService(call('RACEEXPIRYPAY001', 79000, 1, '7'.repeat(64))).result.orderId;
    makeExpired(id);
    await Promise.allSettled([
      asyncSql(`select trry_api.expire_stlolab_reservations_sw3('2026-09-04T00:00:00Z',100)`),
      asyncSql(staff(payment(id, 'PAY-RACE-001', 'RACEPAYMENTKEY01'))),
    ]);
    const state = orderState(id);
    assert.ok((state.status === 'expired' && state.payment_state === 'UNPAID') || (state.status === 'paid' && state.payment_state === 'PAID'));
    assert.equal(balance(variant).reserved_quantity >= 0, true);
  }

  async function raceExpiryCancellation() {
    const token = '8'.repeat(64);
    const id = oneAsService(call('RACEEXPIRYCANCEL01', 79000, 1, token)).result.orderId;
    makeExpired(id);
    await Promise.allSettled([
      asyncSql(`select trry_api.expire_stlolab_reservations_sw3('2026-09-04T00:00:00Z',100)`),
      asyncSql(`select trry_api.cancel_stlolab_order_sw3('${id}','${token}','RACECANCELKEY001',null)`),
    ]);
    assert.ok(['expired', 'cancelled'].includes(orderState(id).status));
    assert.notEqual(one(`select status from public.inventory_reservations where order_id='${id}'`).status, 'ACTIVE');
  }

  async function raceExpiryHandover() {
    const id = oneAsService(call('RACEEXPIRYHAND01', 79000, 1, '9'.repeat(64))).result.orderId;
    makeExpired(id);
    const before = balance(variant).quantity_on_hand;
    await Promise.allSettled([
      asyncSql(`select trry_api.expire_stlolab_reservations_sw3('2026-09-04T00:00:00Z',100)`),
      asyncSql(staff(`select trry_api.handover_stlolab_order_sw3('${id}','CUSTOMER_PICKUP','RACEHANDOVERKEY1')`)),
    ]);
    const state = orderState(id);
    assert.ok(['expired', 'released'].includes(state.status));
    assert.equal(balance(variant).quantity_on_hand, state.status === 'released' ? before - 1 : before);
    assert.notEqual(one(`select status from public.inventory_reservations where order_id='${id}'`).status, 'ACTIVE');
  }

  async function racePaymentHandover() {
    const id = oneAsService(call('RACEPAYHANDOVER1', 79000, 1, 'a'.repeat(64))).result.orderId;
    const before = balance(variant).quantity_on_hand;
    await Promise.all([
      asyncSql(staff(payment(id, 'PAY-RACE-HANDOVER', 'RACEPAYHANDOVER1'))),
      asyncSql(staff(`select trry_api.handover_stlolab_order_sw3('${id}','CUSTOMER_PICKUP','RACEHANDOVERPAY1')`)),
    ]);
    assert.deepEqual(orderState(id), { status: 'released', payment_state: 'PAID', fulfillment_state: 'HANDED_OVER' });
    assert.equal(balance(variant).quantity_on_hand, before - 1);
    assert.equal(one(`select count(*)::int as count from public.stock_movements where source_id='${id}'`).count, 1);
  }

  async function raceCancellationHandover() {
    const token = '0'.repeat(64);
    const id = oneAsService(call('RACECANCELHAND01', 79000, 1, token)).result.orderId;
    const before = balance(variant).quantity_on_hand;
    await Promise.allSettled([
      asyncSql(`select trry_api.cancel_stlolab_order_sw3('${id}','${token}','RACECANCELHAND01',null)`),
      asyncSql(staff(`select trry_api.handover_stlolab_order_sw3('${id}','CUSTOMER_PICKUP','RACEHANDCANCEL01')`)),
    ]);
    const state = orderState(id);
    assert.ok(['cancelled', 'released'].includes(state.status));
    assert.equal(balance(variant).quantity_on_hand, state.status === 'released' ? before - 1 : before);
    assert.notEqual(one(`select status from public.inventory_reservations where order_id='${id}'`).status, 'ACTIVE');
  }

  function makeExpired(orderId) {
    sql(`update public.orders set reservation_expires_at='2026-09-04T00:00:00Z' where id='${orderId}';
      update public.inventory_reservations set expires_at='2026-09-04T00:00:00Z' where order_id='${orderId}' and status='ACTIVE';`);
  }
  function balance(variantId) {
    return one(`select quantity_on_hand,reserved_quantity from public.inventory_balances where location_id='${location}' and variant_id='${variantId}'`);
  }
  function orderState(orderId) {
    return one(`select status,payment_state,fulfillment_state from public.orders where id='${orderId}'`);
  }
} finally {
  if (started) run(['rm', '-f', name], { allow: true });
}

function owner(source) { return `set request.jwt.claim.sub='${ownerId}';${source};`; }
function pos(source) { return `set request.jwt.claim.sub='${posUserId}';${source};`; }
function staff(source) { return `set role authenticated;set request.jwt.claim.sub='${ownerId}';${source};`; }
function service(source) { return `set role service_role;${source};`; }
function sql(source) { const r = psqlRun(source, { allow: true }); if (r.status !== 0) throw new Error((r.stderr || r.stdout).trim()); return r.stdout; }
function one(query) { const r = psqlRun(`select row_to_json(q)::text from (${query.replace(/;+$/, '')})q;`, { allow: true }); if (r.status !== 0) throw new Error((r.stderr || r.stdout).trim()); return JSON.parse(r.stdout.trim()); }
function oneAsService(query) { const r = psqlRun(`set role service_role;select row_to_json(q)::text from (${query.replace(/;+$/, '')})q;`, { allow: true }); if (r.status !== 0) throw new Error((r.stderr || r.stdout).trim()); return JSON.parse(r.stdout.trim()); }
function fails(query, pattern) { const r = psqlRun(query, { allow: true }); assert.notEqual(r.status, 0); assert.match(r.stderr || r.stdout, pattern); }
function asyncSql(source) { return new Promise((resolve, reject) => { const command = psqlBridge ? process.execPath : 'docker'; const args = psqlBridge ? [psqlBridge] : ['exec', '-i', name, 'psql', '-U', 'postgres', '-d', 'trry_verify', '-X', '-v', 'ON_ERROR_STOP=1', '-q']; const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] }); let out = '', err = ''; child.stdout.on('data', chunk => out += chunk); child.stderr.on('data', chunk => err += chunk); child.on('close', code => code === 0 ? resolve(out) : reject(new Error((err || out).trim()))); child.stdin.end(source); }); }
function psqlRun(source, { allow = false } = {}) { return psqlBridge ? spawnSync(process.execPath, [psqlBridge], { encoding: 'utf8', input: source, maxBuffer: 20 * 1024 * 1024 }) : run(['exec', '-i', name, 'psql', '-U', 'postgres', '-d', 'trry_verify', '-X', '-v', 'ON_ERROR_STOP=1', '-q'], { input: source, allow }); }
function run(args, { input = null, allow = false } = {}) { const r = spawnSync('docker', args, { encoding: 'utf8', input, maxBuffer: 20 * 1024 * 1024 }); if (r.status !== 0 && !allow) throw new Error((r.stderr || r.stdout).trim()); return r; }
