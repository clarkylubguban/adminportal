import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import handler from '../api/_lib/stlolabCheckoutRoute.js';

const original={...process.env};
try{
 let result=await invoke('GET');assert.equal(result.status,405);
 delete process.env.STLO_CHECKOUT_ENABLED;result=await invoke('POST');assert.equal(result.status,503);assert.equal(result.body.code,'ORDERS_NOT_OPEN');
 Object.assign(process.env,{STLO_CHECKOUT_ENABLED:'true',STLO_CHECKOUT_ENV:'staging',SUPABASE_URL:'https://fszkypwovpdthqfobxrk.supabase.co',STLO_STOREFRONT_GATEWAY_SECRET:'x'.repeat(40)});
 result=await invoke('POST',{}, {'x-stlolab-gateway-secret':'wrong'});assert.equal(result.status,401);
 const migration=readFileSync('supabase/migrations/20260911110045_stlolab_sw3_checkout_foundation.sql','utf8');
 assert.match(migration,/revoke all on function trry_api\.create_stlolab_order_sw3[\s\S]+from public, anon, authenticated/);
 assert.match(migration,/grant execute on function trry_api\.create_stlolab_order_sw3[\s\S]+to service_role/);
 assert.match(migration,/source_type = 'STLOLAB_RETAIL'/);assert.match(migration,/inventory_policy = 'UNCONFIRMED'/);
 const reservations=readFileSync('supabase/migrations/20260911113647_stlolab_sw3_inventory_reservations.sql','utf8');
 assert.match(reservations,/RESERVE_ON_SUBMIT/);assert.match(reservations,/would consume reserved inventory/);assert.doesNotMatch(reservations,/DEDUCT_ON_SUBMIT/);
 console.log('PASS STLOLAB checkout route is fail-closed, gateway-authenticated, and service-role-only');
}finally{process.env=original;}

async function invoke(method,body={},headers={}){const request=Readable.from([JSON.stringify(body)]);request.method=method;request.headers=headers;const response={statusCode:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(raw=''){this.raw=raw;}};await handler(request,response);return {status:response.statusCode,body:response.raw?JSON.parse(response.raw):null};}
