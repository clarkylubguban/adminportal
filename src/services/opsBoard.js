import {
  createSupabaseRowWithAuth,
  isSupabaseReady,
  readSupabaseTableWithAuth,
  updateSupabaseRowsWithAuth,
} from "../lib/supabaseClient.js";
import {
  reconcileNativeOrderStatusForInquiry,
  shouldReconcileFulfillmentCompletion,
} from "./nativeOrderStatus.js";

export const OPS_INQUIRIES_TABLE = "ops_inquiries";

// Database schema and RLS policies must be managed in Supabase,
// not embedded inside the Admin Portal frontend.
export const OPS_INQUIRIES_SQL = null;

export async function getOpsBoardInquiries(
  fallbackInquiries = [],
  authSession
) {
  if (!isSupabaseReady()) {
    return {
      inquiries: [...fallbackInquiries],
      status: "local",
      source: "local",
      error: null,
      sql: null,
    };
  }

  try {
    const rows = await readSupabaseTableWithAuth(
      OPS_INQUIRIES_TABLE,
      {
        select: "*",
        order: "created_at.desc",
      },
      getAccessToken(authSession)
    );

    return {
      inquiries: Array.isArray(rows)
        ? rows.map(mapOpsRowToInquiry)
        : [],
      status: rows?.length ? "success" : "empty",
      source: "supabase",
      error: null,
      sql: null,
    };
  } catch (error) {
    console.error(
      "Unable to load Supabase Ops Board inquiries.",
      error
    );

    return {
      inquiries: [],
      status: isMissingTableError(error)
        ? "missing-table"
        : "error",
      source: "supabase",
      error,
      sql: null,
    };
  }
}

export async function createOpsBoardInquiry(
  inquiry,
  authSession
) {
  const rows = await createSupabaseRowWithAuth(
    OPS_INQUIRIES_TABLE,
    mapInquiryToOpsRow(inquiry),
    getAccessToken(authSession)
  );

  return mapOpsRowToInquiry(
    rows?.[0] ?? mapInquiryToOpsRow(inquiry)
  );
}

export async function updateOpsInquiryStatus(
  id,
  updates,
  authSession
) {
  const rows = await updateSupabaseRowsWithAuth(
    OPS_INQUIRIES_TABLE,
    { id: `eq.${id}` },
    mapInquiryUpdatesToOpsRow(updates),
    getAccessToken(authSession)
  );

  return rows?.[0]
    ? mapOpsRowToInquiry(rows[0])
    : null;
}

export async function updateOpsInquiryNextAction(
  id,
  nextAction,
  authSession
) {
  return updateOpsInquiryFields(
    id,
    { next: nextAction },
    authSession
  );
}

export async function updateOpsInquiryDates(
  id,
  { dueDate, followUpDate },
  authSession
) {
  return updateOpsInquiryFields(
    id,
    { dueDate, followUpDate },
    authSession
  );
}

export async function saveOpsInquiryOdooSO(
  id,
  odooSO,
  authSession
) {
  throw new Error("Legacy Odoo SO writes are disabled. Native public.orders is the active Order authority.");
}

export async function confirmOpsInquiryOdooSO(
  id,
  odooSO,
  authSession
) {
  throw new Error("Legacy Odoo SO confirmation is disabled. Native public.orders is the active Order authority.");
}

export const updateOpsInquiryOdooSO =
  confirmOpsInquiryOdooSO;

export async function updateOpsInquiryFields(
  id,
  updates,
  authSession
) {
  const rows = await updateSupabaseRowsWithAuth(
    OPS_INQUIRIES_TABLE,
    { id: `eq.${id}` },
    mapInquiryUpdatesToOpsRow(updates),
    getAccessToken(authSession)
  );

  const savedInquiry = rows?.[0]
    ? mapOpsRowToInquiry(rows[0])
    : null;
  if (savedInquiry && shouldReconcileFulfillmentCompletion(updates, savedInquiry)) {
    await reconcileNativeOrderStatusForInquiry(savedInquiry, authSession);
  }
  return savedInquiry;
}

export function mapOpsRowToInquiry(row) {
  return {
    id: getFirstValue(row, ["id"]),
    orderCode: getFirstValue(row, ["order_code", "orderCode"]),
    orderReference: getFirstValue(row, ["order_reference", "orderReference"]),
    reference: getFirstValue(row, ["reference"]),
    code: getFirstValue(row, ["code"]),
    sourceInquiryId: getFirstValue(row, ["source_inquiry_id", "sourceInquiryId", "inquiry_id", "inquiryId"]),
    sourceInquiryReference: getFirstValue(row, ["source_inquiry_reference", "sourceInquiryReference", "inquiry_reference", "inquiryReference", "converted_from", "convertedFrom"]),
    customerId: getFirstValue(row, ["customer_id", "customerId"]),
    customer: getFirstValue(row, [
      "customer_name",
      "customer",
    ]),
    contact: getFirstValue(row, ["contact"]),
    company: getFirstValue(row, ["company"]),
    channel: getFirstValue(row, ["channel"]),
    productDesc: getFirstValue(row, ["product_desc", "productDesc"]),
    sizeBreakdown: getFirstValue(row, ["size_breakdown", "sizeBreakdown"]),
    ownerId: getFirstValue(row, ["owner_id", "ownerId"]),
    ownerUserId: getFirstValue(row, ["owner_user_id", "ownerUserId"]),
    owner: getFirstValue(row, ["owner_name", "owner"]),
    blockedReason: getFirstValue(row, ["blocked_reason", "blockedReason"]),
    lostReason: getFirstValue(row, ["lost_reason", "lostReason"]),
    quoteSentAt: getFirstValue(row, ["quote_sent_at", "quoteSentAt"]),
    customerResponse: getFirstValue(row, ["customer_response", "customerResponse"]),
    source:
      getFirstValue(row, ["source"]) || "FB",
    message: getFirstValue(row, ["message"]),
    notes: getFirstValue(row, ["notes", "customer_notes", "customerNotes"]),
    service:
      getFirstValue(row, [
        "product",
        "service",
        "service_type",
      ]) || "-",
    qty:
      getFirstValue(row, ["quantity", "qty"]) ||
      "-",
    priority:
      getFirstValue(row, ["priority"]) ||
      "normal",
    status:
      normalizeOpsStatus(
        getFirstValue(row, ["status"])
      ) || "new",
    next:
      getFirstValue(row, [
        "next_action",
        "next",
      ]) || "Review inquiry",
    dueDate: normalizeDate(
      getFirstValue(row, ["due_date", "dueDate"])
    ),
    fulfillmentMethod: getFirstValue(row, ["fulfillment_method", "fulfillmentMethod"]),
    deliveryCity: getFirstValue(row, ["delivery_city", "deliveryCity"]),
    deliveryAddress: getFirstValue(row, ["delivery_address", "deliveryAddress"]),
    deliveryLandmark: getFirstValue(row, ["delivery_landmark", "deliveryLandmark"]),
    trackingSubstatus: getFirstValue(row, ["tracking_substatus", "trackingSubstatus"]),
    trackingNote: getFirstValue(row, ["tracking_note", "trackingNote"]),
    updatedAt: getFirstValue(row, ["updated_at", "updatedAt"]),
    trackingUpdatedAt: getFirstValue(row, ["tracking_updated_at", "trackingUpdatedAt"]),
    followUpDate: normalizeDate(
      getFirstValue(row, [
        "follow_up_date",
        "followUpDate",
      ])
    ),
    odooSO: getFirstValue(row, [
      "odoo_so",
      "odooSO",
    ]),
    estimatedValue: getFirstValue(row, [
      "estimated_value",
      "estimatedValue",
    ]),
    assigned:
      getFirstValue(row, ["assigned_staff", "assignedStaff", "assigned"]) ||
      "Unassigned",
    assignedStaff:
      getFirstValue(row, ["assigned_staff", "assignedStaff"]),
    productionStage:
      getFirstValue(row, ["production_stage", "productionStage"]),
    productionNote:
      getFirstValue(row, ["production_note", "productionNote"]),
    productionUpdatedAt:
      getFirstValue(row, ["production_updated_at", "productionUpdatedAt"]),
    productionStartedAt:
      getFirstValue(row, ["production_started_at", "productionStartedAt"]),
    productionStartedBy:
      getFirstValue(row, ["production_started_by", "productionStartedBy"]),
    productionCompletedAt:
      getFirstValue(row, ["production_completed_at", "productionCompletedAt"]),
    productionCompletedBy:
      getFirstValue(row, ["production_completed_by", "productionCompletedBy"]),
    qcStartedAt:
      getFirstValue(row, ["qc_started_at", "qcStartedAt"]),
    qcStartedBy:
      getFirstValue(row, ["qc_started_by", "qcStartedBy"]),
    qcNote:
      getFirstValue(row, ["qc_note", "qcNote"]),
    qcCompletedAt:
      getFirstValue(row, ["qc_completed_at", "qcCompletedAt"]),
    qcCompletedBy:
      getFirstValue(row, ["qc_completed_by", "qcCompletedBy"]),
    quotedAmount: getNullableNumber(row, ["quoted_amount", "quotedAmount"]),
    amountDue: getNullableNumber(row, ["amount_due", "amountDue"]),
    quoteStatus: getFirstValue(row, ["quote_status", "quoteStatus"]),
    quoteApprovedAt: getFirstValue(row, ["quote_approved_at", "quoteApprovedAt"]),
    quotePublishedAt: getFirstValue(row, ["quote_published_at", "quotePublishedAt"]),
    quoteChangeRequest: getFirstValue(row, ["quote_change_request", "quoteChangeRequest"]),
    quoteBreakdown: getFirstValue(row, ["quote_breakdown", "quoteBreakdown"]),
    quoteNotes: getFirstValue(row, ["quote_notes", "quoteNotes"]),
    quoteValidUntil: normalizeDate(getFirstValue(row, ["quote_valid_until", "quoteValidUntil"])),
    artworkStatus: getFirstValue(row, ["artwork_status", "artworkStatus"]),
    artworkUrl: getFirstValue(row, ["artwork_url", "artworkUrl"]),
    artworkApprovedAt: getFirstValue(row, ["artwork_approved_at", "artworkApprovedAt"]),
    artworkRevisionRequest: getFirstValue(row, ["artwork_revision_request", "artworkRevisionRequest"]),
    paymentStatus: getFirstValue(row, ["payment_status", "paymentStatus"]),
    paymentMethod: getFirstValue(row, ["payment_method", "paymentMethod"]),
    paymentType: getFirstValue(row, ["payment_type", "paymentType"]),
    paymentSelectedAmount: getNullableNumber(row, ["payment_selected_amount", "paymentSelectedAmount"]),
    paymentReference: getFirstValue(row, ["payment_reference", "paymentReference"]),
    paymentCustomerNote: getFirstValue(row, ["payment_customer_note", "paymentCustomerNote"]),
    paymentReceiptFilename: getFirstValue(row, ["payment_receipt_filename", "paymentReceiptFilename"]),
    paymentReceiptContentType: getFirstValue(row, ["payment_receipt_content_type", "paymentReceiptContentType"]),
    paymentReceiptSize: getNullableNumber(row, ["payment_receipt_size", "paymentReceiptSize"]),
    paymentVerifiedAmount: getNullableNumber(row, ["payment_verified_amount", "paymentVerifiedAmount"]),
    paymentVerifiedAt: getFirstValue(row, ["payment_verified_at", "paymentVerifiedAt"]),
    paymentVerifiedBy: getFirstValue(row, ["payment_verified_by", "paymentVerifiedBy"]),
    paymentConfirmedBy: getFirstValue(row, ["payment_confirmed_by", "paymentConfirmedBy"]),
    paymentInternalNote: getFirstValue(row, ["payment_internal_note", "paymentInternalNote"]),
    paymentHistory: Array.isArray(row?.payment_history) ? row.payment_history : [],
    depositAmount: getNullableNumber(row, ["deposit_amount", "depositAmount"]),
    paymentLabel: getFirstValue(row, ["payment_label", "paymentLabel"]),
    paymentInstructions: getFirstValue(row, ["payment_instructions", "paymentInstructions"]),
    paymentProofPath: getFirstValue(row, ["payment_proof_path", "paymentProofPath"]),
    paymentProofSubmittedAt: getFirstValue(row, ["payment_proof_submitted_at", "paymentProofSubmittedAt"]),
    paymentConfirmedAt: getFirstValue(row, ["payment_confirmed_at", "paymentConfirmedAt"]),
    paymentConfirmedAmount: getNullableNumber(row, ["payment_confirmed_amount", "paymentConfirmedAmount"]),
    paymentReviewNote: getFirstValue(row, ["payment_review_note", "paymentReviewNote"]),
    paymentRejectedAt: getFirstValue(row, ["payment_rejected_at", "paymentRejectedAt"]),
    productionFieldsReady:
      ["assigned_staff", "assigned_user_id", "production_stage", "production_note", "production_updated_at", "production_started_at", "production_started_by", "qc_started_at", "qc_started_by", "qc_note", "qc_completed_at", "qc_completed_by"].every((key) => Object.prototype.hasOwnProperty.call(row || {}, key)),
  };
}

export function mapInquiryToOpsRow(inquiry) {
  return cleanRow({
    id: inquiry.id,
    customer_id: inquiry.customerId,
    customer_name: inquiry.customer,
    contact: inquiry.contact,
    company: inquiry.company,
    channel: inquiry.channel,
    product_desc: inquiry.productDesc,
    size_breakdown: inquiry.sizeBreakdown,
    owner_id: inquiry.ownerId || inquiry.owner,
    owner_user_id: inquiry.ownerUserId,
    blocked_reason: inquiry.blockedReason,
    lost_reason: inquiry.lostReason,
    quote_sent_at: inquiry.quoteSentAt,
    customer_response: inquiry.customerResponse,
    source: inquiry.source,
    message: inquiry.message,
    product: inquiry.service,
    quantity: inquiry.qty,
    priority: inquiry.priority || "normal",
    status: normalizeOpsStatus(inquiry.status),
    next_action: inquiry.next,
    due_date: normalizeDate(inquiry.dueDate),
    fulfillment_method: inquiry.fulfillmentMethod,
    delivery_city: inquiry.deliveryCity,
    delivery_address: inquiry.deliveryAddress,
    delivery_landmark: inquiry.deliveryLandmark,
    tracking_substatus: inquiry.trackingSubstatus,
    tracking_note: inquiry.trackingNote,
    tracking_updated_at: inquiry.trackingUpdatedAt,
    follow_up_date: normalizeDate(
      inquiry.followUpDate
    ),
    estimated_value: inquiry.estimatedValue,
    assigned_staff: inquiry.assignedStaff,
    assigned_user_id: inquiry.assignedUserId,
    production_stage: inquiry.productionStage,
    production_note: inquiry.productionNote,
    production_updated_at: inquiry.productionUpdatedAt,
    production_started_at: inquiry.productionStartedAt,
    production_started_by: inquiry.productionStartedBy,
    production_completed_at: inquiry.productionCompletedAt,
    production_completed_by: inquiry.productionCompletedBy,
    qc_started_at: inquiry.qcStartedAt,
    qc_started_by: inquiry.qcStartedBy,
    qc_note: inquiry.qcNote,
    qc_completed_at: inquiry.qcCompletedAt,
    qc_completed_by: inquiry.qcCompletedBy,
  });
}

function mapInquiryUpdatesToOpsRow(updates) {
  return cleanRow({
    customer_id: updates.customerId,
    customer_name: updates.customer,
    contact: updates.contact,
    company: updates.company,
    channel: updates.channel,
    product_desc: updates.productDesc,
    size_breakdown: updates.sizeBreakdown,
    owner_id: updates.ownerId ?? updates.owner,
    owner_user_id: updates.ownerUserId,
    blocked_reason: updates.blockedReason,
    lost_reason: updates.lostReason,
    quote_sent_at: updates.quoteSentAt,
    customer_response: updates.customerResponse,
    source: updates.source,
    message: updates.message,
    product: updates.service,
    quantity: updates.qty,
    priority: updates.priority,
    status:
      updates.status === undefined
        ? undefined
        : normalizeOpsStatus(updates.status),
    next_action: updates.next,
    due_date:
      updates.dueDate === undefined
        ? undefined
        : normalizeDate(updates.dueDate),
    fulfillment_method: updates.fulfillmentMethod,
    delivery_city: updates.deliveryCity,
    delivery_address: updates.deliveryAddress,
    delivery_landmark: updates.deliveryLandmark,
    tracking_substatus: updates.trackingSubstatus,
    tracking_note: updates.trackingNote,
    tracking_updated_at: updates.trackingUpdatedAt,
    follow_up_date:
      updates.followUpDate === undefined
        ? undefined
        : normalizeDate(updates.followUpDate),
    estimated_value: updates.estimatedValue,
    assigned_staff: updates.assignedStaff,
    assigned_user_id: updates.assignedUserId,
    production_stage: updates.productionStage,
    production_note: updates.productionNote,
    production_updated_at: updates.productionUpdatedAt,
    production_started_at: updates.productionStartedAt,
    production_started_by: updates.productionStartedBy,
    production_completed_at: updates.productionCompletedAt,
    production_completed_by: updates.productionCompletedBy,
    qc_started_at: updates.qcStartedAt,
    qc_started_by: updates.qcStartedBy,
    qc_note: updates.qcNote,
    qc_completed_at: updates.qcCompletedAt,
    qc_completed_by: updates.qcCompletedBy,
  });
}

function normalizeOpsStatus(value) {
  const normalized = String(value || "new")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  const statusMap = {
    new: "new",
    inquiry_received: "new",
    new_inquiry: "new",
    quote: "new",
    needs_quote: "new",
    quote_needed: "new",
    sent: "sent",
    quote_sent: "sent",
    followup: "sent",
    follow_up: "sent",
    won: "won",
    odoo_created: "won",
    won_odoo_created: "won",
    lost: "lost",
  };

  return statusMap[normalized] ?? "new";
}

function getAccessToken(authSession) {
  const accessToken =
    typeof authSession === "string"
      ? authSession
      : authSession?.access_token;

  if (!accessToken) {
    throw new Error(
      "Supabase auth session is required for ops_inquiries."
    );
  }

  return accessToken;
}

function cleanRow(row) {
  return Object.fromEntries(
    Object.entries(row).filter(
      ([, value]) => value !== undefined
    )
  );
}

function getFirstValue(record, keys) {
  for (const key of keys) {
    const value = record?.[key];

    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      return value;
    }
  }

  return "";
}

function getNullableNumber(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }

  return null;
}

function normalizeDate(value) {
  if (!value) return null;

  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed)
    .toISOString()
    .slice(0, 10);
}

function isMissingTableError(error) {
  const message = String(
    error?.message || error || ""
  ).toLowerCase();

  return (
    message.includes("could not find") ||
    message.includes("does not exist") ||
    message.includes("pgrst205") ||
    message.includes("42p01")
  );
}
