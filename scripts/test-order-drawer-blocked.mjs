import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createMvpDashboard } from "../src/mvpDashboard.js";

global.window = { location: { search: "" }, history: { replaceState() {} }, setTimeout };

const team = [
  { userId: "owner-james", displayName: "James", email: "james@trry.test", role: "owner" },
];

const base = {
  id: "TRY-DRAWER-BASE",
  status: "won",
  quoteStatus: "approved",
  sourceType: "native",
  sourceInquiryId: "TRY-DRAWER-BASE",
  sourceInquiryReference: "TRY-DRAWER-BASE",
  nativeOrderId: "96000000-0000-4000-8000-000000000111",
  orderReference: "TRRY-ORD-DRAWER01",
  customer: "Drawer Customer",
  contact: "+63 917 420 9911",
  source: "Website",
  productDesc: "Premium Tshirt",
  service: "Embroidery",
  qty: "12 pcs",
  sizeBreakdown: "S-2 / M-4 / L-4 / XL-2",
  garmentColor: "Black",
  dueDate: "2026-08-09",
  fulfillmentMethod: "pickup",
  artworkStatus: "approved",
  assignedUserId: "owner-james",
  quotedAmount: 850,
  amountDue: 850,
  updatedAt: "2026-08-01T03:32:00.000Z",
  quoteApprovedAt: "2026-07-31T02:46:00.000Z",
};

const unpaid = { ...base, paymentStatus: "awaiting_payment", paymentMethod: "cash", paymentType: "shop" };
const review = { ...base, id: "TRY-DRAWER-REVIEW", orderReference: "TRRY-ORD-REVIEW02", paymentStatus: "proof_submitted", paymentMethod: "online" };
const blocked = { ...base, id: "TRY-DRAWER-BLOCK", orderReference: "TRRY-ORD-BLOCK02", paymentStatus: "paid", paymentVerifiedAmount: 850, amountDue: 0, blockedReason: "Materials unavailable" };
const ready = { ...base, id: "TRY-DRAWER-READY", orderReference: "TRRY-ORD-READY02", paymentStatus: "paid", paymentVerifiedAmount: 850, paymentConfirmedAmount: 850, amountDue: 0 };
const legacy = { ...base, id: "TRY-DRAWER-LEGACY", sourceType: "legacy", nativeOrderId: "", orderReference: "TRRY-LEGACY-DRAWER", odooSO: "SO-LEGACY-DRAWER", paymentStatus: "paid", paymentVerifiedAmount: 850, amountDue: 0 };

const dashboard = createMvpDashboard({
  getAssignmentContext: () => ({ users: team, loadState: "success", error: "" }),
});

const paymentForm = (item) => `<section class="mvp-drawer-section mvp-payment-confirmation" data-mvp-payment-confirmation="${item.id}">
  <h3>CONFIRM PAYMENT RECEIVED</h3>
  <input data-mvp-payment-field="amountReceived" value="850" />
  <select data-mvp-payment-field="paymentSource"><option value="cash">Cash</option></select>
  <input data-mvp-payment-field="referenceNumber" />
  <textarea data-mvp-payment-field="internalNote"></textarea>
  <p data-mvp-payment-message>Confirm only after staff receives payment at the shop.</p>
  <button data-mvp-confirm-payment="${item.id}">Confirm Payment</button>
</section>`;

function renderSelected(item, tab = "overview") {
  global.window.location.search = `?order=${encodeURIComponent(item.orderReference)}`;
  dashboard.state.orderTab = tab;
  return dashboard.renderOrders({ items: [unpaid, review, blocked, ready, legacy], renderPayment: paymentForm });
}

let html = renderSelected(unpaid);
assert.ok(html.includes("mvp-order-drawer"), "shared Order drawer shell renders");
assert.ok(html.includes("AWAITING PAYMENT"), "unpaid order is awaiting payment");
assert.equal((html.match(/<mark class="payment">AWAITING PAYMENT<\/mark>/g) || []).length, 1, "unpaid drawer status is awaiting payment");
assert.equal((html.match(/<mark class="overdue">BLOCKED<\/mark>/g) || []).length, 0, "unpaid drawer status is not blocked");
assert.ok(html.includes("TRRY-ORD-DRAWER01"), "native order_reference is primary header identity");
assert.ok(html.includes("Drawer Customer"), "customer identity renders");
assert.ok(html.includes("Overview") && html.includes("Requirements") && html.includes("Payment") && html.includes("Fulfillment") && html.includes("History"), "all tabs render");
const tabNav = html.match(/<nav class="mvp-order-drawer-tabs"[\s\S]*?<\/nav>/)?.[0] || "";
assert.ok(tabNav.indexOf("Overview") < tabNav.indexOf("Requirements"), "Overview precedes Requirements");
assert.ok(tabNav.indexOf("Requirements") < tabNav.indexOf("Payment"), "Requirements precedes Payment");
assert.ok(tabNav.indexOf("Payment") < tabNav.indexOf("Fulfillment"), "Payment precedes Fulfillment");
assert.ok(tabNav.indexOf("Fulfillment") < tabNav.indexOf("History"), "Fulfillment precedes History");
assert.ok(html.includes("Premium Tshirt"), "overview shows real product");
assert.ok(html.includes("S-2 / M-4 / L-4 / XL-2"), "overview shows real size breakdown when present");
assert.ok(html.includes("Black"), "overview shows real color when present");

html = renderSelected(unpaid, "requirements");
assert.ok(html.includes("PRODUCTION REQUIREMENTS"), "requirements tab renders");
for (const label of ["Product and quantity", "Due date", "Artwork approved", "Assigned production staff", "Payment requirement", "No revision or explicit blocker"]) {
  assert.ok(html.includes(label), `requirement renders: ${label}`);
}
assert.ok(html.includes("paymentStatus + verified/confirmed amount"), "payment requirement exposes current rule mapping");

html = renderSelected(unpaid, "payment");
assert.ok(html.includes("PAYMENT SUMMARY"), "payment tab renders summary");
assert.ok(html.includes('data-mvp-payment-field="amountReceived"'), "amount received field is wired through existing contract");
assert.ok(html.includes('data-mvp-payment-field="paymentSource"'), "payment source field is wired through existing contract");
assert.ok(html.includes('data-mvp-payment-field="referenceNumber"'), "reference field is wired through existing contract");
assert.ok(html.includes('data-mvp-payment-field="internalNote"'), "internal note field is wired through existing contract");
assert.ok(html.includes('data-mvp-confirm-payment="TRY-DRAWER-BASE"'), "confirm payment uses sourceInquiryId bridge/current inquiry-keyed handler");

html = renderSelected(review);
assert.ok(html.includes("PAYMENT REVIEW"), "proof submitted order is Payment Review");
assert.equal((html.match(/<mark class="payment">PAYMENT REVIEW<\/mark>/g) || []).length, 1, "payment review drawer status is payment review");
assert.equal((html.match(/<mark class="overdue">BLOCKED<\/mark>/g) || []).length, 0, "payment review drawer status is not blocked");

html = renderSelected(blocked);
assert.ok(html.includes(">BLOCKED<"), "explicit blocker renders Blocked");
assert.ok(html.includes("Review Blocker"), "blocked footer points to requirements");
assert.ok(html.includes("Resolve Blocker") && html.includes("disabled"), "resolve blocker is not faked without a working drawer action");

html = renderSelected(ready);
assert.ok(html.includes("READY TO RELEASE"), "gate-clear queued order is Ready to Release");
assert.ok(html.includes("Release to Production"), "existing release behavior is preserved");

html = renderSelected(legacy);
assert.ok(html.includes("TRRY-LEGACY-DRAWER"), "legacy compatibility identity still opens in drawer");

html = renderSelected(unpaid, "fulfillment");
assert.ok(html.includes("FULFILLMENT"), "fulfillment tab renders");
assert.ok(html.includes("Order-owned customer fulfillment data only"), "fulfillment stays separate from production execution");
assert.ok(!html.includes("Save Fulfillment"), "unproven fulfillment write is not exposed");

html = renderSelected(ready, "history");
assert.ok(html.includes("HISTORY"), "history tab renders");
assert.ok(html.includes("Derived from quote approval"), "derived history is labeled");
assert.ok(!html.includes("Payment method selected"), "Figma sample-only history event is not hardcoded");

const dashboardSource = await readFile("src/mvpDashboard.js", "utf8");
assert.ok(dashboardSource.includes("data-mvp-open-messenger"), "Messenger behavior remains present");
assert.ok(dashboardSource.includes("payment.key !== \"paid\"") && dashboardSource.includes("AWAITING PAYMENT"), "awaiting payment state remains separate from Blocked");

const paymentApi = await readFile("api/inquiries/[id]/payment-confirmations.js", "utf8");
assert.ok(paymentApi.includes('new Set(["owner", "admin"])'), "payment confirmation role gate remains owner/admin");
assert.ok(paymentApi.includes("owner or admin access required"), "staff payment confirmation remains forbidden");

console.log("PASS Order drawer blocked/readiness shell, tabs, state semantics, payment contract, native/legacy identity, and history boundaries");
