import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createMvpDashboard } from "../src/mvpDashboard.js";
import { renderOnlinePaymentReview } from "../src/paymentReviewView.js";

const main = await readFile("src/main.js", "utf8");
const dashboardSource = await readFile("src/mvpDashboard.js", "utf8");
const paymentView = await readFile("src/paymentReviewView.js", "utf8");

const functionBody = (name) => {
  const start = main.indexOf(`function ${name}`) >= 0
    ? main.indexOf(`function ${name}`)
    : main.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} exists`);
  const next = main.indexOf("\nfunction ", start + 20);
  const nextAsync = main.indexOf("\nasync function ", start + 20);
  const ends = [next, nextAsync].filter((index) => index > start);
  return main.slice(start, ends.length ? Math.min(...ends) : main.length);
};

const loadPayment = functionBody("loadOnlinePaymentReview");
assert.doesNotMatch(loadPayment, /\brender\(\)/, "payment fetch does not full-render the drawer");
assert.match(loadPayment, /replaceActiveInquiryPaymentSection\(inquiryId\)/, "payment fetch updates only payment container");
assert.match(loadPayment, /mvpDashboard\.state\.inquiryId[\s\S]+requestInquiryId/, "stale online payment responses are guarded");
assert.match(main, /onlinePaymentReviewByInquiry\[inquiryId\]/, "payment cache is keyed by inquiry ID");
assert.match(main, /\["loading", "loaded"\]\.includes/, "payment cache uses loading/loaded states to prevent duplicate fetches");
assert.match(main, /refreshOpsInquiryDataForPayment\(inquiryId\)/, "payment mutation refreshes payment data without route fetch churn");
assert.match(dashboardSource, /renderInquiryHistoryPanel: inquiryHistoryTab/, "affected history panel can be refreshed directly");
assert.doesNotMatch(main, /PAYMENT WORKFLOW PARKED/, "parked payment copy is removed");
assert.match(main, /FULL PAYMENT REQUIRED/, "below-threshold full-payment state is present");
assert.match(main, /Full payment is required for quotations below \$\{formatOpsValue\(1000\)\}/, "below-threshold notice uses peso formatter");
assert.doesNotMatch(main, /FULL PAYMENT ONLY BELOW PHP/, "payment validation does not use PHP currency copy");

const confirmedPayment = {
  inquiryId: "TRRY-WZTBV9U2",
  customer: "QA Customer",
  paymentStatus: "down_payment_confirmed",
  paymentMethod: "gcash",
  paymentType: "down_payment",
  submittedAmount: 525,
  quotedAmount: 1050,
  amountDue: 525,
  customerReference: "QA-P9B2-ONLINE-DP-REF",
  customerNote: "Synthetic staging DP receipt for visual QA.",
  submittedAt: "2026-07-31T02:45:00.000Z",
  verifiedAmount: 525,
  verifiedAt: "2026-07-31T02:45:00.000Z",
  verifiedBy: "QA Staff",
  receipt: { available: true, contentType: "image/png", filename: "receipt.png" },
  permissions: { canRead: true, canConfirm: false, canRequestCorrection: false, canStartReview: false },
};

const confirmedSummary = renderOnlinePaymentReview(
  { id: confirmedPayment.inquiryId },
  { status: "loaded", payment: confirmedPayment },
);
assert.match(confirmedSummary, /DOWN PAYMENT CONFIRMED/);
assert.match(confirmedSummary, /₱525/);
assert.match(confirmedSummary, /Remaining balance/);
assert.doesNotMatch(confirmedSummary, /PHP 525|PHP 1,050/);

const confirmedModal = renderOnlinePaymentReview(
  { id: confirmedPayment.inquiryId },
  {
    status: "loaded",
    payment: confirmedPayment,
    dialog: "review",
    proofStatus: "opened",
    proof: { signedUrl: "https://signed.example/receipt.png", contentType: "image/png" },
  },
);
assert.match(confirmedModal, /PAID[\s\S]*₱525/);
assert.match(confirmedModal, /REMAINING[\s\S]*₱525/);
assert.match(confirmedModal, /RECEIPT DETAILS/);
assert.match(confirmedModal, /QA-P9B2-ONLINE-DP-REF/);
assert.doesNotMatch(confirmedModal, /Confirmed DP|Remaining after confirmation/);
assert.match(confirmedModal, /data-payment-review-cancel aria-label="Close payment dialog"|>CLOSE</);

const failedPreview = renderOnlinePaymentReview(
  { id: confirmedPayment.inquiryId },
  { status: "loaded", payment: confirmedPayment, dialog: "review", proofStatus: "error" },
);
assert.match(failedPreview, /Receipt preview unavailable/);
assert.match(failedPreview, /OPEN RECEIPT/);
assert.match(failedPreview, /RETRY/);

const pdfPreview = renderOnlinePaymentReview(
  { id: confirmedPayment.inquiryId },
  {
    status: "loaded",
    payment: { ...confirmedPayment, receipt: { available: true, contentType: "application/pdf", filename: "receipt.pdf" } },
    dialog: "review",
    proofStatus: "opened",
    proof: { signedUrl: "https://signed.example/receipt.pdf", contentType: "application/pdf" },
  },
);
assert.match(pdfPreview, /iframe class="payment-receipt-preview"/);
assert.match(pdfPreview, /OPEN PDF/);

globalThis.window = { location: { pathname: "/inquiries", search: "" } };
const dashboard = createMvpDashboard();
const inquiry850 = {
  id: "TRRY-B3QCECZ2",
  customer: "Below Threshold",
  status: "sent",
  quoteStatus: "approved",
  quotedAmount: 850,
  amountDue: 850,
  paymentStatus: "required",
  paymentMethod: "",
  paymentType: "",
  artworkStatus: "approved",
  productDesc: "Jacket",
  service: "Embroidery",
  qty: "1",
};
dashboard.state.inquiryId = inquiry850.id;
const drawerHtml = dashboard.renderInquiries({
  items: [inquiry850],
  renderPayment: () => `<section class="ops-stage-section payment-review-section" data-stage="payment"><header><div><span></span><h3>PAYMENT</h3></div><mark>FULL PAYMENT REQUIRED</mark></header><div class="ops-stage-body">Quote total: ₱850 Balance: ₱850</div></section>`,
});
assert.match(drawerHtml, /data-mvp-inquiry-panel="details"[\s\S]+FULL PAYMENT REQUIRED/);
assert.doesNotMatch(drawerHtml.match(/data-mvp-inquiry-panel="request"[\s\S]*?data-mvp-inquiry-panel="notes"/)?.[0] || "", /PAYMENT|Customer Message/);
assert.doesNotMatch(drawerHtml, /PAYMENT WORKFLOW PARKED|Required DP|50%/);
assert.match(drawerHtml, /₱850/);

assert.match(paymentView, /payment-receipt-preview fallback/, "failed image preview has a fallback instead of blank box");
assert.match(paymentView, /application\/pdf|OPEN PDF|payment-receipt-pdf/, "PDF receipt preview or OPEN PDF fallback exists");

console.log("PASS Phase 9B4.1 inquiry drawer payment no-refresh, preview, currency, and state regressions");
