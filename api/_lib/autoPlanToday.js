import { createHash, randomUUID } from "node:crypto";
import { getAuthorizedAdmin, getBearerToken, readJsonBody, sendJson } from "./adminAccess.js";
import { createServerSupabaseClient } from "./supabaseServer.js";
import { TaskApiError, mapTaskError } from "./taskApi.js";
import { TaskValidationError, assertAllowedKeys, assertPlainObject, requireIdempotencyKey } from "./taskValidation.js";

const BODY_FIELDS = new Set(["quickDirection", "requestedBy", "n8nEndpoint", "maximumTasks"]);
const DEFAULT_MAX_TASKS = 3;
const MAX_QUICK_DIRECTION_LENGTH = 500;
const MAX_DISPATCH_MS = 5000;
const MANILA_TIME_ZONE = "Asia/Manila";

export class AutoPlanError extends Error {
  constructor(code, status, message, details = undefined) {
    super(message);
    this.name = "AutoPlanError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function handleAutoPlanToday(request, response, dependencies = {}) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendAutoPlanError(response, new AutoPlanError("VALIDATION_ERROR", 405, "Method not allowed."));
  }

  try {
    const token = getBearerToken(request);
    if (!token && !dependencies.actor) throw new AutoPlanError("AUTH_REQUIRED", 401, "Authentication required.");
    const supabase = dependencies.supabase || createServerSupabaseClient();
    const actor = dependencies.actor || await getAuthorizedAdmin(supabase, token);
    if (!actor) throw new AutoPlanError("AUTH_REQUIRED", 401, "Authentication required.");
    if (actor.role !== "owner") throw new AutoPlanError("FORBIDDEN", 403, "Auto Plan Today is Owner-only.");

    const body = parseAutoPlanBody(await (dependencies.readBody || readJsonBody)(request));
    const idempotencyKey = requireIdempotencyKey(request);
    const config = readAutoPlanConfig(dependencies.env || process.env, dependencies.config);
    await assertServerGate(supabase, config, dependencies);

    const context = await buildApprovedPlanningContext(supabase, actor, body.quickDirection, config, dependencies);
    const requestCode = createRequestCode(idempotencyKey);
    const planning = await createPlanningRequest(supabase, {
      requestCode,
      actor,
      quickDirection: body.quickDirection,
      context,
      maximumTasks: config.maximumTasks,
    });

    const handoff = await dispatchPlanningRequest(planning, context, config, { ...dependencies, supabase });
    const refreshed = await readPlanningRequest(supabase, planning.id);
    const tasks = await listDraftTasksForPlanning(supabase, planning.id);
    const status = tasks.length ? "COMPLETED" : handoff.status;
    return sendJson(response, 202, {
      ok: true,
      request: projectPlanningRequest(refreshed || planning),
      draftsReceived: tasks.length,
      draftTaskIds: tasks.map((task) => task.id),
      dispatchStatus: status,
      traceCode: planning.request_code,
      replayed: planning.replayed === true,
    });
  } catch (error) {
    return sendAutoPlanError(response, mapAutoPlanError(error));
  }
}

export function parseAutoPlanBody(body) {
  assertPlainObject(body);
  assertAllowedKeys(body, BODY_FIELDS);
  const quickDirection = normalizeQuickDirection(body.quickDirection);
  if (body.requestedBy || body.n8nEndpoint || body.maximumTasks !== undefined) {
    throw new TaskValidationError("Browser may not choose planning authority, endpoint, or task limits.");
  }
  return { quickDirection };
}

export function normalizeQuickDirection(value) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new TaskValidationError("quickDirection must be text.");
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length > MAX_QUICK_DIRECTION_LENGTH) {
    throw new TaskValidationError(`quickDirection must contain 0 to ${MAX_QUICK_DIRECTION_LENGTH} characters.`);
  }
  if (/[<>]/.test(normalized)) throw new TaskValidationError("quickDirection may not contain raw HTML.");
  return normalized;
}

export function readAutoPlanConfig(env = process.env, overrides = {}) {
  const maximumTasks = readInteger(env.AUTO_PLAN_TODAY_MAX_TASKS, DEFAULT_MAX_TASKS, 1, DEFAULT_MAX_TASKS);
  return {
    enabled: overrides.enabled ?? String(env.ENABLE_AUTO_PLAN_TODAY || "").toLowerCase() === "true",
    endpointUrl: overrides.endpointUrl ?? String(env.N8N_AUTO_PLAN_TODAY_URL || "").trim(),
    workflowName: overrides.workflowName ?? String(env.N8N_AUTO_PLAN_TODAY_WORKFLOW || "TRRY Auto Plan Today").trim(),
    integrationToken: overrides.integrationToken ?? String(env.N8N_AUTO_PLAN_TODAY_TOKEN || "").trim(),
    maximumTasks,
    timeoutMs: overrides.timeoutMs ?? readInteger(env.AUTO_PLAN_TODAY_TIMEOUT_MS, MAX_DISPATCH_MS, 500, 15000),
  };
}

export async function buildApprovedPlanningContext(supabase, actor, quickDirection, config, dependencies = {}) {
  const now = dependencies.now || new Date();
  const manilaDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const capacity = dependencies.capacitySnapshot || await loadCapacitySnapshot(supabase);
  return {
    schemaVersion: "phase-8.7-auto-plan-today-v1",
    currentDate: { date: manilaDate, timeZone: MANILA_TIME_ZONE },
    quickDirection,
    maximumTasks: config.maximumTasks,
    businessContext: {
      activeCampaign: null,
      businessPriority: null,
      priorityServices: [],
      approvedMarketingChannels: [],
      upcomingApprovedEvents: [],
      productionCapacitySnapshot: capacity,
      taskLoadSummary: capacity.taskLoadSummary,
    },
    unavailableContext: [
      "activeCampaign",
      "businessPriority",
      "priorityServices",
      "approvedMarketingChannels",
      "upcomingApprovedEvents",
    ],
    exclusions: [
      "customer_names",
      "phone_numbers",
      "addresses",
      "payment_information",
      "private_inquiry_notes",
      "artwork",
      "credentials",
      "tokens",
      "service_role_details",
    ],
    requestedByRole: actor.role,
  };
}

async function assertServerGate(supabase, config, dependencies = {}) {
  if (!config.enabled) throw new AutoPlanError("FEATURE_DISABLED", 503, "Auto Plan Today is not enabled for this environment.");
  if (!isSafeEndpoint(config.endpointUrl)) throw new AutoPlanError("INTEGRATION_UNAVAILABLE", 503, "Auto Plan Today integration is not configured.");
  if (config.integrationToken && config.integrationToken.length < 16) {
    throw new AutoPlanError("INTEGRATION_UNAVAILABLE", 503, "Auto Plan Today integration is not configured.");
  }
  if (dependencies.skipDatabaseFeatureGate) return;
  const [taskDomain, autoPlanFlag] = await Promise.all([
    supabase.rpc("task_domain_enabled"),
    supabase.from("task_feature_flags").select("enabled").eq("feature", "AUTO_PLAN_TODAY").maybeSingle(),
  ]);
  if (taskDomain.error) throw taskDomain.error;
  if (autoPlanFlag.error) throw autoPlanFlag.error;
  if (taskDomain.data !== true || autoPlanFlag.data?.enabled !== true) {
    throw new AutoPlanError("FEATURE_DISABLED", 503, "Auto Plan Today is disabled.");
  }
}

async function createPlanningRequest(supabase, { requestCode, actor, quickDirection, context, maximumTasks }) {
  const row = {
    request_code: requestCode,
    requested_by_user_id: actor.userId,
    quick_direction: quickDirection,
    active_campaign: null,
    capacity_snapshot: context.businessContext.productionCapacitySnapshot,
    maximum_tasks: maximumTasks,
    status: "REQUESTED",
    planning_context: context,
  };
  const inserted = await supabase.from("planning_requests").insert(row).select("*").single();
  if (!inserted.error) return { ...inserted.data, replayed: false };
  if (inserted.error.code !== "23505") throw inserted.error;

  const existing = await supabase.from("planning_requests").select("*").eq("request_code", requestCode).maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data) throw inserted.error;
  if (existing.data.requested_by_user_id !== actor.userId || existing.data.quick_direction !== quickDirection) {
    throw new AutoPlanError("IDEMPOTENCY_CONFLICT", 409, "Planning request conflicts with an earlier command.");
  }
  return { ...existing.data, replayed: true };
}

async function dispatchPlanningRequest(planning, context, config, dependencies = {}) {
  if (planning.status === "COMPLETED") return { status: "COMPLETED" };
  if (planning.replayed) return { status: planning.status || "REQUESTED" };
  const body = {
    provider: "trry-admin",
    workflowName: config.workflowName,
    planningRequestId: planning.id,
    requestCode: planning.request_code,
    traceCode: planning.request_code,
    maximumTasks: config.maximumTasks,
    context,
    ingestion: {
      method: "POST",
      path: "/api/integrations/n8n/task-drafts",
      signatureHeaders: [
        "x-trry-request-timestamp",
        "x-trry-request-expires-at",
        "x-trry-signature",
        "idempotency-key",
      ],
    },
  };
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
    "x-trry-planning-request-id": planning.id,
    "x-trry-planning-request-code": planning.request_code,
  };
  if (config.integrationToken) headers.authorization = `Bearer ${config.integrationToken}`;

  const dispatchFetch = dependencies.fetch || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await dispatchFetch(config.endpointUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      await markPlanningFailed(dependencies.supabase || dependencies.client, planning.id, `n8n dispatch failed with HTTP ${response.status}`);
      throw new AutoPlanError("DISPATCH_FAILED", 502, "Auto Plan Today could not reach the planning workflow.");
    }
    return { status: "REQUESTED" };
  } catch (error) {
    if (error instanceof AutoPlanError) throw error;
    const timeoutFailure = error?.name === "AbortError";
    await markPlanningFailed(dependencies.supabase || dependencies.client, planning.id, timeoutFailure ? "n8n dispatch timed out" : "n8n dispatch failed");
    throw new AutoPlanError(timeoutFailure ? "DISPATCH_TIMEOUT" : "DISPATCH_FAILED", 504, timeoutFailure ? "Auto Plan Today timed out before drafts were received." : "Auto Plan Today could not reach the planning workflow.");
  } finally {
    clearTimeout(timeout);
  }
}

async function markPlanningFailed(supabase, planningId, summary) {
  if (!supabase) return;
  await supabase
    .from("planning_requests")
    .update({ status: "FAILED", completed_at: new Date().toISOString() })
    .eq("id", planningId)
    .in("status", ["REQUESTED", "PROCESSING"]);
}

async function readPlanningRequest(supabase, planningId) {
  const { data, error } = await supabase.from("planning_requests").select("*").eq("id", planningId).maybeSingle();
  if (error) throw error;
  return data;
}

async function listDraftTasksForPlanning(supabase, planningId) {
  const { data, error } = await supabase
    .from("tasks")
    .select("id,status,assigned_user_id,source_type")
    .eq("planning_request_id", planningId)
    .eq("status", "DRAFT");
  if (error) throw error;
  return data || [];
}

async function loadCapacitySnapshot(supabase) {
  const statusCounts = await supabase
    .from("tasks")
    .select("status", { count: "exact" })
    .in("status", ["DRAFT", "TO_DO", "IN_PROGRESS", "FOR_REVIEW", "NEEDS_REVISION"])
    .is("archived_at", null);
  if (statusCounts.error) throw statusCounts.error;
  const counts = {};
  for (const row of statusCounts.data || []) counts[row.status] = (counts[row.status] || 0) + 1;
  return {
    source: "public.tasks status counts only",
    taskLoadSummary: {
      draft: counts.DRAFT || 0,
      toDo: counts.TO_DO || 0,
      inProgress: counts.IN_PROGRESS || 0,
      forReview: counts.FOR_REVIEW || 0,
      needsRevision: counts.NEEDS_REVISION || 0,
    },
  };
}

function projectPlanningRequest(row) {
  return {
    id: row.id,
    requestCode: row.request_code,
    status: row.status,
    requestedAt: row.requested_at,
    completedAt: row.completed_at,
    maximumTasks: row.maximum_tasks,
    quickDirection: row.quick_direction || "",
  };
}

function createRequestCode(idempotencyKey) {
  const hash = createHash("sha256").update(idempotencyKey).digest("base64url").toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  return `PLN-${hash.slice(0, 16)}`;
}

function isSafeEndpoint(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;
    return ["127.0.0.1", "localhost"].includes(url.hostname);
  } catch {
    return false;
  }
}

function readInteger(value, fallback, min, max) {
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function mapAutoPlanError(error) {
  if (error instanceof AutoPlanError) return error;
  const mapped = mapTaskError(error);
  if (mapped instanceof TaskApiError || mapped instanceof TaskValidationError) return mapped;
  return new AutoPlanError("INTERNAL_ERROR", 500, "Auto Plan Today request failed.");
}

function sendAutoPlanError(response, error) {
  const body = { ok: false, error: { code: error.code || "INTERNAL_ERROR", message: error.message || "Auto Plan Today request failed." } };
  if (error.details !== undefined) body.error.details = error.details;
  if (body.error.code === "INTERNAL_ERROR") console.error("Auto Plan Today failed.", { code: body.error.code, status: error.status || 500 });
  return sendJson(response, error.status || 500, body);
}
