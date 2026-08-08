import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createMvpDashboard } from "../src/mvpDashboard.js";

global.window = { location: { search: "" }, history: { replaceState() {} }, setTimeout };

const team = [
  { userId: "owner-james", displayName: "James", email: "james@trry.test", role: "owner" },
  { userId: "owner-maya", displayName: "Maya", email: "maya@trry.test", role: "admin" },
];

const base = {
  status: "won",
  quoteStatus: "approved",
  artworkStatus: "approved",
  fulfillmentMethod: "pickup",
  service: "Embroidery",
  qty: "40 pcs",
  dueDate: "2026-08-09",
  quotedAmount: 3200,
  amountDue: 3200,
  assignedUserId: "owner-james",
};

const rows = [
  {
    ...base,
    id: "TRY-AWAIT-001",
    status: "approved",
    sourceType: "native",
    nativeOrderId: "96000000-0000-4000-8000-000000000001",
    sourceInquiryId: "TRY-AWAIT-001",
    sourceInquiryReference: "TRY-AWAIT-001",
    orderReference: "TRRY-ORD-AWAIT01",
    customer: "Teresa Gonzales",
    contact: "+63 917 420 9911",
    productDesc: "Polo shirts",
    paymentStatus: "awaiting_payment",
    productionStage: "queued",
  },
  {
    ...base,
    id: "TRY-REVIEW-001",
    status: "approved",
    sourceType: "native",
    nativeOrderId: "96000000-0000-4000-8000-000000000002",
    sourceInquiryId: "TRY-REVIEW-001",
    orderReference: "TRRY-ORD-REVIEW01",
    customer: "Review Customer",
    contact: "0917-000-0002",
    productDesc: "Team jackets",
    paymentStatus: "proof_submitted",
    productionStage: "queued",
  },
  {
    ...base,
    id: "TRY-READY-001",
    status: "approved",
    sourceType: "native",
    nativeOrderId: "96000000-0000-4000-8000-000000000003",
    sourceInquiryId: "TRY-READY-001",
    orderReference: "TRRY-ORD-READY01",
    customer: "Ready Customer",
    contact: "0917-000-0003",
    productDesc: "Caps",
    paymentStatus: "paid",
    paymentVerifiedAmount: 3200,
    productionStage: "queued",
  },
  {
    ...base,
    id: "TRY-PROD-001",
    sourceType: "legacy",
    orderReference: "TRRY-LEGACY-PROD01",
    odooSO: "SO-LEGACY-PROD01",
    customer: "Legacy Production",
    contact: "0917-000-0004",
    productDesc: "Tote bags",
    paymentStatus: "paid",
    paymentVerifiedAmount: 3200,
    productionStage: "printing",
  },
  {
    ...base,
    id: "TRY-BLOCK-001",
    sourceType: "legacy",
    orderReference: "TRRY-LEGACY-BLOCK01",
    customer: "Blocked Customer",
    contact: "0917-000-0005",
    productDesc: "Uniforms",
    paymentStatus: "paid",
    paymentVerifiedAmount: 3200,
    productionStage: "queued",
    blockedReason: "Materials unavailable",
  },
  {
    ...base,
    id: "TRY-ONLINE-001",
    status: "approved",
    sourceType: "native",
    nativeOrderId: "96000000-0000-4000-8000-000000000006",
    orderReference: "TRRY-ORD-ONLINE01",
    customer: "Messenger Customer",
    contact: "0917-000-0006",
    productDesc: "Shirts",
    paymentMethod: "online",
    paymentStatus: "awaiting_payment",
    productionStage: "queued",
  },
  {
    ...base,
    id: "TRY-R4-STAGING",
    status: "approved",
    sourceType: "native",
    nativeOrderId: "96000000-0000-4000-8000-000000000013",
    sourceInquiryId: "TRY-R4-STAGING",
    orderReference: "TRRY-ORD-STG13A01",
    customer: "Phase 13 Staging Synthetic",
    contact: "0917-000-0013",
    productDesc: "Native staging fixture",
    paymentStatus: "paid",
    paymentVerifiedAmount: 3200,
    productionStage: "queued",
  },
  {
    ...base,
    id: "TRY-ODOO-ONLY",
    status: "won",
    sourceType: "",
    orderReference: "",
    odooSO: "SO-R4-ODOO-ONLY",
    customer: "Odoo Only Negative",
    contact: "0917-000-0014",
    productDesc: "Historical only",
    paymentStatus: "paid",
    paymentVerifiedAmount: 3200,
    productionStage: "printing",
  },
];

const dashboard = createMvpDashboard({
  getAssignmentContext: () => ({ users: team, loadState: "success", error: "" }),
});
dashboard.state.order.pageSize = 10;

let html = dashboard.renderOrders({ items: rows });

assert.ok(html.includes("mvp-orders-dashboard-page"), "dashboard shell should render");
assert.ok(html.includes("Track payment, release readiness, production progress, and fulfillment."), "Figma header subtitle should render");
assert.ok(html.includes("Awaiting Payment"), "KPI and tab labels render");
assert.ok(html.includes("Payment Review"), "payment review tab renders");
assert.ok(html.includes("Ready to Release"), "ready release KPI/tab renders");
assert.ok(html.includes("ORDER"), "table header renders");
assert.ok(html.indexOf("ORDER") < html.indexOf("CUSTOMER"), "ORDER precedes CUSTOMER");
assert.ok(html.indexOf("CUSTOMER") < html.indexOf("SUMMARY"), "CUSTOMER precedes SUMMARY");
assert.ok(html.indexOf("SUMMARY") < html.indexOf("AMOUNT"), "SUMMARY precedes AMOUNT");
assert.ok(html.indexOf("AMOUNT") < html.indexOf("PAYMENT"), "AMOUNT precedes PAYMENT");
assert.ok(html.indexOf("PAYMENT") < html.indexOf("PRODUCTION"), "PAYMENT precedes PRODUCTION");
assert.ok(html.indexOf("PRODUCTION") < html.indexOf("DUE"), "PRODUCTION precedes DUE");
assert.ok(html.indexOf("DUE") < html.indexOf("OWNER"), "DUE precedes OWNER");
assert.ok(html.indexOf("OWNER") < html.indexOf("NEXT ACTION"), "OWNER precedes NEXT ACTION");
assert.ok(html.indexOf("NEXT ACTION") < html.indexOf("ACTION"), "NEXT ACTION precedes ACTION");
assert.ok(html.includes("TRRY-ORD-AWAIT01"), "native orders display orders.order_reference");
assert.ok(html.includes("TRRY-ORD-STG13A01"), "native Order with source Inquiry status=approved is visible in Orders");
assert.ok(!html.includes("SO-SHOULD-NOT-SHOW"), "native identity does not fall back to Odoo");
assert.ok(!html.includes("SO-R4-ODOO-ONLY"), "Odoo-only won Inquiry does not become an active Order row");
assert.ok(html.includes("FROM INQUIRY"), "source inquiry bridge is shown as secondary metadata");
assert.ok(html.includes("Balance due"), "awaiting payment is payment-owned dashboard state");
assert.ok(html.includes("NOT READY"), "awaiting payment remains production-not-ready, not an explicit blocker");
assert.ok(html.includes("For verification"), "submitted proof maps to Payment Review");
assert.ok(html.includes("READY"), "paid and gate-clear order maps to Ready");
assert.ok(html.includes("QUEUED FOR PRODUCTION"), "released-but-not-started production state appears as queued");
assert.ok(html.includes("RESOLVE BLOCKER"), "explicit blockers remain visible");
assert.ok(html.includes("data-mvp-open=\"order\""), "rows/actions open the existing order drawer");

dashboard.state.order.status = "payment_review";
dashboard.state.order.page = 1;
html = dashboard.renderOrders({ items: rows });
assert.ok(html.includes("TRRY-ORD-REVIEW01"), "Payment Review status tab includes submitted proof");
assert.ok(!html.includes("TRRY-ORD-AWAIT01"), "Payment Review tab excludes Pay Online awaiting rows");
assert.ok(!html.includes("TRRY-ORD-ONLINE01"), "Pay Online/Messenger awaiting payment is not payment submitted");

dashboard.state.order.status = "all";
dashboard.state.order.search = "Teresa";
html = dashboard.renderOrders({ items: rows });
assert.ok(html.includes("TRRY-ORD-AWAIT01"), "search matches customer");
assert.ok(!html.includes("TRRY-ORD-REVIEW01"), "search filters unrelated rows");

dashboard.state.order.search = "";
dashboard.state.order.payment = "awaiting";
html = dashboard.renderOrders({ items: rows });
assert.ok(html.includes("TRRY-ORD-AWAIT01"), "payment filter includes awaiting payment");
assert.ok(html.includes("TRRY-ORD-ONLINE01"), "Pay Online waiting for manual receipt remains awaiting payment");
assert.ok(!html.includes("TRRY-ORD-REVIEW01"), "awaiting filter excludes receipt review");

global.window.location.search = "?order=TRRY-ORD-READY01";
dashboard.state.order.payment = "all";
html = dashboard.renderOrders({ items: rows });
assert.ok(html.includes("TRRY-ORD-READY01"), "URL order reference resolves selected drawer");
assert.ok(html.includes("ORDER SUMMARY"), "existing order drawer renders after URL resolution");

global.window.location.search = "?order=SO-LEGACY-PROD01";
html = dashboard.renderOrders({ items: rows, renderPayment: () => `<button data-mvp-confirm-payment>Confirm Payment</button>`, renderTracking: () => `<button>Save Tracking</button>` });
assert.ok(html.includes("Historical Read Only"), "legacy compatibility drawer is read-only");
assert.ok(!html.includes("data-mvp-confirm-payment"), "legacy compatibility drawer does not render active payment controls");

const source = await readFile("src/mvpDashboard.js", "utf8");
assert.ok(source.includes("data-mvp-open-messenger"), "Messenger contract remains in source");
assert.ok(source.includes("ordersDashboardTable"), "Phase 4B dashboard table is the active Orders renderer");
assert.ok(source.includes("findOrderByIdentity(orders, state.orderId || orderQuery)"), "native/legacy URL identity resolution remains intact");
assert.ok(source.includes("orderReference(item)"), "dashboard uses order reference identity");
assert.ok(source.includes("hasNativeOrderAuthority(item)"), "active Order workflow controls require native Order authority");

console.log("PASS Orders dashboard rendering, native identity, filters, payment boundary, and drawer reachability");
