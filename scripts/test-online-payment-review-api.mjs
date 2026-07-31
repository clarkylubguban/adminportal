import assert from "node:assert/strict";
import { createPaymentReviewHandler, normalizePaymentReview } from "../api/_lib/paymentReview.js";

const actorId = "11111111-1111-4111-8111-111111111111";
const inquiry = {
  id: "QA-ONLINE-PAY-9A",
  customer_name: "QA ONLINE PAYMENT REVIEW PHASE 9A",
  quote_status: "approved",
  quoted_amount: 1500,
  amount_due: 1500,
  payment_status: "proof_submitted",
  payment_method: "gcash",
  payment_type: "full",
  payment_selected_amount: 1500,
  payment_reference: "QA-REFERENCE",
  payment_customer_note: "Synthetic QA note",
  payment_proof_path: "QA-ONLINE-PAY-9A/payments/private-receipt.pdf",
  payment_receipt_filename: "qa-receipt.pdf",
  payment_receipt_content_type: "application/pdf",
  payment_receipt_size: 2048,
  payment_proof_submitted_at: "2026-07-30T01:00:00.000Z",
  payment_review_note: "",
  payment_internal_note: "Manager-only note",
  updated_at: "2026-07-30T01:00:00.123456+00:00",
};
const events = [{
  event_type: "ONLINE_PAYMENT_REVIEW_STARTED",
  previous_status: "proof_submitted",
  next_status: "under_review",
  payment_method: "gcash",
  amount: 1500,
  review_note: "",
  internal_note: "Manager-only event note",
  actor_user_id: actorId,
  actor_role: "admin",
  source: "ADMIN_PORTAL",
  created_at: "2026-07-30T01:01:00.000Z",
}];

const manager = normalizePaymentReview(
  inquiry,
  events,
  [{ user_id: actorId, display_name: "QA Admin", role: "admin" }],
  "admin",
);
assert.equal(manager.permissions.canConfirm, true);
assert.equal(manager.internalNote, "Manager-only note");
assert.equal(manager.history[0].label, "ONLINE PAYMENT REVIEW STARTED");
assert.equal(manager.history[0].actorDisplayName, "QA Admin");
assert.equal(manager.version, inquiry.updated_at, "database timestamp precision is preserved");

const staff = normalizePaymentReview(inquiry, events, [], "staff");
assert.equal(staff.permissions.canConfirm, false);
assert.equal(staff.permissions.canRequestCorrection, false);
assert.equal(staff.internalNote, "");
assert.equal(staff.history[0].internalNote, "");

const downPaymentReview = normalizePaymentReview({
  ...inquiry,
  quoted_amount: 1050,
  amount_due: 1050,
  payment_type: "down_payment",
  payment_selected_amount: 525,
}, [], [], "admin");
assert.equal(downPaymentReview.permissions.canConfirm, true);
assert.equal(downPaymentReview.submittedAmount, 525);
assert.equal(downPaymentReview.limitation, "");

const calls = [];
const baseDependencies = {
  featureEnabled: () => true,
  createServiceClient: () => ({ kind: "service" }),
  createUserClient: () => ({ kind: "user" }),
  getAuthUser: async () => ({ id: actorId }),
  getPortalProfile: async () => ({
    user_id: actorId,
    display_name: "QA Admin",
    role: "admin",
    is_active: true,
  }),
  getInquiry: async () => ({ ...inquiry }),
  getPaymentEvents: async () => events,
  getDisplayProfiles: async () => [{
    user_id: actorId,
    display_name: "QA Admin",
    role: "admin",
  }],
  invokeReview: async (_client, id, body) => calls.push({ id, body }),
  getProofObject: async () => ({ contentType: "application/pdf" }),
  createProofUrl: async () => "signed-proof-link",
};

{
  const response = await runHandler(createPaymentReviewHandler(baseDependencies), {
    method: "GET",
    url: "/api/inquiries/QA-ONLINE-PAY-9A/payment-review",
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.payment.inquiryId, inquiry.id);
  const serialized = JSON.stringify(response.body);
  assert.doesNotMatch(serialized, /payment_proof_path|private-receipt|actor_user_id|idempotency/i);
}

{
  const response = await runHandler(createPaymentReviewHandler(baseDependencies), {
    method: "PATCH",
    url: "/api/inquiries/QA-ONLINE-PAY-9A/payment-review",
    body: {
      action: "confirm_online_payment",
      verifiedAmount: 1500,
      expectedVersion: inquiry.updated_at,
      idempotencyKey: "online:qa:confirm:1",
    },
  });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.action, "confirm_online_payment");
}

{
  const ownerHandler = createPaymentReviewHandler({
    ...baseDependencies,
    getPortalProfile: async () => ({ role: "owner", is_active: true }),
  });
  const response = await runHandler(ownerHandler, {
    method: "PATCH",
    url: "/api/inquiries/QA-ONLINE-PAY-9A/payment-review",
    body: {
      action: "start_online_payment_review",
      expectedVersion: inquiry.updated_at,
      idempotencyKey: "online:qa:owner:1",
    },
  });
  assert.equal(response.status, 200);
}

{
  const staffHandler = createPaymentReviewHandler({
    ...baseDependencies,
    getPortalProfile: async () => ({ role: "staff", is_active: true }),
  });
  const response = await runHandler(staffHandler, {
    method: "PATCH",
    url: "/api/inquiries/QA-ONLINE-PAY-9A/payment-review",
    body: {
      action: "confirm_online_payment",
      verifiedAmount: 1500,
      expectedVersion: inquiry.updated_at,
      idempotencyKey: "online:qa:staff:1",
    },
  });
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, "PAYMENT_REVIEW_WRITE_FORBIDDEN");
}

{
  const inactiveHandler = createPaymentReviewHandler({
    ...baseDependencies,
    getPortalProfile: async () => ({ role: "admin", is_active: false }),
  });
  const response = await runHandler(inactiveHandler, {
    method: "GET",
    url: "/api/inquiries/QA-ONLINE-PAY-9A/payment-review",
  });
  assert.equal(response.status, 403);
}

{
  const anonymous = await runHandler(createPaymentReviewHandler(baseDependencies), {
    method: "GET",
    url: "/api/inquiries/QA-ONLINE-PAY-9A/payment-review",
    headers: {},
  }, false);
  assert.equal(anonymous.status, 401);
}

{
  const proof = await runHandler(createPaymentReviewHandler(baseDependencies), {
    method: "GET",
    url: "/api/inquiries/QA-ONLINE-PAY-9A/payment-proof",
  }, true, "proof");
  assert.equal(proof.status, 200);
  assert.equal(proof.body.proof.filename, "qa-receipt.pdf");
  assert.equal(proof.body.proof.expiresIn, 300);
  assert.equal(proof.body.proof.signedUrl, "signed-proof-link");
  assert.doesNotMatch(JSON.stringify(proof.body), /payment_proof_path|private-receipt/);
}

{
  const unsafeHandler = createPaymentReviewHandler({
    ...baseDependencies,
    getInquiry: async () => ({
      ...inquiry,
      payment_receipt_filename: "receipt.exe",
      payment_receipt_content_type: "application/octet-stream",
    }),
  });
  const response = await runHandler(unsafeHandler, {
    method: "GET",
    url: "/api/inquiries/QA-ONLINE-PAY-9A/payment-proof",
  }, true, "proof");
  assert.equal(response.status, 415);
  assert.equal(response.body.error.code, "PAYMENT_PROOF_UNSAFE");
}

{
  const staleHandler = createPaymentReviewHandler({
    ...baseDependencies,
    invokeReview: async () => {
      throw { code: "P0001", message: "PAYMENT_STALE_VERSION: hidden details" };
    },
  });
  const response = await runHandler(staleHandler, {
    method: "PATCH",
    url: "/api/inquiries/QA-ONLINE-PAY-9A/payment-review",
    body: {
      action: "start_online_payment_review",
      expectedVersion: inquiry.updated_at,
      idempotencyKey: "online:qa:stale:1",
    },
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "PAYMENT_STALE");
  assert.doesNotMatch(JSON.stringify(response.body), /hidden details/);
}

{
  const disabled = await runHandler(createPaymentReviewHandler({
    ...baseDependencies,
    featureEnabled: () => false,
  }), {
    method: "GET",
    url: "/api/inquiries/QA-ONLINE-PAY-9A/payment-review",
  });
  assert.equal(disabled.status, 404);
}

console.log("PASS Phase 9A payment review API roles, normalization, stale handling, and proof security");

async function runHandler(handler, request, includeAuth = true, mode = "review") {
  const headers = {
    ...(includeAuth ? { authorization: "Bearer test-session" } : {}),
    ...(request.headers || {}),
  };
  const req = {
    method: request.method,
    url: request.url,
    headers,
    query: { id: "QA-ONLINE-PAY-9A" },
    body: request.body,
  };
  const response = {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = JSON.parse(value); },
  };
  await handler(req, response, mode);
  return { status: response.statusCode, body: response.body, headers: response.headers };
}
