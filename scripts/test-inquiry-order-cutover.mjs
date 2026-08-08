import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createMvpDashboard } from "../src/mvpDashboard.js";
import {
  buildDualReadOrders,
  normalizeNativeOrderResponseToRow,
} from "../src/services/orderCompatibility.js";

global.window = {
  location: { search: "" },
  setTimeout,
};

const approvedInquiry = {
  id: "TRY-CUTOVER-001",
  customer: "Cutover Customer",
  contact: "0917-123-4567",
  source: "Website",
  service: "DTF Print",
  productDesc: "Logo shirt",
  qty: "10 pcs",
  status: "sent",
  quoteStatus: "approved",
  quotedAmount: 850,
  amountDue: 850,
  quoteBreakdown: "Logo shirt | 10 pcs | PHP 850",
  quoteNotes: "Approved customer quote.",
  quoteValidUntil: "2026-08-31",
  quoteApprovedAt: "2026-08-08T02:00:00.000Z",
  artworkStatus: "approved",
  dueDate: "2026-08-20",
};

const dashboard = createMvpDashboard({
  navigate: () => {},
  getAssignmentContext: () => ({ users: [], loadState: "success", error: "" }),
});
dashboard.state.inquiryId = approvedInquiry.id;
let rendered = dashboard.renderInquiries({ items: [approvedInquiry] });

assert.ok(rendered.includes('data-mvp-inquiry-panel="quotation"'), "approved Inquiry keeps the Quotation tab available");
assert.ok(rendered.includes("Create Order"), "approved Inquiry without native Order shows Create Order");
assert.ok(rendered.includes('data-mvp-create-order="TRY-CUTOVER-001"'), "Create Order uses native conversion action hook");
assert.ok(rendered.includes("Pre-order requirements"), "approved Inquiry shows canonical pre-order readiness");
assert.ok(rendered.includes("QT-TRY-CUTOVER-001"), "approved quote reference is shown");
assert.ok(rendered.includes("Approved"), "approved quote state is shown");
assert.ok(rendered.includes("Customer approval"), "customer approval state is shown");
assert.ok(rendered.includes("Approved customer quote."), "quote note remains visible");
assert.ok(!rendered.includes("PAYMENT REQUIRED"), "payment-required marker must not render inside Inquiry");
assert.ok(!rendered.includes("Amount Due"), "amount due belongs to Order payment workflow");
assert.ok(!rendered.includes("Payment Option"), "payment option belongs to Order");
assert.ok(!rendered.includes("Payment Method"), "payment method belongs to Order");
assert.ok(!rendered.includes("Payment Status"), "payment status belongs to Order");
assert.ok(!rendered.includes("Add Odoo SO"), "legacy Odoo creation UI must not be active in Inquiry drawer");
assert.ok(!rendered.includes("CONFIRM &amp; CREATE ORDER"), "legacy confirm Odoo SO control must not render");

for (const [name, inquiry, expectedLabel] of [
  ["artwork pending", { ...approvedInquiry, id: "TRY-ART-PENDING", artworkStatus: "submitted" }, "Complete Artwork"],
  ["due date missing", { ...approvedInquiry, id: "TRY-DUE-MISSING", dueDate: "" }, "Set Due Date"],
  ["product missing", { ...approvedInquiry, id: "TRY-PRODUCT-MISSING", productDesc: "", service: "", qty: "" }, "Create Order Blocked"],
  ["revision active", { ...approvedInquiry, id: "TRY-REVISION", artworkStatus: "revision_requested", blockedReason: "Customer requested artwork revision" }, "Complete Artwork"],
]) {
  dashboard.state.inquiryId = inquiry.id;
  dashboard.state.inquiryActionId = null;
  rendered = dashboard.renderInquiries({ items: [inquiry] });
  assert.ok(rendered.includes(expectedLabel), `pre-order gate surfaces ${expectedLabel} for ${name}`);
  assert.ok(!rendered.includes(`data-mvp-create-order="${inquiry.id}"`), `pre-order gate blocks Create Order for ${name}`);
}

dashboard.state.inquiryId = "TRY-DUE-MISSING";
dashboard.state.inquiryActionId = "TRY-DUE-MISSING";
rendered = dashboard.renderInquiries({ items: [{ ...approvedInquiry, id: "TRY-DUE-MISSING", dueDate: "" }] });
assert.ok(rendered.includes('data-ops-customer-action="set_due_date"'), "Set Due Date editor saves through Inquiry customer-action contract");

const existingNative = {
  ...approvedInquiry,
  nativeOrderId: "96000000-0000-4000-8000-000000000333",
  nativeOrderReference: "TRRY-ORD-CUTOVER",
};
dashboard.state.inquiryId = existingNative.id;
rendered = dashboard.renderInquiries({ items: [existingNative] });
assert.ok(rendered.includes("View Order"), "existing native Order shows View Order");
assert.ok(rendered.includes("/orders?order=TRRY-ORD-CUTOVER"), "View Order navigates with native orderReference");
assert.ok(!rendered.includes('data-mvp-create-order="TRY-CUTOVER-001"'), "existing native Order does not offer Create Order");

const nativeRow = normalizeNativeOrderResponseToRow({
  id: existingNative.nativeOrderId,
  orderReference: existingNative.nativeOrderReference,
  sourceInquiryId: existingNative.id,
  status: "awaiting_payment",
  quotedAmount: 850,
  amountDue: 850,
});
const orders = buildDualReadOrders({
  inquiries: [{ ...approvedInquiry, status: "won", odooSO: "SO-LEGACY-SUPPRESSED" }],
  nativeRows: [nativeRow],
});
assert.equal(orders.length, 1, "native row suppresses matching legacy order display");
assert.equal(orders[0].orderReference, "TRRY-ORD-CUTOVER");
assert.equal(orders[0].odooSO, "", "native display remains Odoo-independent");

const main = await readFile("src/main.js", "utf8");
assert.ok(main.includes("POST"), "native conversion uses an explicit POST request");
assert.ok(main.includes("/api/inquiries/${encodeURIComponent(inquiryId)}/orders"), "Create Order posts to the verified native conversion endpoint");
assert.ok(main.includes("nativeOrderConversionRequests[id]?.status === \"loading\""), "frontend blocks repeated concurrent conversion calls");
assert.ok(main.includes("navigateTo(`/orders?order=${encodeURIComponent(routeIdentity)}`)"), "success navigates to returned native identity");
assert.ok(main.includes("loadNativeOrderRows()"), "success reconciles native Orders data");

const createOrderFunction = main.match(/async function createNativeOrderFromInquiry[\s\S]*?\r?\n}\r?\n\r?\nasync function requestMvpPaymentConfirmation/)?.[0] || "";
assert.ok(createOrderFunction, "native Create Order handler exists");
assert.ok(!createOrderFunction.includes("confirm_order"), "native Create Order handler must not call legacy confirm_order");
assert.ok(!createOrderFunction.includes("odooSO"), "native Create Order handler must not write Odoo SO");

const dashboardSource = await readFile("src/mvpDashboard.js", "utf8");
assert.ok(dashboardSource.includes('action.kind === "create_order"'), "MVP drawer has a native Create Order action kind");
assert.ok(dashboardSource.includes("data-mvp-create-order"), "Create Order is wired through a native action hook");
assert.ok(dashboardSource.includes("data-mvp-open-messenger"), "Messenger behavior remains present");

console.log("PASS Inquiry native Order cutover UI, Odoo deactivation, payment boundary, and duplicate-submit guardrails");
