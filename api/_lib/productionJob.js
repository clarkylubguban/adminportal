import { assignmentLabel, validateAssignmentUser } from "./adminAssignments.js";
import { createServerSupabaseClient } from "./supabaseServer.js";

const PORTAL_ROLES = new Set(["owner", "admin", "staff"]);
const MANAGER_ROLES = new Set(["owner", "admin"]);
const ACTIVE_STAGES = new Set(["printing", "embroidery", "screen_printing", "in_production"]);
const MUTABLE_STAGES = new Set(["queued", ...ACTIVE_STAGES, "qc"]);
const JOB_SELECT = [
  "id",
  "customer_name",
  "company",
  "product",
  "product_desc",
  "quantity",
  "size_breakdown",
  "status",
  "next_action",
  "due_date",
  "fulfillment_method",
  "quoted_amount",
  "quote_status",
  "artwork_status",
  "artwork_url",
  "artwork_approved_at",
  "payment_status",
  "payment_type",
  "payment_verified_amount",
  "payment_confirmed_amount",
  "owner_id",
  "owner_user_id",
  "assigned_staff",
  "assigned_user_id",
  "production_stage",
  "production_note",
  "production_updated_at",
  "blocked_reason",
  "created_at",
].join(",");

export function createProductionJobHandler(overrides = {}) {
  const dependencies = {
    createClient: overrides.createClient || createServerSupabaseClient,
    getAuthUser: overrides.getAuthUser || getAuthUser,
    getPortalProfile: overrides.getPortalProfile || getPortalProfile,
    getJob: overrides.getJob || getJob,
    getDisplayProfiles: overrides.getDisplayProfiles || getDisplayProfiles,
    validateAssignment: overrides.validateAssignment || validateAssignmentUser,
    updateJob: overrides.updateJob || updateJob,
    now: overrides.now || (() => new Date().toISOString()),
  };

  return async function productionJobHandler(request, response) {
    if (!["GET", "PATCH"].includes(request.method)) {
      return sendJson(response, 405, errorBody("METHOD_NOT_ALLOWED", "Method not allowed."));
    }

    const jobReference = getJobReference(request);
    if (!/^[A-Z0-9][A-Z0-9_-]{2,79}$/.test(jobReference)) {
      return sendJson(response, 400, errorBody("INVALID_JOB_REFERENCE", "Invalid production job reference."));
    }

    const token = getBearerToken(request);
    if (!token) return sendJson(response, 401, authError());

    try {
      const supabase = dependencies.createClient();
      const authUser = await dependencies.getAuthUser(supabase, token);
      if (!authUser?.id) return sendJson(response, 401, authError());

      const actor = await dependencies.getPortalProfile(supabase, authUser.id);
      const role = key(actor?.role);
      if (!actor || actor.is_active === false || !PORTAL_ROLES.has(role)) {
        return sendJson(response, 403, errorBody(
          "PRODUCTION_ACCESS_FORBIDDEN",
          "Production access is not available.",
        ));
      }
      const normalizedActor = { ...actor, role, user_id: authUser.id };

      const job = await dependencies.getJob(supabase, jobReference);
      if (!job) {
        return sendJson(response, 404, errorBody("PRODUCTION_JOB_NOT_FOUND", "Production job not found."));
      }
      if (key(job.status) !== "won") {
        return sendJson(response, 404, errorBody(
          "PRODUCTION_JOB_NOT_CONFIRMED",
          "This record is not a confirmed TRRY order.",
        ));
      }

      if (request.method === "GET") {
        const profiles = await dependencies.getDisplayProfiles(
          supabase,
          collectUserIds(job),
        );
        return sendJson(response, 200, {
          ok: true,
          job: normalizeProductionJob(job, profiles, normalizedActor),
        });
      }

      const body = await readJsonBody(request);
      const actionResult = await buildProductionAction({
        action: String(body.action || ""),
        body,
        job,
        actor: normalizedActor,
        supabase,
        dependencies,
      });
      const updated = await dependencies.updateJob(
        supabase,
        jobReference,
        actionResult.updates,
        job,
      );
      if (!updated) {
        throw businessError(
          409,
          "PRODUCTION_STALE",
          "This job was updated by another user. Refresh and try again.",
        );
      }

      const profiles = await dependencies.getDisplayProfiles(
        supabase,
        collectUserIds(updated),
      );
      return sendJson(response, 200, {
        ok: true,
        job: normalizeProductionJob(updated, profiles, normalizedActor),
      });
    } catch (error) {
      if (error?.businessStatus) {
        return sendJson(response, error.businessStatus, errorBody(error.code, error.message));
      }
      const expectedRuleFailure = /23514|invalid production stage transition|production requirements|production details are locked/i
        .test(`${error?.code || ""} ${error?.message || ""}`);
      if (expectedRuleFailure) {
        return sendJson(response, 400, errorBody(
          "PRODUCTION_RULE_REJECTED",
          "The production update is not valid for the current job state.",
        ));
      }
      console.error("Production job request failed.", {
        message: error?.message,
        code: error?.code,
      });
      return sendJson(response, 500, errorBody(
        "PRODUCTION_JOB_FAILED",
        "Unable to update production details.",
      ));
    }
  };
}

export function normalizeProductionJob(row, profiles = [], actor = {}) {
  const profileMap = new Map(
    profiles
      .filter((profile) => profile?.user_id)
      .map((profile) => [
        profile.user_id,
        cleanText(profile.display_name, 160) || roleLabel(profile.role) || "TRRY Staff",
      ]),
  );
  const stage = canonicalProductionStage(row.production_stage);
  const nextStage = nextProductionStage(row);
  const readiness = getProductionReadiness(row);
  const assigned = displayForUser(
    row.assigned_user_id,
    profileMap,
    cleanText(row.assigned_staff, 160),
  );
  const owner = displayForUser(
    row.owner_user_id,
    profileMap,
    nonUuidText(row.owner_id, 160),
  );
  const actorRole = key(actor.role);
  const manager = MANAGER_ROLES.has(actorRole);
  const assignedActor = actorRole === "staff"
    && Boolean(actor.user_id)
    && actor.user_id === row.assigned_user_id;
  const mutable = MUTABLE_STAGES.has(stage);
  const blocker = cleanText(row.blocked_reason, 500);
  const mayAdvance = Boolean(
    nextStage
    && !blocker
    && (manager || assignedActor)
    && (stage !== "queued" || readiness.ready),
  );

  return {
    id: cleanText(row.id, 80),
    reference: cleanText(row.id, 80),
    customerName: cleanText(row.customer_name, 240)
      || cleanText(row.company, 240)
      || "Unnamed customer",
    service: cleanText(row.product, 240),
    productDescription: cleanText(row.product_desc, 500)
      || cleanText(row.product, 500),
    quantity: cleanText(row.size_breakdown, 500)
      || cleanText(row.quantity, 160),
    dueDate: dateOrNull(row.due_date),
    owner,
    assignedStaff: assigned,
    fulfillmentMethod: cleanText(row.fulfillment_method, 80),
    paymentStatus: paymentDisplayStatus(row),
    quotedAmount: numberOrNull(row.quoted_amount),
    artworkStatus: cleanText(row.artwork_status, 80),
    artworkAvailable: hasArtwork(row),
    nextAction: cleanText(row.next_action, 500),
    storedStage: cleanText(row.production_stage, 80) || "queued",
    stage,
    stageLabel: productionStageLabel(stage),
    validNextStage: nextStage,
    validNextStageLabel: nextStage ? productionStageLabel(nextStage) : "",
    stageActionLabel: nextStage ? stageActionLabel(stage, nextStage) : "",
    stageActionExplanation: nextStage ? stageActionExplanation(stage) : "",
    productionNote: cleanText(row.production_note, 2000),
    blockerReason: blocker,
    productionUpdatedAt: isoOrNull(row.production_updated_at),
    readiness,
    activity: productionActivity(row),
    permissions: {
      canAssign: manager && mutable,
      canSetBlocker: manager && mutable && !blocker,
      canClearBlocker: manager && mutable && Boolean(blocker),
      canUpdateNote: mutable && (manager || assignedActor),
      canAdvance: mayAdvance,
      isAssignedStaff: assignedActor,
      completedReadOnly: stage === "completed",
    },
  };
}

export function canonicalProductionStage(value) {
  const stage = key(value);
  if (!stage) return "queued";
  if (stage === "qc_finishing") return "qc";
  if (stage === "ready_for_fulfillment") return "ready";
  return [
    "queued",
    "printing",
    "embroidery",
    "screen_printing",
    "in_production",
    "qc",
    "ready",
    "completed",
  ].includes(stage) ? stage : "queued";
}

export function nextProductionStage(row) {
  const stage = canonicalProductionStage(row.production_stage);
  if (stage === "queued") return startStageForService(row);
  if (ACTIVE_STAGES.has(stage)) return "qc";
  if (stage === "qc") return "ready";
  if (stage === "ready") return "completed";
  return "";
}

export function getProductionReadiness(row) {
  const product = cleanText(row.product_desc, 500) || cleanText(row.product, 500);
  const quantity = cleanText(row.size_breakdown, 500) || cleanText(row.quantity, 160);
  const checks = [
    ["confirmed-order", "TRRY order confirmed", key(row.status) === "won"],
    ["approved-quote", "Quote approved", key(row.quote_status) === "approved"],
    ["product", "Product or service complete", Boolean(product)],
    ["quantity", "Quantity complete", hasPositiveQuantity(quantity)],
    ["due-date", "Due date set", Boolean(dateOrNull(row.due_date))],
    ["artwork", "Artwork approved", key(row.artwork_status) === "approved"],
    [
      "payment",
      "Full payment confirmed",
      paymentSatisfiesProductionGate(row),
    ],
    [
      "staff",
      "Staff assigned",
      Boolean(row.assigned_user_id || cleanText(row.assigned_staff, 160)),
    ],
    ["blocker", "No blocker", !cleanText(row.blocked_reason, 500)],
  ].map(([checkKey, label, complete]) => ({
    key: checkKey,
    label,
    complete: Boolean(complete),
  }));
  return {
    ready: checks.every((check) => check.complete),
    checks,
    missing: checks.filter((check) => !check.complete).map((check) => check.label),
  };
}

async function buildProductionAction({
  action,
  body,
  job,
  actor,
  supabase,
  dependencies,
}) {
  assertFresh(body, job);
  const stage = canonicalProductionStage(job.production_stage);
  const manager = MANAGER_ROLES.has(actor.role);
  const assignedActor = actor.role === "staff" && actor.user_id === job.assigned_user_id;
  const now = dependencies.now();

  if (stage === "completed") {
    throw businessError(400, "PRODUCTION_COMPLETED_LOCKED", "Completed production jobs are read-only.");
  }

  if (action === "assign_production_staff") {
    if (!manager) throw forbidden();
    if (!MUTABLE_STAGES.has(stage)) throw locked();
    const targetId = cleanText(body.assignedUserId, 80);
    if (!targetId) {
      return {
        updates: {
          assigned_user_id: null,
          assigned_staff: null,
          production_updated_at: now,
        },
      };
    }
    const target = await dependencies.validateAssignment(supabase, targetId, actor);
    if (!target) {
      throw businessError(400, "PRODUCTION_ASSIGNEE_INVALID", "Production staff is unavailable.");
    }
    return {
      updates: {
        assigned_user_id: target.userId,
        assigned_staff: assignmentLabel(target),
        production_updated_at: now,
      },
    };
  }

  if (action === "set_production_blocker") {
    if (!manager) throw forbidden();
    if (!MUTABLE_STAGES.has(stage)) throw locked();
    const reason = cleanText(body.blockerReason, 500);
    if (!reason) {
      throw businessError(400, "PRODUCTION_BLOCKER_REQUIRED", "A blocker reason is required.");
    }
    return { updates: { blocked_reason: reason, production_updated_at: now } };
  }

  if (action === "clear_production_blocker") {
    if (!manager) throw forbidden();
    if (!MUTABLE_STAGES.has(stage)) throw locked();
    if (!cleanText(job.blocked_reason, 500)) {
      throw businessError(400, "PRODUCTION_BLOCKER_MISSING", "No blocker is set.");
    }
    return { updates: { blocked_reason: null, production_updated_at: now } };
  }

  if (action === "update_production_note") {
    if (!MUTABLE_STAGES.has(stage)) throw locked();
    if (!manager && !assignedActor) throw forbidden();
    const note = cleanText(body.productionNote, 2000);
    return {
      updates: {
        production_note: note || null,
        production_updated_at: now,
      },
    };
  }

  if (action === "advance_production_stage") {
    if (!manager && !assignedActor) throw forbidden();
    if (cleanText(job.blocked_reason, 500)) {
      throw businessError(400, "PRODUCTION_BLOCKED", "Clear the active blocker before advancing.");
    }
    if (stage === "queued") {
      const readiness = getProductionReadiness(job);
      if (!readiness.ready) {
        throw businessError(
          400,
          "PRODUCTION_NOT_READY",
          `Production requirements are incomplete: ${readiness.missing.join(", ")}.`,
        );
      }
    }
    const nextStage = nextProductionStage(job);
    if (!nextStage) {
      const code = stage === "queued"
        ? "PRODUCTION_START_UNSUPPORTED"
        : "PRODUCTION_TRANSITION_INVALID";
      throw businessError(
        400,
        code,
        stage === "queued"
          ? "This service has no safe start stage under the current production rules."
          : "No valid forward production transition is available.",
      );
    }
    const requestedNext = body.nextStage
      ? canonicalProductionStage(body.nextStage)
      : nextStage;
    if (requestedNext !== nextStage) {
      throw businessError(
        400,
        "PRODUCTION_TRANSITION_INVALID",
        "Only the valid next production stage is allowed.",
      );
    }
    return {
      updates: {
        production_stage: nextStage,
        production_updated_at: now,
      },
    };
  }

  throw businessError(400, "PRODUCTION_ACTION_INVALID", "Invalid production action.");
}

function assertFresh(body, job) {
  if (!Object.prototype.hasOwnProperty.call(body, "expectedCurrentStage")) {
    throw businessError(400, "PRODUCTION_EXPECTED_STAGE_REQUIRED", "Expected production stage is required.");
  }
  if (!Object.prototype.hasOwnProperty.call(body, "expectedUpdatedAt")) {
    throw businessError(400, "PRODUCTION_EXPECTED_VERSION_REQUIRED", "Expected production version is required.");
  }
  const expectedStage = canonicalProductionStage(body.expectedCurrentStage);
  const currentStage = canonicalProductionStage(job.production_stage);
  const expectedUpdatedAt = isoOrNull(body.expectedUpdatedAt);
  const currentUpdatedAt = isoOrNull(job.production_updated_at);
  if (expectedStage !== currentStage || expectedUpdatedAt !== currentUpdatedAt) {
    throw businessError(
      409,
      "PRODUCTION_STALE",
      "This job was updated by another user. Refresh and try again.",
    );
  }
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

async function getJob(supabase, jobReference) {
  const { data, error } = await supabase
    .from("ops_inquiries")
    .select(JOB_SELECT)
    .eq("id", jobReference)
    .maybeSingle();
  if (error) throw error;
  return data;
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

async function updateJob(supabase, jobReference, updates, current) {
  let query = supabase
    .from("ops_inquiries")
    .update(updates)
    .eq("id", jobReference)
    .eq("status", "won");
  query = current.production_stage === null || current.production_stage === undefined
    ? query.is("production_stage", null)
    : query.eq("production_stage", current.production_stage);
  query = current.production_updated_at
    ? query.eq("production_updated_at", current.production_updated_at)
    : query.is("production_updated_at", null);
  const { data, error } = await query.select(JOB_SELECT).maybeSingle();
  if (error) throw error;
  return data || null;
}

function collectUserIds(job) {
  return [...new Set([
    job.owner_user_id,
    job.assigned_user_id,
  ].filter(isUuid))];
}

function productionActivity(row) {
  const activity = [];
  const artworkApprovedAt = isoOrNull(row.artwork_approved_at);
  if (artworkApprovedAt) {
    activity.push({
      label: "ARTWORK APPROVED",
      actor: "",
      createdAt: artworkApprovedAt,
      note: "",
    });
  }
  return activity;
}

function startStageForService(row) {
  const service = key(`${row.product || ""} ${row.product_desc || ""}`);
  if (service.includes("embro")) return "embroidery";
  if (service.includes("screen")) return "screen_printing";
  if (service.includes("dtf") || service.includes("direct_to_film") || service.includes("printing")) {
    return "printing";
  }
  return "";
}

function productionStageLabel(stage) {
  const labels = {
    queued: "QUEUED",
    printing: "DTF PRINTING",
    embroidery: "EMBROIDERY",
    screen_printing: "SCREEN PRINTING",
    in_production: "IN PRODUCTION",
    qc: "QUALITY CHECK",
    ready: "READY",
    completed: "COMPLETED",
  };
  return labels[stage] || "QUEUED";
}

function stageActionLabel(stage, nextStage) {
  if (stage === "queued" && nextStage === "printing") return "START DTF PRINTING";
  if (stage === "queued" && nextStage === "embroidery") return "START EMBROIDERY";
  if (stage === "queued" && nextStage === "screen_printing") return "START SCREEN PRINTING";
  if (stage === "queued") return "START PRODUCTION";
  if (ACTIVE_STAGES.has(stage)) return "MOVE TO QUALITY CHECK";
  if (stage === "qc") return "MARK READY";
  if (stage === "ready") return "COMPLETE JOB";
  return "";
}

function stageActionExplanation(stage) {
  if (stage === "queued") return "Start the service-specific production process.";
  if (ACTIVE_STAGES.has(stage)) return "Move finished production work to Quality Check.";
  if (stage === "qc") return "Mark the job Ready after quality checks pass.";
  if (stage === "ready") return "Complete after pickup or delivery preparation is finished.";
  return "";
}

function paymentDisplayStatus(row) {
  const status = key(row.payment_status);
  if (
    key(row.payment_type) === "shop"
    && ["confirmed", "paid", "full_payment_confirmed"].includes(status)
  ) return "PAID AT SHOP";
  if (["confirmed", "paid", "full_payment_confirmed"].includes(status)) return "PAID";
  if (["down_payment_confirmed", "partially_paid"].includes(status)) return "PARTIALLY PAID";
  if (["pay_at_shop", "payment_pending_at_shop"].includes(status)) return "PAY AT SHOP";
  if (status === "proof_submitted") return "RECEIPT SUBMITTED";
  if (["under_review", "correction_required"].includes(status)) return "PAYMENT REVIEW";
  return "UNPAID";
}

function paymentSatisfiesProductionGate(row) {
  const total = numberOrNull(row.quoted_amount ?? row.amount_due);
  const verified = numberOrNull(row.payment_verified_amount ?? row.payment_confirmed_amount);
  const status = key(row.payment_status);
  if (!Number.isFinite(total) || total <= 0) return false;
  return ["paid", "full_payment_confirmed", "confirmed"].includes(status)
    && Number.isFinite(verified)
    && verified >= total;
}

function hasArtwork(row) {
  if (cleanText(row.artwork_url, 1000)) return true;
  return ["submitted", "under_review", "approval_required", "revision_requested", "approved"]
    .includes(key(row.artwork_status));
}

function hasPositiveQuantity(value) {
  const matches = String(value || "").match(/\d+(?:\.\d+)?/g) || [];
  return matches.some((number) => Number(number) > 0);
}

function displayForUser(userId, profileMap, fallback) {
  if (isUuid(userId)) return profileMap.get(userId) || "Inactive user (historical)";
  return cleanText(fallback, 160) || "Not set";
}

function nonUuidText(value, maxLength) {
  return isUuid(value) ? "" : cleanText(value, maxLength);
}

function roleLabel(role) {
  const value = key(role);
  if (value === "owner") return "Owner";
  if (value === "admin") return "Admin";
  if (value === "staff") return "Staff";
  return "";
}

function forbidden() {
  return businessError(403, "PRODUCTION_ACTION_FORBIDDEN", "Production action is not available.");
}

function locked() {
  return businessError(400, "PRODUCTION_DETAILS_LOCKED", "Ready and completed production details are locked.");
}

function businessError(status, code, message) {
  const error = new Error(message);
  error.businessStatus = status;
  error.code = code;
  return error;
}

function getJobReference(request) {
  const queryId = Array.isArray(request.query?.id) ? request.query.id[0] : request.query?.id;
  if (queryId) return String(queryId).trim().toUpperCase();
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const match = url.pathname.match(/^\/api\/production\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]).trim().toUpperCase() : "";
}

function getBearerToken(request) {
  const authorization = request.headers.authorization || request.headers.Authorization || "";
  return String(authorization).match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}

async function readJsonBody(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
    return request.body;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function authError() {
  return errorBody("AUTH_REQUIRED", "Authentication required.");
}

function errorBody(code, message) {
  return { ok: false, error: { code, message } };
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

export default createProductionJobHandler();
