import {
  canAdvanceNativeOrderStatus,
  deriveNativeOrderStatusFromFacts,
  maxNativeOrderStatus,
  normalizeNativeOrderStatus,
} from "../../src/shared/nativeOrderStatus.js";
import { ORDER_SELECT, ORDERS_TABLE, readNativeOrderBySourceInquiryId } from "./nativeOrders.js";

export async function reconcileNativeOrderStatusForInquiry(supabase, sourceInquiryId, facts, options = {}) {
  const sourceId = cleanSourceInquiryId(sourceInquiryId || facts?.id || facts?.source_inquiry_id || facts?.sourceInquiryId);
  if (!sourceId) return null;

  const order = options.order || await readNativeOrderBySourceInquiryId(supabase, sourceId);
  if (!order) return null;

  const derivedStatus = deriveNativeOrderStatusFromFacts({ ...facts, source_inquiry_id: sourceId });
  return transitionNativeOrderStatus(supabase, sourceId, derivedStatus, { order, now: options.now });
}

export async function transitionNativeOrderStatus(supabase, sourceInquiryId, requestedStatus, options = {}) {
  const sourceId = cleanSourceInquiryId(sourceInquiryId);
  if (!sourceId) return null;

  const order = options.order || await readNativeOrderBySourceInquiryId(supabase, sourceId);
  if (!order) return null;

  const currentStatus = normalizeNativeOrderStatus(order.status);
  const nextStatus = normalizeNativeOrderStatus(requestedStatus);
  const targetStatus = canAdvanceNativeOrderStatus(currentStatus, nextStatus)
    ? nextStatus
    : currentStatus;

  if (targetStatus === currentStatus) return order;

  const { data, error } = await supabase
    .from(ORDERS_TABLE)
    .update({ status: targetStatus, updated_at: options.now || new Date().toISOString() })
    .eq("source_inquiry_id", sourceId)
    .select(ORDER_SELECT)
    .single();
  if (error) throw error;
  return normalizeOrder(data);
}

export function backfillNativeOrderStatusFromFacts(order, facts) {
  return maxNativeOrderStatus(order?.status, deriveNativeOrderStatusFromFacts(facts));
}

function normalizeOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderReference: row.order_reference,
    sourceInquiryId: row.source_inquiry_id,
    status: row.status,
    quotedAmount: numberOrNull(row.quoted_amount),
    amountDue: numberOrNull(row.amount_due),
    quoteBreakdown: cleanText(row.quote_breakdown, 4000),
    quoteNote: cleanText(row.quote_note, 2000),
    quoteValidUntil: cleanText(row.quote_valid_until, 80),
    quoteApprovedAt: cleanText(row.quote_approved_at, 80),
    customerName: cleanText(row.customer_name, 240),
    customerContact: cleanText(row.customer_contact, 240),
    product: cleanText(row.product, 500),
    productDesc: cleanText(row.product_desc, 1000),
    quantity: cleanText(row.quantity, 120),
    fulfillmentMethod: cleanText(row.fulfillment_method, 120),
    dueDate: cleanText(row.due_date, 80),
    createdAt: cleanText(row.created_at, 80),
    updatedAt: cleanText(row.updated_at, 80),
  };
}

function cleanSourceInquiryId(value) {
  const text = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9_-]{2,79}$/.test(text) ? text : "";
}

function cleanText(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
