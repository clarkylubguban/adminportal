import {
  isSupabaseReady,
  readSupabaseTableWithAuth,
} from "../lib/supabaseClient.js";

export const ORDERS_TABLE = "orders";

export async function getNativeOrderRows(authSession) {
  if (!isSupabaseReady()) {
    return {
      rows: [],
      status: "local",
      source: "local",
      error: null,
    };
  }

  try {
    const rows = await readSupabaseTableWithAuth(
      ORDERS_TABLE,
      {
        select: "*",
        order: "created_at.desc",
      },
      getAccessToken(authSession)
    );

    return {
      rows: Array.isArray(rows) ? rows : [],
      status: rows?.length ? "success" : "empty",
      source: "supabase",
      error: null,
    };
  } catch (error) {
    console.error("Unable to load native TRRY orders.", error);
    return {
      rows: [],
      status: isMissingOrdersTableError(error) ? "missing-table" : "error",
      source: "supabase",
      error,
    };
  }
}

export function buildDualReadOrders({ inquiries = [], nativeRows = [] } = {}) {
  const inquiryRows = Array.isArray(inquiries) ? inquiries : [];
  const nativeOrders = (Array.isArray(nativeRows) ? nativeRows : [])
    .map((row) => normalizeNativeOrder(row, findInquiryBySource(inquiryRows, row)))
    .filter(Boolean);
  const nativeSourceInquiryIds = new Set(
    nativeOrders.map((item) => normalizeIdentity(item.sourceInquiryId)).filter(Boolean)
  );
  const legacyOrders = inquiryRows
    .filter(isLegacyOrderInquiry)
    .filter((item) => !nativeSourceInquiryIds.has(normalizeIdentity(item.id)))
    .map(normalizeLegacyOrder);

  return [...nativeOrders, ...legacyOrders];
}

export function normalizeNativeOrder(row, sourceInquiry = null) {
  if (!row) return null;
  const nativeOrderId = getFirstValue(row, ["id"]);
  const sourceInquiryId = getFirstValue(row, ["source_inquiry_id", "sourceInquiryId"]);
  const orderReference = getFirstValue(row, ["order_reference", "orderReference"]);
  const bridgeId = sourceInquiryId || nativeOrderId || orderReference;

  if (!bridgeId) return null;

  return {
    ...(sourceInquiry || {}),
    id: bridgeId,
    sourceType: "native",
    nativeOrderId,
    sourceInquiryId,
    sourceInquiryReference:
      getFirstValue(row, ["source_inquiry_reference", "sourceInquiryReference"]) ||
      sourceInquiry?.sourceInquiryReference ||
      sourceInquiryId ||
      sourceInquiry?.id ||
      "",
    orderReference,
    orderCode: "",
    reference: "",
    code: "",
    odooSO: "",
    customer: getFirstValue(row, ["customer_name", "customerName", "customer"]) || sourceInquiry?.customer || "",
    contact: getFirstValue(row, ["customer_contact", "contact", "phone"]) || sourceInquiry?.contact || "",
    company: getFirstValue(row, ["company", "business_name", "businessName"]) || sourceInquiry?.company || "",
    service: getFirstValue(row, ["product", "service", "service_type", "serviceType"]) || sourceInquiry?.service || "-",
    productDesc: getFirstValue(row, ["product_desc", "productDesc"]) || sourceInquiry?.productDesc || "",
    qty: getFirstValue(row, ["quantity", "qty"]) || sourceInquiry?.qty || "-",
    sizeBreakdown: getFirstValue(row, ["size_breakdown", "sizeBreakdown"]) || sourceInquiry?.sizeBreakdown || "",
    status: getFirstValue(sourceInquiry, ["status"]) || "",
    quoteStatus: getFirstValue(sourceInquiry, ["quoteStatus", "quote_status"]) || "approved",
    orderStatus: getFirstValue(row, ["status"]),
    quotedAmount: getNullableNumber(row, ["quoted_amount", "quotedAmount"]) ?? sourceInquiry?.quotedAmount,
    amountDue: getNullableNumber(row, ["amount_due", "amountDue"]) ?? sourceInquiry?.amountDue,
    quoteBreakdown: getFirstValue(row, ["quote_breakdown", "quoteBreakdown"]) || sourceInquiry?.quoteBreakdown || "",
    quoteNotes: getFirstValue(row, ["quote_note", "quote_notes", "quoteNote", "quoteNotes"]) || sourceInquiry?.quoteNotes || "",
    quoteValidUntil: normalizeDate(getFirstValue(row, ["quote_valid_until", "quoteValidUntil"])) || sourceInquiry?.quoteValidUntil || "",
    quoteApprovedAt: getFirstValue(row, ["quote_approved_at", "quoteApprovedAt"]) || sourceInquiry?.quoteApprovedAt || "",
    quotePublishedAt: getFirstValue(row, ["quote_published_at", "quotePublishedAt"]) || sourceInquiry?.quotePublishedAt || "",
    fulfillmentMethod: getFirstValue(row, ["fulfillment_method", "fulfillmentMethod"]) || sourceInquiry?.fulfillmentMethod || "",
    dueDate: normalizeDate(getFirstValue(row, ["due_date", "dueDate"])) || sourceInquiry?.dueDate || "",
    createdAt: getFirstValue(row, ["created_at", "createdAt"]) || sourceInquiry?.createdAt || "",
    updatedAt: getFirstValue(row, ["updated_at", "updatedAt"]) || sourceInquiry?.updatedAt || "",
  };
}

export function normalizeNativeOrderResponseToRow(order) {
  if (!order) return null;
  return {
    id: order.id,
    order_reference: order.orderReference,
    source_inquiry_id: order.sourceInquiryId,
    status: order.status,
    quoted_amount: order.quotedAmount,
    amount_due: order.amountDue,
    quote_breakdown: order.quoteBreakdown,
    quote_note: order.quoteNote,
    quote_valid_until: order.quoteValidUntil,
    quote_approved_at: order.quoteApprovedAt,
    customer_name: order.customerName,
    customer_contact: order.customerContact,
    product: order.product,
    product_desc: order.productDesc,
    quantity: order.quantity,
    fulfillment_method: order.fulfillmentMethod,
    due_date: order.dueDate,
    created_at: order.createdAt,
    updated_at: order.updatedAt,
  };
}

export function normalizeLegacyOrder(inquiry) {
  return {
    ...inquiry,
    sourceType: "legacy",
    sourceInquiryId: inquiry?.sourceInquiryId || inquiry?.id || "",
  };
}

export function findOrderByIdentity(items, value) {
  const rows = Array.isArray(items) ? items : [];
  const nativeMatch = rows.find((item) => item?.sourceType === "native" && matchesOrderIdentity(item, value));
  return nativeMatch || rows.find((item) => matchesOrderIdentity(item, value)) || null;
}

export function matchesOrderIdentity(item, value) {
  const target = normalizeIdentity(value);
  if (!target) return false;
  return orderIdentityValues(item).some((candidate) => normalizeIdentity(candidate) === target);
}

export function orderIdentityValues(item) {
  if (!item) return [];
  return [
    item.nativeOrderId,
    item.orderReference,
    item.id,
    item.sourceInquiryId,
    item.sourceInquiryReference,
    item.orderCode,
    item.reference,
    item.code,
    item.odooSO,
  ];
}

function findInquiryBySource(inquiries, row) {
  const sourceInquiryId = normalizeIdentity(getFirstValue(row, ["source_inquiry_id", "sourceInquiryId"]));
  if (!sourceInquiryId) return null;
  return inquiries.find((item) => normalizeIdentity(item?.id) === sourceInquiryId) || null;
}

function isLegacyOrderInquiry(item) {
  return normalizeIdentity(item?.status) === "won" && normalizeIdentity(item?.quoteStatus) === "approved";
}

function getAccessToken(authSession) {
  return authSession?.access_token || "";
}

function getFirstValue(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function getNullableNumber(row, keys) {
  const value = getFirstValue(row, keys);
  if (value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeDate(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function normalizeIdentity(value) {
  return String(value || "").trim().toLowerCase();
}

function isMissingOrdersTableError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("orders") &&
    (message.includes("schema cache") ||
      message.includes("could not find") ||
      message.includes("does not exist") ||
      message.includes("404") ||
      message.includes("pgrst"))
  );
}
