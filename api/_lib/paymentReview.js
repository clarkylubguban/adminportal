import {
  createServerSupabaseClient,
  createServerUserSupabaseClient,
} from "./supabaseServer.js";

const PORTAL_ROLES = new Set(["owner", "admin", "staff"]);
const REVIEW_ROLES = new Set(["owner", "admin"]);
const REVIEW_ACTIONS = new Set([
  "start_online_payment_review",
  "confirm_online_payment",
  "request_online_payment_correction",
]);
const REVIEWABLE_STATUSES = new Set(["proof_submitted", "under_review"]);
const ONLINE_METHODS = new Set(["gcash", "bank_transfer"]);
const RECEIPT_BUCKET = "inquiry-artworks";
const RECEIPT_TYPES = new Set(["image/png", "image/jpeg", "application/pdf"]);
const RECEIPT_EXTENSIONS = new Set(["png", "jpg", "jpeg", "pdf"]);
const SIGNED_URL_EXPIRES_IN_SECONDS = 300;
const PAYMENT_SELECT = [
  "id",
  "customer_name",
  "company",
  "quote_status",
  "quoted_amount",
  "amount_due",
  "payment_status",
  "payment_method",
  "payment_type",
  "payment_selected_amount",
  "payment_reference",
  "payment_customer_note",
  "payment_proof_path",
  "payment_receipt_filename",
  "payment_receipt_content_type",
  "payment_receipt_size",
  "payment_proof_submitted_at",
  "payment_confirmed_at",
  "payment_confirmed_amount",
  "payment_verified_amount",
  "payment_verified_at",
  "payment_verified_by",
  "payment_review_note",
  "payment_rejected_at",
  "payment_internal_note",
  "updated_at",
].join(",");
const PAYMENT_EVENT_SELECT = [
  "event_type",
  "previous_status",
  "next_status",
  "payment_method",
  "amount",
  "review_note",
  "internal_note",
  "actor_user_id",
  "actor_role",
  "source",
  "created_at",
].join(",");

export function createPaymentReviewHandler(overrides = {}) {
  const dependencies = {
    createServiceClient: overrides.createServiceClient || createServerSupabaseClient,
    createUserClient: overrides.createUserClient || createServerUserSupabaseClient,
    getAuthUser: overrides.getAuthUser || getAuthUser,
    getPortalProfile: overrides.getPortalProfile || getPortalProfile,
    getInquiry: overrides.getInquiry || getInquiry,
    getPaymentEvents: overrides.getPaymentEvents || getPaymentEvents,
    getDisplayProfiles: overrides.getDisplayProfiles || getDisplayProfiles,
    invokeReview: overrides.invokeReview || invokeReview,
    getProofObject: overrides.getProofObject || getProofObject,
    createProofUrl: overrides.createProofUrl || createProofUrl,
    featureEnabled: overrides.featureEnabled || (() => process.env.ENABLE_ADMIN_ONLINE_PAYMENT_REVIEW === "true"),
  };

  return async function paymentReviewHandler(request, response, mode = "review") {
    if (!dependencies.featureEnabled()) {
      return sendJson(response, 404, paymentError(
        "PAYMENT_REVIEW_UNAVAILABLE",
        "Online payment review is not available.",
      ));
    }

    const inquiryReference = getInquiryReference(request);
    if (!isValidInquiryReference(inquiryReference)) {
      return sendJson(response, 400, paymentError(
        "INVALID_INQUIRY_REFERENCE",
        "Invalid inquiry reference.",
      ));
    }

    const allowedMethods = mode === "proof" ? new Set(["GET"]) : new Set(["GET", "PATCH"]);
    if (!allowedMethods.has(request.method)) {
      return sendJson(response, 405, paymentError("METHOD_NOT_ALLOWED", "Method not allowed."));
    }

    const token = getBearerToken(request);
    if (!token) {
      return sendJson(response, 401, paymentError("AUTH_REQUIRED", "Authentication required."));
    }

    try {
      const serviceClient = dependencies.createServiceClient();
      const authUser = await dependencies.getAuthUser(serviceClient, token);
      if (!authUser?.id) {
        return sendJson(response, 401, paymentError("AUTH_REQUIRED", "Authentication required."));
      }

      const profile = await dependencies.getPortalProfile(serviceClient, authUser.id);
      const role = key(profile?.role);
      if (!profile || profile.is_active === false || !PORTAL_ROLES.has(role)) {
        return sendJson(response, 403, paymentError(
          "PAYMENT_REVIEW_FORBIDDEN",
          "Payment review access is not available.",
        ));
      }

      const inquiry = await dependencies.getInquiry(serviceClient, inquiryReference);
      if (!inquiry) {
        return sendJson(response, 404, paymentError("INQUIRY_NOT_FOUND", "Inquiry not found."));
      }

      if (mode === "proof") {
        return handleProofRequest(response, dependencies, serviceClient, inquiry);
      }

      if (request.method === "PATCH") {
        if (!REVIEW_ROLES.has(role)) {
          return sendJson(response, 403, paymentError(
            "PAYMENT_REVIEW_WRITE_FORBIDDEN",
            "Owner or Admin review is required.",
          ));
        }

        const body = await readJsonBody(request);
        const validation = validateReviewCommand(body);
        if (validation) {
          return sendJson(response, 400, paymentError(validation.code, validation.message));
        }

        const callerClient = dependencies.createUserClient(token);
        await dependencies.invokeReview(callerClient, inquiryReference, body);
      }

      const canonicalInquiry = request.method === "PATCH"
        ? await dependencies.getInquiry(serviceClient, inquiryReference)
        : inquiry;
      const events = await dependencies.getPaymentEvents(serviceClient, inquiryReference);
      const profileIds = [
        canonicalInquiry.payment_verified_by,
        ...events.map((event) => event.actor_user_id),
      ].filter(isUuid);
      const profiles = await dependencies.getDisplayProfiles(serviceClient, profileIds);

      return sendJson(response, 200, {
        ok: true,
        payment: normalizePaymentReview(canonicalInquiry, events, profiles, role),
      });
    } catch (error) {
      const expected = mapPaymentReviewError(error);
      if (expected) {
        return sendJson(response, expected.status, paymentError(expected.code, expected.message));
      }

      console.error("Online payment review request failed.", {
        code: cleanText(error?.code, 40) || "UNKNOWN",
      });
      return sendJson(response, 500, paymentError(
        "PAYMENT_REVIEW_FAILED",
        "Unable to process the payment review.",
      ));
    }
  };
}

async function handleProofRequest(response, dependencies, serviceClient, inquiry) {
  const path = cleanText(inquiry.payment_proof_path, 500);
  const contentType = cleanText(inquiry.payment_receipt_content_type, 120).toLowerCase();
  const filename = sanitizeFilename(cleanText(inquiry.payment_receipt_filename, 180));

  if (!path || !filename) {
    return sendJson(response, 404, paymentError("PAYMENT_PROOF_NOT_FOUND", "Payment receipt is not available."));
  }
  if (
    !isSafeReceiptPath(path, inquiry.id)
    || !isSafeReceiptType(filename, contentType)
    || !isSafeReceiptType(path, contentType)
  ) {
    return sendJson(response, 415, paymentError(
      "PAYMENT_PROOF_UNSAFE",
      "Payment receipt type is not supported.",
    ));
  }

  const object = await dependencies.getProofObject(serviceClient, path);
  if (!object) {
    return sendJson(response, 404, paymentError("PAYMENT_PROOF_NOT_FOUND", "Payment receipt is not available."));
  }

  const storedType = cleanText(object.contentType, 120).toLowerCase();
  if (!storedType || !RECEIPT_TYPES.has(storedType) || !typesMatch(contentType, storedType)) {
    return sendJson(response, 415, paymentError(
      "PAYMENT_PROOF_UNSAFE",
      "Payment receipt type is not supported.",
    ));
  }

  const signedUrl = await dependencies.createProofUrl(serviceClient, path);
  if (!signedUrl) throw Object.assign(new Error("SIGNED_URL_UNAVAILABLE"), { code: "SIGNED_URL_UNAVAILABLE" });

  return sendJson(response, 200, {
    ok: true,
    proof: {
      signedUrl,
      filename,
      contentType,
      sizeBytes: numberOrNull(inquiry.payment_receipt_size),
      expiresIn: SIGNED_URL_EXPIRES_IN_SECONDS,
    },
  });
}

export function normalizePaymentReview(inquiry, events = [], profiles = [], role = "staff") {
  const profileMap = new Map(
    profiles
      .filter((profile) => isUuid(profile?.user_id))
      .map((profile) => [
        profile.user_id,
        cleanText(profile.display_name, 160) || roleLabel(profile.role),
      ]),
  );
  const paymentStatus = key(inquiry.payment_status) || "not_required";
  const paymentMethod = key(inquiry.payment_method);
  const paymentType = key(inquiry.payment_type);
  const quotedAmount = numberOrNull(inquiry.quoted_amount);
  const amountDue = positiveMoney(inquiry.amount_due) ?? positiveMoney(inquiry.quoted_amount);
  const hasReceipt = Boolean(
    isSafeReceiptPath(inquiry.payment_proof_path, inquiry.id)
    && sanitizeFilename(cleanText(inquiry.payment_receipt_filename, 180))
    && isSafeReceiptType(
      inquiry.payment_receipt_filename,
      inquiry.payment_receipt_content_type,
    ),
  );
  const canWrite = REVIEW_ROLES.has(key(role));
  const supportedOnlineReceipt = ["full", "down_payment"].includes(paymentType)
    && ONLINE_METHODS.has(paymentMethod)
    && hasReceipt;

  return {
    inquiryId: cleanText(inquiry.id, 80),
    customer: cleanText(inquiry.customer_name, 240)
      || cleanText(inquiry.company, 240)
      || "Unnamed customer",
    paymentStatus,
    paymentMethod,
    paymentType,
    submittedAmount: numberOrNull(inquiry.payment_selected_amount),
    quotedAmount,
    amountDue,
    customerReference: cleanText(inquiry.payment_reference, 120),
    customerNote: cleanText(inquiry.payment_customer_note, 1000),
    submittedAt: isoOrNull(inquiry.payment_proof_submitted_at),
    receipt: {
      available: hasReceipt,
      filename: hasReceipt
        ? sanitizeFilename(cleanText(inquiry.payment_receipt_filename, 180))
        : "",
      contentType: hasReceipt
        ? cleanText(inquiry.payment_receipt_content_type, 120).toLowerCase()
        : "",
      sizeBytes: hasReceipt ? numberOrNull(inquiry.payment_receipt_size) : null,
    },
    reviewNote: cleanText(inquiry.payment_review_note, 1000),
    rejectedAt: isoOrNull(inquiry.payment_rejected_at),
    verifiedAmount: numberOrNull(
      inquiry.payment_verified_amount ?? inquiry.payment_confirmed_amount,
    ),
    verifiedAt: isoOrNull(
      inquiry.payment_verified_at ?? inquiry.payment_confirmed_at,
    ),
    verifiedBy: displayForUser(inquiry.payment_verified_by, profileMap),
    internalNote: canWrite ? cleanText(inquiry.payment_internal_note, 500) : "",
    version: versionOrNull(inquiry.updated_at),
    history: events
      .map((event) => normalizePaymentEvent(event, profileMap, canWrite))
      .filter(Boolean),
    permissions: {
      canRead: true,
      canStartReview: canWrite && supportedOnlineReceipt && paymentStatus === "proof_submitted",
      canConfirm: canWrite && supportedOnlineReceipt && REVIEWABLE_STATUSES.has(paymentStatus),
      canRequestCorrection: canWrite && supportedOnlineReceipt && REVIEWABLE_STATUSES.has(paymentStatus),
    },
    limitation: paymentMethod === "online"
        ? "A specific GCash or bank-transfer method is required."
        : "",
  };
}

function normalizePaymentEvent(event, profileMap, includeInternalNote) {
  const eventType = cleanText(event.event_type, 80);
  const createdAt = isoOrNull(event.created_at);
  if (!eventType || !createdAt) return null;
  const source = key(event.source);
  return {
    eventType,
    label: paymentEventLabel(eventType),
    previousStatus: cleanText(event.previous_status, 80),
    nextStatus: cleanText(event.next_status, 80),
    paymentMethod: cleanText(event.payment_method, 80),
    amount: numberOrNull(event.amount),
    reviewNote: cleanText(event.review_note, 1000),
    internalNote: includeInternalNote ? cleanText(event.internal_note, 500) : "",
    actorDisplayName: source === "customer"
      ? "Customer"
      : displayForUser(event.actor_user_id, profileMap, roleLabel(event.actor_role)),
    actorRole: cleanText(event.actor_role, 40),
    source: cleanText(event.source, 40),
    createdAt,
  };
}

function paymentEventLabel(eventType) {
  if (eventType === "ONLINE_PAYMENT_REVIEW_STARTED") return "ONLINE PAYMENT REVIEW STARTED";
  if (eventType === "ONLINE_PAYMENT_CONFIRMED") return "ONLINE PAYMENT CONFIRMED";
  if (eventType === "ONLINE_PAYMENT_CORRECTION_REQUESTED") return "PAYMENT CORRECTION REQUESTED";
  if (eventType === "SHOP_PAYMENT_CONFIRMED") return "SHOP PAYMENT CONFIRMED";
  if (eventType === "PAY_AT_SHOP_SELECTED") return "PAY AT SHOP SELECTED";
  return eventType.replaceAll("_", " ");
}

function validateReviewCommand(body) {
  const action = cleanText(body?.action, 80);
  const expectedVersion = isoOrNull(body?.expectedVersion);
  const idempotencyKey = cleanText(body?.idempotencyKey, 121);
  const reviewNote = typeof body?.reviewNote === "string" ? body.reviewNote.trim() : "";
  const internalNote = typeof body?.internalNote === "string" ? body.internalNote.trim() : "";

  if (!REVIEW_ACTIONS.has(action)) {
    return { code: "INVALID_PAYMENT_ACTION", message: "Invalid payment review action." };
  }
  if (!expectedVersion) {
    return { code: "PAYMENT_VERSION_REQUIRED", message: "Refresh payment details and try again." };
  }
  if (
    idempotencyKey.length < 8
    || idempotencyKey.length > 120
    || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)
  ) {
    return { code: "INVALID_IDEMPOTENCY_KEY", message: "A valid request key is required." };
  }
  if (reviewNote.length > 1000) {
    return { code: "PAYMENT_REVIEW_NOTE_TOO_LONG", message: "Correction reason must be 1000 characters or fewer." };
  }
  if (internalNote.length > 500) {
    return { code: "PAYMENT_INTERNAL_NOTE_TOO_LONG", message: "Internal note must be 500 characters or fewer." };
  }
  if (action === "request_online_payment_correction" && reviewNote.length < 5) {
    return { code: "PAYMENT_CORRECTION_REASON_REQUIRED", message: "Enter a clear correction reason." };
  }
  if (action === "confirm_online_payment") {
    const amount = money(body?.verifiedAmount);
    if (!Number.isFinite(amount) || amount <= 0 || roundMoney(amount) !== amount) {
      return { code: "INVALID_VERIFIED_AMOUNT", message: "Enter a valid verified amount." };
    }
  }
  return null;
}

async function getAuthUser(supabase, token) {
  const { data, error } = await supabase.auth.getUser(token);
  if (error) return null;
  return data?.user || null;
}

async function getPortalProfile(supabase, userId) {
  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id,display_name,role,is_active")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getInquiry(supabase, inquiryReference) {
  const { data, error } = await supabase
    .from("ops_inquiries")
    .select(PAYMENT_SELECT)
    .eq("id", inquiryReference)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getPaymentEvents(supabase, inquiryReference) {
  const { data, error } = await supabase
    .from("inquiry_payment_events")
    .select(PAYMENT_EVENT_SELECT)
    .eq("inquiry_id", inquiryReference)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function getDisplayProfiles(supabase, userIds) {
  const uniqueIds = [...new Set(userIds.filter(isUuid))];
  if (!uniqueIds.length) return [];
  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id,display_name,role")
    .in("user_id", uniqueIds);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function invokeReview(supabase, inquiryReference, body) {
  const { error } = await supabase.rpc("review_online_payment", {
    p_inquiry_id: inquiryReference,
    p_action: cleanText(body.action, 80),
    p_verified_amount: body.action === "confirm_online_payment"
      ? money(body.verifiedAmount)
      : null,
    p_review_note: cleanText(body.reviewNote, 1000) || null,
    p_internal_note: cleanText(body.internalNote, 500) || null,
    p_expected_updated_at: body.expectedVersion,
    p_idempotency_key: cleanText(body.idempotencyKey, 120),
  });
  if (error) throw error;
}

async function getProofObject(supabase, path) {
  const { data: bucket, error: bucketError } = await supabase.storage.getBucket(RECEIPT_BUCKET);
  if (bucketError) throw bucketError;
  if (!bucket || bucket.public !== false) {
    throw Object.assign(new Error("PAYMENT_BUCKET_NOT_PRIVATE"), {
      code: "PAYMENT_BUCKET_NOT_PRIVATE",
    });
  }

  const slashIndex = path.lastIndexOf("/");
  const folder = path.slice(0, slashIndex);
  const objectName = path.slice(slashIndex + 1);
  const { data, error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .list(folder, { limit: 10, search: objectName });
  if (error) throw error;
  const object = (data || []).find((candidate) => candidate?.name === objectName);
  if (!object) return null;
  return {
    contentType: cleanText(
      object.metadata?.mimetype || object.metadata?.contentType,
      120,
    ),
  };
}

async function createProofUrl(supabase, path) {
  const { data, error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .createSignedUrl(path, SIGNED_URL_EXPIRES_IN_SECONDS);
  if (error) throw error;
  return data?.signedUrl || "";
}

function mapPaymentReviewError(error) {
  const code = cleanText(error?.code, 40);
  const message = String(error?.message || "");
  if (code === "42501" || message.includes("ONLINE_PAYMENT_REVIEW_FORBIDDEN")) {
    return { status: 403, code: "PAYMENT_REVIEW_WRITE_FORBIDDEN", message: "Owner or Admin review is required." };
  }
  if (code === "P0002" || message.includes("INQUIRY_NOT_FOUND")) {
    return { status: 404, code: "INQUIRY_NOT_FOUND", message: "Inquiry not found." };
  }
  if (code === "40001" || message.includes("PAYMENT_STALE_VERSION")) {
    return { status: 409, code: "PAYMENT_STALE", message: "Payment details changed. Refresh and try again." };
  }
  if (code === "PAYMENT_BUCKET_NOT_PRIVATE" || message.includes("PAYMENT_BUCKET_NOT_PRIVATE")) {
    return {
      status: 503,
      code: "PAYMENT_PROOF_UNAVAILABLE",
      message: "Payment receipt access is temporarily unavailable.",
    };
  }
  if (code === "23505" || message.includes("IDEMPOTENCY_KEY_CONFLICT") || message.includes("ALREADY_CONFIRMED")) {
    const conflict = message.includes("IDEMPOTENCY_KEY_CONFLICT");
    return {
      status: 409,
      code: conflict ? "PAYMENT_IDEMPOTENCY_CONFLICT" : "PAYMENT_ALREADY_CONFIRMED",
      message: conflict ? "This request key was already used for another action." : "Payment is already confirmed.",
    };
  }
  if (code === "22023" || /INVALID_|_REQUIRED|_FORBIDDEN|_ONLY|_MISMATCH|_REVIEWABLE|_TOO_LONG|UNSAFE_/.test(message)) {
    const known = [
      ["INVALID_PAYMENT_TYPE", "Receipt payment type must be full payment or 50% down payment."],
      ["ONLINE_PAYMENT_METHOD_REQUIRED", "A GCash or bank-transfer receipt is required."],
      ["APPROVED_QUOTE_REQUIRED", "An approved quotation is required."],
      ["APPROVED_ARTWORK_REQUIRED", "Approved artwork is required by the active customer receipt contract."],
      ["POSITIVE_QUOTE_REQUIRED", "A positive quotation total is required."],
      ["POSITIVE_AMOUNT_DUE_REQUIRED", "A positive amount due is required."],
      ["SUBMITTED_AMOUNT_MISMATCH", "The submitted amount does not match the selected payment amount."],
      ["PAYMENT_PROOF_REQUIRED", "A submitted payment receipt is required."],
      ["UNSAFE_PAYMENT_PROOF_TYPE", "The submitted receipt type is not supported."],
      ["PAYMENT_PROOF_METADATA_MISMATCH", "The submitted receipt metadata does not match the stored file."],
      ["INVALID_PAYMENT_PROOF_SIZE", "The submitted receipt size is invalid."],
      ["PAYMENT_STATUS_NOT_REVIEWABLE", "This payment is not available for that review action."],
      ["VERIFIED_AMOUNT_MISMATCH", "Verified amount must match the selected payment amount."],
      ["PAY_AT_SHOP_REVIEW_FORBIDDEN", "Pay at Shop uses its separate confirmation workflow."],
      ["PAYMENT_CORRECTION_REASON_REQUIRED", "Enter a clear correction reason."],
    ];
    const match = known.find(([errorKey]) => message.includes(errorKey));
    return {
      status: 400,
      code: match?.[0] || "PAYMENT_REVIEW_INVALID",
      message: match?.[1] || "The payment review request is invalid.",
    };
  }
  return null;
}

function getInquiryReference(request) {
  const queryId = Array.isArray(request.query?.id) ? request.query.id[0] : request.query?.id;
  if (queryId) return String(queryId).trim().toUpperCase();
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const match = url.pathname.match(/^\/api\/inquiries\/([^/]+)\/payment-(?:review|proof)\/?$/);
  return match ? decodeURIComponent(match[1]).trim().toUpperCase() : "";
}

function getBearerToken(request) {
  return String(request.headers.authorization || request.headers.Authorization || "")
    .match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
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

function isValidInquiryReference(value) {
  return /^[A-Z0-9][A-Z0-9_-]{2,79}$/.test(value);
}

function isSafeReceiptPath(path, inquiryReference) {
  const prefix = `${inquiryReference}/payments/`;
  const objectName = path.startsWith(prefix) ? path.slice(prefix.length) : "";
  return Boolean(
    objectName
    && !objectName.includes("/")
    && !objectName.includes("\\")
    && RECEIPT_EXTENSIONS.has(extension(objectName)),
  );
}

function isSafeReceiptType(filename, contentType) {
  const fileExtension = extension(filename);
  const normalizedType = cleanText(contentType, 120).toLowerCase();
  if (!RECEIPT_TYPES.has(normalizedType)) return false;
  if (fileExtension === "pdf") return normalizedType === "application/pdf";
  if (fileExtension === "png") return normalizedType === "image/png";
  return ["jpg", "jpeg"].includes(fileExtension) && normalizedType === "image/jpeg";
}

function typesMatch(left, right) {
  return left === right;
}

function sanitizeFilename(value) {
  const normalized = String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return normalized
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 180);
}

function extension(value) {
  return String(value || "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
}

function displayForUser(userId, profileMap, fallback = "") {
  return profileMap.get(userId) || cleanText(fallback, 160) || "";
}

function roleLabel(value) {
  const role = key(value);
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  if (role === "staff") return "Staff";
  return "TRRY Admin";
}

function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function versionOrNull(value) {
  if (typeof value !== "string") return isoOrNull(value);
  const version = value.trim();
  return Number.isFinite(new Date(version).getTime()) ? version : null;
}

function money(value) {
  const normalized = typeof value === "string" ? value.trim().replace(/,/g, "") : value;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : NaN;
}

function positiveMoney(value) {
  const number = money(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function numberOrNull(value) {
  const number = money(value);
  return Number.isFinite(number) ? number : null;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function key(value) {
  return cleanText(value, 120).toLowerCase().replace(/[\s-]+/g, "_");
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function paymentError(code, message) {
  return { ok: false, error: { code, message } };
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}
