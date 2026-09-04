import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createMvpDashboard } from "../src/mvpDashboard.js";
import { mapInquiryToOpsRow, mapOpsRowToInquiry } from "../src/services/opsBoard.js";
import { buildDualReadOrders, normalizeNativeOrderResponseToRow } from "../src/services/orderCompatibility.js";

globalThis.window = { location: { search: "" } };

const mainSource = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const customerServiceSource = readFileSync(new URL("../src/services/adminCustomers.js", import.meta.url), "utf8");

assert.match(mainSource, /\["customerName", "Customer Name"\]/, "Inquiry capture keeps a separate Customer Name field.");
assert.match(mainSource, /\["mobileNumber", "PH Mobile"\]/, "Inquiry capture exposes a separate PH Mobile field.");
assert.match(mainSource, /if \(!mobile\) return \{ \.\.\.inquiry, customerId: null \};/, "Blank mobile remains anonymous and saves a nullable customer_id.");
assert.match(customerServiceSource, /find_or_create_customer_identity_c2_1/, "C2.2 service calls the canonical C2.1 RPC.");
assert.match(mainSource, /renderIntake: renderOpsIntakeWorkflow/, "MVP Inquiries page mounts the existing Ops intake workflow.");
assert.match(mainSource, /opsInquirySaveInFlight/, "Inquiry intake save path guards against double-submit.");
assert.match(mainSource, /if \(!opsExtractFields\) opsExtractFields = \{ \.\.\.emptyOpsExtract \};/, "New Inquiry seeds the review form so C2.2 identity fields are visible immediately.");

const linkedInquiry = mapOpsRowToInquiry({
  id: "TRY-C22-001",
  customer_id: "11111111-1111-4111-8111-111111111111",
  customer_name: "C2 Linked Customer",
  contact: "+639176042201",
  product: "DTF",
  quantity: "12 pcs",
});
assert.equal(linkedInquiry.customerId, "11111111-1111-4111-8111-111111111111");
assert.equal(linkedInquiry.contact, "+639176042201");

assert.deepEqual(mapInquiryToOpsRow({
  id: "TRY-C22-001",
  customerId: "11111111-1111-4111-8111-111111111111",
  customer: "C2 Linked Customer",
  contact: "+639176042201",
}).customer_id, "11111111-1111-4111-8111-111111111111");

const normalizedOrderRow = normalizeNativeOrderResponseToRow({
  id: "order-1",
  orderReference: "TRRY-ORD-C22TEST1",
  sourceInquiryId: "TRY-C22-001",
  customerId: "11111111-1111-4111-8111-111111111111",
  customerName: "C2 Linked Customer",
  customerContact: "+639176042201",
});
assert.equal(normalizedOrderRow.customer_id, "11111111-1111-4111-8111-111111111111");

const [order] = buildDualReadOrders({
  inquiries: [linkedInquiry],
  nativeRows: [{
    id: "order-1",
    order_reference: "TRRY-ORD-C22TEST1",
    source_inquiry_id: "TRY-C22-001",
    customer_id: "11111111-1111-4111-8111-111111111111",
    customer_name: "C2 Linked Customer",
    customer_contact: "+639176042201",
  }],
});
assert.equal(order.customerId, "11111111-1111-4111-8111-111111111111", "Order display preserves linked customer_id.");

const dashboard = createMvpDashboard();
const closedInquiryHtml = dashboard.renderInquiries({ items: [], renderIntake: () => '<div id="ops-raw-message"></div>' });
assert.match(closedInquiryHtml, /data-mvp-new-inquiry/, "Visible New Inquiry button is wired to the dashboard intake state.");
assert.doesNotMatch(closedInquiryHtml, /mvp-inquiry-new-action[^>]*disabled/, "Visible New Inquiry button is enabled.");

dashboard.state.inquiryIntakeOpen = true;
const intakeHtml = dashboard.renderInquiries({
  items: [],
  renderIntake: () => '<textarea id="ops-raw-message"></textarea><button id="ops-extract-inquiry"></button>',
});
assert.match(intakeHtml, /mvp-inquiry-intake-panel/, "New Inquiry button renders the existing intake panel when opened.");
assert.match(intakeHtml, /id="ops-raw-message"/, "Opened intake panel contains the existing raw inquiry input.");
assert.match(intakeHtml, /id="ops-extract-inquiry"/, "Opened intake panel contains the existing extraction control.");
assert.match(mainSource, /opsExtractFields \? renderOpsReviewForm\(\) : ""/, "Opened intake panel renders the existing review form once seeded.");
assert.match(mainSource, /renderOpsInput\(key, label, fields\[key\]\)/, "Opened review form reuses existing data-ops-field inputs.");

dashboard.state.inquiryId = "TRY-C22-001";
const inquiryHtml = dashboard.renderInquiries({
  items: [{
    ...linkedInquiry,
    status: "new",
    service: "DTF",
    qty: "12 pcs",
    customerReference: "CUS-0001",
  }],
});
assert.match(inquiryHtml, /CUSTOMER IDENTITY/, "Inquiry drawer renders the C2 customer identity panel.");
assert.match(inquiryHtml, /LINKED CUSTOMER IDENTITY/, "Inquiry drawer shows linked customer identity state.");

dashboard.state.inquiryId = "TRY-C22-002";
const existingHtml = dashboard.renderInquiries({
  items: [{
    id: "TRY-C22-002",
    customer: "C2 Existing Customer",
    contact: "0917 604 2202",
    service: "DTF",
    qty: "4 pcs",
    status: "new",
    customerIdentityMatch: {
      id: "22222222-2222-4222-8222-222222222222",
      customer_reference: "CUS-0002",
      full_name: "C2 Existing Customer",
      mobile_normalized: "+639176042202",
    },
  }],
});
assert.match(existingHtml, /Existing customer match/, "Existing normalized mobile match state renders.");
assert.match(existingHtml, /Use Existing/, "Existing match exposes Use Existing.");

dashboard.state.inquiryId = "TRY-C22-003";
const invalidHtml = dashboard.renderInquiries({
  items: [{
    id: "TRY-C22-003",
    customer: "C2 Invalid Customer",
    contact: "12345",
    service: "DTF",
    qty: "4 pcs",
    status: "new",
  }],
});
assert.match(invalidHtml, /Invalid PH mobile/, "Invalid PH mobile state renders.");

dashboard.state.inquiryId = "TRY-C22-004";
const anonymousHtml = dashboard.renderInquiries({
  items: [{
    id: "TRY-C22-004",
    customer: "Walk-in",
    contact: "",
    service: "DTF",
    qty: "1 pc",
    status: "new",
  }],
});
assert.match(anonymousHtml, /Anonymous inquiry/, "Blank mobile renders anonymous/unlinked state.");

dashboard.state.orderId = "TRY-C22-001";
const orderHtml = dashboard.renderOrders({ items: [{ ...order, status: "won", quoteStatus: "approved" }] });
assert.match(orderHtml, /ORDER CUSTOMER IDENTITY/, "Order drawer renders linked identity proof.");
assert.match(orderHtml, /Preserved from Inquiry/, "Order drawer labels identity preservation.");

console.log("PASS Customer C2.2 UI/service identity linking contract");
