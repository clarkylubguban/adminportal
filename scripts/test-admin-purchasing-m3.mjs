import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  M3_RECEIVABLE_PURCHASE_ORDER_STATUSES,
  PURCHASE_ORDER_RECEIPTS_TABLE,
  PURCHASE_ORDER_RECEIPT_LINES_TABLE,
  RECEIVE_PURCHASE_ORDER_RPC,
  canReceivePurchaseOrdersForRole,
  createPurchaseOrderReceiptIdempotencyKey,
  receivePurchaseOrder,
  validatePurchaseOrderReceipt,
} from "../src/services/adminPurchasing.js";

const index = await readFile("index.html", "utf8");
const main = await readFile("src/main.js", "utf8");
const extension = await readFile("src/purchasingReceivingM3.js", "utf8");
const extensionStyles = await readFile("src/purchasingReceivingM3.css", "utf8");
const service = await readFile("src/services/adminPurchasing.js", "utf8");
const migration = await readFile("supabase/migrations/202608240003_add_purchase_order_receiving_m3.sql", "utf8");

assert.ok(index.includes('/src/purchasingReceivingM3.css'), "M3 receiving stylesheet must load");
assert.ok(index.includes('/src/purchasingReceivingM3.js'), "M3 receiving enhancement must load");
assert.ok(main.includes("data-receive-stock-parked"), "M2 parked receive controls must remain the enhancement anchor");
assert.ok(extension.includes("data-m3-receive-form") && extension.includes("Confirm Receive"), "Manual Receive Stock drawer missing");
assert.ok(extension.includes("Receiving 0 pcs across 0 SKUs") && extension.includes("data-m3-receive-summary"), "Receive confirmation summary missing");
assert.ok(extension.includes("Receiving History"), "Receiving History UI missing");
assert.ok(extension.includes("<th>Received By</th>") && extension.includes("receivedByUserId"), "Receiving History must show Received By");
assert.ok(extension.includes("MANUAL QUANTITY · M3"), "M3 must stay manual quantity first");
assert.ok(extension.includes("Barcode / scanner stays outside M3."), "Barcode boundary must remain explicit");
assert.ok(extension.includes("Received Now must be a whole number") && extension.includes("Received Now cannot be negative"), "Received Now validation must reject fractional/negative quantities");
assert.equal(/barcode_value|CODE128|XPrinter|XP-236B/i.test(service), false, "Barcode implementation must not leak into M3 service");
assert.ok(extensionStyles.includes(".m3-receive-drawer") && extensionStyles.includes(".m3-history-modal"), "M3 responsive surfaces missing");

assert.equal(PURCHASE_ORDER_RECEIPTS_TABLE, "purchase_order_receipts", "Receipt table changed");
assert.equal(PURCHASE_ORDER_RECEIPT_LINES_TABLE, "purchase_order_receipt_lines", "Receipt lines table changed");
assert.equal(RECEIVE_PURCHASE_ORDER_RPC, "receive_purchase_order", "Receive PO RPC changed");
assert.deepEqual(M3_RECEIVABLE_PURCHASE_ORDER_STATUSES, ["ORDERED", "PARTIALLY_RECEIVED"], "M3 receivable statuses changed");
assert.equal(canReceivePurchaseOrdersForRole("owner"), true, "Owner must receive POs");
assert.equal(canReceivePurchaseOrdersForRole("admin"), true, "Admin must receive POs");
assert.equal(canReceivePurchaseOrdersForRole("staff"), false, "Staff remains read-only for M3 receiving");

const order = {
  id: "po-a",
  status: "ORDERED",
  lines: [
    { id: "line-a", orderedQuantity: 10, receivedQuantity: 2, remainingQuantity: 8 },
    { id: "line-b", orderedQuantity: 5, receivedQuantity: 0, remainingQuantity: 5 },
  ],
};
assert.equal(validatePurchaseOrderReceipt(order, { purchaseOrderId: "po-a", locationId: "loc-a", lines: [] }), "Enter a receive quantity for at least one PO line.", "Empty receipt must fail");
assert.equal(validatePurchaseOrderReceipt(order, { purchaseOrderId: "po-a", locationId: "loc-a", lines: [{ purchaseOrderLineId: "line-a", quantity: 9 }] }), "Line 1: receive quantity cannot exceed 8 remaining.", "Over-receipt must fail");
assert.equal(validatePurchaseOrderReceipt(order, { purchaseOrderId: "po-a", locationId: "loc-a", lines: [{ purchaseOrderLineId: "line-a", quantity: 8 }] }), "", "Valid remaining receipt must pass");
assert.equal(validatePurchaseOrderReceipt({ ...order, status: "RECEIVED" }, { purchaseOrderId: "po-a", locationId: "loc-a", lines: [{ purchaseOrderLineId: "line-b", quantity: 1 }] }), "Only Ordered or Partially Received purchase orders can receive stock.", "Received PO must reject further receiving");

const keyA = createPurchaseOrderReceiptIdempotencyKey();
const keyB = createPurchaseOrderReceiptIdempotencyKey();
assert.ok(keyA.startsWith("admin-purchasing-po-receive-"), "M3 idempotency prefix missing");
assert.notEqual(keyA, keyB, "M3 idempotency keys must be unique");

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
globalThis.window = {
  TRRY_ADMIN_ENV: {
    VITE_USE_SUPABASE_DATA: "true",
    VITE_SUPABASE_URL: "https://example.supabase.co",
    VITE_SUPABASE_ANON_KEY: "test-anon-key",
  },
};
let rpcRequest = null;
globalThis.fetch = async (url, options = {}) => {
  rpcRequest = { url: String(url), options };
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        purchase_order: {
          id: "po-a",
          po_number: "PO-2026-0001",
          supplier_id: "supplier-a",
          status: "PARTIALLY_RECEIVED",
          order_date: "2026-08-24",
          freight_cost: 0,
          ordered_at: "2026-08-24T01:00:00Z",
        },
        supplier: { id: "supplier-a", name: "Supplier A", supplier_reference: "SUP-A" },
        lines: [
          { id: "line-a", purchase_order_id: "po-a", product_id: "prod-a", variant_id: "var-a", product_name_snapshot: "Shirt", sku_snapshot: "SKU-A", ordered_quantity: 10, received_quantity: 5, unit_cost: 100, last_received_at: "2026-08-24T09:00:00Z", created_at: "2026-08-24T00:00:00Z" },
          { id: "line-b", purchase_order_id: "po-a", product_id: "prod-b", variant_id: "var-b", product_name_snapshot: "Cap", sku_snapshot: "SKU-B", ordered_quantity: 5, received_quantity: 0, unit_cost: 80, created_at: "2026-08-24T00:00:01Z" },
        ],
        receipt: {
          id: "receipt-a",
          receipt_number: "RCV-2026-0001",
          purchase_order_id: "po-a",
          location_id: "loc-a",
          reference: "DR-100",
          note: "partial delivery",
          idempotency_key: "m3-test-key",
          received_at: "2026-08-24T09:00:00Z",
        },
        receipt_lines: [
          { id: "receipt-line-a", receipt_id: "receipt-a", purchase_order_line_id: "line-a", variant_id: "var-a", quantity: 3, unit_cost: 100, received_at: "2026-08-24T09:00:00Z" },
        ],
      });
    },
  };
};

const saved = await receivePurchaseOrder({
  purchaseOrderId: "po-a",
  locationId: "loc-a",
  lines: [{ purchaseOrderLineId: "line-a", quantity: 3 }],
  idempotencyKey: "m3-test-key",
  reference: "DR-100",
  note: "partial delivery",
}, { access_token: "owner-token" });

globalThis.fetch = originalFetch;
globalThis.window = originalWindow;

assert.ok(rpcRequest, "Receive PO RPC request was not sent");
assert.ok(rpcRequest.url.endsWith(`/rest/v1/rpc/${RECEIVE_PURCHASE_ORDER_RPC}`), "Receive PO must use public RPC route");
assert.deepEqual(JSON.parse(rpcRequest.options.body), {
  p_purchase_order_id: "po-a",
  p_location_id: "loc-a",
  p_lines: [{ purchase_order_line_id: "line-a", quantity: 3 }],
  p_idempotency_key: "m3-test-key",
  p_reference: "DR-100",
  p_note: "partial delivery",
}, "Receive PO RPC payload changed");
assert.equal(saved.status, "PARTIALLY_RECEIVED", "RPC result must map partial status");
assert.equal(saved.receivedUnits, 5, "Received unit mapping changed");
assert.equal(saved.remainingUnits, 10, "Remaining unit mapping changed");
assert.equal(saved.lines[0].receivedQuantity, 5, "Line received quantity mapping changed");
assert.equal(saved.lines[0].remainingQuantity, 5, "Line remaining quantity mapping changed");
assert.equal(saved.receipts[0].receiptNumber, "RCV-2026-0001", "Receipt number mapping changed");

globalThis.window = {
  TRRY_ADMIN_ENV: {
    VITE_USE_SUPABASE_DATA: "true",
    VITE_SUPABASE_URL: "https://example.supabase.co",
    VITE_SUPABASE_ANON_KEY: "test-anon-key",
  },
};
const walkthroughRequests = [];
let walkthroughResponseIndex = 0;
const walkthroughResponses = [
  makeWalkthroughReceiveResponse({
    status: "PARTIALLY_RECEIVED",
    receiptNumber: "RCV-2026-0101",
    received: [10, 10, 20],
    receiptQuantities: [10, 10, 20],
  }),
  makeWalkthroughReceiveResponse({
    status: "RECEIVED",
    receiptNumber: "RCV-2026-0102",
    received: [40, 30, 50],
    receiptQuantities: [30, 20, 30],
  }),
  makeWalkthroughReceiveResponse({
    status: "RECEIVED",
    receiptNumber: "RCV-2026-0102",
    received: [40, 30, 50],
    receiptQuantities: [30, 20, 30],
    idempotentReplay: true,
  }),
];
globalThis.fetch = async (url, options = {}) => {
  walkthroughRequests.push({ url: String(url), body: JSON.parse(options.body || "{}") });
  const payload = walkthroughResponses[Math.min(walkthroughResponseIndex, walkthroughResponses.length - 1)];
  walkthroughResponseIndex += 1;
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(payload);
    },
  };
};

const walkthroughOrder = {
  id: "po-test",
  status: "ORDERED",
  lines: [
    { id: "line-a", orderedQuantity: 40, receivedQuantity: 0, remainingQuantity: 40 },
    { id: "line-b", orderedQuantity: 30, receivedQuantity: 0, remainingQuantity: 30 },
    { id: "line-c", orderedQuantity: 50, receivedQuantity: 0, remainingQuantity: 50 },
  ],
};
assert.equal(validatePurchaseOrderReceipt(walkthroughOrder, { purchaseOrderId: "po-test", locationId: "loc-a", lines: [] }), "Enter a receive quantity for at least one PO line.", "Zero receive must be blocked");
assert.equal(validatePurchaseOrderReceipt(walkthroughOrder, { purchaseOrderId: "po-test", locationId: "loc-a", lines: [{ purchaseOrderLineId: "line-a", quantity: 41 }] }), "Line 1: receive quantity cannot exceed 40 remaining.", "Over-receive must be blocked");
assert.equal(validatePurchaseOrderReceipt({ ...walkthroughOrder, status: "DRAFT" }, { purchaseOrderId: "po-test", locationId: "loc-a", lines: [{ purchaseOrderLineId: "line-a", quantity: 1 }] }), "Only Ordered or Partially Received purchase orders can receive stock.", "Draft PO receive must be blocked");
assert.equal(validatePurchaseOrderReceipt({ ...walkthroughOrder, status: "RECEIVED" }, { purchaseOrderId: "po-test", locationId: "loc-a", lines: [{ purchaseOrderLineId: "line-a", quantity: 1 }] }), "Only Ordered or Partially Received purchase orders can receive stock.", "Fully Received PO receive must be blocked");

const firstReceipt = await receivePurchaseOrder({
  purchaseOrderId: "po-test",
  locationId: "loc-a",
  lines: [
    { purchaseOrderLineId: "line-a", quantity: 10 },
    { purchaseOrderLineId: "line-b", quantity: 10 },
    { purchaseOrderLineId: "line-c", quantity: 20 },
  ],
  idempotencyKey: "walkthrough-first",
  reference: "PO-TEST-FIRST",
}, { access_token: "owner-token" });
assert.equal(firstReceipt.orderedUnits, 120, "Walkthrough ordered units must be 120");
assert.equal(firstReceipt.receivedUnits, 40, "First receipt must receive 40 units");
assert.equal(firstReceipt.remainingUnits, 80, "First receipt must leave 80 units");
assert.equal(firstReceipt.status, "PARTIALLY_RECEIVED", "First receipt must partially receive PO");

const secondReceipt = await receivePurchaseOrder({
  purchaseOrderId: "po-test",
  locationId: "loc-a",
  lines: [
    { purchaseOrderLineId: "line-a", quantity: 30 },
    { purchaseOrderLineId: "line-b", quantity: 20 },
    { purchaseOrderLineId: "line-c", quantity: 30 },
  ],
  idempotencyKey: "walkthrough-second",
  reference: "PO-TEST-SECOND",
}, { access_token: "owner-token" });
assert.equal(secondReceipt.receivedUnits, 120, "Second receipt must bring received units to 120");
assert.equal(secondReceipt.remainingUnits, 0, "Second receipt must leave zero units");
assert.equal(secondReceipt.status, "RECEIVED", "Second receipt must complete PO");

const replayReceipt = await receivePurchaseOrder({
  purchaseOrderId: "po-test",
  locationId: "loc-a",
  lines: [
    { purchaseOrderLineId: "line-a", quantity: 30 },
    { purchaseOrderLineId: "line-b", quantity: 20 },
    { purchaseOrderLineId: "line-c", quantity: 30 },
  ],
  idempotencyKey: "walkthrough-second",
  reference: "PO-TEST-SECOND",
}, { access_token: "owner-token" });
assert.equal(replayReceipt.receivedUnits, 120, "Idempotent replay must not add extra received units");
assert.equal(walkthroughRequests[0].body.p_lines.reduce((sum, line) => sum + line.quantity, 0), 40, "First receipt inventory post quantity must be A10+B10+C20");
assert.equal(walkthroughRequests[1].body.p_lines.reduce((sum, line) => sum + line.quantity, 0), 80, "Second receipt inventory post quantity must be A30+B20+C30");

globalThis.fetch = originalFetch;
globalThis.window = originalWindow;

for (const token of [
  "add column if not exists received_quantity",
  "create table if not exists public.purchase_order_receipts",
  "create table if not exists public.purchase_order_receipt_lines",
  "create or replace function public.receive_purchase_order",
  "set search_path = ''",
  "for update",
  "perform trry_api.receive_inventory",
  "received_quantity = received_quantity + v_qty",
  "'RECEIVED' else 'PARTIALLY_RECEIVED'",
  "idempotency_key text not null unique",
  "pg_catalog.pg_advisory_xact_lock",
  "public.is_active_admin_user(array['owner','admin'])",
  "revoke execute on function public.receive_purchase_order(uuid,uuid,jsonb,text,text,text) from public",
  "grant execute on function public.receive_purchase_order(uuid,uuid,jsonb,text,text,text) to authenticated",
]) {
  assert.ok(migration.includes(token), `M3 migration contract missing: ${token}`);
}
assert.equal(migration.includes("update public.inventory_balances"), false, "M3 must not bypass canonical inventory RPC");
assert.equal(migration.includes("insert into public.stock_movements"), false, "M3 must not manually write stock movements");
assert.ok(migration.includes("idempotent_replay"), "M3 must return idempotent replays without posting stock twice");

process.stdout.write("PASS Admin Purchasing M3 manual receiving, atomic inventory posting, partial/full status, history, permissions, and idempotency\n");

function makeWalkthroughReceiveResponse({ status, receiptNumber, received, receiptQuantities, idempotentReplay = false }) {
  const ordered = [40, 30, 50];
  return {
    purchase_order: {
      id: "po-test",
      po_number: "PO-TEST",
      supplier_id: "supplier-a",
      status,
      order_date: "2026-08-24",
      freight_cost: 0,
      ordered_at: "2026-08-24T01:00:00Z",
    },
    supplier: { id: "supplier-a", name: "Supplier A", supplier_reference: "SUP-A" },
    lines: ordered.map((quantity, index) => ({
      id: `line-${String.fromCharCode(97 + index)}`,
      purchase_order_id: "po-test",
      product_id: `prod-${String.fromCharCode(97 + index)}`,
      variant_id: `var-${String.fromCharCode(97 + index)}`,
      product_name_snapshot: `Variant ${String.fromCharCode(65 + index)}`,
      sku_snapshot: `SKU-${String.fromCharCode(65 + index)}`,
      ordered_quantity: quantity,
      received_quantity: received[index],
      unit_cost: 10,
      last_received_at: "2026-08-24T09:00:00Z",
      created_at: `2026-08-24T00:00:0${index}Z`,
    })),
    receipt: {
      id: receiptNumber.toLowerCase(),
      receipt_number: receiptNumber,
      purchase_order_id: "po-test",
      location_id: "loc-a",
      reference: receiptNumber,
      idempotency_key: receiptNumber,
      received_by_user_id: "owner-a",
      received_at: "2026-08-24T09:00:00Z",
    },
    receipt_lines: receiptQuantities.map((quantity, index) => ({
      id: `${receiptNumber.toLowerCase()}-${index}`,
      receipt_id: receiptNumber.toLowerCase(),
      purchase_order_line_id: `line-${String.fromCharCode(97 + index)}`,
      variant_id: `var-${String.fromCharCode(97 + index)}`,
      quantity,
      unit_cost: 10,
      received_at: "2026-08-24T09:00:00Z",
    })),
    idempotent_replay: idempotentReplay,
  };
}
