import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createMvpDashboard } from "../src/mvpDashboard.js";
import {
  buildDualReadOrders,
  findOrderByIdentity,
  matchesOrderIdentity,
  normalizeNativeOrder,
} from "../src/services/orderCompatibility.js";

const legacyInquiry = {
  id: "TRY-LEGACY-001",
  customer: "Legacy Customer",
  contact: "0917-000-0001",
  service: "DTF Print",
  qty: "24 pcs",
  status: "won",
  quoteStatus: "approved",
  orderReference: "TRRY-LEGACY-001",
  odooSO: "SO-LEGACY-001",
  paymentStatus: "awaiting",
  productionStage: "queued",
  artworkStatus: "approved",
  quotedAmount: 2400,
  amountDue: 2400,
};

const nativeSourceInquiry = {
  id: "TRY-NATIVE-SOURCE",
  customer: "Native Customer",
  contact: "0917-000-0002",
  service: "Embroidery",
  qty: "12 pcs",
  status: "approved",
  quoteStatus: "approved",
  orderReference: "TRRY-LEGACY-SHOULD-NOT-WIN",
  odooSO: "SO-SHOULD-NOT-SHOW",
  paymentStatus: "for_verification",
  productionStage: "queued",
  artworkStatus: "approved",
  paymentVerifiedAmount: 1200,
  quotedAmount: 1200,
  amountDue: 1200,
};

const nativeRow = {
  id: "96000000-0000-4000-8000-000000000222",
  order_reference: "TRRY-ORD-NATIVE01",
  source_inquiry_id: "TRY-NATIVE-SOURCE",
  status: "awaiting_payment",
  customer_name: "Native Customer Snapshot",
  customer_contact: "0917-999-9999",
  product: "Embroidery Snapshot",
  quantity: "14 pcs (XL: 14)",
  quoted_amount: 1400,
  amount_due: 1400,
  quote_breakdown: "14 pcs | PHP 100",
  quote_note: "Snapshot note",
  quote_valid_until: "2026-08-31",
  quote_approved_at: "2026-08-08T03:00:00.000Z",
};

const legacyOnly = buildDualReadOrders({ inquiries: [legacyInquiry], nativeRows: [] });
assert.equal(legacyOnly.length, 1, "legacy-only approved inquiries should remain visible as orders");
assert.equal(legacyOnly[0].sourceType, "legacy");
assert.equal(legacyOnly[0].id, "TRY-LEGACY-001");
assert.equal(legacyOnly[0].odooSO, "SO-LEGACY-001");

const nativeOnly = buildDualReadOrders({ inquiries: [], nativeRows: [nativeRow] });
assert.equal(nativeOnly.length, 1, "native-only rows should render without a legacy inquiry copy");
assert.equal(nativeOnly[0].sourceType, "native");
assert.equal(nativeOnly[0].id, "TRY-NATIVE-SOURCE", "native row uses source inquiry id as the temporary action bridge");
assert.equal(nativeOnly[0].nativeOrderId, nativeRow.id);
assert.equal(nativeOnly[0].orderReference, "TRRY-ORD-NATIVE01");
assert.equal(nativeOnly[0].odooSO, "", "native display identity must not fall back to Odoo");
assert.equal(nativeOnly[0].status, "", "native-only row must not synthesize Inquiry status=won");
assert.equal(nativeOnly[0].quoteStatus, "approved");
assert.equal(nativeOnly[0].sizeBreakdown, "XL: 14", "native order derives size breakdown from canonical quantity text");

const mixed = buildDualReadOrders({ inquiries: [legacyInquiry, nativeSourceInquiry], nativeRows: [nativeRow] });
assert.equal(mixed.length, 2, "mixed read should include native and unrelated legacy orders");
assert.deepEqual(mixed.map((item) => item.sourceType), ["native", "legacy"]);
assert.equal(mixed.filter((item) => item.sourceInquiryId === "TRY-NATIVE-SOURCE").length, 1, "native source inquiry suppresses legacy duplicate");

const nativeOrder = mixed[0];
assert.equal(nativeOrder.id, "TRY-NATIVE-SOURCE", "payment confirmation bridge remains Inquiry-ID keyed");
assert.equal(nativeOrder.sourceInquiryId, "TRY-NATIVE-SOURCE", "production save bridge remains Inquiry-ID keyed");
assert.equal(nativeOrder.orderReference, "TRRY-ORD-NATIVE01", "native order reference wins display identity");
assert.equal(nativeOrder.status, "approved", "native row preserves source Inquiry metadata instead of requiring status=won");
assert.equal(nativeOrder.paymentStatus, "for_verification", "current payment state is bridged from source inquiry");
assert.equal(nativeOrder.productionStage, "queued", "current production state is bridged from source inquiry");

assert.equal(findOrderByIdentity(mixed, nativeRow.id)?.sourceType, "native", "URL can resolve native primary id");
assert.equal(findOrderByIdentity(mixed, "TRRY-ORD-NATIVE01")?.sourceType, "native", "URL can resolve native order reference");
assert.equal(findOrderByIdentity(mixed, "TRY-NATIVE-SOURCE")?.sourceType, "native", "native wins exact source inquiry ambiguity");
assert.equal(findOrderByIdentity(mixed, "TRRY-LEGACY-001")?.sourceType, "legacy", "URL can resolve legacy order reference");
assert.equal(matchesOrderIdentity(nativeOrder, "trry-ord-native01"), true, "identity matching is case-insensitive");

const normalized = normalizeNativeOrder({ ...nativeRow, order_reference: "TRRY-ORD-DISPLAY" }, nativeSourceInquiry);
assert.equal(normalized.orderReference, "TRRY-ORD-DISPLAY");
assert.equal(normalized.orderCode, "");
assert.equal(normalized.reference, "");
assert.equal(normalized.code, "");
assert.equal(normalized.odooSO, "");

global.window = {
  location: { search: "?order=TRRY-ORD-NATIVE01" },
};
const dashboard = createMvpDashboard({
  navigate: () => {},
  getAssignmentContext: () => ({ users: [], loadState: "success", error: "" }),
});
assert.equal(dashboard.helpers.findOrderByIdentity(mixed, "TRRY-ORD-NATIVE01")?.nativeOrderId, nativeRow.id);
const rendered = dashboard.renderOrders({ items: mixed });
assert.ok(rendered.includes("TRRY-ORD-NATIVE01"), "Orders UI renders native order_reference");
assert.ok(!rendered.includes("SO-SHOULD-NOT-SHOW"), "native order rendering must not expose legacy Odoo identity");

const main = await readFile("src/main.js", "utf8");
assert.ok(main.includes("buildDualReadOrders"), "/orders uses the dual-read compatibility collection");
assert.ok(main.includes("getNativeOrderRows"), "native orders are read through the compatibility service");
assert.ok(main.includes("payment-confirmations"), "existing payment confirmation contract remains present");
assert.ok(main.includes('["proof_submitted", "under_review", "correction_required"]'), "required payment state remains neutral until a payment method is selected");
assert.ok(main.includes("Reference number <small>(optional for Cash)</small>"), "cash payment reference is explicitly optional");
assert.ok(main.includes("Review the Messenger receipt"), "verified online payment review guidance remains available");
assert.ok(main.includes("if (routePath === legacyOrderDashboardPath) return `${activeOrdersPath}${url.search}`;"), "/order-dashboard preserves compatible query string");
assert.ok(main.includes("normalizeLegacyOrderDashboardRoute()"), "legacy dashboard route is normalized before render");

const dashboardSource = await readFile("src/mvpDashboard.js", "utf8");
assert.ok(dashboardSource.includes("data-mvp-open-messenger"), "Messenger button contract remains present");
assert.ok(dashboardSource.includes("findOrderByIdentity(orders, state.orderId || orderQuery)"), "order URL resolution uses compatibility identity matching");
assert.ok(dashboardSource.includes("findOrderByIdentity(productionJobs, selectedId)"), "production URL resolution uses compatibility identity matching");
assert.ok(dashboardSource.includes('detailLine("Quantity", quantityDisplay(item))'), "Order summary uses the total-only quantity formatter");
assert.ok(dashboardSource.includes("normalize(trailingBreakdown[1]) !== normalize(sizes)"), "quantity formatter strips only an exact trailing copy of the Sizes value");
assert.ok(dashboardSource.includes("quantity.slice(0, trailingBreakdown.index).trim() || quantity"), "Production summary removes the duplicated trailing size breakdown");
assert.ok(dashboardSource.includes('detailLine("Sizes", item.sizeBreakdown || "Not set")'), "Order summary keeps size breakdown in the Sizes row");

console.log("PASS Orders dual-read compatibility, native identity, legacy suppression, and Inquiry-ID bridges");
