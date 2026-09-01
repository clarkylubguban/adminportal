import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createMvpDashboard } from "../src/mvpDashboard.js";

global.window = { location: { search: "" }, history: { replaceState() {} }, setTimeout };

const team = [
  { userId: "owner-james", displayName: "James", email: "james@trry.test", role: "owner" },
  { userId: "staff-rachelle", displayName: "Rachelle", email: "rachelle@trry.test", role: "staff" },
  { userId: "staff-juvy", displayName: "Juvy", email: "juvy@trry.test", role: "staff" },
];

const base = {
  status: "approved",
  quoteStatus: "approved",
  artworkStatus: "approved",
  fulfillmentMethod: "pickup",
  service: "Embroidery",
  qty: "12 pcs",
  dueDate: "2026-08-09",
  quotedAmount: 850,
  amountDue: 850,
  paymentStatus: "paid",
  paymentVerifiedAmount: 850,
  assignedUserId: "owner-james",
  productDesc: "Premium Tshirt",
  contact: "0917-000-0000",
  productionUpdatedAt: "2026-08-08T08:00:00.000Z",
};

const unreleased = { ...base, id: "TRY-UNRELEASED", orderReference: "TRRY-ORD-READY01", customer: "Ready Only", productionStage: "queued" };
const queued = { ...base, id: "TRY-QUEUED", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000000701", sourceInquiryId: "TRY-QUEUED", sourceInquiryReference: "TRY-QUEUED", orderReference: "TRRY-ORD-QUEUED01", orderStatus: "released", customer: "Queued Customer", service: "Embroidery", productionStage: "queued" };
const inProduction = { ...base, id: "TRY-INPROD", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000000702", sourceInquiryId: "TRY-INPROD", orderReference: "TRRY-ORD-INPROD01", customer: "Active Customer", service: "Screen Print", productionStage: "screen_printing", productionStartedAt: "2026-08-08T08:15:00.000Z", productionStartedBy: "staff-rachelle", assignedUserId: "staff-rachelle" };
const compatibilityOnly = { ...base, id: "TRY-COMPAT-RAW", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000000705", sourceInquiryId: "TRY-COMPAT-RAW", orderReference: "TRRY-ORD-COMPAT01", customer: "Compatibility Only", service: "DTF", productionStage: "printing", productionWorkflowStatus: "in_production" };
const qc = { ...base, id: "TRY-QC", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000000703", sourceInquiryId: "TRY-QC", orderReference: "TRRY-ORD-QC01", customer: "QC Customer", service: "DTF", productionStage: "qc", assignedUserId: "staff-juvy", dueDate: "2026-08-08" };
const ready = { ...base, id: "TRY-FULFILL", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000000704", sourceInquiryId: "TRY-FULFILL", orderReference: "TRRY-ORD-FULFILL01", customer: "Fulfillment Customer", productionStage: "ready", fulfillmentMethod: "delivery" };
const blocked = { ...base, id: "TRY-BLOCK", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000000706", sourceInquiryId: "TRY-BLOCK", orderReference: "TRRY-ORD-BLOCK01", customer: "Blocked Customer", service: "Embroidery", productionStage: "embroidery", blockedReason: "Thread color missing" };
const legacy = { ...base, id: "TRY-LEGACY", sourceType: "legacy", orderReference: "TRRY-LEGACY-PROD01", odooSO: "SO-LEGACY-PROD01", customer: "Legacy Customer", service: "Screen Print", productionStage: "screen_printing" };
const odooOnlyWon = { ...base, id: "TRY-ODOO-ONLY", status: "won", sourceType: "", orderReference: "", odooSO: "SO-R4-ODOO-ONLY", customer: "Odoo Only Negative", service: "Screen Print", productionStage: "screen_printing" };

const rows = [unreleased, queued, inProduction, compatibilityOnly, qc, ready, blocked, legacy, odooOnlyWon];
const dashboard = createMvpDashboard({
  getAssignmentContext: () => ({ users: team, loadState: "success", error: "" }),
});
dashboard.state.production.pageSize = 10;

let html = dashboard.renderProduction({ items: rows });

assert.ok(html.includes("mvp-production-dashboard-page"), "Production dashboard shell renders");
assert.ok(html.includes("Home") && html.includes("Production"), "breadcrumb/title render");
assert.ok(html.includes("Track released jobs from queue through production completion."), "locked Figma subtitle renders");
assert.ok(html.includes("Active Jobs"), "active job count summary renders");
assert.ok(!html.includes("TRRY-ORD-READY01"), "unreleased READY TO RELEASE order is not visible in Production");
assert.ok(!html.includes("READY TO RELEASE"), "Production dashboard never shows Order-side READY TO RELEASE");
assert.ok(html.includes("TRRY-ORD-QUEUED01"), "released native Order reference is primary job identity");
assert.ok(html.includes("TRRY-ORD-QUEUED01"), "released native Order remains visible when source Inquiry status=approved");
assert.ok(!html.includes("TRRY-LEGACY-PROD01"), "legacy Odoo-only work is read-only and not visible as active Production");
assert.ok(!html.includes("SO-R4-ODOO-ONLY"), "Odoo-only status=won row does not become active Production");
assert.ok(!html.includes("FROM ORDER"), "dashboard omits source secondary metadata");
assert.ok(!html.includes("0917-000-0000"), "dashboard omits customer phone secondary metadata");
assert.ok(!html.includes("DTF / PICKUP"), "dashboard omits method/fulfillment secondary metadata");
assert.ok(!html.includes("PRD-1048"), "dashboard does not invent PRD job references");

for (const label of ["Queued", "Ready", "In Production", "Quality Check", "Completed", "Blocked"]) {
  assert.ok(html.includes(label), `KPI/status label renders: ${label}`);
}
for (const tab of ["All Jobs", "Queued", "Ready", "In Production", "Quality Check", "Completed", "Blocked"]) {
  assert.ok(html.includes(tab), `status tab renders: ${tab}`);
}
assert.ok(!html.includes("Pickup / Delivery"), "Production dashboard no longer exposes fulfillment-owned Pickup / Delivery tab");
for (const header of ["JOB", "CUSTOMER", "SUMMARY", "METHOD", "DUE", "STAFF", "STAGE", "ACTION"]) {
  assert.ok(html.includes(header), `table header renders: ${header}`);
}
for (const removedHeader of ["MATERIALS", "ARTWORK"]) {
  assert.ok(!html.includes(`<span role="columnheader">${removedHeader}`), `table header removed: ${removedHeader}`);
}

assert.ok(html.includes("Embroidery") && html.includes("Screen Print") && html.includes("DTF"), "method column/filter use production methods");
assert.ok(html.includes("QUEUED"), "first station released work maps to queued production state");
assert.ok(html.includes("IN PRODUCTION"), "persisted start timestamp maps to In Production");
assert.ok(html.includes("TRRY-ORD-COMPAT01"), "compatibility pre-start raw-state row remains visible after release");
assert.ok(html.includes("QUALITY CHECK"), "qc stage maps to Quality Check");
assert.ok(html.includes("READY"), "ready stage maps to compact dashboard label");
assert.ok(html.includes("BLOCKED"), "explicit production blocker maps to compact dashboard stage");
assert.ok(html.includes("Start") && html.includes("Update") && html.includes("Inspect") && html.includes("Resolve"), "row actions map to existing drawer open behavior");
assert.ok(!/Confirm Payment|Pay Online|Pay at Shop|Messenger/i.test(html), "Production dashboard has no payment or Messenger controls");

dashboard.state.production.status = "blocked";
html = dashboard.renderProduction({ items: rows });
assert.ok(html.includes("TRRY-ORD-BLOCK01"), "blocked tab includes explicit native blockers");
assert.ok(!html.includes("TRRY-ORD-QUEUED01"), "blocked tab excludes non-blocked queued jobs");

dashboard.state.production.status = "all";
dashboard.state.production.search = "Active Customer";
html = dashboard.renderProduction({ items: rows });
assert.ok(html.includes("TRRY-ORD-INPROD01"), "search matches customer");
assert.ok(!html.includes("TRRY-ORD-QUEUED01"), "search filters unrelated jobs");

dashboard.state.production.search = "";
dashboard.state.production.method = "DTF";
html = dashboard.renderProduction({ items: rows });
assert.ok(html.includes("TRRY-ORD-QC01"), "method filter includes matching method");
assert.ok(!html.includes("TRRY-ORD-INPROD01"), "method filter excludes non-matching method");

dashboard.state.production.method = "all";
dashboard.state.production.staff = "staff-juvy";
html = dashboard.renderProduction({ items: rows });
assert.ok(html.includes("TRRY-ORD-QC01"), "staff filter includes matching assignment");
assert.ok(!html.includes("TRRY-ORD-QUEUED01"), "staff filter excludes unrelated assignment");

const source = await readFile("src/mvpDashboard.js", "utf8");
assert.ok(source.includes("productionWorkflowState"), "Production stage mapping is explicit");
assert.ok(source.includes("productionStartedAt"), "Production dashboard requires persisted start timestamp");
assert.ok(source.includes("productionMaterialsState"), "materials support is deliberately bounded");
assert.ok(source.includes("data-mvp-open=\"production\""), "row actions open existing Production drawer");
assert.ok(source.includes("data-mvp-open-messenger"), "Messenger behavior remains elsewhere and untouched");
assert.ok(!source.includes("PRD-"), "source does not generate fake PRD references");

console.log("PASS Production dashboard Figma structure, release visibility, state mappings, filters, row actions, and payment boundary");
