import { createServerSupabaseClient } from "./supabaseServer.js";

const PORTAL_ROLES = new Set(["owner", "admin", "staff"]);
export const ORDER_SELECT_FIELDS = [
  "id",
  "customer_name",
  "company",
  "contact",
  "source",
  "channel",
  "message",
  "product",
  "product_desc",
  "quantity",
  "size_breakdown",
  "status",
  "next_action",
  "due_date",
  "estimated_value",
  "fulfillment_method",
  "delivery_city",
  "delivery_address",
  "delivery_landmark",
  "tracking_substatus",
  "tracking_note",
  "tracking_updated_at",
  "quoted_amount",
  "amount_due",
  "quote_status",
  "quote_approved_at",
  "quote_published_at",
  "quote_sent_at",
  "quote_change_request",
  "quote_breakdown",
  "quote_notes",
  "quote_valid_until",
  "artwork_status",
  "artwork_url",
  "artwork_approved_at",
  "artwork_revision_request",
  "payment_status",
  "payment_label",
  "payment_instructions",
  "payment_proof_submitted_at",
  "payment_confirmed_at",
  "payment_confirmed_amount",
  "payment_review_note",
  "payment_rejected_at",
  "payment_method",
  "payment_type",
  "payment_verified_amount",
  "payment_verified_at",
  "payment_verified_by",
  "payment_selected_at",
  "payment_internal_note",
  "owner_id",
  "owner_user_id",
  "assigned_staff",
  "assigned_user_id",
  "production_stage",
  "production_note",
  "production_updated_at",
  "blocked_reason",
  "created_at",
  "updated_at",
];
const ORDER_SELECT = ORDER_SELECT_FIELDS.join(",");

const PAYMENT_EVENT_SELECT = [
  "event_type",
  "payment_method",
  "amount",
  "review_note",
  "internal_note",
  "actor_user_id",
  "actor_role",
  "source",
  "created_at",
].join(",");

const FOLLOW_UP_EVENT_SELECT = [
  "outcome",
  "note",
  "next_follow_up_date",
  "created_by_user_id",
  "created_at",
].join(",");

export function createOrderDetailsHandler(overrides = {}) {
  const dependencies = {
    createClient: overrides.createClient || createServerSupabaseClient,
    getAuthUser: overrides.getAuthUser || getAuthUser,
    getPortalProfile: overrides.getPortalProfile || getPortalProfile,
    getOrder: overrides.getOrder || getOrder,
    getPaymentEvents: overrides.getPaymentEvents || getPaymentEvents,
    getFollowUpEvents: overrides.getFollowUpEvents || getFollowUpEvents,
    getDisplayProfiles: overrides.getDisplayProfiles || getDisplayProfiles,
  };

  return async function orderDetailsHandler(request, response) {
    if (request.method !== "GET") {
      sendJson(response, 405, {
        ok: false,
        error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." },
      });
      return;
    }

    const orderReference = getOrderReference(request);
    if (!/^[A-Z0-9][A-Z0-9_-]{2,79}$/.test(orderReference)) {
      sendJson(response, 400, {
        ok: false,
        error: { code: "INVALID_ORDER_REFERENCE", message: "Invalid order reference." },
      });
      return;
    }

    const token = getBearerToken(request);
    if (!token) {
      sendJson(response, 401, authError());
      return;
    }

    try {
      const supabase = dependencies.createClient();
      const authUser = await dependencies.getAuthUser(supabase, token);
      if (!authUser?.id) {
        sendJson(response, 401, authError());
        return;
      }

      const portalProfile = await dependencies.getPortalProfile(supabase, authUser.id);
      const role = key(portalProfile?.role);
      if (!portalProfile || portalProfile.is_active === false || !PORTAL_ROLES.has(role)) {
        sendJson(response, 403, {
          ok: false,
          error: { code: "ORDER_ACCESS_FORBIDDEN", message: "Order access is not available." },
        });
        return;
      }

      const order = await dependencies.getOrder(supabase, orderReference);
      if (!order) {
        sendJson(response, 404, {
          ok: false,
          error: { code: "ORDER_NOT_FOUND", message: "Order not found." },
        });
        return;
      }
      if (key(order.status) !== "won") {
        sendJson(response, 404, {
          ok: false,
          error: {
            code: "ORDER_NOT_CONFIRMED",
            message: "This record is not a confirmed TRRY order.",
          },
        });
        return;
      }

      const [paymentEvents, followUpEvents] = await Promise.all([
        dependencies.getPaymentEvents(supabase, orderReference),
        dependencies.getFollowUpEvents(supabase, orderReference),
      ]);
      const userIds = collectUserIds(order, paymentEvents, followUpEvents);
      const profiles = await dependencies.getDisplayProfiles(supabase, userIds);

      sendJson(response, 200, {
        ok: true,
        order: normalizeOrderDetails(order, paymentEvents, followUpEvents, profiles),
      });
    } catch (error) {
      console.error("Order details read failed.", {
        message: error?.message,
        code: error?.code,
      });
      sendJson(response, 500, {
        ok: false,
        error: { code: "ORDER_DETAILS_FAILED", message: "Unable to load order details." },
      });
    }
  };
}

export function normalizeOrderDetails(
  row,
  paymentEvents = [],
  followUpEvents = [],
  profiles = [],
) {
  const profileMap = new Map(
    profiles
      .filter((profile) => profile?.user_id)
      .map((profile) => [
        profile.user_id,
        cleanText(profile.display_name, 160)
          || roleLabel(profile.role)
          || "TRRY Staff",
      ]),
  );
  const owner = displayForUser(
    row.owner_user_id,
    profileMap,
    nonUuidText(row.owner_id, 160),
  );
  const assignedStaff = displayForUser(
    row.assigned_user_id,
    profileMap,
    cleanText(row.assigned_staff, 160),
  );
  const paymentVerifiedBy = displayForUser(
    row.payment_verified_by,
    profileMap,
    "",
  );
  const productDescription = cleanText(row.product_desc, 500)
    || cleanText(row.product, 500);
  const quantity = cleanText(row.size_breakdown, 500)
    || cleanText(row.quantity, 160);
  const blocker = cleanText(row.blocked_reason, 500);
  const readiness = buildReadiness(row, {
    productDescription,
    quantity,
    assignedStaff,
    blocker,
  });
  const safePaymentEvents = paymentEvents
    .map((event) => normalizePaymentEvent(event, profileMap))
    .filter(Boolean);
  const safeFollowUps = followUpEvents
    .map((event) => normalizeFollowUpEvent(event, profileMap))
    .filter(Boolean);

  return {
    id: cleanText(row.id, 80),
    reference: cleanText(row.id, 80),
    sourceInquiryReference: cleanText(row.id, 80),
    status: "won",
    statusLabel: "CONFIRMED ORDER",
    customerName: cleanText(row.customer_name, 240)
      || cleanText(row.company, 240)
      || "Unnamed customer",
    company: cleanText(row.company, 240),
    contact: cleanText(row.contact, 240),
    source: cleanText(row.source, 120) || cleanText(row.channel, 120),
    channel: cleanText(row.channel, 120),
    createdAt: isoOrNull(row.created_at),
    confirmedAt: null,
    nextAction: cleanText(row.next_action, 500),
    productDescription,
    service: cleanText(row.product, 240),
    quantity,
    sizeBreakdown: cleanText(row.size_breakdown, 500),
    quotedAmount: numberOrNull(row.quoted_amount),
    amountDue: numberOrNull(row.amount_due),
    dueDate: dateOrNull(row.due_date),
    fulfillmentMethod: cleanText(row.fulfillment_method, 80),
    deliveryCity: cleanText(row.delivery_city, 180),
    deliveryAddress: cleanText(row.delivery_address, 500),
    deliveryLandmark: cleanText(row.delivery_landmark, 240),
    trackingSubstatus: cleanText(row.tracking_substatus, 120),
    trackingNote: cleanText(row.tracking_note, 1000),
    trackingUpdatedAt: isoOrNull(row.tracking_updated_at),
    owner,
    assignedStaff,
    quoteStatus: cleanText(row.quote_status, 80),
    quoteApprovedAt: isoOrNull(row.quote_approved_at),
    quotePublishedAt: isoOrNull(row.quote_published_at),
    quoteSentAt: isoOrNull(row.quote_sent_at),
    quoteBreakdown: cleanText(row.quote_breakdown, 5000),
    quoteNotes: cleanText(row.quote_notes, 2000),
    quoteValidUntil: dateOrNull(row.quote_valid_until),
    artworkStatus: cleanText(row.artwork_status, 80),
    artworkApprovedAt: isoOrNull(row.artwork_approved_at),
    artworkRevisionRequest: cleanText(row.artwork_revision_request, 1000),
    artworkAvailable: hasArtwork(row),
    paymentStatus: cleanText(row.payment_status, 80),
    paymentLabel: cleanText(row.payment_label, 120),
    paymentMethod: cleanText(row.payment_method, 80),
    paymentType: cleanText(row.payment_type, 80),
    paymentConfirmedAmount: numberOrNull(row.payment_confirmed_amount),
    paymentConfirmedAt: isoOrNull(row.payment_confirmed_at),
    paymentVerifiedAmount: numberOrNull(row.payment_verified_amount),
    paymentVerifiedAt: isoOrNull(row.payment_verified_at),
    paymentVerifiedBy,
    paymentSelectedAt: isoOrNull(row.payment_selected_at),
    paymentInternalNote: cleanText(row.payment_internal_note, 500),
    paymentProofSubmittedAt: isoOrNull(row.payment_proof_submitted_at),
    paymentReviewNote: cleanText(row.payment_review_note, 1000),
    paymentRejectedAt: isoOrNull(row.payment_rejected_at),
    productionStage: cleanText(row.production_stage, 80) || "queued",
    productionNote: cleanText(row.production_note, 2000),
    productionUpdatedAt: isoOrNull(row.production_updated_at),
    blockerReason: blocker,
    readiness,
    paymentEvents: safePaymentEvents,
    activity: buildActivity(row, safePaymentEvents, safeFollowUps, profileMap),
  };
}

async function getAuthUser(supabase, token) {
  const { data, error } = await supabase.auth.getUser(token);
  if (error) return null;
  return data?.user || null;
}

async function getPortalProfile(supabase, userId) {
  const { data, error } = await supabase
    .from("admin_users")
    .select("role,is_active")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getOrder(supabase, orderReference) {
  const { data, error } = await supabase
    .from("ops_inquiries")
    .select(ORDER_SELECT)
    .eq("id", orderReference)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getPaymentEvents(supabase, orderReference) {
  const { data, error } = await supabase
    .from("inquiry_payment_events")
    .select(PAYMENT_EVENT_SELECT)
    .eq("inquiry_id", orderReference)
    .order("created_at", { ascending: true });
  if (isMissingOptionalHistory(error, "inquiry_payment_events")) return [];
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function getFollowUpEvents(supabase, orderReference) {
  const { data, error } = await supabase
    .from("inquiry_follow_up_events")
    .select(FOLLOW_UP_EVENT_SELECT)
    .eq("inquiry_id", orderReference)
    .order("created_at", { ascending: true });
  if (isMissingOptionalHistory(error, "inquiry_follow_up_events")) return [];
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function getDisplayProfiles(supabase, userIds) {
  if (!userIds.length) return [];
  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id,display_name,role")
    .in("user_id", userIds);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function collectUserIds(order, paymentEvents, followUpEvents) {
  return [...new Set([
    order.owner_user_id,
    order.assigned_user_id,
    order.payment_verified_by,
    ...paymentEvents.map((event) => event.actor_user_id),
    ...followUpEvents.map((event) => event.created_by_user_id),
  ].filter(isUuid))];
}

function buildReadiness(row, values) {
  const checks = [
    ["confirmed-order", "Confirmed TRRY order", key(row.status) === "won"],
    ["approved-quotation", "Approved quotation", key(row.quote_status) === "approved"],
    ["product", "Product or service complete", Boolean(values.productDescription)],
    ["quantity", "Quantity complete", Boolean(values.quantity)],
    ["due-date", "Due date set", Boolean(dateOrNull(row.due_date))],
    ["artwork", "Artwork approved", key(row.artwork_status) === "approved"],
    [
      "production-staff",
      "Production staff assigned",
      Boolean(values.assignedStaff && values.assignedStaff !== "Not set"),
    ],
    ["blocker", "No active blocker", !values.blocker],
  ].map(([keyValue, label, complete]) => ({
    key: keyValue,
    label,
    complete: Boolean(complete),
  }));

  return {
    ready: checks.every((check) => check.complete),
    checks,
    missing: checks.filter((check) => !check.complete).map((check) => check.label),
  };
}

function normalizePaymentEvent(event, profileMap) {
  const eventType = cleanText(event.event_type, 80);
  const createdAt = isoOrNull(event.created_at);
  if (!eventType || !createdAt) return null;
  const source = key(event.source);
  return {
    eventType,
    label: paymentEventLabel(eventType),
    paymentMethod: cleanText(event.payment_method, 80),
    amount: numberOrNull(event.amount),
    reviewNote: cleanText(event.review_note, 1000),
    internalNote: cleanText(event.internal_note, 500),
    actorDisplayName: source === "customer"
      ? "Customer"
      : displayForUser(event.actor_user_id, profileMap, roleLabel(event.actor_role)),
    actorRole: cleanText(event.actor_role, 40),
    source: cleanText(event.source, 40),
    createdAt,
  };
}

function normalizeFollowUpEvent(event, profileMap) {
  const createdAt = isoOrNull(event.created_at);
  if (!createdAt) return null;
  return {
    label: followUpLabel(event.outcome),
    actorDisplayName: displayForUser(event.created_by_user_id, profileMap, "TRRY Staff"),
    createdAt,
    note: cleanText(event.note, 500),
  };
}

function buildActivity(row, paymentEvents, followUpEvents) {
  const activity = [];
  addActivity(activity, "INQUIRY CREATED", row.created_at, "", "");
  addActivity(
    activity,
    "QUOTATION SENT",
    row.quote_published_at || row.quote_sent_at,
    "",
    cleanText(row.quote_notes, 300),
  );
  addActivity(activity, "QUOTATION APPROVED", row.quote_approved_at, "", "");
  addActivity(activity, "ARTWORK APPROVED", row.artwork_approved_at, "", "");
  addActivity(activity, "PAYMENT RECEIPT SUBMITTED", row.payment_proof_submitted_at, "Customer", "");

  for (const event of paymentEvents) {
    addActivity(
      activity,
      event.label,
      event.createdAt,
      event.actorDisplayName,
      event.reviewNote || event.internalNote,
    );
  }
  for (const event of followUpEvents) {
    addActivity(
      activity,
      event.label,
      event.createdAt,
      event.actorDisplayName,
      event.note,
    );
  }

  return activity.sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt));
}

function paymentEventLabel(eventType) {
  if (eventType === "ONLINE_PAYMENT_REVIEW_STARTED") return "ONLINE PAYMENT REVIEW STARTED";
  if (eventType === "ONLINE_PAYMENT_CONFIRMED") return "ONLINE PAYMENT CONFIRMED";
  if (eventType === "ONLINE_PAYMENT_CORRECTION_REQUESTED") return "PAYMENT CORRECTION REQUESTED";
  if (eventType === "SHOP_PAYMENT_CONFIRMED") return "SHOP PAYMENT CONFIRMED";
  if (eventType === "PAY_AT_SHOP_SELECTED") return "PAY AT SHOP SELECTED";
  return eventType.replaceAll("_", " ");
}

function addActivity(activity, label, timestamp, actor, note) {
  const createdAt = isoOrNull(timestamp);
  if (!createdAt) return;
  activity.push({
    label,
    actor: cleanText(actor, 160),
    createdAt,
    note: cleanText(note, 500),
  });
}

function hasArtwork(row) {
  if (cleanText(row.artwork_url, 1000)) return true;
  return ["submitted", "under_review", "approval_required", "revision_requested", "approved"]
    .includes(key(row.artwork_status));
}

function displayForUser(userId, profileMap, fallback) {
  if (isUuid(userId)) {
    return profileMap.get(userId) || "Inactive user (historical)";
  }
  return cleanText(fallback, 160) || "Not set";
}

function nonUuidText(value, maxLength) {
  return isUuid(value) ? "" : cleanText(value, maxLength);
}

function followUpLabel(outcome) {
  const value = key(outcome);
  if (value === "no_response") return "FOLLOW-UP: NO RESPONSE";
  if (value === "customer_considering") return "FOLLOW-UP: CUSTOMER CONSIDERING";
  if (value === "customer_replied_action_needed") return "FOLLOW-UP: ACTION NEEDED";
  return "FOLLOW-UP RECORDED";
}

function roleLabel(role) {
  const value = key(role);
  if (value === "owner") return "Owner";
  if (value === "admin") return "Admin";
  if (value === "staff") return "Staff";
  return "";
}

function isMissingOptionalHistory(error, tableName) {
  return Boolean(error)
    && new RegExp(`${tableName}|42P01|PGRST205|schema cache|does not exist`, "i")
      .test(String(error?.message || error));
}

function getOrderReference(request) {
  const queryId = Array.isArray(request.query?.id)
    ? request.query.id[0]
    : request.query?.id;
  if (queryId) return String(queryId).trim().toUpperCase();
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const match = url.pathname.match(/^\/api\/orders\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]).trim().toUpperCase() : "";
}

function getBearerToken(request) {
  const authorization = request.headers.authorization || request.headers.Authorization || "";
  return String(authorization).match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}

function authError() {
  return {
    ok: false,
    error: { code: "AUTH_REQUIRED", message: "Authentication required." },
  };
}

function key(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateOrNull(value) {
  const text = cleanText(value, 40);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(value || ""));
}

function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export default createOrderDetailsHandler();
