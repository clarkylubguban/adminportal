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

    const enrichedRows = await enrichRetailOrderRows(Array.isArray(rows) ? rows : [], authSession);
    return {
      rows: enrichedRows,
      status: enrichedRows.length ? "success" : "empty",
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

export async function enrichRetailOrderRows(rows, authSession, request = fetch) {
  const accessToken = getAccessToken(authSession);
  return Promise.all(rows.map(async (row) => {
    if (getFirstValue(row, ["source_type", "sourceType"]) !== "STLOLAB_RETAIL") return row;
    const orderId = getFirstValue(row, ["id"]);
    if (!orderId || !accessToken) throw new Error("Admin session required to load canonical retail order details.");
    const response = await request(`/api/orders/${encodeURIComponent(orderId)}/actions`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || "Unable to load canonical retail order details.");
    }
    return {
      ...row,
      fulfillment_state: payload.order?.fulfillmentState || row.fulfillment_state,
      order_items: Array.isArray(payload.order?.items) ? payload.order.items : [],
    };
  }));
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
  const quantity = getFirstValue(row, ["quantity", "qty"]) || sourceInquiry?.qty || "-";
  const sizeBreakdown =
    getFirstValue(row, ["size_breakdown", "sizeBreakdown"]) ||
    sourceInquiry?.sizeBreakdown ||
    extractSizeBreakdown(quantity) ||
    extractSizeBreakdown(sourceInquiry?.qty);
  const bridgeId = sourceInquiryId || nativeOrderId || orderReference;
  const nativeSourceType = getFirstValue(row, ["source_type", "sourceType"]);
  const isStlolabRetail = nativeSourceType === "STLOLAB_RETAIL";
  const paymentState = getFirstValue(row, ["payment_state", "paymentState"]);
  const fulfillmentState = getFirstValue(row, ["fulfillment_state", "fulfillmentState"]);
  const totalAmount = getNullableNumber(row, ["total_amount", "totalAmount", "quoted_amount", "quotedAmount"]);
  const fulfillmentDetails = getFirstValue(row, ["fulfillment_details", "fulfillmentDetails"]);
  const retailItems = normalizeRetailItems(getFirstValue(row, ["order_items", "orderItems"]));
  const retailProductName = uniqueRetailValues(retailItems, "productName").join(", ");
  const retailColor = uniqueRetailValues(retailItems, "color").join(", ");
  const retailSizes = uniqueRetailValues(retailItems, "size").join(", ");
  const retailQuantitySummary = retailItems.map((item) => `${item.size || "-"} × ${item.quantity}`).join(", ");

  if (!bridgeId) return null;

  return {
    ...(sourceInquiry || {}),
    id: bridgeId,
    sourceType: "native",
    nativeSourceType,
    sourceChannel: getFirstValue(row, ["source_channel", "sourceChannel"]),
    isStlolabRetail,
    retailItems,
    retailProductName,
    retailQuantitySummary,
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
    customerId: getFirstValue(row, ["customer_id", "customerId"]) || sourceInquiry?.customerId || "",
    customer: getFirstValue(row, ["customer_name", "customerName", "customer"]) || sourceInquiry?.customer || "",
    contact: getFirstValue(row, ["customer_contact", "contact", "phone"]) || sourceInquiry?.contact || "",
    company: getFirstValue(row, ["company", "business_name", "businessName"]) || sourceInquiry?.company || "",
    service: retailProductName || getFirstValue(row, ["product", "service", "service_type", "serviceType"]) || sourceInquiry?.service || "-",
    productDesc: getFirstValue(row, ["product_desc", "productDesc"]) || sourceInquiry?.productDesc || "",
    qty: retailQuantitySummary || quantity,
    sizeBreakdown: retailSizes || sizeBreakdown,
    color: retailColor || sourceInquiry?.color || sourceInquiry?.garmentColor || "",
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
    fulfillmentDetails: fulfillmentDetails && typeof fulfillmentDetails === "object" ? fulfillmentDetails : null,
    deliveryAddress: formatRetailAddress(fulfillmentDetails?.address) || sourceInquiry?.deliveryAddress || "",
    paymentStatus: isStlolabRetail ? paymentState.toLowerCase() : sourceInquiry?.paymentStatus || "",
    paymentState,
    paymentConfirmedAmount: isStlolabRetail && paymentState === "PAID" ? totalAmount : sourceInquiry?.paymentConfirmedAmount,
    paymentVerifiedAmount: isStlolabRetail && paymentState === "PAID" ? totalAmount : sourceInquiry?.paymentVerifiedAmount,
    paymentReference: getFirstValue(row, ["payment_reference", "paymentReference"]) || sourceInquiry?.paymentReference || "",
    paymentConfirmedAt: getFirstValue(row, ["paid_at", "paidAt"]) || sourceInquiry?.paymentConfirmedAt || "",
    fulfillmentState,
    handedOverAt: getFirstValue(row, ["handed_over_at", "handedOverAt"]),
    handoverKind: getFirstValue(row, ["handover_kind", "handoverKind"]),
    reservationExpiresAt: getFirstValue(row, ["reservation_expires_at", "reservationExpiresAt"]),
    source: isStlolabRetail ? "STLOLAB" : sourceInquiry?.source || "",
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
    source_type: order.sourceType,
    source_channel: order.sourceChannel,
    status: order.status,
    quoted_amount: order.quotedAmount,
    amount_due: order.amountDue,
    quote_breakdown: order.quoteBreakdown,
    quote_note: order.quoteNote,
    quote_valid_until: order.quoteValidUntil,
    quote_approved_at: order.quoteApprovedAt,
    customer_id: order.customerId,
    customer_name: order.customerName,
    customer_contact: order.customerContact,
    product: order.product,
    product_desc: order.productDesc,
    quantity: order.quantity,
    fulfillment_method: order.fulfillmentMethod,
    due_date: order.dueDate,
    created_at: order.createdAt,
    updated_at: order.updatedAt,
    payment_state: order.paymentState,
    payment_reference: order.paymentReference,
    paid_at: order.paidAt,
    fulfillment_state: order.fulfillmentState,
    handed_over_at: order.handedOverAt,
    handover_kind: order.handoverKind,
  };
}

function normalizeRetailItems(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    id: getFirstValue(item, ["id"]),
    productId: getFirstValue(item, ["productId", "product_id"]),
    variantId: getFirstValue(item, ["variantId", "variant_id"]),
    productCode: getFirstValue(item, ["productCode", "product_code"]),
    productName: getFirstValue(item, ["productName", "product_name"]),
    sku: getFirstValue(item, ["sku"]),
    size: getFirstValue(item, ["size"]),
    color: getFirstValue(item, ["color"]),
    quantity: Number(getFirstValue(item, ["quantity"])) || 0,
    unitPrice: getNullableNumber(item, ["unitPrice", "unit_price"]),
    lineTotal: getNullableNumber(item, ["lineTotal", "line_total"]),
  })).filter((item) => item.productName && item.quantity > 0);
}

function uniqueRetailValues(items, key) {
  return [...new Set(items.map((item) => String(item[key] || "").trim()).filter(Boolean))];
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

function formatRetailAddress(address) {
  if (!address || typeof address !== "object") return "";
  return [address.line1, address.line2, address.barangay, address.city, address.province, address.postalCode]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
}

function isLegacyOrderInquiry(item) {
  return normalizeIdentity(item?.status) === "won" && normalizeIdentity(item?.quoteStatus) === "approved";
}

function getAccessToken(authSession) {
  return authSession?.access_token || "";
}

function extractSizeBreakdown(value) {
  const text = String(value || "").trim();
  const parenthetical = text.match(/\(([^)]+)\)/)?.[1]?.trim() || "";
  if (!parenthetical || !/[A-Za-z0-9]+\s*:\s*\d+/.test(parenthetical)) return "";
  return parenthetical;
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
