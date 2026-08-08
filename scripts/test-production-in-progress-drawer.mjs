import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildOpsWorkflowUpdates } from "../api/_lib/opsWorkflow.js";
import { createMvpDashboard } from "../src/mvpDashboard.js";

global.window = { location: { search: "" }, history: { replaceState() {} }, setTimeout };

const team = [
  { userId: "96000000-0000-4000-8000-000000000888", displayName: "Louvelyngel", email: "louvelyngel@trry.test", role: "staff" },
  { userId: "96000000-0000-4000-8000-000000000889", displayName: "Rachelle", email: "rachelle@trry.test", role: "staff" },
];

const base = {
  status: "won",
  quoteStatus: "approved",
  sourceType: "native",
  nativeOrderId: "96000000-0000-4000-8000-000000000702",
  sourceInquiryId: "TRY-INPROD",
  sourceInquiryReference: "TRY-INPROD",
  orderReference: "TRRY-ORD-INPROD01",
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
  artworkStatus: "approved",
  artworkApprovedAt: "2026-07-30T17:54:00.000Z",
  paymentStatus: "paid",
  paymentVerifiedAmount: 850,
  paymentConfirmedAmount: 850,
  paymentConfirmedAt: "2026-07-30T18:12:00.000Z",
  productionStage: "printing",
  productionUpdatedAt: "2026-07-30T18:12:00.000Z",
  productionStartedAt: "2026-07-30T18:15:00.000Z",
  productionStartedBy: "96000000-0000-4000-8000-000000000888",
  assignedUserId: "96000000-0000-4000-8000-000000000888",
  assignedStaff: "Louvelyngel",
  productionNote: "Printing started.\nDTF transfer in progress.",
  createdAt: "2026-07-30T11:32:00.000Z",
};

const queued = { ...base, id: "TRY-QUEUED", orderReference: "TRRY-ORD-QUEUED01", productionStartedAt: "", productionStartedBy: "" };
const started = { ...base, id: "TRY-INPROD" };
const legacyStarted = { ...base, id: "TRY-LEGACY-INPROD", sourceType: "legacy", sourceInquiryId: "", sourceInquiryReference: "", nativeOrderId: "", orderReference: "TRRY-LEGACY-INPROD01", odooSO: "SO-LEGACY-INPROD01" };
const rows = [queued, started, legacyStarted];

const dashboard = createMvpDashboard({
  getAssignmentContext: () => ({ users: team, loadState: "success", error: "" }),
});
dashboard.state.production.pageSize = 10;

global.window.location.search = "?order=TRRY-ORD-QUEUED01";
let html = dashboard.renderProduction({ items: rows });
assert.ok(html.includes("QUEUED"), "released-not-started job remains queued");
assert.ok(html.includes("START PRODUCTION"), "queued job offers Start Production");
assert.ok(!html.includes("mvp-production-drawer in-progress"), "queued job does not render IN PRODUCTION drawer shell");
assert.ok(!html.includes("Move to Quality Check"), "queued job cannot advance directly to QC");

global.window.location.search = "?order=TRRY-ORD-INPROD01";
dashboard.state.productionTab = "overview";
html = dashboard.renderProduction({ items: rows });
assert.ok(html.includes("mvp-production-drawer in-progress"), "started job renders the IN PRODUCTION drawer shell");
assert.ok(html.includes("IN PRODUCTION"), "IN PRODUCTION status pill renders");
assert.ok(html.includes("TRRY-ORD-INPROD01"), "native order reference is the job identity");
assert.ok(html.includes("ORDER SUMMARY"), "Overview tab renders");
assert.ok(html.includes("Current Stage") && html.includes("In Production"), "Overview derives stage from persisted start");
assert.ok(html.includes("Artwork Status") && html.includes("Payment Status"), "prerequisite status is read-only context");
assert.ok(html.includes("No production blocker"), "explicit empty blocker renders truthfully");
assert.ok(html.includes("Move to Quality Check"), "started job exposes QC transition action");
assert.ok(!/Confirm Payment|Pay Online|Pay at Shop|Messenger/i.test(html), "Production drawer exposes no payment or Messenger action");

dashboard.state.productionTab = "workflow";
html = dashboard.renderProduction({ items: rows });
assert.ok(html.includes("Released to Production"), "Workflow shows release event");
assert.ok(html.includes("In Production"), "Workflow shows started/current event");
assert.ok(html.includes("Quality Check") && html.includes("Pending"), "Workflow shows QC pending");

dashboard.state.productionTab = "assignment";
html = dashboard.renderProduction({ items: rows });
assert.ok(html.includes("ASSIGNMENT &amp; NOTES"), "Assignment tab renders");
assert.ok(html.includes("data-mvp-production-staff=\"TRY-INPROD\""), "Assignment uses persisted assignment control");
assert.ok(html.includes("Printing started."), "Production note renders from existing production_note");
assert.ok(html.includes("Save Note"), "Save Note is functional through save_production");

dashboard.state.productionTab = "fulfillment";
html = dashboard.renderProduction({ items: rows });
assert.ok(html.includes("FULFILLMENT DETAILS"), "Fulfillment tab renders");
assert.ok(html.includes("Method") && html.includes("Pickup"), "Order-owned fulfillment method is visible");
assert.ok(html.includes("Customer Visible Status") && html.includes("Not Ready"), "customer-visible status is derived, not persisted");
assert.ok(!html.includes("Save Fulfillment"), "Production drawer does not expose fulfillment writes");

dashboard.state.productionTab = "history";
html = dashboard.renderProduction({ items: rows });
assert.ok(html.includes("Production started"), "History derives Production Started from persisted start fields");
assert.ok(html.includes("Released to production"), "History keeps release and start distinct");
assert.ok(html.includes("Payment confirmed"), "History includes read-only payment prerequisite");
assert.ok(!html.includes("Note updated"), "History does not fabricate note events");

global.window.location.search = "?order=TRRY-LEGACY-INPROD01";
dashboard.state.productionTab = "overview";
html = dashboard.renderProduction({ items: rows });
assert.ok(html.includes("TRRY-LEGACY-INPROD01"), "legacy compatibility reference remains supported");
assert.ok(!html.includes("PRD-"), "drawer does not invent native Production job references");

const qcResult = buildOpsWorkflowUpdates("advance_production", { productionStage: "qc", assignedStaff: "Louvelyngel" }, {
  id: "TRY-INPROD",
  status: "won",
  quote_status: "approved",
  quoted_amount: 850,
  amount_due: 850,
  odoo_so: "SO-INPROD",
  product: "DTF",
  product_desc: "Premium Tshirt",
  quantity: "12 pcs",
  due_date: "2026-07-31",
  artwork_status: "approved",
  assigned_staff: "Louvelyngel",
  payment_status: "paid",
  payment_verified_amount: 850,
  production_stage: "printing",
  production_started_at: "2026-07-30T18:15:00.000Z",
}, "2026-07-30T19:00:00.000Z");
assert.equal(qcResult.ok, true, "started first-station job can advance to QC");
assert.equal(qcResult.updates.production_stage, "qc", "QC transition persists production_stage = qc");

const invalidQc = buildOpsWorkflowUpdates("advance_production", { productionStage: "qc", assignedStaff: "Louvelyngel" }, {
  ...qcResult.updates,
  status: "won",
  quote_status: "approved",
  production_stage: "printing",
  production_started_at: null,
}, "2026-07-30T19:00:00.000Z");
assert.equal(invalidQc.ok, false, "not-started first-station job cannot advance to QC");

const source = await readFile("src/mvpDashboard.js", "utf8");
assert.ok(source.includes("data-mvp-production-tab"), "Production drawer tabs are wired");
assert.ok(source.includes("data-mvp-advance"), "QC transition uses existing advance handler");
assert.ok(source.includes("startProduction"), "Queued start behavior remains present");
assert.ok(source.includes("data-mvp-open-messenger"), "Messenger behavior remains elsewhere and untouched");

console.log("PASS IN PRODUCTION drawer shell, tabs, read-only boundaries, assignment note support, history, and QC transition contract");
