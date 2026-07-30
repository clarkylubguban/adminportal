export async function getPaymentReview(inquiryId, authSession, { signal } = {}) {
  return requestPaymentReview(inquiryId, authSession, {
    method: "GET",
    signal,
  });
}

export async function updatePaymentReview(inquiryId, command, authSession, { signal } = {}) {
  return requestPaymentReview(inquiryId, authSession, {
    method: "PATCH",
    body: command,
    signal,
  });
}

export async function openPaymentProof(inquiryId, authSession, { signal } = {}) {
  const reference = cleanReference(inquiryId);
  const token = getToken(authSession);
  const response = await fetch(`/api/inquiries/${encodeURIComponent(reference)}/payment-proof`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok || !payload?.proof?.signedUrl) {
    throw paymentReviewError(
      payload?.error?.code || "PAYMENT_PROOF_FAILED",
      paymentReviewMessage(response.status, payload?.error?.code, "proof"),
      response.status,
    );
  }
  return payload.proof;
}

export function createPaymentReviewIdempotencyKey(inquiryId, action) {
  const reference = cleanReference(inquiryId);
  const command = String(action || "").trim().replace(/[^a-z0-9_-]+/gi, "-");
  return `online:${reference}:${command}:${crypto.randomUUID()}`;
}

async function requestPaymentReview(inquiryId, authSession, { method, body, signal }) {
  const reference = cleanReference(inquiryId);
  const token = getToken(authSession);
  const response = await fetch(`/api/inquiries/${encodeURIComponent(reference)}/payment-review`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok || !payload?.payment) {
    const code = String(payload?.error?.code || "PAYMENT_REVIEW_FAILED");
    throw paymentReviewError(
      code,
      paymentReviewMessage(response.status, code, method),
      response.status,
    );
  }
  return payload.payment;
}

export function paymentReviewMessage(status, code, operation = "GET") {
  if (status === 409 && code === "PAYMENT_STALE") {
    return "Payment details changed. Review the latest receipt and try again.";
  }
  if (status === 409) return "This payment action was already handled or conflicts with another request.";
  if (status === 404 && code === "PAYMENT_PROOF_NOT_FOUND") return "Payment receipt is not available.";
  if (status === 404) return "Online payment review is not available.";
  if (status === 415) return "This receipt file type cannot be opened safely.";
  if (status === 401 || status === 403) return "Payment review access is not available.";
  if (status === 400 && code === "PAYMENT_CORRECTION_REASON_REQUIRED") return "Enter a clear correction reason.";
  if (status === 400 && code === "FULL_AMOUNT_DUE_REQUIRED") return "Verified amount must match the full amount due.";
  if (status === 400 && code === "FULL_PAYMENT_ONLY") return "Down-payment confirmation is outside Phase 9A.";
  if (status === 400) return "The payment review action is not valid for the current receipt.";
  return operation === "proof"
    ? "Unable to open the payment receipt."
    : operation === "PATCH"
      ? "Unable to save the payment review."
      : "Unable to load payment review details.";
}

function cleanReference(value) {
  const reference = String(value || "").trim();
  if (!reference) throw paymentReviewError("INVALID_INQUIRY_REFERENCE", "Inquiry not found.", 400);
  return reference;
}

function getToken(authSession) {
  const token = String(authSession?.access_token || "").trim();
  if (!token) throw paymentReviewError("AUTH_REQUIRED", "Authentication required.", 401);
  return token;
}

function paymentReviewError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}
