import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildOpsWorkflowUpdates } from "../api/_lib/opsWorkflow.js";
import { createMvpDashboard } from "../src/mvpDashboard.js";

global.window = { location: { search: "" }, history: { replaceState() {} }, setTimeout };

const team = [
  { userId: "owner-james", displayName: "James", email: "james@trry.test", role: "owner" },
];

const base = {
  id: "TRY-READY-BASE",
  status: "won",
  quoteStatus: "approved",
  sourceType: "native",
  sourceInquiryId: "TRY-READY-BASE",
  sourceInquiryReference: "TRY-READY-BASE",
  nativeOrderId: "96000000-0000-4000-8000-000000000444",
  orderReference: "TRRY-ORD-READY99",
  customer: "Ready Release Customer",
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
  paymentStatus: "paid",
  paymentVerifiedAmount: 850,
  paymentConfirmedAmount: 850,
  paymentConfirmedAt: "2026-08-01T04:00:00.000Z",
  paymentHistory: [{ id: "payment-1", amount: 850, confirmedAt: "2026-08-01T04:00:00.000Z" }],
  updatedAt: "2026-08-01T03:32:00.000Z",
  quoteApprovedAt: "2026-07-31T02:46:00.000Z",
  productionStage: "queued",
};

const unpaid = { ...base, id: "TRY-READY-UNPAID", orderReference: "TRRY-ORD-UNPAID99", paymentStatus: "awaiting_payment", paymentVerifiedAmount: 0, paymentConfirmedAmount: 0 };
const review = { ...base, id: "TRY-READY-REVIEW", orderReference: "TRRY-ORD-REVIEW99", paymentStatus: "proof_submitted", paymentVerifiedAmount: 0, paymentConfirmedAmount: 0 };
const blocked = { ...base, id: "TRY-READY-BLOCKED", orderReference: "TRRY-ORD-BLOCKED99", blockedReason: "Materials unavailable" };
const released = { ...base, id: "TRY-READY-RELEASED", orderReference: "TRRY-ORD-RELEASED99", orderStatus: "released", productionStage: "queued", productionUpdatedAt: "2026-08-01T05:00:00.000Z" };
const legacy = { ...base, id: "TRY-READY-LEGACY", sourceType: "legacy", nativeOrderId: "", sourceInquiryId: "", orderReference: "TRRY-LEGACY-READY99", odooSO: "SO-LEGACY-READY99" };
const rows = [base, unpaid, review, blocked, released, legacy];

const dashboard = createMvpDashboard({
  getAssignmentContext: () => ({ users: team, loadState: "success", error: "" }),
});

function renderSelected(item, tab = "overview", renderPayment = () => "") {
  global.window.location.search = `?order=${encodeURIComponent(item.orderReference)}`;
  dashboard.state.orderTab = tab;
  return dashboard.renderOrders({ items: rows, renderPayment });
}

let html = renderSelected(base);
assert.ok(html.includes("<mark class=\"ready\">READY TO RELEASE</mark>"), "ready drawer uses the unambiguous READY TO RELEASE label");
assert.ok(html.includes('data-mvp-release-order="TRY-READY-BASE"'), "ready footer exposes the release action");
assert.ok(!html.includes('data-mvp-next="embroidery"'), "release action no longer carries a first production station");
assert.ok(!html.includes('data-mvp-route="/production?order=TRY-READY-BASE" type="button">Release to Production'), "ready footer no longer fakes release through route navigation");

html = renderSelected(base, "requirements");
for (const label of ["Product and quantity", "Agreed due date inherited", "Artwork approval inherited", "Assigned production staff", "Payment requirement", "No revision or explicit blocker"]) {
  assert.ok(html.includes(label), `ready requirement maps real rule: ${label}`);
}
assert.ok(!html.includes('data-mvp-readiness-action="due_date"'), "ready Order drawer does not expose Due Date as an operational action");
assert.ok(!html.includes('data-mvp-readiness-action="artwork"'), "ready Order drawer does not expose Artwork as an operational action");

html = renderSelected(base, "payment", () => "<section>Payment contract placeholder</section>");
assert.ok(html.includes("PAYMENT SUMMARY"), "ready payment tab renders supported summary");
assert.ok(!html.includes("CONFIRM PAYMENT"), "confirmed ready payment state does not render Confirm Payment");
assert.ok(html.includes("Confirmed Amount") && html.includes("Payment State"), "ready payment tab displays real confirmed payment fields");

html = renderSelected(unpaid);
assert.ok(html.includes("AWAITING PAYMENT"), "unpaid remains Awaiting Payment");
assert.ok(!html.includes("<mark class=\"ready\">READY TO RELEASE</mark>"), "unpaid drawer does not become ready");

html = renderSelected(review);
assert.ok(html.includes("PAYMENT REVIEW"), "proof submitted remains Payment Review");

html = renderSelected(blocked);
assert.ok(html.includes(">BLOCKED<"), "explicit blocker remains Blocked");
assert.ok(!html.includes('data-mvp-release-order="TRY-READY-BLOCKED"'), "blocked order cannot release from the drawer");

html = renderSelected(released);
assert.ok(html.includes("QUEUED FOR PRODUCTION"), "post-release order no longer displays Ready to Release");
assert.ok(!html.includes('data-mvp-release-order="TRY-READY-RELEASED"'), "released order cannot be released again from Orders");
html = renderSelected(released, "history");
assert.ok(html.includes("Released to production"), "released history is derived only after persisted production fields exist");

html = renderSelected(legacy);
assert.ok(!html.includes('data-mvp-release-order="TRY-READY-LEGACY"'), "legacy Odoo-only orders are read-only and cannot release");

global.window.location.search = "";
html = dashboard.renderProduction({ items: [base] });
assert.ok(!html.includes("TRRY-ORD-READY99"), "gate-clear queued order is not visible in Production before persisted release");
html = dashboard.renderProduction({ items: [released] });
assert.ok(html.includes("TRRY-ORD-RELEASED99"), "persisted non-queued release is visible in Production");

const workflowResult = buildOpsWorkflowUpdates("release_production", {}, {
  id: "TRY-READY-BASE",
  status: "approved",
  nativeOrderAuthority: true,
  quote_status: "approved",
  product: "Embroidery",
  product_desc: "Premium Tshirt",
  quantity: "12 pcs",
  due_date: "2026-08-09",
  artwork_status: "approved",
  assigned_staff: "James - owner",
  payment_status: "paid",
  payment_verified_amount: 850,
  quoted_amount: 850,
  amount_due: 850,
  production_stage: "queued",
}, "2026-08-01T05:00:00.000Z");
assert.equal(workflowResult.ok, true, "release workflow accepts a gate-clear queued order");
assert.equal(workflowResult.updates.production_stage, "queued", "release preserves queued stage");
assert.equal(workflowResult.updates.production_started_at, null, "release leaves production start timestamp null");
assert.equal(workflowResult.updates.production_started_by, null, "release leaves production start actor null");

const duplicateResult = buildOpsWorkflowUpdates("release_production", {}, {
  id: "TRY-READY-BASE",
  status: "approved",
  nativeOrderAuthority: true,
  quote_status: "approved",
  product: "Embroidery",
  product_desc: "Premium Tshirt",
  quantity: "12 pcs",
  due_date: "2026-08-09",
  artwork_status: "approved",
  assigned_staff: "James - owner",
  payment_status: "paid",
  payment_verified_amount: 850,
  quoted_amount: 850,
  amount_due: 850,
  production_stage: "printing",
}, "2026-08-01T05:00:00.000Z");
assert.equal(duplicateResult.ok, false, "duplicate release payload is rejected after durable stage changes");
assert.equal(duplicateResult.error, "production is already released");

const dashboardSource = await readFile("src/mvpDashboard.js", "utf8");
assert.ok(dashboardSource.includes("data-mvp-open-messenger"), "Messenger behavior remains present");
assert.ok(dashboardSource.includes("data-mvp-release-order"), "release action has a dedicated handler");
assert.ok(dashboardSource.includes("orderReleaseId"), "release button has in-flight duplicate-click protection");
const releaseHelper = dashboardSource.match(/function isReleasedToProduction\(item\) \{[\s\S]*?\n  \}/)?.[0] || "";
assert.ok(!releaseHelper.includes("readyForProduction(item)"), "Production visibility is not derived from readiness alone");

const workflowSource = await readFile("api/_lib/opsWorkflow.js", "utf8");
assert.ok(workflowSource.includes("advance_production"), "existing release workflow contract remains in use");

console.log("PASS Ready drawer release state, gates, persisted workflow contract, duplicate release rejection, and Production visibility boundary");
