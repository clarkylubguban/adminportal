import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import handler, { buildOperation } from "../api/_lib/adminOrderActionsRoute.js";

const ORDER_ID = "96000000-0000-4000-8000-000000000777";
const OWNER = { userId: "96000000-0000-4000-8000-000000000001", role: "owner" };

const canonicalItems = [{
  id: "96000000-0000-4000-8000-000000000778",
  productName: "Glow N Underground",
  color: "Black",
  size: "M",
  quantity: 1,
  unitPrice: 790,
  lineTotal: 790,
}];
const read = await invoke({
  method: "GET",
  caller: { role: "staff" },
  access: { allowed: true, source: "temporary" },
  readDetails: async () => ({ id: ORDER_ID, sourceType: "STLOLAB_RETAIL", fulfillmentState: "PENDING", items: canonicalItems }),
});
assert.equal(read.status, 200);
assert.deepEqual(read.body.order.items, canonicalItems);
assert.equal((await invoke({ method: "GET", caller: { role: "staff" }, access: { allowed: false } })).status, 403);
assert.equal((await invoke({ method: "DELETE" })).status, 405);
assert.equal((await invoke({ headers: {} })).status, 401);
assert.equal((await invoke({ caller: { role: "staff" } })).status, 403);

const missingReference = await invoke({
  body: paymentBody({ paymentReference: "" }),
  caller: OWNER,
});
assert.equal(missingReference.status, 400);
assert.match(missingReference.body.error, /reference/);

let saved = null;
let rpcCalls = 0;
const actorClient = fakeActorClient(async (functionName, parameters) => {
  rpcCalls += 1;
  assert.equal(functionName, "confirm_stlolab_order_payment_sw3");
  assert.equal(parameters.p_order_id, ORDER_ID);
  assert.equal(parameters.p_amount, 790);
  assert.equal(parameters.p_payment_reference, "GCASH-TEST-001");
  assert.equal(parameters.p_payment_method, "gcash");
  assert.equal(Object.hasOwn(parameters, "paymentState"), false, "browser payment-state claims are not forwarded");
  if (!saved) saved = { ...parameters };
  assert.deepEqual(parameters, saved);
  return { data: { orderId: ORDER_ID, paymentState: "PAID", idempotent: rpcCalls > 1 }, error: null };
});

const first = await invoke({ body: paymentBody({ paymentState: "PAID" }), caller: OWNER, actorClient });
const duplicate = await invoke({ body: paymentBody({ paymentState: "UNPAID" }), caller: OWNER, actorClient });
assert.equal(first.status, 200);
assert.equal(first.body.transition.idempotent, false);
assert.equal(duplicate.status, 200);
assert.equal(duplicate.body.transition.idempotent, true);
assert.equal(rpcCalls, 2);

const pickup = buildOperation(ORDER_ID, { action: "customer_pickup", idempotencyKey: "SW3-BATCH-PICKUP-L-HANDOVER-01" });
assert.equal(pickup.functionName, "handover_stlolab_order_sw3");
assert.equal(pickup.parameters.p_handover_kind, "CUSTOMER_PICKUP");
const courier = buildOperation(ORDER_ID, { action: "courier_handover", idempotencyKey: "SW3-BATCH-COD-XL-HANDOVER-01" });
assert.equal(courier.parameters.p_handover_kind, "COURIER_HANDOVER");

const denied = await invoke({
  body: { action: "customer_pickup", idempotencyKey: "DENIEDACTIONKEY01" },
  caller: OWNER,
  actorClient: fakeActorClient(async () => ({ data: null, error: { code: "42501", message: "denied" } })),
});
assert.equal(denied.status, 403);

const conflict = await invoke({
  body: { action: "courier_handover", idempotencyKey: "CONFLICTACTION01" },
  caller: OWNER,
  actorClient: fakeActorClient(async () => ({ data: null, error: { code: "23505", message: "replay conflicts" } })),
});
assert.equal(conflict.status, 409);

let excludedRpcCalls = 0;
const excludedActorClient = fakeActorClient(async () => {
  excludedRpcCalls += 1;
  return { data: {}, error: null };
});
for (const environment of [
  { VITE_APP_ENV: "production", VITE_STLO_ACCEPTANCE_KEYS_ENABLED: "true" },
  { VITE_APP_ENV: "staging", VITE_STLO_ACCEPTANCE_KEYS_ENABLED: "false" },
  { VITE_APP_ENV: "Staging", VITE_STLO_ACCEPTANCE_KEYS_ENABLED: "true" },
]) {
  const excluded = await invoke({ body: paymentBody(), caller: OWNER, actorClient: excludedActorClient, environment });
  assert.equal(excluded.status, 403, "direct acceptance-key requests must be server-excluded outside exact staging configuration");
}
assert.equal(excludedRpcCalls, 0, "excluded acceptance keys must not reach canonical RPCs");
const normalProductionKey = await invoke({
  body: paymentBody({ idempotencyKey: "admin-retail-confirm-payment-00000000" }),
  caller: OWNER,
  actorClient: fakeActorClient(async () => ({ data: { idempotent: false }, error: null })),
  environment: { VITE_APP_ENV: "production", VITE_STLO_ACCEPTANCE_KEYS_ENABLED: "false" },
});
assert.equal(normalProductionKey.status, 200, "normal generated idempotency keys remain unchanged");

const dispatcher = readFileSync("api/assignment-users.js", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
assert.match(dispatcher, /adminOrderActionsHandler/);
assert.ok(vercel.rewrites.some((rule) => rule.source === "/api/orders/:orderId/actions"));
assert.equal(readFileSync("src/main.js", "utf8").includes("paymentState: form.paymentState"), false);

console.log("PASS authenticated STLOLAB Orders handlers reject browser state claims, preserve role checks, and map idempotent payment/handover actions");

async function invoke({ method = "POST", body = {}, headers = { authorization: "Bearer admin-token" }, caller, actorClient, access, readDetails, environment = { VITE_APP_ENV: "staging", VITE_STLO_ACCEPTANCE_KEYS_ENABLED: "true" } } = {}) {
  const request = Readable.from([JSON.stringify(body)]);
  request.method = method;
  request.url = `/api/orders/${ORDER_ID}/actions`;
  request.headers = headers;
  request.query = { orderId: ORDER_ID };
  const response = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(raw = "") { this.raw = raw; },
  };
  await handler(request, response, { caller, identityClient: {}, actorClient, access, readDetails, environment });
  return { status: response.statusCode, body: response.raw ? JSON.parse(response.raw) : null };
}

function paymentBody(overrides = {}) {
  return {
    action: "confirm_payment",
    amountReceived: 790,
    paymentSource: "gcash",
    paymentReference: "GCASH-TEST-001",
    internalNote: "Disposable handler fixture",
    idempotencyKey: "SW3-BATCH-PICKUP-L-PAY-01",
    ...overrides,
  };
}

function fakeActorClient(rpc) {
  return { schema: (schema) => { assert.equal(schema, "trry_api"); return { rpc }; } };
}
