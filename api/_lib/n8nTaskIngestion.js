import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { sendJson } from "./adminAccess.js";
import { createServerSupabaseClient } from "./supabaseServer.js";
import {
  assertAllowedKeys,
  assertPlainObject,
  enumValue,
  optionalDate,
  optionalTimestamp,
  optionalText,
  requireText,
  requireUuid,
  TaskValidationError,
  TASK_PRIORITIES,
} from "./taskValidation.js";

const ALLOWED_SOURCES = new Set(["AI_MARKETING", "DAILY_CONTENT"]);
const BODY_FIELDS = new Set([
  "provider",
  "workflowName",
  "externalExecutionId",
  "planningRequestId",
  "requestTimestamp",
  "requestExpiresAt",
  "idempotencyKey",
  "payloadHash",
  "taskDrafts",
]);
const DRAFT_FIELDS = new Set([
  "externalTaskId",
  "sourceType",
  "title",
  "brief",
  "priority",
  "scheduledDate",
  "startDeadline",
  "submissionDeadline",
  "approvalDeadline",
  "suggestedAssignee",
]);
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;
const SIGNATURE_PATTERN = /^sha256=([a-f0-9]{64})$/i;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

export class N8nIngestionError extends Error {
  constructor(code, status, message, details = undefined) {
    super(message);
    this.name = "N8nIngestionError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function handleN8nTaskDrafts(request, response, dependencies = {}) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendN8nError(response, new N8nIngestionError("VALIDATION_ERROR", 405, "Method not allowed."));
  }

  try {
    const limits = dependencies.limits || getLimits();
    const rawBody = await readRawBody(request, limits.maxPayloadBytes);
    verifySignedRequest(request, rawBody, dependencies);
    const parsed = parseN8nPayload(rawBody, request, dependencies);
    const client = dependencies.client || createServerSupabaseClient();
    const { data, error } = await client.rpc("task_ingest_n8n_drafts", {
      p_provider: parsed.provider,
      p_workflow_name: parsed.workflowName,
      p_external_execution_id: parsed.externalExecutionId,
      p_planning_request_id: parsed.planningRequestId,
      p_idempotency_key: parsed.idempotencyKey,
      p_payload_hash: parsed.payloadHash,
      p_task_drafts: parsed.taskDrafts,
    });
    if (error) throw mapDatabaseError(error);
    return sendJson(response, data?.replayed ? 200 : 201, {
      ok: true,
      receiptId: data?.receiptId,
      planningRequestId: data?.planningRequestId,
      tasksCreated: data?.tasksCreated ?? 0,
      taskIds: data?.taskIds || [],
      replayed: data?.replayed === true,
      status: data?.status || "COMPLETED",
    });
  } catch (error) {
    return sendN8nError(response, mapN8nError(error));
  }
}

export function parseN8nPayload(rawBody, request, dependencies = {}) {
  let body;
  try {
    body = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new N8nIngestionError("INVALID_JSON", 400, "Request body must be valid JSON.");
  }
  assertPlainObject(body);
  assertAllowedKeys(body, BODY_FIELDS);

  const timestamp = requireIsoTimestamp(body.requestTimestamp, "requestTimestamp");
  const expiresAt = requireIsoTimestamp(body.requestExpiresAt, "requestExpiresAt");
  const headerTimestamp = headerValue(request, "x-trry-request-timestamp");
  const headerExpires = headerValue(request, "x-trry-request-expires-at");
  const headerIdempotencyKey = headerValue(request, "idempotency-key");
  if (headerTimestamp !== timestamp || headerExpires !== expiresAt) {
    throw new N8nIngestionError("SIGNATURE_INVALID", 401, "Integration signature is invalid.");
  }

  const idempotencyKey = requireToken(body.idempotencyKey, "idempotencyKey", IDEMPOTENCY_PATTERN);
  if (headerIdempotencyKey !== idempotencyKey) {
    throw new N8nIngestionError("IDEMPOTENCY_REQUIRED", 400, "A valid idempotency key is required.");
  }

  const provider = requireToken(body.provider, "provider", TOKEN_PATTERN);
  const workflowName = requireText(body.workflowName, "workflowName", 120);
  const externalExecutionId = requireToken(body.externalExecutionId, "externalExecutionId", IDEMPOTENCY_PATTERN);
  const planningRequestId = requireUuid(body.planningRequestId, "planningRequestId");
  const payloadHash = String(body.payloadHash || "").trim().toLowerCase();
  if (!HASH_PATTERN.test(payloadHash)) {
    throw new N8nIngestionError("VALIDATION_ERROR", 400, "payloadHash is invalid.");
  }
  const canonicalHash = hashCanonicalPayload({ ...body, payloadHash: undefined });
  if (payloadHash !== canonicalHash) {
    throw new N8nIngestionError("PAYLOAD_HASH_MISMATCH", 400, "payloadHash does not match the signed payload.");
  }

  const limits = dependencies.limits || getLimits();
  if (!Array.isArray(body.taskDrafts) || body.taskDrafts.length < 1 || body.taskDrafts.length > limits.maxTasks) {
    throw new N8nIngestionError("VALIDATION_ERROR", 400, "taskDrafts exceeds the configured limit.");
  }
  const seen = new Set();
  const taskDrafts = body.taskDrafts.map((draft, index) => parseDraft(draft, index, seen, limits));
  return {
    provider,
    workflowName,
    externalExecutionId,
    planningRequestId,
    requestTimestamp: timestamp,
    requestExpiresAt: expiresAt,
    idempotencyKey,
    payloadHash,
    taskDrafts,
  };
}

export function verifySignedRequest(request, rawBody, dependencies = {}) {
  const timestamp = headerValue(request, "x-trry-request-timestamp");
  const expiresAt = headerValue(request, "x-trry-request-expires-at");
  const signature = headerValue(request, "x-trry-signature");
  const match = signature.match(SIGNATURE_PATTERN);
  if (!timestamp || !expiresAt || !match) {
    throw new N8nIngestionError("SIGNATURE_INVALID", 401, "Integration signature is invalid.");
  }
  assertFreshWindow(timestamp, expiresAt, dependencies.now || new Date(), dependencies.clockSkewMs);
  const secret = dependencies.secret ?? process.env.N8N_TASK_DRAFTS_SECRET ?? "";
  if (!secret || secret.length < 32) {
    throw new N8nIngestionError("INTEGRATION_UNAVAILABLE", 503, "Integration endpoint is unavailable.");
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${expiresAt}.`)
    .update(rawBody)
    .digest("hex");
  const provided = Buffer.from(match[1], "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) {
    throw new N8nIngestionError("SIGNATURE_INVALID", 401, "Integration signature is invalid.");
  }
}

export function hashCanonicalPayload(value) {
  return createHash("sha256").update(stableStringify(stripUndefined(value))).digest("hex");
}

export function signN8nBody(rawBody, { secret, timestamp, expiresAt }) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${expiresAt}.`).update(rawBody).digest("hex")}`;
}

async function readRawBody(request, maxBytes) {
  if (Buffer.isBuffer(request.body)) {
    if (request.body.length > maxBytes) throw new N8nIngestionError("PAYLOAD_TOO_LARGE", 413, "Payload is too large.");
    return request.body;
  }
  if (typeof request.body === "string") {
    const body = Buffer.from(request.body, "utf8");
    if (body.length > maxBytes) throw new N8nIngestionError("PAYLOAD_TOO_LARGE", 413, "Payload is too large.");
    return body;
  }
  if (!request || typeof request[Symbol.asyncIterator] !== "function") return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new N8nIngestionError("PAYLOAD_TOO_LARGE", 413, "Payload is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function parseDraft(value, index, seen, limits) {
  assertPlainObject(value);
  assertAllowedKeys(value, DRAFT_FIELDS);
  const externalTaskId = requireToken(value.externalTaskId, `taskDrafts[${index}].externalTaskId`, IDEMPOTENCY_PATTERN);
  if (seen.has(externalTaskId)) {
    throw new N8nIngestionError("VALIDATION_ERROR", 400, "Duplicate external task IDs are not allowed.");
  }
  seen.add(externalTaskId);
  const sourceType = enumValue(value.sourceType, `taskDrafts[${index}].sourceType`, ALLOWED_SOURCES);
  return {
    externalTaskId,
    sourceType,
    title: requireText(value.title, `taskDrafts[${index}].title`, limits.maxTitleLength),
    brief: requireText(value.brief, `taskDrafts[${index}].brief`, limits.maxBriefLength),
    priority: value.priority === undefined ? "MEDIUM" : enumValue(value.priority, `taskDrafts[${index}].priority`, TASK_PRIORITIES),
    scheduledDate: optionalDate(value.scheduledDate, `taskDrafts[${index}].scheduledDate`),
    startDeadline: optionalTimestamp(value.startDeadline, `taskDrafts[${index}].startDeadline`),
    submissionDeadline: optionalTimestamp(value.submissionDeadline, `taskDrafts[${index}].submissionDeadline`),
    approvalDeadline: optionalTimestamp(value.approvalDeadline, `taskDrafts[${index}].approvalDeadline`),
    suggestedAssignee: parseSuggestedAssignee(value.suggestedAssignee, index),
  };
}

function parseSuggestedAssignee(value, index) {
  if (value === undefined || value === null) return null;
  assertPlainObject(value);
  assertAllowedKeys(value, new Set(["label", "externalUserId", "reason"]));
  return {
    label: optionalText(value.label, `taskDrafts[${index}].suggestedAssignee.label`, 120),
    externalUserId: optionalText(value.externalUserId, `taskDrafts[${index}].suggestedAssignee.externalUserId`, 120),
    reason: optionalText(value.reason, `taskDrafts[${index}].suggestedAssignee.reason`, 500),
  };
}

function assertFreshWindow(timestamp, expiresAt, now, clockSkewMs = 120000) {
  const requested = Date.parse(requireIsoTimestamp(timestamp, "request timestamp"));
  const expires = Date.parse(requireIsoTimestamp(expiresAt, "request expiry"));
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  if (Number.isNaN(current)) throw new N8nIngestionError("VALIDATION_ERROR", 400, "Server clock is invalid.");
  if (requested - current > clockSkewMs) {
    throw new N8nIngestionError("REQUEST_NOT_YET_VALID", 401, "Request timestamp is outside the allowed window.");
  }
  if (expires <= current) {
    throw new N8nIngestionError("REQUEST_EXPIRED", 401, "Request has expired.");
  }
  if (expires - requested > 10 * 60 * 1000) {
    throw new N8nIngestionError("REQUEST_EXPIRY_INVALID", 401, "Request expiry is outside the allowed window.");
  }
}

function requireIsoTimestamp(value, label) {
  const normalized = optionalTimestamp(value, label);
  if (!normalized) throw new N8nIngestionError("VALIDATION_ERROR", 400, `${label} is required.`);
  return normalized;
}

function requireToken(value, label, pattern) {
  const normalized = requireText(value, label, 200);
  if (!pattern.test(normalized)) throw new N8nIngestionError("VALIDATION_ERROR", 400, `${label} is invalid.`);
  return normalized;
}

function headerValue(request, name) {
  const lower = name.toLowerCase();
  const raw = request.headers?.[name] ?? request.headers?.[lower] ?? "";
  return Array.isArray(raw) ? String(raw[0] || "").trim() : String(raw || "").trim();
}

function getLimits() {
  return {
    maxPayloadBytes: readIntegerEnv("N8N_TASK_DRAFTS_MAX_PAYLOAD_BYTES", 128 * 1024, 1024, 1024 * 1024),
    maxTasks: readIntegerEnv("N8N_TASK_DRAFTS_MAX_TASKS", 3, 1, 10),
    maxTitleLength: readIntegerEnv("N8N_TASK_DRAFTS_MAX_TITLE_LENGTH", 200, 1, 200),
    maxBriefLength: readIntegerEnv("N8N_TASK_DRAFTS_MAX_BRIEF_LENGTH", 10000, 1, 10000),
  };
}

function readIntegerEnv(name, fallback, min, max) {
  const parsed = Number(process.env[name] || fallback);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, stripUndefined(item)]),
  );
}

function mapDatabaseError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  if (code === "P0002") return new N8nIngestionError("PLANNING_REQUEST_NOT_FOUND", 404, "Planning request was not found.");
  if (code === "23505") return new N8nIngestionError("IDEMPOTENCY_CONFLICT", 409, "Automation execution conflicts with an earlier payload.");
  if (code === "55000") return new N8nIngestionError("INVALID_PLANNING_STATE", 409, "Planning request is not ready for automation.");
  if (["22023", "23514", "22P02"].includes(code) || message.includes("invalid")) {
    return new N8nIngestionError("VALIDATION_ERROR", 400, "Automation payload is invalid.");
  }
  return new N8nIngestionError("INTERNAL_ERROR", 500, "Automation ingestion failed.");
}

function mapN8nError(error) {
  if (error instanceof N8nIngestionError) return error;
  if (error instanceof TaskValidationError) return new N8nIngestionError(error.code, error.status, error.message, error.details);
  return new N8nIngestionError("INTERNAL_ERROR", 500, "Automation ingestion failed.");
}

function sendN8nError(response, error) {
  const body = { ok: false, error: { code: error.code, message: error.message } };
  if (error.details !== undefined) body.error.details = error.details;
  if (error.code === "INTERNAL_ERROR") console.error("n8n task ingestion failed.", { code: error.code, status: error.status });
  return sendJson(response, error.status || 500, body);
}
