import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { buildOpsWorkflowUpdates } from "../api/_lib/opsWorkflow.js";
import {
  buildOrderSnapshot,
  convertInquiryToNativeOrder,
  generateOrderReference,
  ORDER_STATUS_AWAITING_PAYMENT,
  readNativeOrderById,
  readNativeOrderByReference,
  readNativeOrderBySourceInquiryId,
} from "../api/_lib/nativeOrders.js";

const APPROVED_INQUIRY = {
  id: "TRY-ORDER-001",
  customer_name: "Approved Customer",
  contact: "0917-000-0000",
  product: "DTF Print",
  product_desc: "Customer-supplied shirts with DTF logo",
  quantity: "24 pcs",
  fulfillment_method: "pickup",
  due_date: "2026-08-20",
  quote_status: "approved",
  quoted_amount: 2400,
  amount_due: 2400,
  quote_breakdown: "24 pcs | PHP 100",
  quote_notes: "Approved quote note",
  quote_valid_until: "2026-08-31",
  quote_approved_at: "2026-08-08T03:00:00.000Z",
  artwork_status: "approved",
  artwork_revision_request: null,
  blocked_reason: null,
  odoo_so: "",
};

const reference = generateOrderReference(() => Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]));
assert.equal(reference, "TRRY-ORD-ABCDEFGH");

const snapshot = buildOrderSnapshot(APPROVED_INQUIRY);
assert.deepEqual(snapshot, {
  source_inquiry_id: "TRY-ORDER-001",
  status: ORDER_STATUS_AWAITING_PAYMENT,
  quoted_amount: 2400,
  amount_due: 2400,
  quote_breakdown: "24 pcs | PHP 100",
  quote_note: "Approved quote note",
  quote_valid_until: "2026-08-31",
  quote_approved_at: "2026-08-08T03:00:00.000Z",
  customer_name: "Approved Customer",
  customer_contact: "0917-000-0000",
  product: "DTF Print",
  product_desc: "Customer-supplied shirts with DTF logo",
  quantity: "24 pcs",
  fulfillment_method: "pickup",
  due_date: "2026-08-20",
});

const calls = [];
const supabase = fakeSupabase({ inquiries: [APPROVED_INQUIRY], calls });
const first = await convertInquiryToNativeOrder(supabase, APPROVED_INQUIRY.id, {
  randomBytes: () => Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]),
});
assert.equal(first.created, true);
assert.equal(first.order.orderReference, "TRRY-ORD-ABCDEFGH");
assert.equal(first.order.sourceInquiryId, APPROVED_INQUIRY.id);
assert.equal(first.order.status, ORDER_STATUS_AWAITING_PAYMENT);
assert.ok(first.order.id, "native order id is required");
assert.equal(first.order.customerName, "Approved Customer");
assert.equal(first.order.quoteNote, "Approved quote note");
assert.equal(calls.filter((call) => call.table === "orders" && call.action === "insert").length, 1);

const second = await convertInquiryToNativeOrder(supabase, APPROVED_INQUIRY.id, {
  randomBytes: () => Uint8Array.from([8, 9, 10, 11, 12, 13, 14, 15]),
});
assert.equal(second.created, false);
assert.equal(second.order.id, first.order.id);
assert.equal(calls.filter((call) => call.table === "orders" && call.action === "insert").length, 1);
assert.equal(await countOrdersBySource(supabase, APPROVED_INQUIRY.id), 1);

assert.equal((await readNativeOrderById(supabase, first.order.id))?.id, first.order.id);
assert.equal((await readNativeOrderByReference(supabase, first.order.orderReference))?.id, first.order.id);
assert.equal((await readNativeOrderBySourceInquiryId(supabase, APPROVED_INQUIRY.id))?.id, first.order.id);

await assertRejectsNativeOrder(
  convertInquiryToNativeOrder(fakeSupabase({ inquiries: [{ ...APPROVED_INQUIRY, id: "TRY-ORDER-002", quote_status: "ready" }] }), "TRY-ORDER-002"),
  400,
  "QUOTE_NOT_APPROVED"
);

await assertRejectsNativeOrder(
  convertInquiryToNativeOrder(fakeSupabase({ inquiries: [{ ...APPROVED_INQUIRY, id: "TRY-NO-PRODUCT", product: "", product_desc: "" }] }), "TRY-NO-PRODUCT"),
  400,
  "PRODUCT_REQUIRED"
);

await assertRejectsNativeOrder(
  convertInquiryToNativeOrder(fakeSupabase({ inquiries: [{ ...APPROVED_INQUIRY, id: "TRY-NO-QTY", quantity: "" }] }), "TRY-NO-QTY"),
  400,
  "QUANTITY_REQUIRED"
);

await assertRejectsNativeOrder(
  convertInquiryToNativeOrder(fakeSupabase({ inquiries: [{ ...APPROVED_INQUIRY, id: "TRY-NO-ART", artwork_status: "submitted" }] }), "TRY-NO-ART"),
  400,
  "ARTWORK_NOT_APPROVED"
);

await assertRejectsNativeOrder(
  convertInquiryToNativeOrder(fakeSupabase({ inquiries: [{ ...APPROVED_INQUIRY, id: "TRY-NO-DUE", due_date: null }] }), "TRY-NO-DUE"),
  400,
  "DUE_DATE_REQUIRED"
);

await assertRejectsNativeOrder(
  convertInquiryToNativeOrder(fakeSupabase({ inquiries: [{ ...APPROVED_INQUIRY, id: "TRY-BLOCKED", blocked_reason: "Revision unresolved" }] }), "TRY-BLOCKED"),
  400,
  "INQUIRY_BLOCKED"
);

await assertRejectsNativeOrder(
  convertInquiryToNativeOrder(fakeSupabase({ inquiries: [] }), "TRY-MISSING"),
  404,
  "INQUIRY_NOT_FOUND"
);

const noOdoo = await convertInquiryToNativeOrder(fakeSupabase({ inquiries: [{ ...APPROVED_INQUIRY, id: "TRY-NO-ODOO", odoo_so: "" }] }), "TRY-NO-ODOO", {
  randomBytes: () => Uint8Array.from([1, 1, 1, 1, 1, 1, 1, 1]),
});
assert.equal(noOdoo.created, true);
assert.equal(noOdoo.order.sourceInquiryId, "TRY-NO-ODOO");
assert.equal(Object.prototype.hasOwnProperty.call(noOdoo.order, "odooSO"), false);

const raced = await convertInquiryToNativeOrder(fakeSupabase({
  inquiries: [{ ...APPROVED_INQUIRY, id: "TRY-RACE" }],
  duplicateOnInsert: "source",
  seededOrders: [{
    id: "96000000-0000-4000-8000-000000000099",
    order_reference: "TRRY-ORD-RACE0001",
    source_inquiry_id: "TRY-RACE",
    status: ORDER_STATUS_AWAITING_PAYMENT,
  }],
}), "TRY-RACE");
assert.equal(raced.created, false);
assert.equal(raced.order.orderReference, "TRRY-ORD-RACE0001");

const legacy = buildOpsWorkflowUpdates("confirm_order", { odooSO: "SO-KEEP" }, {
  status: "sent",
  quote_status: "approved",
  quoted_amount: 1000,
});
assert.equal(legacy.ok, false, "legacy confirm_order is not an active workflow action");
assert.equal(legacy.error, "invalid workflow action");

const paymentSource = await readFileText("api/_lib/paymentConfirmation.js");
assert.ok(paymentSource.includes("payment_history"), "payment confirmation contract should remain present");
const workflowSource = await readFileText("api/_lib/opsWorkflow.js");
assert.ok(workflowSource.includes("advance_production"), "production workflow contract should remain present");

const api = await invokeOrdersApi({
  supabase: fakeSupabase({ inquiries: [{ ...APPROVED_INQUIRY, id: "TRY-API-001" }] }),
  actor: { role: "staff" },
  path: "/api/inquiries/TRY-API-001/orders",
});
assert.equal(api.status, 201);
assert.equal(api.body.order.sourceInquiryId, "TRY-API-001");

console.log("PASS Native Order foundation contracts, idempotency, Odoo independence, and legacy safety");

async function assertRejectsNativeOrder(promise, status, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}

async function invokeOrdersApi({ supabase, actor, path }) {
  const { handleWorkflowRequest } = await import("../api/inquiries/[id]/workflow.js");
  const request = Readable.from(["{}"]);
  request.method = "POST";
  request.url = path;
  request.headers = { host: "localhost", authorization: "Bearer synthetic" };
  const response = createResponse();
  await handleWorkflowRequest(request, response, {
    supabase,
    adminUser: { role: actor.role },
  });
  return response.result();
}

async function readFileText(path) {
  const { readFile } = await import("node:fs/promises");
  return readFile(path, "utf8");
}

async function countOrdersBySource(supabase, sourceInquiryId) {
  return supabase._orders.filter((order) => order.source_inquiry_id === sourceInquiryId).length;
}

function fakeSupabase({ inquiries = [], seededOrders = [], calls = [], duplicateOnInsert = "" } = {}) {
  let insertCount = 0;
  const state = {
    inquiries: inquiries.map((inquiry) => ({ ...inquiry })),
    orders: seededOrders.map((order) => ({ ...order })),
  };
  const supabase = {
    _orders: state.orders,
    auth: {
      async getUser() {
        return { data: { user: { id: "96000000-0000-4000-8000-000000000001" } }, error: null };
      },
    },
    from(table) {
      const query = { table, filters: {}, action: "select", row: null };
      const builder = {
        select() { return builder; },
        eq(key, value) { query.filters[key] = value; return builder; },
        insert(row) { query.action = "insert"; query.row = row; calls.push({ table, action: "insert", row }); return builder; },
        async maybeSingle() {
          const rows = rowsFor(query);
          return { data: rows[0] || null, error: null };
        },
        async single() {
          if (query.action === "insert" && table === "orders") {
            insertCount += 1;
            if (duplicateOnInsert === "source" && insertCount === 1) {
              return { data: null, error: { code: "23505", message: "duplicate", details: "orders_source_inquiry_id_key" } };
            }
            if (state.orders.some((order) => order.source_inquiry_id === query.row.source_inquiry_id)) {
              return { data: null, error: { code: "23505", message: "duplicate", details: "orders_source_inquiry_id_key" } };
            }
            if (state.orders.some((order) => order.order_reference === query.row.order_reference)) {
              return { data: null, error: { code: "23505", message: "duplicate", details: "orders_order_reference_key" } };
            }
            const row = {
              id: `96000000-0000-4000-8000-${String(state.orders.length + 1).padStart(12, "0")}`,
              created_at: "2026-08-08T04:00:00.000Z",
              updated_at: "2026-08-08T04:00:00.000Z",
              ...query.row,
            };
            state.orders.push(row);
            return { data: row, error: null };
          }
          const rows = rowsFor(query);
          return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: "not found" } };
        },
      };
      return builder;
    },
  };
  return supabase;

  function rowsFor(query) {
    if (query.table === "ops_inquiries") return filterRows(state.inquiries, query.filters);
    if (query.table === "orders") return filterRows(state.orders, query.filters);
    if (query.table === "admin_users") return filterRows([supabase.adminUser || { user_id: "96000000-0000-4000-8000-000000000001", role: "staff", is_active: true }], query.filters);
    return [];
  }
}

function filterRows(rows, filters) {
  return rows.filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value));
}

function createResponse() {
  const response = {
    statusCode: 200,
    headers: {},
    setHeader(key, value) { response.headers[key.toLowerCase()] = value; },
    end(payload = "") { response.payload = payload; },
    result() {
      return {
        status: response.statusCode,
        headers: response.headers,
        body: response.payload ? JSON.parse(response.payload) : null,
      };
    },
  };
  return response;
}
