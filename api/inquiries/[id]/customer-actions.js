import {
  createServerSupabaseClient,
  createServerUserSupabaseClient,
} from "../../_lib/supabaseServer.js";

const ARTWORK_BUCKET = "inquiry-artworks";
const SIGNED_URL_EXPIRES_IN_SECONDS = 300;
const MAX_PROOF_SIZE = 10 * 1024 * 1024;
const PROOF_EXTENSIONS = new Set(["png", "jpg", "jpeg", "pdf"]);
const WRITE_ROLES = new Set(["owner", "admin", "staff"]);
const READ_ROLES = new Set(["owner", "admin", "staff"]);
const SHOP_PAYMENT_WRITE_ROLES = new Set(["owner", "admin"]);
const SHOP_PAYMENT_ACTIONS = new Set(["confirm_shop_payment", "confirm_cash_payment"]);
const ONLINE_PAYMENT_ACTIONS = new Set([
  "require_payment",
  "mark_payment_under_review",
  "request_new_payment_proof",
  "confirm_payment",
]);
const SHOP_PAYMENT_METHODS = new Set(["cash", "gcash", "bank_transfer", "card", "other"]);
const PAYMENT_INTERNAL_NOTE_MAX_LENGTH = 500;
const CUSTOMER_ACTION_SELECT = [
  "id",
  "contact",
  "status",
  "production_stage",
  "odoo_so",
  "quoted_amount",
  "amount_due",
  "quote_status",
  "quote_approved_at",
  "quote_published_at",
  "quote_change_request",
  "quote_breakdown",
  "quote_notes",
  "quote_valid_until",
  "quote_sent_at",
  "next_action",
  "updated_at",
  "artwork_status",
  "artwork_url",
  "artwork_approved_at",
  "artwork_revision_request",
  "payment_status",
  "payment_method",
  "payment_type",
  "payment_selected_amount",
  "payment_reference",
  "payment_customer_note",
  "payment_receipt_filename",
  "payment_receipt_content_type",
  "payment_receipt_size",
  "payment_verified_amount",
  "payment_verified_at",
  "payment_verified_by",
  "payment_label",
  "payment_instructions",
  "payment_proof_path",
  "payment_proof_submitted_at",
  "payment_confirmed_at",
  "payment_confirmed_amount",
  "payment_selected_at",
  "payment_internal_note",
  "payment_review_note",
  "payment_rejected_at",
].join(",");
const ONLINE_PAYMENT_FIELDS = [
  "payment_selected_amount",
  "payment_reference",
  "payment_customer_note",
  "payment_receipt_filename",
  "payment_receipt_content_type",
  "payment_receipt_size",
];
const SHOP_PAYMENT_FIELDS = [
  "payment_method",
  "payment_type",
  "payment_verified_amount",
  "payment_verified_at",
  "payment_verified_by",
  "payment_selected_at",
  "payment_internal_note",
];
const SHOP_PAYMENT_SELECT = CUSTOMER_ACTION_SELECT
  .split(",")
  .filter((field) => !ONLINE_PAYMENT_FIELDS.includes(field))
  .join(",");
const CUSTOMER_ACTION_LEGACY_SELECT = CUSTOMER_ACTION_SELECT
  .split(",")
  .filter((field) => !ONLINE_PAYMENT_FIELDS.includes(field) && !SHOP_PAYMENT_FIELDS.includes(field))
  .join(",");
export default async function handler(request, response) {
  const inquiryReference = getInquiryReference(request);

  if (!isValidInquiryReference(inquiryReference)) {
    sendJson(response, 400, { ok: false, error: "invalid inquiry reference" });
    return;
  }

  const token = getBearerToken(request);
  if (!token) {
    sendJson(response, 401, { ok: false, error: "admin session required" });
    return;
  }

  try {
    const supabase = createServerSupabaseClient();
    const adminUser = await getAuthorizedAdmin(supabase, token);

    if (!adminUser || !READ_ROLES.has(adminUser.role)) {
      sendJson(response, adminUser ? 403 : 401, {
        ok: false,
        error: adminUser ? "admin access required" : "admin session required",
      });
      return;
    }

    if (request.method === "GET") {
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      if (url.searchParams.get("view") === "payment-history") {
        await handlePaymentHistoryRequest(response, supabase, inquiryReference);
      } else {
        await handleAssetRequest(request, response, supabase, inquiryReference);
      }
      return;
    }

    if (request.method !== "PATCH") {
      sendJson(response, 405, { ok: false, error: "method not allowed" });
      return;
    }

    if (!WRITE_ROLES.has(adminUser.role)) {
      sendJson(response, 403, { ok: false, error: "write access required" });
      return;
    }

    const body = await readJsonBody(request);
    const action = cleanText(body.action, 80);
    if (ONLINE_PAYMENT_ACTIONS.has(action) && process.env.ENABLE_CUSTOMER_PAYMENT_WORKFLOW !== "true") {
      sendJson(response, 404, { ok: false, error: "online payment workflow is not available" });
      return;
    }
    if (SHOP_PAYMENT_ACTIONS.has(action) && !isAdminPayAtShopWorkflowEnabled()) {
      sendJson(response, 404, { ok: false, error: "Pay at Shop confirmation is not available" });
      return;
    }
    if (SHOP_PAYMENT_ACTIONS.has(action) && !SHOP_PAYMENT_WRITE_ROLES.has(adminUser.role)) {
      sendJson(response, 403, { ok: false, error: "Owner or Admin confirmation required" });
      return;
    }

    const {
      inquiry,
      selectFields,
      paymentWorkflowReady,
      shopPaymentWorkflowReady,
      error: lookupError,
    } = await readCustomerActionInquiry(supabase, inquiryReference);

    if (lookupError) throw lookupError;
    if (!inquiry) {
      sendJson(response, 404, { ok: false, error: "inquiry not found" });
      return;
    }
    if (SHOP_PAYMENT_ACTIONS.has(action) && !shopPaymentWorkflowReady) {
      sendJson(response, 503, { ok: false, error: "payment fields are not ready" });
      return;
    }
    if (ONLINE_PAYMENT_ACTIONS.has(action) && !paymentWorkflowReady) {
      sendJson(response, 503, { ok: false, error: "payment fields are not ready" });
      return;
    }
    if (SHOP_PAYMENT_ACTIONS.has(action)) {
      await handleShopPaymentConfirmation({
        response,
        supabase,
        token,
        inquiryReference,
        body,
        adminUser,
      });
      return;
    }

    if (action === "prepare_artwork_proof_upload") {
      const filename = sanitizeFilename(cleanText(body.filename, 180));
      const fileSize = Number(body.fileSize);
      const contentType = cleanText(body.contentType, 120) || "application/octet-stream";

      if (!filename || !PROOF_EXTENSIONS.has(getExtension(filename))) {
        sendJson(response, 400, { ok: false, error: "upload PNG, JPG, or PDF artwork proof" });
        return;
      }
      if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_PROOF_SIZE) {
        sendJson(response, 400, { ok: false, error: "artwork proof must be between 1 byte and 10 MB" });
        return;
      }

      const proofPath = `${inquiryReference}/proofs/${crypto.randomUUID()}-${filename}`;
      const { data: signed, error: signedError } = await supabase.storage
        .from(ARTWORK_BUCKET)
        .createSignedUploadUrl(proofPath, { upsert: false });

      if (signedError || !signed?.signedUrl) throw signedError || new Error("Signed upload URL missing.");

      sendJson(response, 200, {
        ok: true,
        upload: {
          signedUrl: signed.signedUrl,
          path: proofPath,
          contentType,
        },
      });
      return;
    }

    const now = new Date().toISOString();
    const updates = buildUpdates(action, body, inquiry, now, adminUser);

    if (updates?.error) {
      sendJson(response, 400, { ok: false, error: updates.error });
      return;
    }

    if (!updates) {
      sendJson(response, 400, { ok: false, error: "invalid customer action update" });
      return;
    }

    const { data: updated, error: updateError } = await supabase
      .from("ops_inquiries")
      .update({ ...updates, updated_at: now })
      .eq("id", inquiryReference)
      .select(selectFields)
      .single();

    if (updateError) throw updateError;

    sendJson(response, 200, {
      ok: true,
      inquiry: getSafeInquiry(updated),
    });
  } catch (error) {
    const expectedError = getExpectedPaymentError(error);
    if (expectedError) {
      sendJson(response, expectedError.status, { ok: false, error: expectedError.message });
      return;
    }

    console.error("Admin customer action failed.", {
      message: error?.message,
      code: error?.code,
      status: error?.status || error?.statusCode,
    });

    const schemaMissing = /quoted_amount|quote_status|quote_published_at|artwork_status|payment_status|payment_review_note|payment_rejected_at|payment_selected_amount|payment_selected_at|payment_internal_note|payment_type|payment_method|payment_verified_by|inquiry_payment_events|confirm_inquiry_shop_payment|schema cache|could not find/i.test(String(error?.message || ""));
    sendJson(response, schemaMissing ? 503 : 500, {
      ok: false,
      error: schemaMissing
        ? "customer action fields are not ready"
        : "customer action update failed",
    });
  }
}

async function getAuthorizedAdmin(supabase, token) {
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) return null;

  const adminUser = await readAdminUser(supabase, userData.user.id);
  return normalizeAdminUser(adminUser);
}

async function readAdminUser(supabase, userId) {
  const query = (select) => supabase
    .from("admin_users")
    .select(select)
    .eq("user_id", userId)
    .maybeSingle();

  const { data, error } = await query("id,user_id,display_name,role,is_active");
  if (!error) return data;
  if (!isMissingAdminProfileColumn(error)) throw error;

  const fallback = await query("id,user_id,role");
  if (fallback.error) throw fallback.error;
  return fallback.data;
}

function normalizeAdminUser(adminUser) {
  if (!adminUser || adminUser.is_active === false) return null;
  const role = String(adminUser.role || "").trim().toLowerCase();
  return { ...adminUser, role };
}

function isMissingAdminProfileColumn(error) {
  return /is_active|42703|schema cache|could not find/i.test(String(error?.message || error || ""));
}

async function handleShopPaymentConfirmation({
  response,
  supabase,
  token,
  inquiryReference,
  body,
  adminUser,
}) {
  const action = cleanText(body.action, 80);
  const amount = getMoney(body.receivedAmount ?? body.confirmedAmount);
  const method = cleanPaymentMethod(body.paymentMethod)
    || (action === "confirm_cash_payment" ? "cash" : "");
  const rawNote = typeof body.internalNote === "string" ? body.internalNote.trim() : "";
  const rawIdempotencyKey = typeof body.idempotencyKey === "string"
    ? body.idempotencyKey.trim()
    : "";
  const idempotencyKey = rawIdempotencyKey
    || (action === "confirm_cash_payment" ? `legacy:${crypto.randomUUID()}` : "");

  if (!Number.isFinite(amount) || amount <= 0 || roundMoney(amount) !== amount) {
    sendJson(response, 400, { ok: false, error: "received amount must be a positive amount with at most two decimal places" });
    return;
  }
  if (!SHOP_PAYMENT_METHODS.has(method)) {
    sendJson(response, 400, { ok: false, error: "select a valid payment method" });
    return;
  }
  if (rawNote.length > PAYMENT_INTERNAL_NOTE_MAX_LENGTH) {
    sendJson(response, 400, { ok: false, error: `internal note must be ${PAYMENT_INTERNAL_NOTE_MAX_LENGTH} characters or fewer` });
    return;
  }
  if (
    idempotencyKey.length < 8
    || idempotencyKey.length > 120
    || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)
  ) {
    sendJson(response, 400, { ok: false, error: "valid idempotency key required" });
    return;
  }

  const callerSupabase = createServerUserSupabaseClient(token);
  const { error: confirmationError } = await callerSupabase.rpc(
    "confirm_inquiry_shop_payment",
    {
      p_inquiry_id: inquiryReference,
      p_amount: amount,
      p_payment_method: method,
      p_internal_note: rawNote || null,
      p_idempotency_key: idempotencyKey,
    }
  );

  if (confirmationError) throw confirmationError;

  const {
    inquiry: updated,
    error: updatedError,
  } = await readCustomerActionInquiry(supabase, inquiryReference);
  if (updatedError) throw updatedError;
  if (!updated) throw Object.assign(new Error("INQUIRY_NOT_FOUND"), { code: "P0002" });

  const paymentEvents = await readPaymentEvents(supabase, inquiryReference);
  sendJson(response, 200, {
    ok: true,
    inquiry: getSafeInquiry(updated),
    confirmedBy: {
      displayName: cleanText(adminUser.display_name, 120) || "TRRY Admin",
      role: adminUser.role,
    },
    paymentEvents,
  });
}

async function handlePaymentHistoryRequest(response, supabase, inquiryReference) {
  const { data: inquiry, error } = await supabase
    .from("ops_inquiries")
    .select("id")
    .eq("id", inquiryReference)
    .maybeSingle();

  if (error) throw error;
  if (!inquiry) {
    sendJson(response, 404, { ok: false, error: "inquiry not found" });
    return;
  }

  const paymentEvents = await readPaymentEvents(supabase, inquiryReference);
  sendJson(response, 200, { ok: true, paymentEvents });
}

async function readPaymentEvents(supabase, inquiryReference) {
  const { data: events, error } = await supabase
    .from("inquiry_payment_events")
    .select("event_type,previous_status,next_status,payment_method,amount,internal_note,actor_user_id,actor_role,source,created_at")
    .eq("inquiry_id", inquiryReference)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const actorIds = [...new Set((events || []).map((event) => event.actor_user_id).filter(Boolean))];
  let actorById = new Map();
  if (actorIds.length) {
    const { data: actors, error: actorError } = await supabase
      .from("admin_users")
      .select("user_id,display_name,role")
      .in("user_id", actorIds);

    if (actorError) throw actorError;
    actorById = new Map((actors || []).map((actor) => [actor.user_id, actor]));
  }

  return (events || []).map((event) => {
    const actor = actorById.get(event.actor_user_id);
    return {
      eventType: cleanText(event.event_type, 80),
      previousStatus: cleanText(event.previous_status, 80),
      nextStatus: cleanText(event.next_status, 80),
      paymentMethod: cleanText(event.payment_method, 80),
      amount: numberOrNull(event.amount),
      internalNote: cleanText(event.internal_note, PAYMENT_INTERNAL_NOTE_MAX_LENGTH),
      actorDisplayName: cleanText(actor?.display_name, 120),
      actorRole: cleanText(actor?.role || event.actor_role, 80),
      source: cleanText(event.source, 80),
      createdAt: cleanText(event.created_at, 80),
    };
  });
}

function getExpectedPaymentError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");

  if (code === "42501" || /SHOP_PAYMENT_FORBIDDEN/.test(message)) {
    return { status: 403, message: "Owner or Admin confirmation required" };
  }
  if (code === "P0002" || /INQUIRY_NOT_FOUND/.test(message)) {
    return { status: 404, message: "inquiry not found" };
  }
  if (code === "23505" || /ALREADY_CONFIRMED|IDEMPOTENCY_KEY_CONFLICT/.test(message)) {
    return { status: 409, message: /IDEMPOTENCY_KEY_CONFLICT/.test(message) ? "idempotency key conflict" : "shop payment is already confirmed" };
  }
  if (code === "22023" || /INVALID_|_REQUIRED|NOTE_TOO_LONG/.test(message)) {
    const friendlyMessage = {
      INVALID_PAYMENT_METHOD: "select a valid payment method",
      INVALID_PAYMENT_AMOUNT: "received amount must be positive and use at most two decimal places",
      PAYMENT_NOTE_TOO_LONG: `internal note must be ${PAYMENT_INTERNAL_NOTE_MAX_LENGTH} characters or fewer`,
      INVALID_IDEMPOTENCY_KEY: "valid idempotency key required",
      PAY_AT_SHOP_STATUS_REQUIRED: "inquiry is not pending Pay at Shop",
      PRODUCTION_ACTIVE_PAYMENT_LOCKED: "payment details are locked after production starts",
      APPROVED_QUOTE_REQUIRED: "approved quote required",
      APPROVED_ARTWORK_REQUIRED: "approved artwork required",
      POSITIVE_QUOTE_REQUIRED: "valid quote total required",
      FULL_QUOTE_AMOUNT_REQUIRED: "received amount must match the full quoted amount",
    };
    const key = Object.keys(friendlyMessage).find((candidate) => message.includes(candidate));
    return { status: 400, message: friendlyMessage[key] || "shop payment confirmation is invalid" };
  }

  return null;
}

function isAdminPayAtShopWorkflowEnabled() {
  return [
    process.env.ENABLE_ADMIN_PAY_AT_SHOP_WORKFLOW,
    process.env.ENABLE_ADMIN_SHOP_WORKFLOW,
  ].some((value) => String(value || "").trim().toLowerCase() === "true");
}

function cleanPaymentMethod(value) {
  return cleanText(value, 80).toLowerCase().replace(/[\s-]+/g, "_");
}

export function buildUpdates(action, body, inquiry, now, adminUser = null) {
  if (isProductionActive(inquiry.production_stage)) return null;

  const quoteValues = getQuoteValues(body);
  const proofPath = cleanText(body.proofPath, 500);
  const confirmedAmount = getMoney(body.confirmedAmount);
  const paymentReviewNote = cleanText(body.paymentReviewNote, 1000);

  if (action === "mark_artwork_under_review") {
    if (!["submitted", "under_review", "revision_requested"].includes(String(inquiry.artwork_status || ""))) return null;
    return { artwork_status: "under_review" };
  }

  if (action === "mark_artwork_usable") {
    if (!["submitted", "under_review", "revision_requested"].includes(String(inquiry.artwork_status || ""))) return null;
    return { artwork_status: "submitted", artwork_revision_request: null };
  }

  if (action === "request_new_artwork") {
    return { artwork_status: "missing" };
  }

  if (action === "finalize_artwork_proof_upload") {
    if (!isValidProofPath(proofPath, inquiry.id)) return null;
    return { artwork_url: proofPath, artwork_status: "under_review" };
  }

  if (action === "publish_artwork") {
    if (inquiry.quote_status !== "approved" || !isValidProofPath(String(inquiry.artwork_url || ""), inquiry.id)) return null;
    return { artwork_status: "approval_required", artwork_revision_request: null };
  }

  if (["save_quote_draft", "revise_quote", "mark_quote_pending", "publish_quote"].includes(action)) {
    const quoteError = getQuoteValidationError(action, body, inquiry);
    if (quoteError) return { error: quoteError };

    const currentQuoteValues = getQuoteValues(body, { allowAmountDueFallback: true });
    if (!currentQuoteValues) return { error: "enter a valid quoted amount" };

    return {
      ...currentQuoteValues,
      quote_status: action === "publish_quote" ? "ready" : "pending",
      quote_published_at: action === "publish_quote" ? now : null,
      quote_sent_at: action === "publish_quote" ? now : inquiry.quote_sent_at,
      status: action === "publish_quote" ? "sent" : inquiry.status,
      next_action: action === "publish_quote" ? "Quote sent - wait for customer response" : inquiry.next_action,
      quote_change_request: action === "publish_quote" ? null : inquiry.quote_change_request,
    };
  }
  if (action === "require_payment") {
    const amountDue = getMoney(body.amountDue);
    const paymentInstructions = cleanText(body.paymentInstructions, 2000);
    const paymentLabel = cleanText(body.paymentLabel, 120);
    if (!paymentInstructions) return { error: "enter payment instructions" };
    if (inquiry.quote_status !== "approved" || inquiry.artwork_status !== "approved" || !Number.isFinite(amountDue) || amountDue <= 0 || ["required", "proof_submitted", "under_review", "confirmed"].includes(String(inquiry.payment_status || ""))) return null;
    return { amount_due: amountDue, payment_label: paymentLabel || null, payment_instructions: paymentInstructions, payment_status: "required", payment_review_note: null, payment_rejected_at: null, updated_at: now };
  }

  if (action === "mark_payment_under_review") {
    if (!inquiry.payment_proof_path || !["proof_submitted", "under_review"].includes(String(inquiry.payment_status || ""))) return null;
    return paymentReviewNote
      ? { payment_status: "under_review", payment_review_note: paymentReviewNote }
      : { payment_status: "under_review" };
  }

  if (action === "request_new_payment_proof") {
    if (
      inquiry.quote_status !== "approved"
      || inquiry.artwork_status !== "approved"
      || !["required", "proof_submitted", "under_review", "correction_required"].includes(String(inquiry.payment_status || ""))
    ) return null;
    if (paymentReviewNote.length < 5) return { error: "receipt request reason required" };
    return { payment_status: "correction_required", payment_review_note: paymentReviewNote, payment_rejected_at: now };
  }

  if (action === "confirm_payment") {
    if (
      inquiry.quote_status !== "approved"
      || inquiry.artwork_status !== "approved"
      || !inquiry.payment_proof_path
      || !["proof_submitted", "under_review"].includes(String(inquiry.payment_status || ""))
      || !Number.isFinite(confirmedAmount)
      || confirmedAmount <= 0
    ) return null;

    const confirmation = getConfirmedPaymentState(inquiry, confirmedAmount);
    if (!confirmation.ok) return { error: confirmation.error };

    return {
      payment_status: confirmation.status,
      payment_confirmed_amount: confirmedAmount,
      payment_confirmed_at: now,
      payment_verified_amount: confirmedAmount,
      payment_verified_at: now,
      payment_verified_by: adminUser?.user_id || null,
      amount_due: confirmation.remainingBalance,
      payment_review_note: null,
      payment_rejected_at: null,
    };
  }

  return null;
}

async function readCustomerActionInquiry(supabase, inquiryReference) {
  const read = (selectFields) => supabase
    .from("ops_inquiries")
    .select(selectFields)
    .eq("id", inquiryReference)
    .maybeSingle();
  const full = await read(CUSTOMER_ACTION_SELECT);
  if (!isMissingParkedPaymentColumn(full.error)) {
    return {
      inquiry: full.data,
      selectFields: CUSTOMER_ACTION_SELECT,
      paymentWorkflowReady: true,
      shopPaymentWorkflowReady: true,
      error: full.error,
    };
  }
  const shop = await read(SHOP_PAYMENT_SELECT);
  if (!isMissingParkedPaymentColumn(shop.error)) {
    return {
      inquiry: shop.data,
      selectFields: SHOP_PAYMENT_SELECT,
      paymentWorkflowReady: false,
      shopPaymentWorkflowReady: true,
      error: shop.error,
    };
  }
  const legacy = await read(CUSTOMER_ACTION_LEGACY_SELECT);
  return {
    inquiry: legacy.data,
    selectFields: CUSTOMER_ACTION_LEGACY_SELECT,
    paymentWorkflowReady: false,
    shopPaymentWorkflowReady: false,
    error: legacy.error,
  };
}

function isMissingParkedPaymentColumn(error) {
  return /payment_selected_amount|payment_type|payment_method|payment_reference|payment_customer_note|payment_receipt|payment_verified|payment_verified_by|42703|schema cache|could not find/i.test(String(error?.message || error || ""));
}

function isProductionActive(value) {
  return ["printing", "embroidery", "screen_printing", "qc", "ready", "in_production", "qc_finishing", "ready_for_fulfillment", "completed"].includes(String(value || ""));
}

function getQuoteValues(body, options = {}) {
  const quotedAmount = getMoney(body.quotedAmount);
  const amountDueText = String(body.amountDue ?? "").trim();
  const amountDue = amountDueText || !options.allowAmountDueFallback
    ? getMoney(body.amountDue)
    : quotedAmount;
  const quoteBreakdown = cleanText(body.quoteBreakdown, 5000);
  const quoteNotes = cleanText(body.quoteNotes, 2000);
  const quoteValidUntil = cleanDate(body.quoteValidUntil);
  const paymentLabel = cleanText(body.paymentLabel, 120);
  const paymentInstructions = cleanText(body.paymentInstructions, 2000);

  if (!Number.isFinite(quotedAmount) || quotedAmount < 0 || !Number.isFinite(amountDue) || amountDue < 0) return null;

  return {
    quoted_amount: quotedAmount,
    amount_due: amountDue,
    quote_breakdown: quoteBreakdown || null,
    quote_notes: quoteNotes || null,
    quote_valid_until: quoteValidUntil,
    payment_label: paymentLabel || null,
    payment_instructions: paymentInstructions || null,
  };
}

function getQuoteValidationError(action, body, inquiry) {
  const quotedAmountText = String(body.quotedAmount ?? "").trim();
  const amountDueText = String(body.amountDue ?? "").trim();
  const quotedAmount = getMoney(quotedAmountText);
  const amountDue = amountDueText ? getMoney(amountDueText) : quotedAmount;
  const quoteValidUntil = cleanDate(body.quoteValidUntil);

  if (["publish_quote"].includes(action) && (!Number.isFinite(quotedAmount) || quotedAmount <= 0)) {
    return "enter a valid quoted amount";
  }

  if (quotedAmountText && (!Number.isFinite(quotedAmount) || quotedAmount < 0)) {
    return "enter a valid quoted amount";
  }

  if (amountDueText && (!Number.isFinite(amountDue) || amountDue < 0)) {
    return "enter a valid amount due";
  }

  if (String(body.quoteValidUntil || "").trim() && !quoteValidUntil) {
    return "enter a valid quote validity date";
  }

  if (quoteValidUntil && isPastDate(quoteValidUntil)) {
    return "quote validity date has expired";
  }


  return "";
}

function isPastDate(dateText) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(`${dateText}T00:00:00`);
  return !Number.isFinite(date.getTime()) || date < today;
}
async function handleAssetRequest(request, response, supabase, inquiryReference) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const asset = String(url.searchParams.get("asset") || "");
  const { data: inquiry, error } = await supabase
    .from("ops_inquiries")
    .select("id,artwork_status,artwork_url,payment_proof_path")
    .eq("id", inquiryReference)
    .maybeSingle();

  if (error) throw error;
  if (!inquiry) {
    sendJson(response, 404, { ok: false, error: "inquiry not found" });
    return;
  }

  let path = "";
  let uploadedAt = "";
  if (asset === "artwork-proof") {
    path = String(inquiry.artwork_url || "");
  } else if (asset === "payment-proof") {
    path = String(inquiry.payment_proof_path || "");
  } else if (asset === "customer-artwork") {
    const customerArtwork = await findCustomerArtworkPath(supabase, inquiry);
    path = customerArtwork.path;
    uploadedAt = customerArtwork.uploadedAt;
  } else {
    sendJson(response, 400, { ok: false, error: "invalid asset request" });
    return;
  }

  if (!path) {
    sendJson(response, 404, { ok: false, error: "file not available" });
    return;
  }

  if (/^https:\/\//i.test(path)) {
    sendJson(response, 200, { ok: true, signedUrl: path, uploadedAt });
    return;
  }

  const { data: signed, error: signedError } = await supabase.storage
    .from(ARTWORK_BUCKET)
    .createSignedUrl(path, SIGNED_URL_EXPIRES_IN_SECONDS);

  if (signedError || !signed?.signedUrl) throw signedError || new Error("Signed URL missing.");
  sendJson(response, 200, { ok: true, signedUrl: signed.signedUrl, uploadedAt });
}

async function findCustomerArtworkPath(supabase, inquiry) {
  const currentPath = String(inquiry.artwork_url || "");
  if (/^https:\/\//i.test(currentPath) && !currentPath.includes("/proofs/")) {
    return { path: currentPath, uploadedAt: "" };
  }

  const { data: files, error } = await supabase.storage
    .from(ARTWORK_BUCKET)
    .list(inquiry.id, { limit: 100 });

  if (error) throw error;

  const availableFiles = (Array.isArray(files) ? files : [])
    .filter((file) => file?.id && file?.name)
    .sort((a, b) => getFileTime(b) - getFileTime(a));
  const currentName = currentPath ? currentPath.split("/").pop() : "";
  const selected = availableFiles.find((file) => file.name === currentName) || availableFiles[0];

  return selected
    ? {
        path: currentPath && !currentPath.includes("/proofs/") ? currentPath : `${inquiry.id}/${selected.name}`,
        uploadedAt: selected.updated_at || selected.created_at || selected.last_accessed_at || "",
      }
    : { path: "", uploadedAt: "" };
}

function getSafeInquiry(row) {
  return {
    id: row.id,
    quotedAmount: numberOrNull(row.quoted_amount),
    amountDue: numberOrNull(row.amount_due),
    quoteStatus: cleanText(row.quote_status, 80),
    quoteApprovedAt: cleanText(row.quote_approved_at, 80),
    quotePublishedAt: cleanText(row.quote_published_at, 80),
    quoteChangeRequest: cleanText(row.quote_change_request, 1000),
    quoteBreakdown: cleanText(row.quote_breakdown, 5000),
    quoteNotes: cleanText(row.quote_notes, 2000),
    quoteValidUntil: cleanText(row.quote_valid_until, 40),
    quoteSentAt: cleanText(row.quote_sent_at, 80),
    status: cleanText(row.status, 80),
    next: cleanText(row.next_action, 500),
    updatedAt: cleanText(row.updated_at, 80),
    artworkStatus: cleanText(row.artwork_status, 80),
    artworkApprovedAt: cleanText(row.artwork_approved_at, 80),
    artworkRevisionRequest: cleanText(row.artwork_revision_request, 1000),
    paymentStatus: cleanText(row.payment_status, 80),
    paymentMethod: cleanText(row.payment_method, 80),
    paymentType: cleanText(row.payment_type, 80),
    paymentSelectedAmount: numberOrNull(row.payment_selected_amount),
    paymentReference: cleanText(row.payment_reference, 120),
    paymentCustomerNote: cleanText(row.payment_customer_note, 1000),
    paymentReceiptFilename: cleanText(row.payment_receipt_filename, 180),
    paymentReceiptContentType: cleanText(row.payment_receipt_content_type, 120),
    paymentReceiptSize: numberOrNull(row.payment_receipt_size),
    paymentVerifiedAmount: numberOrNull(row.payment_verified_amount),
    paymentVerifiedAt: cleanText(row.payment_verified_at, 80),
    paymentVerifiedBy: cleanText(row.payment_verified_by, 80),
    paymentLabel: cleanText(row.payment_label, 120),
    paymentInstructions: cleanText(row.payment_instructions, 2000),
    paymentProofSubmittedAt: cleanText(row.payment_proof_submitted_at, 80),
    paymentConfirmedAt: cleanText(row.payment_confirmed_at, 80),
    paymentConfirmedAmount: numberOrNull(row.payment_confirmed_amount),
    paymentSelectedAt: cleanText(row.payment_selected_at, 80),
    paymentInternalNote: cleanText(row.payment_internal_note, PAYMENT_INTERNAL_NOTE_MAX_LENGTH),
    paymentReviewNote: cleanText(row.payment_review_note, 1000),
    paymentRejectedAt: cleanText(row.payment_rejected_at, 80),
  };
}

async function readJsonBody(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) return request.body;

  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function getInquiryReference(request) {
  const queryId = Array.isArray(request.query?.id) ? request.query.id[0] : request.query?.id;
  if (queryId) return String(queryId).trim().toUpperCase();

  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const match = url.pathname.match(/^\/api\/inquiries\/([^/]+)\/customer-actions\/?$/);
  return match ? decodeURIComponent(match[1]).trim().toUpperCase() : "";
}

function getBearerToken(request) {
  const authorization = request.headers.authorization || request.headers.Authorization || "";
  const match = String(authorization).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function isValidInquiryReference(value) {
  return /^[A-Z0-9][A-Z0-9_-]{2,79}$/.test(value);
}

function getMoney(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.trim().replace(/,/g, "");
    if (normalized && Number.isFinite(Number(normalized))) return Number(normalized);
  }
  return NaN;
}

export function getConfirmedPaymentState(inquiry, amount) {
  const total = Number(inquiry.quoted_amount);
  if (!Number.isFinite(total) || total <= 0) return { ok: false, error: "valid quote total required" };
  const roundedAmount = roundMoney(amount);
  const fullAmount = roundMoney(total);
  const downAmount = roundMoney(total * 0.5);
  const paymentType = String(inquiry.payment_type || "").trim().toLowerCase();
  const selectedAmount = Number(inquiry.payment_selected_amount);
  const hasSelectedAmount = Number.isFinite(selectedAmount) && selectedAmount > 0;

  if (amountsMatch(roundedAmount, fullAmount)) {
    return { ok: true, status: "paid", paymentType: "full", remainingBalance: 0 };
  }
  if (total >= 1000 && amountsMatch(roundedAmount, downAmount)) {
    if (paymentType && !["down_payment", "shop"].includes(paymentType)) {
      return { ok: false, error: "confirmed amount must match the selected payment type" };
    }
    if (hasSelectedAmount && !amountsMatch(selectedAmount, downAmount)) {
      return { ok: false, error: "confirmed amount must match the selected payment amount" };
    }
    return {
      ok: true,
      status: "down_payment_confirmed",
      paymentType: "down_payment",
      remainingBalance: roundMoney(fullAmount - downAmount),
    };
  }
  return { ok: false, error: total >= 1000 ? "confirmed amount must match the 50% down payment or full quote total" : "confirmed amount must match the full quote total" };
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function amountsMatch(left, right) {
  return Math.abs(roundMoney(left) - roundMoney(right)) <= 0.009;
}
function numberOrNull(value) {
  const number = getMoney(value);
  return Number.isFinite(number) ? number : null;
}

function cleanDate(value) {
  const text = cleanText(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function sanitizeFilename(filename) {
  const normalized = filename.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return normalized.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "artwork-proof";
}

function getExtension(filename) {
  const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

function isValidProofPath(path, inquiryReference) {
  return path.startsWith(`${inquiryReference}/proofs/`) && PROOF_EXTENSIONS.has(getExtension(path));
}

function getFileTime(file) {
  return Date.parse(file.updated_at || file.created_at || file.last_accessed_at || "") || 0;
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}
