import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createOrderDetailsHandler,
  normalizeOrderDetails,
  ORDER_SELECT_FIELDS,
} from "../api/_lib/orderDetails.js";

const ownerId = "81000000-0000-4000-8000-000000000001";
const adminId = "81000000-0000-4000-8000-000000000002";
const staffId = "81000000-0000-4000-8000-000000000003";
const inactiveId = "81000000-0000-4000-8000-000000000004";
const assignedId = "81000000-0000-4000-8000-000000000005";
const orderId = "QA-ORDER-DRAWER-PHASE-8D1";

const order = {
  id: orderId,
  customer_name: "QA ORDER DRAWER PHASE 8D1",
  company: "Synthetic QA",
  contact: "Synthetic contact",
  source: "QA",
  channel: "synthetic",
  product: "Screen Printing",
  product_desc: "QA Shirt",
  quantity: "12",
  size_breakdown: "S 4 / M 4 / L 4",
  status: "won",
  next_action: "Prepare production handoff",
  due_date: "2026-08-10",
  fulfillment_method: "pickup",
  quoted_amount: 2400,
  amount_due: 2400,
  quote_status: "approved",
  quote_published_at: "2026-07-29T01:00:00Z",
  quote_approved_at: "2026-07-29T02:00:00Z",
  quote_breakdown: "12 shirts",
  quote_notes: "Synthetic quote",
  artwork_status: "approved",
  artwork_url: `${orderId}/qa-artwork.png`,
  artwork_approved_at: "2026-07-29T03:00:00Z",
  payment_status: "full_payment_confirmed",
  payment_method: "cash",
  payment_type: "shop",
  payment_confirmed_amount: 2400,
  payment_confirmed_at: "2026-07-29T04:00:00Z",
  payment_verified_amount: 2400,
  payment_verified_at: "2026-07-29T04:00:00Z",
  payment_verified_by: adminId,
  payment_selected_at: "2026-07-29T03:30:00Z",
  payment_internal_note: "Synthetic QA confirmation",
  owner_user_id: ownerId,
  assigned_user_id: assignedId,
  assigned_staff: "Legacy assignment",
  production_stage: "queued",
  production_note: "Synthetic production note",
  blocked_reason: null,
  created_at: "2026-07-29T00:00:00Z",
  updated_at: "2026-07-29T04:00:00Z",
};

const paymentEvents = [
  {
    event_type: "PAY_AT_SHOP_SELECTED",
    payment_method: null,
    amount: 2400,
    internal_note: null,
    actor_user_id: null,
    actor_role: null,
    source: "CUSTOMER",
    created_at: "2026-07-29T03:30:00Z",
  },
  {
    event_type: "SHOP_PAYMENT_CONFIRMED",
    payment_method: "cash",
    amount: 2400,
    internal_note: "Synthetic QA confirmation",
    actor_user_id: adminId,
    actor_role: "admin",
    source: "ADMIN",
    created_at: "2026-07-29T04:00:00Z",
  },
];

const profiles = [
  { user_id: ownerId, display_name: "Synthetic Owner", role: "owner" },
  { user_id: adminId, display_name: "Synthetic Admin", role: "admin" },
  { user_id: staffId, display_name: "Synthetic Staff", role: "staff" },
  { user_id: assignedId, display_name: "Synthetic Production Staff", role: "staff" },
];

const handler = createOrderDetailsHandler({
  createClient: () => ({}),
  getAuthUser: async (_client, token) => {
    if (token === "invalid") return null;
    return { id: token };
  },
  getPortalProfile: async (_client, userId) => {
    if (userId === inactiveId) return { role: "staff", is_active: false };
    if (userId === ownerId) return { role: "owner", is_active: true };
    if (userId === adminId) return { role: "admin", is_active: true };
    if (userId === staffId) return { role: "staff", is_active: true };
    return { role: "customer", is_active: true };
  },
  getOrder: async (_client, reference) => {
    if (reference === "MISSING-ORDER") return null;
    if (reference === "NOT-CONFIRMED") return { ...order, id: reference, status: "quote" };
    return { ...order, id: reference };
  },
  getPaymentEvents: async () => paymentEvents,
  getFollowUpEvents: async () => [{
    outcome: "customer_replied_action_needed",
    note: "Synthetic follow-up",
    created_by_user_id: staffId,
    created_at: "2026-07-29T01:30:00Z",
  }],
  getDisplayProfiles: async () => profiles,
});

assert.equal((await call(handler, { id: orderId })).status, 401, "anonymous read");
assert.equal(
  (await call(handler, { id: orderId, token: "invalid" })).status,
  401,
  "invalid session",
);
assert.equal(
  (await call(handler, { id: orderId, token: inactiveId })).status,
  403,
  "inactive account",
);
assert.equal(
  (await call(handler, { id: orderId, token: "unauthorized" })).status,
  403,
  "unauthorized role",
);
assert.equal(
  (await call(handler, { id: "MISSING-ORDER", token: ownerId })).status,
  404,
  "missing order",
);
const nonWon = await call(handler, { id: "NOT-CONFIRMED", token: ownerId });
assert.equal(nonWon.status, 404, "non-won inquiry");
assert.equal(nonWon.body.error.code, "ORDER_NOT_CONFIRMED");

for (const [role, token] of [
  ["Owner", ownerId],
  ["Admin", adminId],
  ["Staff", staffId],
]) {
  const result = await call(handler, { id: orderId, token });
  assert.equal(result.status, 200, `${role} valid read`);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.order.id, orderId);
  assert.equal(result.body.order.owner, "Synthetic Owner");
  assert.equal(result.body.order.assignedStaff, "Synthetic Production Staff");
  assert.equal(result.body.order.paymentVerifiedBy, "Synthetic Admin");
  assert.deepEqual(
    result.body.order.paymentEvents.map((event) => event.label),
    ["PAY AT SHOP SELECTED", "SHOP PAYMENT CONFIRMED"],
  );
  assert.ok(
    result.body.order.activity.some((event) => event.label === "FOLLOW-UP: ACTION NEEDED"),
  );
  assert.equal(result.body.order.readiness.ready, true);
  assert.equal(Object.hasOwn(result.body.order, "notes"), false);
  assert.equal(Object.hasOwn(result.body.order, "customerNotes"), false);
  assert.equal(result.body.order.quoteNotes, "Synthetic quote");
  assert.equal(result.body.order.productionNote, "Synthetic production note");
  assert.equal(result.body.order.paymentInternalNote, "Synthetic QA confirmation");
  assertSafeProjection(result.body.order);
  assertNoUndefined(result.body.order);
}

const normalized = normalizeOrderDetails(
  { ...order, assigned_user_id: null, assigned_staff: "", blocked_reason: "Materials unavailable" },
  paymentEvents,
  [],
  profiles,
);
assert.equal(normalized.readiness.ready, false);
assert.deepEqual(
  normalized.readiness.missing,
  ["Production staff assigned", "No active blocker"],
);
assert.equal(normalized.confirmedAt, null, "no invented order-confirmed timestamp");
assert.equal(
  normalized.activity.some((event) => event.label === "TRRY ORDER CONFIRMED"),
  false,
  "no fabricated order-confirmed event",
);
assert.equal(Object.hasOwn(normalized, "notes"), false);
assert.equal(Object.hasOwn(normalized, "customerNotes"), false);

let selectedProductionFields = [];
const productionShapeHandler = createOrderDetailsHandler({
  createClient: () => ({
    from(table) {
      assert.equal(table, "ops_inquiries");
      return {
        select(fields) {
          selectedProductionFields = fields.split(",");
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: { ...order }, error: null };
                },
              };
            },
          };
        },
      };
    },
  }),
  getAuthUser: async () => ({ id: ownerId }),
  getPortalProfile: async () => ({ role: "owner", is_active: true }),
  getPaymentEvents: async () => paymentEvents,
  getFollowUpEvents: async () => [],
  getDisplayProfiles: async () => profiles,
});
const productionShapeRead = await call(productionShapeHandler, {
  id: orderId,
  token: ownerId,
});
assert.equal(productionShapeRead.status, 200, "production-compatible row reads without legacy note columns");
assert.deepEqual(selectedProductionFields, ORDER_SELECT_FIELDS);
assert.equal(selectedProductionFields.includes("notes"), false);
assert.equal(selectedProductionFields.includes("customer_notes"), false);

const rawSchemaMessage = "column ops_inquiries.customer_notes does not exist";
const schemaFailureHandler = createOrderDetailsHandler({
  createClient: () => ({}),
  getAuthUser: async () => ({ id: ownerId }),
  getPortalProfile: async () => ({ role: "owner", is_active: true }),
  getOrder: async () => {
    throw Object.assign(new Error(rawSchemaMessage), { code: "42703" });
  },
});
const originalConsoleError = console.error;
console.error = () => {};
let schemaFailure;
try {
  schemaFailure = await call(schemaFailureHandler, { id: orderId, token: ownerId });
} finally {
  console.error = originalConsoleError;
}
assert.equal(schemaFailure.status, 500);
assert.equal(schemaFailure.body.error.code, "ORDER_DETAILS_FAILED");
assert.equal(JSON.stringify(schemaFailure.body).includes(rawSchemaMessage), false, "raw schema errors stay private");

const apiSource = await readFile("api/_lib/orderDetails.js", "utf8");
const selectBlock = apiSource.match(/ORDER_SELECT_FIELDS = \[([\s\S]*?)\]/)?.[1] || "";
assert.doesNotMatch(selectBlock, /odoo_so/i, "order read has no Odoo dependency");
assert.doesNotMatch(selectBlock, /["']notes["']/i, "legacy notes column is not selected");
assert.doesNotMatch(selectBlock, /customer_notes/i, "legacy customer_notes column is not selected");
assert.doesNotMatch(selectBlock, /auth\\.|encrypted_password|token/i);
const vercelConfig = JSON.parse(await readFile("vercel.json", "utf8"));
assert.ok(
  vercelConfig.rewrites.some((rewrite) => rewrite.source === "/api/orders/:id"
    && rewrite.destination === "/api/inquiries/:id/workflow?_opsAction=order-details"),
  "public Order Details API route shares the existing workflow function",
);

process.stdout.write("PASS Order Details API auth, projection, hydration, and readiness contracts\n");

async function call(target, { id, token = "", method = "GET" }) {
  const request = {
    method,
    query: { id },
    url: `/api/orders/${encodeURIComponent(id)}`,
    headers: token ? { authorization: `Bearer ${token}`, host: "localhost" } : { host: "localhost" },
  };
  const response = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(value) {
      this.value = value;
    },
  };
  await target(request, response);
  return {
    status: response.statusCode,
    body: JSON.parse(response.value),
  };
}

function assertSafeProjection(value) {
  const json = JSON.stringify(value);
  for (const forbidden of [
    ownerId,
    adminId,
    staffId,
    assignedId,
    "encrypted_password",
    "access_token",
    "refresh_token",
    "signedUrl",
    "idempotencyKey",
    "odoo",
  ]) {
    assert.equal(json.includes(forbidden), false, `safe projection excludes ${forbidden}`);
  }
  for (const key of Object.keys(value)) {
    assert.doesNotMatch(key, /userId|auth|token|email/i, `safe top-level key: ${key}`);
  }
}

function assertNoUndefined(value) {
  if (Array.isArray(value)) {
    for (const item of value) assertNoUndefined(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    assert.notEqual(item, undefined, `projection value ${key} is defined`);
    assertNoUndefined(item);
  }
}
