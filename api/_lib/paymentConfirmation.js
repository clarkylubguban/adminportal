const PAYMENT_SOURCE_VALUES = new Set(["cash", "gcash", "card", "bank_transfer"]);
const CONFIRMED_PAYMENT_STATUSES = new Set(["paid", "full_payment_confirmed", "confirmed", "partially_paid", "down_payment_confirmed"]);

export function buildPaymentConfirmationUpdate({ inquiry, body = {}, adminUser = {}, now = new Date().toISOString() }) {
  if (!inquiry) return failure("inquiry not found");
  if (String(inquiry.quote_status || "").trim().toLowerCase() !== "approved") return failure("approved quote required");

  const currentStatus = key(inquiry.payment_status);
  const total = money(inquiry.quoted_amount);
  const existingPaid = confirmedPaidAmount(inquiry);
  const remaining = roundMoney(total - existingPaid);
  const amount = money(body.amountReceived);
  const source = cleanPaymentSource(body.paymentSource);
  const reference = cleanText(body.referenceNumber, 120) || null;
  const note = cleanText(body.internalNote, 1000) || null;
  const idempotencyKey = cleanText(body.idempotencyKey, 120) || "";

  if (!Number.isFinite(total) || total <= 0) return failure("valid quote total required");
  if (!Number.isFinite(amount) || amount <= 0) return failure("amount received must be positive");
  if (!source) return failure("payment source is required");

  if (idempotencyKey && hasPaymentHistoryKey(inquiry, idempotencyKey)) {
    return {
      ok: true,
      idempotent: true,
      updates: {},
    };
  }

  if (remaining <= 0 || ["paid", "full_payment_confirmed", "confirmed"].includes(currentStatus)) {
    return failure("payment is already fully confirmed");
  }
  if (roundMoney(amount - remaining) > 0) return failure("amount received cannot exceed remaining balance");

  const paidTotal = roundMoney(existingPaid + amount);
  const remainingBalance = Math.max(roundMoney(total - paidTotal), 0);
  const status = remainingBalance === 0 ? "paid" : "partially_paid";
  const history = appendPaymentHistory(inquiry.payment_history, {
    id: idempotencyKey || `payment-${Date.now()}`,
    type: "payment_confirmed",
    amount,
    source,
    referenceNumber: reference,
    internalNote: note,
    confirmedBy: adminUser.user_id || adminUser.userId || null,
    confirmedAt: now,
    balanceAfter: remainingBalance,
    status,
  });

  return {
    ok: true,
    idempotent: false,
    updates: {
      payment_method: source,
      payment_status: status,
      payment_selected_amount: inquiry.payment_selected_amount ?? amount,
      payment_confirmed_amount: paidTotal,
      payment_confirmed_at: now,
      payment_confirmed_by: adminUser.user_id || adminUser.userId || null,
      payment_verified_amount: paidTotal,
      payment_verified_at: now,
      payment_verified_by: adminUser.user_id || adminUser.userId || null,
      payment_reference: reference,
      payment_internal_note: note,
      payment_review_note: null,
      payment_rejected_at: null,
      amount_due: remainingBalance,
      payment_history: history,
    },
  };
}

export function isPaymentFullyConfirmed(inquiry) {
  const total = money(inquiry?.quoted_amount ?? inquiry?.amount_due);
  const paid = confirmedPaidAmount(inquiry || {});
  const status = key(inquiry?.payment_status);
  return total > 0 && paid >= total && ["paid", "full_payment_confirmed", "confirmed"].includes(status);
}

export function confirmedPaidAmount(inquiry) {
  const confirmed = money(inquiry.payment_confirmed_amount);
  const verified = money(inquiry.payment_verified_amount);
  return Math.max(confirmed || 0, verified || 0);
}

export function cleanPaymentSource(value) {
  const normalized = key(value);
  return PAYMENT_SOURCE_VALUES.has(normalized) ? normalized : "";
}

function appendPaymentHistory(value, entry) {
  const history = Array.isArray(value) ? value : [];
  return [...history, entry];
}

function hasPaymentHistoryKey(inquiry, idempotencyKey) {
  return Array.isArray(inquiry.payment_history)
    && inquiry.payment_history.some((entry) => String(entry?.id || "") === idempotencyKey);
}

function money(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.trim().replace(/,/g, "");
    if (normalized && Number.isFinite(Number(normalized))) return Number(normalized);
  }
  return NaN;
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function key(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function failure(error) {
  return { ok: false, error };
}
