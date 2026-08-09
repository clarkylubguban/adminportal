import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildOpsWorkflowUpdates } from "../api/_lib/opsWorkflow.js";
import { createMvpDashboard } from "../src/mvpDashboard.js";

global.window = { location: { search: "" }, history: { replaceState() {} }, setTimeout };

const ACTOR_ID = "96000000-0000-4000-8000-000000000888";
const OTHER_ACTOR_ID = "96000000-0000-4000-8000-000000000889";
const team = [
  { userId: ACTOR_ID, displayName: "Louvelyngel", email: "louvelyngel@trry.test", role: "staff" },
  { userId: OTHER_ACTOR_ID, displayName: "Rachelle", email: "rachelle@trry.test", role: "staff" },
];

const base = {
  id: "TRY-QC-DRAWER",
  status: "won",
  quoteStatus: "approved",
  sourceType: "native",
  nativeOrderId: "96000000-0000-4000-8000-000000000902",
  sourceInquiryId: "TRY-QC-DRAWER",
  sourceInquiryReference: "TRY-QC-DRAWER",
  orderReference: "TRRY-ORD-QC22",
  customer: "Clark Lubguban",
  contact: "+639177021242",
  source: "Website",
  service: "DTF",
  productDesc: "Premium Tshirt",
  qty: "12 pcs",
  sizeBreakdown: "S-2 / M-4 / L-4 / XL-2",
  garmentColor: "Black",
  dueDate: "2026-07-31",
  fulfillmentMethod: "pickup",
  trackingSubstatus: "",
  trackingNote: "Hold for pickup confirmation.",
  artworkStatus: "approved",
  artworkApprovedAt: "2026-07-30T17:54:00.000Z",
  paymentStatus: "paid",
  paymentVerifiedAmount: 850,
  paymentConfirmedAmount: 850,
  paymentConfirmedAt: "2026-07-30T18:12:00.000Z",
  productionStage: "qc",
  productionUpdatedAt: "2026-07-30T18:12:00.000Z",
  productionStartedAt: "2026-07-31T14:25:00.000Z",
  productionStartedBy: ACTOR_ID,
  qcStartedAt: "2026-08-01T14:30:00.000Z",
  qcStartedBy: ACTOR_ID,
  qcNote: "Checked quantity, artwork placement, and stitching.",
  assignedUserId: ACTOR_ID,
  assignedStaff: "Louvelyngel",
  productionNote: "Production completed.\nNow on quality check.",
  createdAt: "2026-07-30T11:32:00.000Z",
};

const queued = { ...base, id: "TRY-QUEUED-QC-REG", orderReference: "TRRY-ORD-QUEUEDQC", productionStage: "printing", productionStartedAt: "", productionStartedBy: "", qcStartedAt: "", qcStartedBy: "", qcNote: "" };
const inProgress = { ...base, id: "TRY-INPROD-QC-REG", orderReference: "TRRY-ORD-INPRODQC", productionStage: "printing", qcStartedAt: "", qcStartedBy: "", qcNote: "" };
const qc = { ...base };
const blockedQc = { ...base, id: "TRY-QC-BLOCKED", orderReference: "TRRY-ORD-QCBLOCK", blockedReason: "Print defect requires owner review" };
const legacyQc = { ...base, id: "TRY-LEGACY-QC", sourceType: "legacy", nativeOrderId: "", sourceInquiryId: "", sourceInquiryReference: "", orderReference: "TRRY-LEGACY-QC22", odooSO: "SO-QC22", qcStartedAt: "", qcStartedBy: "", qcNote: "" };

const dashboard = createMvpDashboard({
  getAssignmentContext: () => ({ users: team, loadState: "success", error: "" }),
});
dashboard.state.production.pageSize = 10;

global.window.location.search = "?order=TRRY-ORD-QC22";
dashboard.state.productionTab = "overview";
let html = dashboard.renderProduction({ items: [queued, inProgress, qc, blockedQc, legacyQc] });
assert.ok(html.includes("mvp-production-drawer in-progress quality-check"), "QC job renders shared Quality Check drawer shell");
assert.ok(html.includes("QUALITY CHECK"), "QC status pill renders");
assert.ok(html.includes("TRRY-ORD-QC22"), "native order reference remains job identity");
assert.ok(html.includes("Current Stage") && html.includes("Quality Check"), "Overview shows QC current stage");
assert.ok(html.includes("QC Started") && html.includes("Aug 1, 2026"), "Overview displays persisted QC started timestamp");
assert.ok(html.includes("Louvelyngel - Staff"), "QC started actor resolves from admin_users identity");
assert.ok(html.includes("NOW: QUALITY CHECK"), "QC footer NOW shows Quality Check");
assert.ok(html.includes("NEXT: READY"), "QC footer NEXT shows Ready");
assert.ok(html.includes("Complete Quality Check"), "QC footer exposes completion action");
assert.ok(html.includes('data-mvp-next="ready"'), "completion action maps to ready transition");
assert.ok(!/Confirm Payment|Pay Online|Pay at Shop|Messenger/i.test(html), "QC drawer exposes no payment or Messenger action");

dashboard.state.productionTab = "workflow";
html = dashboard.renderProduction({ items: [queued, inProgress, qc, blockedQc, legacyQc] });
assert.ok(html.includes("Released to Production"), "Workflow includes release step");
assert.ok(html.includes("In Production"), "Workflow includes completed in-production step");
assert.ok(html.includes("Quality Check") && html.includes("Current Stage"), "Workflow marks Quality Check current");
assert.ok(html.includes("Ready for Fulfillment") && html.includes("Pending"), "Workflow keeps Ready for Fulfillment pending");
assert.ok(html.includes("Completed") && html.includes("Pending"), "Workflow keeps Completed pending");

dashboard.state.productionTab = "assignment";
html = dashboard.renderProduction({ items: [queued, inProgress, qc, blockedQc, legacyQc] });
assert.ok(html.includes("ASSIGNMENT &amp; NOTES"), "Assignment tab renders");
assert.ok(html.includes('data-mvp-production-staff="TRY-QC-DRAWER"'), "Assignment support remains reachable");
assert.ok(html.includes("Internal Production Note") && html.includes("Production completed."), "Production note remains separate");
assert.ok(html.includes("Quality Check Note (Optional)") && html.includes("Checked quantity"), "QC note renders from qc_note");
assert.ok(html.includes('data-mvp-save-qc-note="TRY-QC-DRAWER"'), "Save QC Note action uses dedicated contract");

dashboard.state.productionTab = "fulfillment";
html = dashboard.renderProduction({ items: [queued, inProgress, qc, blockedQc, legacyQc] });
assert.ok(html.includes("FULFILLMENT"), "Fulfillment tab renders");
assert.ok(html.includes("Customer Visible Status") && html.includes("Not Ready"), "QC derives customer-visible status as Not Ready");
assert.ok(!html.includes("Save Fulfillment"), "QC drawer keeps fulfillment read-only");

dashboard.state.productionTab = "history";
html = dashboard.renderProduction({ items: [queued, inProgress, qc, blockedQc, legacyQc] });
assert.ok(html.includes("Quality check started"), "History derives QC started from persisted QC metadata");
assert.ok(!html.includes("Quality check completed"), "Active QC does not fabricate completion event");
assert.ok(!html.includes("Note updated"), "History does not fabricate note events");

global.window.location.search = "?order=TRRY-ORD-QCBLOCK";
dashboard.state.productionTab = "overview";
html = dashboard.renderProduction({ items: [queued, inProgress, qc, blockedQc, legacyQc] });
assert.ok(html.includes("Print defect requires owner review"), "Explicit blocker appears in QC drawer");
assert.match(html, /data-mvp-next="ready" disabled/, "blocked QC cannot complete through the UI");

global.window.location.search = "?order=TRRY-LEGACY-QC22";
dashboard.state.productionTab = "overview";
html = dashboard.renderProduction({ items: [queued, inProgress, qc, blockedQc, legacyQc] });
assert.ok(!html.includes("TRRY-LEGACY-QC22"), "legacy Odoo-only QC row is not active Production");
assert.ok(!html.includes("PRD-"), "QC drawer does not invent Production job IDs");

global.window.location.search = "?order=TRRY-ORD-QUEUEDQC";
html = dashboard.renderProduction({ items: [queued, inProgress, qc, blockedQc, legacyQc] });
assert.ok(html.includes("START PRODUCTION"), "queued regression still offers Start Production");
assert.ok(html.includes("NOW: Queued for Production"), "queued regression keeps explicit NOW state");
assert.ok(html.includes("NEXT: In Production"), "queued regression keeps explicit NEXT state");

global.window.location.search = "?order=TRRY-ORD-INPRODQC";
html = dashboard.renderProduction({ items: [queued, inProgress, qc, blockedQc, legacyQc] });
assert.ok(html.includes("IN PRODUCTION"), "started regression still renders In Production");
assert.ok(html.includes("NOW: PRINTING"), "In Production regression keeps active station in footer");
assert.ok(html.includes("NEXT: QUALITY CHECK"), "In Production regression keeps next stage in footer");
assert.ok(html.includes("MOVE TO QUALITY CHECK"), "In Production regression still moves to QC");

const noteResult = buildOpsWorkflowUpdates("save_qc_note", { qcNote: "Final QC note.", actorUserId: ACTOR_ID }, {
  ...workflowInquiry(),
  production_stage: "qc",
  production_note: "Keep production note.",
  qc_started_at: "2026-08-01T14:30:00.000Z",
  qc_started_by: ACTOR_ID,
}, "2026-08-01T14:35:00.000Z");
assert.equal(noteResult.ok, true, "save_qc_note contract accepts active QC");
assert.equal(noteResult.updates.qc_note, "Final QC note.");
assert.equal(noteResult.updates.production_note, undefined, "QC note does not overwrite production_note");
assert.equal(noteResult.updates.production_stage, undefined, "QC note does not change stage");

const completeResult = buildOpsWorkflowUpdates("advance_production", { productionStage: "ready", actorUserId: ACTOR_ID }, {
  ...workflowInquiry(),
  production_stage: "qc",
  qc_started_at: "2026-08-01T14:30:00.000Z",
  qc_started_by: ACTOR_ID,
}, "2026-08-01T14:45:00.000Z");
assert.equal(completeResult.ok, true, "Complete QC advances through existing production workflow");
assert.equal(completeResult.updates.production_stage, "ready");
assert.equal(completeResult.updates.qc_completed_at, "2026-08-01T14:45:00.000Z");
assert.equal(completeResult.updates.qc_completed_by, ACTOR_ID);

const retry = buildOpsWorkflowUpdates("advance_production", { productionStage: "ready", actorUserId: OTHER_ACTOR_ID }, {
  ...workflowInquiry(),
  production_stage: "ready",
  qc_started_at: "2026-08-01T14:30:00.000Z",
  qc_started_by: ACTOR_ID,
  qc_completed_at: "2026-08-01T14:45:00.000Z",
  qc_completed_by: ACTOR_ID,
}, "2026-08-01T15:00:00.000Z");
assert.equal(retry.ok, true, "duplicate completion reconciles safely");
assert.equal(retry.noop, true, "duplicate completion is a no-op");

const blocked = buildOpsWorkflowUpdates("advance_production", { productionStage: "ready", actorUserId: ACTOR_ID }, {
  ...workflowInquiry(),
  production_stage: "qc",
  qc_started_at: "2026-08-01T14:30:00.000Z",
  blocked_reason: "Print defect requires owner review",
}, "2026-08-01T14:45:00.000Z");
assert.equal(blocked.ok, false, "backend blocks QC completion when explicit blocker exists");

const source = await readFile("src/mvpDashboard.js", "utf8");
assert.ok(source.includes("productionQualityCheckDrawer"), "QC drawer uses the shared Production drawer implementation path");
assert.ok(source.includes("data-mvp-save-qc-note"), "QC note save action is wired");
assert.ok(source.includes("data-mvp-next=\"ready\""), "Complete Quality Check uses ready transition");

console.log("PASS Quality Check drawer, QC note contract, completion action, blocker gate, idempotency, legacy support, and regressions");

function workflowInquiry(overrides = {}) {
  return {
    id: "TRY-QC-DRAWER",
    status: "approved",
    nativeOrderAuthority: true,
    nativeOrderId: "96000000-0000-4000-8000-000000000882",
    quote_status: "approved",
    quoted_amount: 850,
    amount_due: 850,
    odoo_so: "SO-QC",
    product: "DTF",
    product_desc: "Premium Tshirt",
    quantity: "12 pcs",
    due_date: "2026-07-31",
    artwork_status: "approved",
    assigned_staff: "Louvelyngel",
    payment_status: "paid",
    payment_verified_amount: 850,
    production_stage: "qc",
    production_started_at: "2026-07-31T14:25:00.000Z",
    production_started_by: ACTOR_ID,
    blocked_reason: null,
    ...overrides,
  };
}
