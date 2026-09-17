import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import handler from '../api/_lib/stlolabCheckoutRoute.js';

const original={...process.env};
try{
 let result=await invoke('GET');assert.equal(result.status,405);
 delete process.env.STLO_CHECKOUT_ENABLED;result=await invoke('POST');assert.equal(result.status,503);assert.equal(result.body.code,'ORDERS_NOT_OPEN');
 Object.assign(process.env,{STLO_CHECKOUT_ENABLED:'true',STLO_CHECKOUT_ENV:'staging',SUPABASE_URL:'https://fszkypwovpdthqfobxrk.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'local-test-only',STLO_STOREFRONT_GATEWAY_SECRET:'x'.repeat(40)});
 result=await invoke('POST',{}, {'x-stlolab-gateway-secret':'wrong'});assert.equal(result.status,401);
 result=await invoke('POST',{idempotencyKey:'ABCDEFGHIJKLMNOP',confirmationToken:'x'.repeat(64)}, {'x-stlolab-gateway-secret':'x'.repeat(40)});assert.equal(result.status,400);assert.equal(result.body.code,'INVALID_CHECKOUT_SECURITY');
 process.env.STLO_CHECKOUT_ENABLED='false';result=await invoke('POST',{}, {'x-stlolab-gateway-secret':'x'.repeat(40)},'confirmation');assert.equal(result.status,400);assert.equal(result.body.code,'INVALID_CONFIRMATION_ACCESS');process.env.STLO_CHECKOUT_ENABLED='true';
 const migration=readFileSync('supabase/migrations/20260911110045_stlolab_sw3_checkout_foundation.sql','utf8');
 assert.match(migration,/revoke all on function trry_api\.create_stlolab_order_sw3[\s\S]+from public, anon, authenticated/);
 assert.match(migration,/grant execute on function trry_api\.create_stlolab_order_sw3[\s\S]+to service_role/);
 assert.match(migration,/source_type = 'STLOLAB_RETAIL'/);assert.match(migration,/inventory_policy = 'UNCONFIRMED'/);
 const reservations=readFileSync('supabase/migrations/20260911113647_stlolab_sw3_inventory_reservations.sql','utf8');
 assert.match(reservations,/RESERVE_ON_SUBMIT/);assert.match(reservations,/would consume reserved inventory/);assert.doesNotMatch(reservations,/DEDUCT_ON_SUBMIT/);
 const lifecycle=readFileSync('supabase/migrations/20260911130719_stlolab_sw3_fulfillment_lifecycle.sql','utf8');
 assert.match(lifecycle,/interval '72 hours'/);assert.match(lifecycle,/payment_state = 'UNPAID'/);
 assert.match(lifecycle,/fulfillment_state = 'PENDING'/);assert.match(lifecycle,/COURIER_HANDOVER/);
 assert.match(lifecycle,/private\.m2b_apply_stock_movement/);assert.match(lifecycle,/EXPLICIT_BARANGAYS/);
 assert.doesNotMatch(lifecycle,/DEDUCT_ON_SUBMIT/);assert.doesNotMatch(lifecycle,/'PAYMENT_FAILED'|'RETURNED'|'REFUNDED'/);
 const access=readFileSync('supabase/migrations/20260917034542_stlolab_order_access_lifecycle.sql','utf8');
 assert.match(access,/confirmation_token_expires_at > clock_timestamp\(\)/);
 assert.match(access,/confirmation_token_revoked_at is null/);
 assert.match(access,/durable confirmation access is required for new STLOLAB orders/);
 assert.match(access,/grant execute on function trry_api\.create_stlolab_order_sw3\(text,text,text,text,jsonb,jsonb,jsonb,timestamptz\) to service_role/);
 assert.doesNotMatch(access,/grant .* to (anon|authenticated|public)/i);
 console.log('PASS STLOLAB checkout route is fail-closed, gateway-authenticated, and service-role-only');
}finally{process.env=original;}

async function invoke(method,body={},headers={},action='create'){const request=Readable.from([JSON.stringify(body)]);request.method=method;request.headers=headers;const response={statusCode:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(raw=''){this.raw=raw;}};await handler(request,response,action);return {status:response.statusCode,body:response.raw?JSON.parse(response.raw):null};}
