import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const name = `trry-stlolab-sw3-${process.pid}`;
const image = process.env.TRRY_VERIFY_POSTGRES_IMAGE || 'postgres:16-alpine';
const ownerId = '96000000-0000-4000-8000-000000000001';
let started = false;

try {
  run(['run', '--rm', '-d', '--name', name, '-e', 'POSTGRES_PASSWORD=postgres', '-e', 'POSTGRES_DB=trry_verify', image]);
  started = true;
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (run(['exec', name, 'psql', '-U', 'postgres', '-d', 'trry_verify', '-tAc', 'select 1'], { allow: true }).status === 0) { ready = true; break; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  if (!ready) throw new Error('Disposable Postgres did not become ready.');

  sql(`create extension if not exists pgcrypto;create schema auth;create schema storage;
    do $$begin create role anon;exception when duplicate_object then null;end$$;
    do $$begin create role authenticated;exception when duplicate_object then null;end$$;
    do $$begin create role service_role bypassrls;exception when duplicate_object then null;end$$;
    create table auth.users(id uuid primary key,email text);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  for (const file of [
    '202607110001_create_catalog_products.sql', '202607220001_harden_admin_auth_profiles.sql',
    '202608080001_phase3d_native_orders.sql', '202608110001_add_master_catalog_m0_foundation.sql',
    '202608110002_add_master_catalog_m1_governance.sql', '20260816104008_add_brand_foundation.sql',
    '20260820000000_m2b_inventory_foundation.sql', '20260831021438_add_customer_identity_c1.sql',
    '20260902142917_repair_customer_identity_c1_audit_users.sql', '20260903010100_customer_identity_linking_c2_1.sql',
    '20260911110045_stlolab_sw3_checkout_foundation.sql', '20260911113647_stlolab_sw3_inventory_reservations.sql',
    '20260911130719_stlolab_sw3_fulfillment_lifecycle.sql',
  ]) sql(readFileSync(`supabase/migrations/${file}`, 'utf8'));

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

  const variant = one(`select id from public.product_variants where sku='STLO-S'`).id;
  const lastVariant = one(`select id from public.product_variants where sku='STLO-LAST'`).id;
  const location = one(`select id from public.inventory_locations where location_code='MAIN-RETAIL'`).id;
  const pickup = `jsonb_build_object('method','pickup','optionCode','SHOP_PICKUP','pickupCode','TRRY-SHOP','address',jsonb_build_object())`;
  const delivery = (code, barangay) => `jsonb_build_object('method','delivery','optionCode','${code}','address',jsonb_build_object('line1','Test street','barangay','${barangay}','city','Iligan City','province','Lanao del Norte','postalCode','9200'))`;
  const call = (key = 'ABCDEFGHIJKLMNOP', price = 79000, qty = 2, token = 'b'.repeat(64), fulfillment = pickup, variantId = variant) =>
    `select trry_api.create_stlolab_order_sw3('staging','${key}','${createHash('sha256').update([key, price, qty, variantId, fulfillment].join(':')).digest('hex')}','${token}',jsonb_build_object('fullName','SW3 Staging Tester','mobile','09171234567','email','sw3@example.test'),${fulfillment},jsonb_build_array(jsonb_build_object('variantId','${variantId}','quantity',${qty},'unitPriceMinor',${price}))) as result`;

  fails(call(), /not enabled/);
  sql(`insert into public.stlolab_checkout_config(environment,enabled,inventory_policy,inventory_location_id)
      values('staging',true,'RESERVE_ON_SUBMIT','${location}');
    insert into public.stlolab_fulfillment_options(environment,option_code,method,enabled,fee_amount,requires_address,pickup_code,customer_label,coverage_mode,coverage_rules,customer_instructions)
      values
      ('staging','SHOP_PICKUP','pickup',true,0,false,'TRRY-SHOP','TRRY Apparel Shop','PICKUP','{}','Torralba St., Brgy. Poblacion, Iligan City; daily 10 AM-6 PM Philippine time.'),
      ('staging','LOCAL_DELIVERY','delivery',true,60,true,null,'Local delivery','EXPLICIT_BARANGAYS',jsonb_build_object('allowedBarangays',jsonb_build_array('Poblacion'),'excludedBarangays',jsonb_build_array('Buru-un','Linamon','Dalipuga','Pugaan','Suarez','Santa Elena')),null),
      ('staging','NATIONWIDE_DELIVERY','delivery',true,120,true,null,'Nationwide delivery','NATIONWIDE','{}',null);`);

  const created = one(call()).result;
  const replay = one(call()).result;
  assert.equal(created.orderId, replay.orderId);
  assert.equal(created.orderReference, replay.orderReference);
  assert.equal(created.totalMinor, 158000);
  assert.equal(created.lines[0].size, 'S');
  assert.equal(created.lines[0].quantity, 2);
  assert.equal(one(`select extract(epoch from (reservation_expires_at-created_at))::int as seconds from public.orders where id='${created.orderId}'`).seconds, 259200);
  assert.equal(one(`select count(*)::int as count from public.orders where source_type='STLOLAB_RETAIL'`).count, 1);
  assert.equal(one(`select count(*)::int as count from public.order_items`).count, 1);
  assert.equal(balance(variant).reserved_quantity, 2);

  await Promise.all([asyncSql(call('CONCURRENTKEY123', 79000, 1, 'e'.repeat(64))), asyncSql(call('CONCURRENTKEY123', 79000, 1, 'e'.repeat(64)))]);
  assert.equal(one(`select count(*)::int as count from public.stlolab_checkout_requests where idempotency_key='CONCURRENTKEY123'`).count, 1);
  const lastRace = await Promise.allSettled([
    asyncSql(call('LASTITEMORDER001', 79000, 1, '1'.repeat(64), pickup, lastVariant)),
    asyncSql(call('LASTITEMORDER002', 79000, 1, '2'.repeat(64), pickup, lastVariant)),
  ]);
  assert.equal(lastRace.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(lastRace.filter(result => result.status === 'rejected').length, 1);
  assert.match(lastRace.find(result => result.status === 'rejected').reason.message, /variant is unavailable/);
  fails(call('ABCDEFGHIJKLMNOP', 79000, 1), /different checkout data/);
  fails(call('QRSTUVWXYZABCDEF', 1, 1), /canonical price/);
  fails(call('ZYXWVUTSRQPONMLK', 79000, 31), /unavailable/);
  fails(call('DELIVERYTESTKEY1', 79000, 1, 'c'.repeat(64), `jsonb_build_object('method','delivery','optionCode','LOCAL_DELIVERY','address',jsonb_build_object())`), /including barangay/);
  fails(call('LOCALBANNEDKEY01', 79000, 1, 'c'.repeat(64), delivery('LOCAL_DELIVERY', 'Buru-un')), /excluded from local/);
  fails(call('LOCALUNKNOWNKEY1', 79000, 1, 'c'.repeat(64), delivery('LOCAL_DELIVERY', 'Unknown')), /not in configured local/);
  const local = one(call('LOCALALLOWEDKEY1', 79000, 1, 'd'.repeat(64), delivery('LOCAL_DELIVERY', 'Poblacion'))).result;
  const nationwide = one(call('NATIONWIDEKEY001', 79000, 1, 'f'.repeat(64), delivery('NATIONWIDE_DELIVERY', 'Unknown'))).result;
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
  one(`select trry_api.cancel_stlolab_order_sw3('${winningLast}','${winningToken}','CANCELLASTITEM01',null) as result`);
  sql(owner(`select private.m2b_apply_stock_movement('${location}','${lastVariant}','SALE',-1,'SALE','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','POS-AFTER-RELEASE','POS-AFTER-RELEASE-1',null)`));
  assert.deepEqual(balance(lastVariant), { quantity_on_hand: 0, reserved_quantity: 0 });

  const expiryOrder = one(call('EXPIRYORDERKEY01', 79000, 1, '3'.repeat(64))).result.orderId;
  makeExpired(expiryOrder);
  const beforeExpiry = balance(variant).quantity_on_hand;
  assert.equal(one(`select trry_api.expire_stlolab_reservations_sw3('2026-09-04T00:00:00Z',100) as result`).result.expiredCount, 1);
  assert.equal(one(`select trry_api.expire_stlolab_reservations_sw3('2026-09-04T00:00:00Z',100) as result`).result.expiredCount, 0);
  assert.deepEqual(orderState(expiryOrder), { status: 'expired', payment_state: 'UNPAID', fulfillment_state: 'PENDING' });
  assert.equal(balance(variant).quantity_on_hand, beforeExpiry);
  assert.equal(one(`select count(*)::int as count from public.inventory_reservations where order_id='${expiryOrder}' and status='EXPIRED' and release_reason='UNPAID_72_HOUR_EXPIRY'`).count, 1);

  const pickupOrder = one(call('PICKUPHANDOVER01', 79000, 1, '4'.repeat(64))).result.orderId;
  const pickupBefore = balance(variant).quantity_on_hand;
  sql(staff(`select trry_api.handover_stlolab_order_sw3('${pickupOrder}','CUSTOMER_PICKUP','PICKUPHANDOVERKEY1')`));
  sql(staff(`select trry_api.handover_stlolab_order_sw3('${pickupOrder}','CUSTOMER_PICKUP','PICKUPHANDOVERKEY2')`));
  fails(staff(`select trry_api.handover_stlolab_order_sw3('${pickupOrder}','COURIER_HANDOVER','PICKUPHANDOVERKEY3')`), /replay conflicts/);
  assert.equal(balance(variant).quantity_on_hand, pickupBefore - 1);
  assert.deepEqual(orderState(pickupOrder), { status: 'released', payment_state: 'UNPAID', fulfillment_state: 'HANDED_OVER' });
  assert.equal(one(`select count(*)::int as count from public.stock_movements where source_id='${pickupOrder}'`).count, 1);
  fails(`select trry_api.cancel_stlolab_order_sw3('${pickupOrder}','${'4'.repeat(64)}','CANCELAFTERPICKUP',null)`, /after payment, expiry, or handover/);

  const courierOrder = one(call('COURIERHANDOVER1', 79000, 1, '5'.repeat(64), delivery('NATIONWIDE_DELIVERY', 'Unknown'))).result.orderId;
  sql(staff(`select trry_api.handover_stlolab_order_sw3('${courierOrder}','COURIER_HANDOVER','COURIERHANDOVERKEY')`));
  assert.equal(orderState(courierOrder).payment_state, 'UNPAID');

  const paidOrder = one(call('PAIDORDERTEST001', 79000, 1, '6'.repeat(64))).result.orderId;
  sql(staff(`select trry_api.mark_stlolab_order_paid_sw3('${paidOrder}','PAY-TEST-001','PAYMENTIDEMPOTENT1')`));
  sql(staff(`select trry_api.mark_stlolab_order_paid_sw3('${paidOrder}','PAY-TEST-001','PAYMENTIDEMPOTENT2')`));
  fails(staff(`select trry_api.mark_stlolab_order_paid_sw3('${paidOrder}','PAY-OTHER','PAYMENTIDEMPOTENT3')`), /replay conflicts/);
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
  fails(`update public.stlolab_checkout_config set inventory_policy='DEDUCT_ON_SUBMIT' where environment='staging'`, /inventory_policy/);
  console.log('PASS STLOLAB SW3 reservation expiry, payment/cancellation/handover races, atomic handover deduction, delivery coverage, POS exclusion, and idempotency');

  async function raceExpiryPayment() {
    const id = one(call('RACEEXPIRYPAY001', 79000, 1, '7'.repeat(64))).result.orderId;
    makeExpired(id);
    await Promise.allSettled([
      asyncSql(`select trry_api.expire_stlolab_reservations_sw3('2026-09-04T00:00:00Z',100)`),
      asyncSql(staff(`select trry_api.mark_stlolab_order_paid_sw3('${id}','PAY-RACE-001','RACEPAYMENTKEY01')`)),
    ]);
    const state = orderState(id);
    assert.ok((state.status === 'expired' && state.payment_state === 'UNPAID') || (state.status === 'paid' && state.payment_state === 'PAID'));
    assert.equal(balance(variant).reserved_quantity >= 0, true);
  }

  async function raceExpiryCancellation() {
    const token = '8'.repeat(64);
    const id = one(call('RACEEXPIRYCANCEL01', 79000, 1, token)).result.orderId;
    makeExpired(id);
    await Promise.allSettled([
      asyncSql(`select trry_api.expire_stlolab_reservations_sw3('2026-09-04T00:00:00Z',100)`),
      asyncSql(`select trry_api.cancel_stlolab_order_sw3('${id}','${token}','RACECANCELKEY001',null)`),
    ]);
    assert.ok(['expired', 'cancelled'].includes(orderState(id).status));
    assert.notEqual(one(`select status from public.inventory_reservations where order_id='${id}'`).status, 'ACTIVE');
  }

  async function raceExpiryHandover() {
    const id = one(call('RACEEXPIRYHAND01', 79000, 1, '9'.repeat(64))).result.orderId;
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
    const id = one(call('RACEPAYHANDOVER1', 79000, 1, 'a'.repeat(64))).result.orderId;
    const before = balance(variant).quantity_on_hand;
    await Promise.all([
      asyncSql(staff(`select trry_api.mark_stlolab_order_paid_sw3('${id}','PAY-RACE-HANDOVER','RACEPAYHANDOVER1')`)),
      asyncSql(staff(`select trry_api.handover_stlolab_order_sw3('${id}','CUSTOMER_PICKUP','RACEHANDOVERPAY1')`)),
    ]);
    assert.deepEqual(orderState(id), { status: 'released', payment_state: 'PAID', fulfillment_state: 'HANDED_OVER' });
    assert.equal(balance(variant).quantity_on_hand, before - 1);
    assert.equal(one(`select count(*)::int as count from public.stock_movements where source_id='${id}'`).count, 1);
  }

  async function raceCancellationHandover() {
    const token = '0'.repeat(64);
    const id = one(call('RACECANCELHAND01', 79000, 1, token)).result.orderId;
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
function staff(source) { return `set role authenticated;set request.jwt.claim.sub='${ownerId}';${source};`; }
function sql(source) { const r = run(['exec', '-i', name, 'psql', '-U', 'postgres', '-d', 'trry_verify', '-X', '-v', 'ON_ERROR_STOP=1', '-q'], { input: source, allow: true }); if (r.status !== 0) throw new Error((r.stderr || r.stdout).trim()); return r.stdout; }
function one(query) { const r = run(['exec', '-i', name, 'psql', '-U', 'postgres', '-d', 'trry_verify', '-X', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-q'], { input: `select row_to_json(q)::text from (${query.replace(/;+$/, '')})q;`, allow: true }); if (r.status !== 0) throw new Error((r.stderr || r.stdout).trim()); return JSON.parse(r.stdout.trim()); }
function fails(query, pattern) { const r = run(['exec', '-i', name, 'psql', '-U', 'postgres', '-d', 'trry_verify', '-X', '-v', 'ON_ERROR_STOP=1', '-q'], { input: query, allow: true }); assert.notEqual(r.status, 0); assert.match(r.stderr || r.stdout, pattern); }
function asyncSql(source) { return new Promise((resolve, reject) => { const child = spawn('docker', ['exec', '-i', name, 'psql', '-U', 'postgres', '-d', 'trry_verify', '-X', '-v', 'ON_ERROR_STOP=1', '-q'], { stdio: ['pipe', 'pipe', 'pipe'] }); let out = '', err = ''; child.stdout.on('data', chunk => out += chunk); child.stderr.on('data', chunk => err += chunk); child.on('close', code => code === 0 ? resolve(out) : reject(new Error((err || out).trim()))); child.stdin.end(source); }); }
function run(args, { input = null, allow = false } = {}) { const r = spawnSync('docker', args, { encoding: 'utf8', input, maxBuffer: 20 * 1024 * 1024 }); if (r.status !== 0 && !allow) throw new Error((r.stderr || r.stdout).trim()); return r; }
