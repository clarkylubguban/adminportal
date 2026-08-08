import assert from "node:assert/strict";
import { buildUpdates as buildCustomerActionUpdates } from "../api/inquiries/[id]/customer-actions.js";
import { buildOpsWorkflowUpdates } from "../api/_lib/opsWorkflow.js";
import { createMvpDashboard } from "../src/mvpDashboard.js";

global.window = { location: { search: "" }, history: { replaceState() {} }, setTimeout };

const ACTOR_ID = "96000000-0000-4000-8000-000000000777";
const team = [
  { userId: ACTOR_ID, displayName: "Louvelyngel", email: "lou@trry.test", role: "admin" },
];

const base = {
  id: "TRY-READINESS-ACTIONS",
  status: "approved",
  quoteStatus: "approved",
  sourceType: "native",
  sourceInquiryId: "TRY-READINESS-ACTIONS",
  sourceInquiryReference: "TRY-READINESS-ACTIONS",
  nativeOrderId: "96000000-0000-4000-8000-000000000771",
  orderReference: "TRRY-ORD-READY-ACTIONS",
  customer: "Readiness Action Customer",
  contact: "+63 917 000 0771",
  source: "Website",
  productDesc: "Premium Shirt",
  service: "DTF",
  qty: "12 pcs",
  sizeBreakdown: "S-2 / M-4 / L-4 / XL-2",
  fulfillmentMethod: "pickup",
  artworkStatus: "submitted",
  artworkUrl: "TRY-READINESS-ACTIONS/proofs/artwork.png",
  assignedUserId: "",
  assignedStaff: "",
  quotedAmount: 1200,
  amountDue: 1200,
  paymentStatus: "paid",
  paymentVerifiedAmount: 1200,
  paymentConfirmedAmount: 1200,
  paymentConfirmedAt: "2026-08-08T09:00:00.000Z",
  productionStage: "queued",
};

const dashboard = createMvpDashboard({
  getAssignmentContext: () => ({ users: team, loadState: "success", error: "" }),
});

function renderOrder(item, tab = "requirements") {
  global.window.location.search = `?order=${encodeURIComponent(item.orderReference)}`;
  dashboard.state.orderTab = tab;
  return dashboard.renderOrders({ items: [item] });
}

function workflowInquiry(overrides = {}) {
  return {
    id: base.id,
    status: "approved",
    nativeOrderAuthority: true,
    quote_status: "approved",
    product: "DTF",
    product_desc: "Premium Shirt",
    quantity: "12 pcs",
    due_date: null,
    artwork_status: "submitted",
    assigned_staff: "",
    payment_status: "paid",
    payment_verified_amount: 1200,
    payment_confirmed_amount: 1200,
    quoted_amount: 1200,
    amount_due: 1200,
    production_stage: "queued",
    production_note: "Keep this production note",
    blocked_reason: null,
    ...overrides,
  };
}

let html = renderOrder(base);
assert.ok(!html.includes('data-mvp-readiness-action="due_date"'), "TEST 1 due-date action is not available in Orders");
assert.ok(!html.includes('data-mvp-readiness-action="artwork"'), "TEST 1 artwork review action is not available in Orders");
assert.ok(html.includes('data-mvp-readiness-action="staff"'), "TEST 1 staff assignment action remains available in Orders");
assert.ok(html.includes("Agreed due date inherited"), "TEST 1 due-date requirement is shown as inherited fact");
assert.ok(html.includes("Artwork approval inherited"), "TEST 1 artwork requirement is shown as inherited fact");
assert.ok(!html.includes('data-mvp-release-order="TRY-READINESS-ACTIONS"'), "TEST 1 release remains blocked");

const dueDateSave = buildCustomerActionUpdates("set_due_date", { dueDate: "2026-08-20" }, {
  id: base.id,
  quote_status: "approved",
  artwork_status: "approved",
  production_stage: "queued",
}, "2026-08-08T10:00:00.000Z", { role: "admin", user_id: ACTOR_ID });
assert.equal(dueDateSave.due_date, "2026-08-20", "TEST 2 Inquiry due-date save persists canonical due_date");
html = renderOrder({ ...base, dueDate: "2026-08-20" });
assert.ok(!html.includes('data-mvp-readiness-action="due_date"'), "TEST 2 due-date requirement turns green");
assert.ok(!html.includes('data-mvp-readiness-action="artwork"') && html.includes('data-mvp-readiness-action="staff"'), "TEST 2 only staff action remains");

const artworkApproval = buildCustomerActionUpdates("approve_artwork", {}, {
  id: base.id,
  quote_status: "approved",
  artwork_status: "submitted",
  artwork_approved_at: null,
  production_stage: "queued",
}, "2026-08-08T10:05:00.000Z", { role: "admin", user_id: ACTOR_ID });
assert.deepEqual(Object.keys(artworkApproval).sort(), ["artwork_approved_at", "artwork_revision_request", "artwork_status"], "TEST 3 artwork approval only mutates canonical artwork fields");
assert.equal(artworkApproval.artwork_status, "approved", "TEST 3 artwork approval persists canonical artwork_status");
html = renderOrder({ ...base, dueDate: "2026-08-20", artworkStatus: "approved" });
assert.ok(!html.includes('data-mvp-readiness-action="artwork"'), "TEST 3 artwork requirement turns green");

const staffSave = buildOpsWorkflowUpdates("save_production", { assignedStaff: "Louvelyngel - admin" }, workflowInquiry({ due_date: "2026-08-20", artwork_status: "approved" }), "2026-08-08T10:10:00.000Z");
assert.equal(staffSave.ok, true, "TEST 4 staff save accepted");
assert.equal(staffSave.updates.assigned_staff, "Louvelyngel - admin", "TEST 4 staff persists canonical assigned_staff");
html = renderOrder({ ...base, dueDate: "2026-08-20", artworkStatus: "approved", assignedUserId: ACTOR_ID, assignedStaff: "Louvelyngel - admin" });
assert.ok(!html.includes('data-mvp-readiness-action="staff"'), "TEST 4 staff requirement turns green");

const ready = { ...base, dueDate: "2026-08-20", artworkStatus: "approved", assignedUserId: ACTOR_ID, assignedStaff: "Louvelyngel - admin" };
html = renderOrder(ready, "overview");
assert.ok(html.includes("<mark class=\"ready\">READY TO RELEASE</mark>"), "TEST 5 all requirements ready makes Order Ready to Release");
assert.ok(html.includes('data-mvp-release-order="TRY-READINESS-ACTIONS"'), "TEST 5 release action is exposed when ready");
assert.equal(ready.productionStage, "queued", "TEST 6 readiness does not auto-release");

const release = buildOpsWorkflowUpdates("advance_production", { productionStage: "printing", assignedStaff: "Louvelyngel - admin" }, workflowInquiry({
  due_date: "2026-08-20",
  artwork_status: "approved",
  assigned_staff: "Louvelyngel - admin",
}), "2026-08-08T10:15:00.000Z");
assert.equal(release.ok, true, "TEST 7 explicit release succeeds when all requirements are ready");
assert.equal(release.updates.production_stage, "printing", "TEST 7 release persists production stage");

const pendingArtworkRelease = buildOpsWorkflowUpdates("advance_production", { productionStage: "printing", assignedStaff: "Louvelyngel - admin" }, workflowInquiry({
  due_date: "2026-08-20",
  assigned_staff: "Louvelyngel - admin",
}), "2026-08-08T10:20:00.000Z");
assert.equal(pendingArtworkRelease.ok, false, "TEST 8 artwork pending blocks release");
assert.match(pendingArtworkRelease.error, /artwork approval/);

const missingDateRelease = buildOpsWorkflowUpdates("advance_production", { productionStage: "printing", assignedStaff: "Louvelyngel - admin" }, workflowInquiry({
  artwork_status: "approved",
  assigned_staff: "Louvelyngel - admin",
}), "2026-08-08T10:25:00.000Z");
assert.equal(missingDateRelease.ok, false, "TEST 9 missing due date blocks release");
assert.match(missingDateRelease.error, /due date/);

const missingStaffRelease = buildOpsWorkflowUpdates("advance_production", { productionStage: "printing" }, workflowInquiry({
  due_date: "2026-08-20",
  artwork_status: "approved",
}), "2026-08-08T10:30:00.000Z");
assert.equal(missingStaffRelease.ok, false, "TEST 10 missing staff blocks release");
assert.match(missingStaffRelease.error, /assigned staff/);

console.log("PASS Order readiness actions UI and canonical readiness contracts");
