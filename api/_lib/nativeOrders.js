import { randomBytes } from "node:crypto";
import { NATIVE_ORDER_STATUS } from "../../src/shared/nativeOrderStatus.js";

export const ORDERS_TABLE = "orders";
export const ORDER_STATUS_AWAITING_PAYMENT = NATIVE_ORDER_STATUS.AWAITING_PAYMENT;

export const ORDER_SELECT = [
  "id",
  "order_reference",
  "source_inquiry_id",
  "status",
  "quoted_amount",
  "amount_due",
  "quote_breakdown",
  "quote_note",
  "quote_valid_until",
  "quote_approved_at",
  "customer_name",
  "customer_contact",
  "product",
  "product_desc",
  "quantity",
  "fulfillment_method",
  "due_date",
  "created_at",
  "updated_at",
].join(",");

export const ORDER_SOURCE_INQUIRY_SELECT = [
  "id",
  "customer_name",
  "contact",
  "product",
  "product_desc",
  "quantity",
  "fulfillment_method",
  "due_date",
  "quote_status",
  "quoted_amount",
  "amount_due",
  "quote_breakdown",
  "quote_notes",
  "quote_valid_until",
  "quote_approved_at",
  "artwork_status",
  "artwork_revision_request",
  "blocked_reason",
].join(",");

const REFERENCE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const MAX_REFERENCE_ATTEMPTS = 8;

export class NativeOrderError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "NativeOrderError";
    this.status = status;
    this.code = code;
  }
}

export function generateOrderReference(random = randomBytes) {
  const bytes = random(8);
  let suffix = "";
  for (const byte of bytes) suffix += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  return `TRRY-ORD-${suffix}`;
}

export async function convertInquiryToNativeOrder(supabase, inquiryId, options = {}) {
  const sourceInquiryId = cleanInquiryId(inquiryId);
  if (!sourceInquiryId) throw new NativeOrderError(400, "INVALID_INQUIRY_REFERENCE", "invalid inquiry reference");

  const existing = await readNativeOrderBySourceInquiryId(supabase, sourceInquiryId);
  if (existing) return { order: existing, created: false };

  const inquiry = await readSourceInquiry(supabase, sourceInquiryId);
  if (!inquiry) throw new NativeOrderError(404, "INQUIRY_NOT_FOUND", "inquiry not found");
  assertInquiryCanConvert(inquiry);

  for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt += 1) {
    const row = {
      ...buildOrderSnapshot(inquiry),
      order_reference: generateOrderReference(options.randomBytes || randomBytes),
    };
    const { data, error } = await supabase
      .from(ORDERS_TABLE)
      .insert(row)
      .select(ORDER_SELECT)
      .single();

    if (!error && data) return { order: normalizeOrder(data), created: true };

    if (isSourceInquiryUniqueViolation(error)) {
      const replay = await readNativeOrderBySourceInquiryId(supabase, sourceInquiryId);
      if (replay) return { order: replay, created: false };
    }

    if (isOrderReferenceUniqueViolation(error)) continue;
    throw error || new Error("native order creation failed");
  }

  throw new NativeOrderError(409, "ORDER_REFERENCE_COLLISION", "unable to generate a unique order reference");
}

export async function readNativeOrderById(supabase, id) {
  const value = String(id || "").trim();
  if (!value) return null;
  return readSingleOrder(supabase.from(ORDERS_TABLE).select(ORDER_SELECT).eq("id", value));
}

export async function readNativeOrderByReference(supabase, orderReference) {
  const value = String(orderReference || "").trim().toUpperCase();
  if (!value) return null;
  return readSingleOrder(supabase.from(ORDERS_TABLE).select(ORDER_SELECT).eq("order_reference", value));
}

export async function readNativeOrderBySourceInquiryId(supabase, sourceInquiryId) {
  const value = cleanInquiryId(sourceInquiryId);
  if (!value) return null;
  return readSingleOrder(supabase.from(ORDERS_TABLE).select(ORDER_SELECT).eq("source_inquiry_id", value));
}

export function buildOrderSnapshot(inquiry) {
  return {
    source_inquiry_id: cleanInquiryId(inquiry.id),
    status: ORDER_STATUS_AWAITING_PAYMENT,
    quoted_amount: numberOrNull(inquiry.quoted_amount),
    amount_due: numberOrNull(inquiry.amount_due ?? inquiry.quoted_amount),
    quote_breakdown: cleanText(inquiry.quote_breakdown, 4000) || null,
    quote_note: cleanText(inquiry.quote_notes, 2000) || null,
    quote_valid_until: dateOrNull(inquiry.quote_valid_until),
    quote_approved_at: timestampOrNull(inquiry.quote_approved_at),
    customer_name: cleanText(inquiry.customer_name, 240) || null,
    customer_contact: cleanText(inquiry.contact, 240) || null,
    product: cleanText(inquiry.product, 500) || null,
    product_desc: cleanText(inquiry.product_desc, 1000) || null,
    quantity: cleanText(inquiry.quantity, 120) || null,
    fulfillment_method: cleanText(inquiry.fulfillment_method, 120) || null,
    due_date: dateOrNull(inquiry.due_date),
  };
}

export function normalizeOrder(row) {
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

async function readSourceInquiry(supabase, sourceInquiryId) {
  const { data, error } = await supabase
    .from("ops_inquiries")
    .select(ORDER_SOURCE_INQUIRY_SELECT)
    .eq("id", sourceInquiryId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function readSingleOrder(builder) {
  const { data, error } = await builder.maybeSingle();
  if (error) throw error;
  return normalizeOrder(data);
}

function assertInquiryCanConvert(inquiry) {
  if (!cleanText(inquiry.product_desc || inquiry.product, 500)) throw new NativeOrderError(400, "PRODUCT_REQUIRED", "product or service required");
  if (!cleanText(inquiry.quantity, 120)) throw new NativeOrderError(400, "QUANTITY_REQUIRED", "quantity required");
  if (key(inquiry.quote_status) !== "approved" || !timestampOrNull(inquiry.quote_approved_at)) throw new NativeOrderError(400, "QUOTE_NOT_APPROVED", "approved quote required");
  if (!(numberOrNull(inquiry.quoted_amount) > 0)) {
    throw new NativeOrderError(400, "QUOTE_AMOUNT_REQUIRED", "approved quote amount required");
  }
  if (key(inquiry.artwork_status) !== "approved") throw new NativeOrderError(400, "ARTWORK_NOT_APPROVED", "artwork approval required");
  if (!dateOrNull(inquiry.due_date)) throw new NativeOrderError(400, "DUE_DATE_REQUIRED", "agreed due date required");
  if (key(inquiry.artwork_status) === "revision_requested" || cleanText(inquiry.artwork_revision_request, 1000) || cleanText(inquiry.blocked_reason, 500)) {
    throw new NativeOrderError(400, "INQUIRY_BLOCKED", "active revision or blocker must be resolved");
  }
}

function isSourceInquiryUniqueViolation(error) {
  return isUniqueViolation(error) && /source_inquiry_id|orders_source_inquiry_id_key/i.test(errorText(error));
}

function isOrderReferenceUniqueViolation(error) {
  return isUniqueViolation(error) && /order_reference|orders_order_reference_key/i.test(errorText(error));
}

function isUniqueViolation(error) {
  return String(error?.code || "") === "23505" || /duplicate key|unique/i.test(errorText(error));
}

function errorText(error) {
  return [error?.message, error?.details, error?.hint].filter(Boolean).join(" ");
}

function cleanInquiryId(value) {
  const text = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9_-]{2,79}$/.test(text) ? text : "";
}

function cleanText(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function key(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function dateOrNull(value) {
  const text = cleanText(value, 80);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function timestampOrNull(value) {
  const text = cleanText(value, 80);
  return text && !Number.isNaN(Date.parse(text)) ? text : null;
}
