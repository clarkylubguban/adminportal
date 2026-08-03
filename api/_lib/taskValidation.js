const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/i;

export const TASK_STATUSES = new Set(["DRAFT", "TO_DO", "IN_PROGRESS", "FOR_REVIEW", "NEEDS_REVISION", "DONE", "CANCELLED"]);
export const TASK_SOURCES = new Set(["MANUAL", "PRODUCTION", "SHOP_TASK", "AI_MARKETING", "DAILY_CONTENT"]);
export const TASK_PRIORITIES = new Set(["LOW", "MEDIUM", "HIGH", "URGENT"]);
export const TASK_TIME_TRACKING_MODES = new Set(["EXPECTED", "NONE"]);

export class TaskValidationError extends Error {
  constructor(message, details = undefined) {
    super(message);
    this.name = "TaskValidationError";
    this.code = "VALIDATION_ERROR";
    this.status = 400;
    this.details = details;
  }
}

export function assertPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TaskValidationError("JSON object body required.");
  return value;
}

export function assertAllowedKeys(value, allowed) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new TaskValidationError("Unknown request fields.", { fields: unknown.sort() });
}

export function requireUuid(value, label = "id") {
  const normalized = String(value || "").trim();
  if (!UUID_PATTERN.test(normalized)) throw new TaskValidationError(`${label} must be a valid UUID.`);
  return normalized.toLowerCase();
}

export function optionalUuid(value, label) {
  if (value === null || value === undefined || value === "") return null;
  return requireUuid(value, label);
}

export function requireExpectedVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TaskValidationError("expectedVersion must be a positive integer.");
  return value;
}

export function requireIdempotencyKey(request) {
  const raw = request.headers?.["idempotency-key"] ?? request.headers?.["Idempotency-Key"] ?? "";
  const value = Array.isArray(raw) ? raw[0] : String(raw).trim();
  if (!IDEMPOTENCY_PATTERN.test(value)) throw new TaskValidationError("A valid Idempotency-Key header is required.");
  return value;
}

export function requireText(value, label, max, min = 1) {
  if (typeof value !== "string") throw new TaskValidationError(`${label} must be text.`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) throw new TaskValidationError(`${label} must contain ${min} to ${max} characters.`);
  return normalized;
}

export function optionalText(value, label, max) {
  if (value === null || value === undefined || value === "") return null;
  return requireText(value, label, max);
}

export function enumValue(value, label, allowed) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!allowed.has(normalized)) throw new TaskValidationError(`${label} is invalid.`);
  return normalized;
}

export function optionalDate(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).trim();
  const parsed = Date.parse(`${normalized}T00:00:00Z`);
  if (!DATE_PATTERN.test(normalized) || Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== normalized) {
    throw new TaskValidationError(`${label} must be a valid YYYY-MM-DD date.`);
  }
  return normalized;
}

export function optionalTimestamp(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).trim();
  if (!TIMESTAMP_PATTERN.test(normalized) || Number.isNaN(Date.parse(normalized))) {
    throw new TaskValidationError(`${label} must be an ISO timestamp with a timezone.`);
  }
  return new Date(normalized).toISOString();
}

export function optionalProofUrl(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = requireText(value, "proofUrl", 2048);
  let parsed;
  try { parsed = new URL(normalized); } catch { throw new TaskValidationError("proofUrl must be a valid HTTPS URL."); }
  if (parsed.protocol !== "https:" || /\s/.test(normalized)) throw new TaskValidationError("proofUrl must be a valid HTTPS URL.");
  return normalized;
}

export function booleanValue(value, label, defaultValue = false) {
  if (value === undefined) return defaultValue;
  if (typeof value !== "boolean") throw new TaskValidationError(`${label} must be boolean.`);
  return value;
}

export function validateSourcePair(type, id) {
  if ((type === null) !== (id === null)) throw new TaskValidationError("sourceRecordType and sourceRecordId must both be present or both be null.");
}

export function parsePagination(query, { max = 100, defaultSize = 25 } = {}) {
  const page = parseInteger(query.page ?? 1, "page", 1, 100000);
  const pageSize = parseInteger(query.pageSize ?? defaultSize, "pageSize", 1, max);
  return { page, pageSize, from: (page - 1) * pageSize, to: page * pageSize - 1 };
}

export function parseInteger(value, label, min, max) {
  const parsed = typeof value === "number" ? value : Number(String(value));
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new TaskValidationError(`${label} is invalid.`);
  return parsed;
}

export function parseCreateTask(body) {
  assertPlainObject(body);
  assertAllowedKeys(body, new Set([
    "title", "brief", "sourceType", "sourceRecordType", "sourceRecordId", "priority",
    "assignedUserId", "reviewerUserId", "draftApprovalRequired", "scheduledDate",
    "startDeadline", "submissionDeadline", "approvalDeadline", "timeTrackingMode",
  ]));
  const sourceRecordType = optionalText(body.sourceRecordType, "sourceRecordType", 64);
  const sourceRecordId = optionalText(body.sourceRecordId, "sourceRecordId", 200);
  validateSourcePair(sourceRecordType, sourceRecordId);
  return {
    title: requireText(body.title, "title", 200),
    brief: requireText(body.brief, "brief", 10000),
    sourceType: enumValue(body.sourceType, "sourceType", TASK_SOURCES),
    sourceRecordType,
    sourceRecordId,
    priority: enumValue(body.priority ?? "MEDIUM", "priority", TASK_PRIORITIES),
    timeTrackingMode: enumValue(body.timeTrackingMode ?? "EXPECTED", "timeTrackingMode", TASK_TIME_TRACKING_MODES),
    assignedUserId: optionalUuid(body.assignedUserId, "assignedUserId"),
    reviewerUserId: optionalUuid(body.reviewerUserId, "reviewerUserId"),
    draftApprovalRequired: booleanValue(body.draftApprovalRequired, "draftApprovalRequired"),
    scheduledDate: optionalDate(body.scheduledDate, "scheduledDate"),
    startDeadline: optionalTimestamp(body.startDeadline, "startDeadline"),
    submissionDeadline: optionalTimestamp(body.submissionDeadline, "submissionDeadline"),
    approvalDeadline: optionalTimestamp(body.approvalDeadline, "approvalDeadline"),
  };
}

export function parseDraftUpdate(body, currentTask) {
  assertPlainObject(body);
  assertAllowedKeys(body, new Set([
    "expectedVersion", "title", "brief", "priority", "assignedUserId", "reviewerUserId",
    "draftApprovalRequired", "scheduledDate", "startDeadline", "submissionDeadline", "approvalDeadline",
    "timeTrackingMode",
  ]));
  const merged = {
    title: body.title ?? currentTask.title,
    brief: body.brief ?? currentTask.brief,
    priority: body.priority ?? currentTask.priority,
    timeTrackingMode: body.timeTrackingMode ?? currentTask.timeTrackingMode,
    assignedUserId: body.assignedUserId === undefined ? currentTask.assignedUserId : body.assignedUserId,
    reviewerUserId: body.reviewerUserId === undefined ? currentTask.reviewerUserId : body.reviewerUserId,
    draftApprovalRequired: body.draftApprovalRequired === undefined ? currentTask.draftApprovalRequired : body.draftApprovalRequired,
    scheduledDate: body.scheduledDate === undefined ? currentTask.scheduledDate : body.scheduledDate,
    startDeadline: body.startDeadline === undefined ? currentTask.startDeadline : body.startDeadline,
    submissionDeadline: body.submissionDeadline === undefined ? currentTask.submissionDeadline : body.submissionDeadline,
    approvalDeadline: body.approvalDeadline === undefined ? currentTask.approvalDeadline : body.approvalDeadline,
  };
  return {
    expectedVersion: requireExpectedVersion(body.expectedVersion),
    title: requireText(merged.title, "title", 200),
    brief: requireText(merged.brief, "brief", 10000),
    priority: enumValue(merged.priority, "priority", TASK_PRIORITIES),
    timeTrackingMode: enumValue(merged.timeTrackingMode, "timeTrackingMode", TASK_TIME_TRACKING_MODES),
    assignedUserId: optionalUuid(merged.assignedUserId, "assignedUserId"),
    reviewerUserId: optionalUuid(merged.reviewerUserId, "reviewerUserId"),
    draftApprovalRequired: booleanValue(merged.draftApprovalRequired, "draftApprovalRequired"),
    scheduledDate: optionalDate(merged.scheduledDate, "scheduledDate"),
    startDeadline: optionalTimestamp(merged.startDeadline, "startDeadline"),
    submissionDeadline: optionalTimestamp(merged.submissionDeadline, "submissionDeadline"),
    approvalDeadline: optionalTimestamp(merged.approvalDeadline, "approvalDeadline"),
  };
}

export function parseExpectedVersionBody(body, extraAllowed = []) {
  assertPlainObject(body);
  assertAllowedKeys(body, new Set(["expectedVersion", ...extraAllowed]));
  return { expectedVersion: requireExpectedVersion(body.expectedVersion) };
}

export function queryObject(request) {
  if (request.query && typeof request.query === "object") return request.query;
  const url = new URL(request.url || "/", `http://${request.headers?.host || "localhost"}`);
  return Object.fromEntries(url.searchParams.entries());
}

export function assertAllowedQuery(query, allowed) {
  const unknown = Object.keys(query).filter((key) => !allowed.has(key));
  if (unknown.length) throw new TaskValidationError("Unknown query parameters.", { fields: unknown.sort() });
}
export function parseTaskListQuery(request, { myTasks = false } = {}) {
  const query = queryObject(request);
  const allowed = new Set([
    "status", "priority", "sourceType", "reviewerUserId", "scheduledDate",
    "deadlineFrom", "deadlineTo", "archived", "search", "page", "pageSize",
  ]);
  if (!myTasks) allowed.add("assignedUserId");
  assertAllowedQuery(query, allowed);

  const deadlineFrom = optionalTimestamp(singleQueryValue(query.deadlineFrom, "deadlineFrom"), "deadlineFrom");
  const deadlineTo = optionalTimestamp(singleQueryValue(query.deadlineTo, "deadlineTo"), "deadlineTo");
  if (deadlineFrom && deadlineTo && Date.parse(deadlineTo) < Date.parse(deadlineFrom)) {
    throw new TaskValidationError("deadlineTo must not be earlier than deadlineFrom.");
  }

  return {
    pagination: parsePagination(query),
    filters: {
      status: query.status === undefined ? null : enumValue(singleQueryValue(query.status, "status"), "status", TASK_STATUSES),
      priority: query.priority === undefined ? null : enumValue(singleQueryValue(query.priority, "priority"), "priority", TASK_PRIORITIES),
      sourceType: query.sourceType === undefined ? null : enumValue(singleQueryValue(query.sourceType, "sourceType"), "sourceType", TASK_SOURCES),
      assignedUserId: query.assignedUserId === undefined ? null : requireUuid(singleQueryValue(query.assignedUserId, "assignedUserId"), "assignedUserId"),
      reviewerUserId: query.reviewerUserId === undefined ? null : requireUuid(singleQueryValue(query.reviewerUserId, "reviewerUserId"), "reviewerUserId"),
      scheduledDate: query.scheduledDate === undefined ? null : optionalDate(singleQueryValue(query.scheduledDate, "scheduledDate"), "scheduledDate"),
      deadlineFrom,
      deadlineTo,
      archived: query.archived === undefined ? null : parseBooleanQuery(singleQueryValue(query.archived, "archived"), "archived"),
      search: query.search === undefined ? null : parseSearch(singleQueryValue(query.search, "search")),
    },
  };
}

export function parseHistoryQuery(request) {
  const query = queryObject(request);
  const cleaned = { ...query };
  delete cleaned.id;
  assertAllowedQuery(cleaned, new Set(["page", "pageSize"]));
  return parsePagination(cleaned, { max: 100, defaultSize: 25 });
}

export function parseAssignBody(body) {
  const parsed = parseExpectedVersionBody(body, ["assignedUserId"]);
  return { ...parsed, assignedUserId: optionalUuid(body.assignedUserId, "assignedUserId") };
}

export function parseApproveAndAssignBody(body) {
  const parsed = parseExpectedVersionBody(body, [
    "assignedUserId",
    "reviewerUserId",
    "startDeadline",
    "submissionDeadline",
    "approvalDeadline",
  ]);
  return {
    ...parsed,
    assignedUserId: requireUuid(body.assignedUserId, "assignedUserId"),
    reviewerUserId: requireUuid(body.reviewerUserId, "reviewerUserId"),
    startDeadline: optionalTimestamp(body.startDeadline, "startDeadline"),
    submissionDeadline: optionalTimestamp(body.submissionDeadline, "submissionDeadline"),
    approvalDeadline: optionalTimestamp(body.approvalDeadline, "approvalDeadline"),
  };
}

export function parseSubmitBody(body) {
  const parsed = parseExpectedVersionBody(body, ["submissionNote", "proofUrl"]);
  return {
    ...parsed,
    submissionNote: requireText(body.submissionNote, "submissionNote", 5000),
    proofUrl: optionalProofUrl(body.proofUrl),
  };
}

export function parseSubmitWithoutTimeBody(body) {
  const parsed = parseExpectedVersionBody(body, ["note", "reason"]);
  return {
    ...parsed,
    note: requireText(body.note, "note", 5000),
    reason: requireText(body.reason, "reason", 2000),
  };
}
export function parseReasonBody(body, label = "reason") {
  const parsed = parseExpectedVersionBody(body, [label]);
  return { ...parsed, [label]: requireText(body[label], label, 5000) };
}

export function parseApproveBody(body) {
  const parsed = parseExpectedVersionBody(body, ["reviewNote"]);
  return { ...parsed, reviewNote: optionalText(body.reviewNote, "reviewNote", 5000) };
}

export function parseTimeCorrectionBody(body) {
  const parsed = parseExpectedVersionBody(body, ["startedAt", "endedAt", "reason"]);
  const startedAt = optionalTimestamp(body.startedAt, "startedAt");
  const endedAt = optionalTimestamp(body.endedAt, "endedAt");
  if (!startedAt) throw new TaskValidationError("startedAt is required.");
  if (endedAt && Date.parse(endedAt) < Date.parse(startedAt)) {
    throw new TaskValidationError("endedAt must not be earlier than startedAt.");
  }
  return {
    ...parsed,
    startedAt,
    endedAt,
    reason: requireText(body.reason, "reason", 5000),
  };
}

export function taskIdFromRequest(request) {
  const queryId = Array.isArray(request.query?.id) ? request.query.id[0] : request.query?.id;
  if (queryId) return requireUuid(queryId, "task id");
  const url = new URL(request.url || "/", `http://${request.headers?.host || "localhost"}`);
  const match = url.pathname.match(/^\/api\/tasks\/([^/]+)/);
  return requireUuid(match ? decodeURIComponent(match[1]) : "", "task id");
}

export function timeEntryIdFromRequest(request) {
  const queryId = Array.isArray(request.query?.entryId) ? request.query.entryId[0] : request.query?.entryId;
  if (queryId) return requireUuid(queryId, "time entry id");
  const url = new URL(request.url || "/", `http://${request.headers?.host || "localhost"}`);
  const match = url.pathname.match(/\/time-entries\/([^/]+)\/correct\/?$/);
  return requireUuid(match ? decodeURIComponent(match[1]) : "", "time entry id");
}

function singleQueryValue(value, label) {
  if (Array.isArray(value)) throw new TaskValidationError(`${label} may be provided only once.`);
  return value;
}

function parseBooleanQuery(value, label) {
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  throw new TaskValidationError(`${label} must be true or false.`);
}

function parseSearch(value) {
  const normalized = requireText(value, "search", 100);
  if (!/^[A-Za-z0-9 ._-]+$/.test(normalized)) {
    throw new TaskValidationError("search contains unsupported characters.");
  }
  return normalized;
}
