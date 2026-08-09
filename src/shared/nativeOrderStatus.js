export const NATIVE_ORDER_STATUS = Object.freeze({
  AWAITING_PAYMENT: "awaiting_payment",
  PAID: "paid",
  READY_TO_RELEASE: "ready_to_release",
  RELEASED: "released",
  COMPLETED: "completed",
});

export const NATIVE_ORDER_STATUS_SEQUENCE = Object.freeze([
  NATIVE_ORDER_STATUS.AWAITING_PAYMENT,
  NATIVE_ORDER_STATUS.PAID,
  NATIVE_ORDER_STATUS.READY_TO_RELEASE,
  NATIVE_ORDER_STATUS.RELEASED,
  NATIVE_ORDER_STATUS.COMPLETED,
]);

const ORDER_STATUS_RANK = new Map(
  NATIVE_ORDER_STATUS_SEQUENCE.map((status, index) => [status, index])
);
const RELEASED_PRODUCTION_STAGES = new Set(["printing", "embroidery", "screen_printing", "qc", "ready", "completed"]);
const PAID_PAYMENT_STATUSES = new Set(["paid", "full_payment_confirmed", "confirmed"]);

export function normalizeNativeOrderStatus(value) {
  const status = key(value);
  return ORDER_STATUS_RANK.has(status) ? status : NATIVE_ORDER_STATUS.AWAITING_PAYMENT;
}

export function canAdvanceNativeOrderStatus(currentStatus, nextStatus) {
  return nativeOrderStatusRank(nextStatus) >= nativeOrderStatusRank(currentStatus);
}

export function maxNativeOrderStatus(...statuses) {
  return statuses
    .map(normalizeNativeOrderStatus)
    .sort((left, right) => nativeOrderStatusRank(right) - nativeOrderStatusRank(left))[0]
    || NATIVE_ORDER_STATUS.AWAITING_PAYMENT;
}

export function deriveNativeOrderStatusFromFacts(facts = {}) {
  const stage = key(first(facts, ["production_stage", "productionStage"]));
  const tracking = key(first(facts, ["tracking_substatus", "trackingSubstatus"]));

  if (tracking === "completed") return NATIVE_ORDER_STATUS.COMPLETED;
  if (RELEASED_PRODUCTION_STAGES.has(stage)) return NATIVE_ORDER_STATUS.RELEASED;
  if (nativeOrderReleaseRequirementsMissing(facts).length === 0) return NATIVE_ORDER_STATUS.READY_TO_RELEASE;
  if (nativeOrderPaymentFullyConfirmed(facts)) return NATIVE_ORDER_STATUS.PAID;
  return NATIVE_ORDER_STATUS.AWAITING_PAYMENT;
}

export function nativeOrderReleaseRequirementsMissing(facts = {}) {
  const missing = [];
  if (!cleanText(first(facts, ["product_desc", "productDesc", "product"]), 500)) missing.push("product or service");
  if (!cleanText(first(facts, ["quantity", "qty"]), 120)) missing.push("quantity");
  if (!first(facts, ["due_date", "dueDate"])) missing.push("due date");
  if (key(first(facts, ["artwork_status", "artworkStatus"])) !== "approved") missing.push("artwork approval");
  if (!cleanText(first(facts, ["assigned_staff", "assignedStaff"]), 120)) missing.push("assigned staff");
  if (Number(first(facts, ["quoted_amount", "quotedAmount", "amount_due", "amountDue"])) > 0 && !nativeOrderPaymentFullyConfirmed(facts)) missing.push("confirmed payment");
  if (cleanText(first(facts, ["blocked_reason", "blockedReason"]), 500)) missing.push("blocked reason");
  return missing;
}

export function nativeOrderPaymentFullyConfirmed(facts = {}) {
  const total = number(first(facts, ["quoted_amount", "quotedAmount", "amount_due", "amountDue"]));
  const verified = number(first(facts, ["payment_verified_amount", "paymentVerifiedAmount", "payment_confirmed_amount", "paymentConfirmedAmount"]));
  const status = key(first(facts, ["payment_status", "paymentStatus"]));
  return total > 0 && verified >= total && PAID_PAYMENT_STATUSES.has(status);
}

export function isNativeOrderFulfillmentComplete(facts = {}) {
  return key(first(facts, ["tracking_substatus", "trackingSubstatus"])) === "completed";
}

export function nativeOrderStatusRank(status) {
  return ORDER_STATUS_RANK.get(normalizeNativeOrderStatus(status)) ?? 0;
}

function first(row, keys) {
  for (const name of keys) {
    const value = row?.[name];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function key(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}
