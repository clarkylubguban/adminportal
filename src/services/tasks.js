export async function getMyTasks(session, filters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.search) params.set("search", filters.search);
  params.set("pageSize", String(filters.pageSize || 100));
  return taskRequest(`/api/my-tasks?${params.toString()}`, { session });
}

export async function getWorkboardTasks(session, filters = {}) {
  const params = new URLSearchParams();
  for (const key of ["status", "priority", "sourceType", "assignedUserId", "reviewerUserId", "scheduledDate", "deadlineFrom", "deadlineTo", "archived", "search"]) {
    if (filters[key] !== undefined && filters[key] !== null && filters[key] !== "") params.set(key, String(filters[key]));
  }
  params.set("pageSize", String(filters.pageSize || 100));
  return taskRequest(`/api/tasks?${params.toString()}`, { session });
}

export async function getTaskCalendar(session, filters = {}) {
  const params = new URLSearchParams();
  for (const key of ["from", "to", "assignedUserId", "sourceType", "status"]) {
    if (filters[key] !== undefined && filters[key] !== null && filters[key] !== "") params.set(key, String(filters[key]));
  }
  return taskRequest(`/api/task-calendar?${params.toString()}`, { session });
}

export async function requestAutoPlanToday(body, session, idempotencyKey = createIdempotencyKey("auto-plan")) {
  return taskRequest("/api/planning/auto-plan-today", { method: "POST", body, session, idempotencyKey });
}

export async function createTaskDraft(body, session, idempotencyKey = createIdempotencyKey("create")) {
  return taskRequest("/api/tasks", { method: "POST", body, session, idempotencyKey });
}

export async function updateTaskDraft(taskId, body, session, idempotencyKey = createIdempotencyKey("draft")) {
  return taskRequest(`/api/tasks/${encodeURIComponent(taskId)}/draft`, { method: "PATCH", body, session, idempotencyKey });
}

export async function assignTask(taskId, body, session, idempotencyKey = createIdempotencyKey("assign")) {
  return taskCommand(taskId, "assign", body, session, idempotencyKey);
}

export async function approveTaskDraft(taskId, expectedVersion, session, idempotencyKey = createIdempotencyKey("approve-draft")) {
  return taskCommand(taskId, "approve-draft", { expectedVersion }, session, idempotencyKey);
}

export async function approveAndAssignTask(taskId, body, session, idempotencyKey = createIdempotencyKey("approve-and-assign")) {
  return taskCommand(taskId, "approve-and-assign", body, session, idempotencyKey);
}

export async function requestTaskRevision(taskId, body, session, idempotencyKey = createIdempotencyKey("revision-request")) {
  return taskCommand(taskId, "request-revision", body, session, idempotencyKey);
}

export async function approveTaskWork(taskId, body, session, idempotencyKey = createIdempotencyKey("approve-work")) {
  return taskCommand(taskId, "approve", body, session, idempotencyKey);
}

export async function cancelTask(taskId, body, session, idempotencyKey = createIdempotencyKey("cancel")) {
  return taskCommand(taskId, "cancel", body, session, idempotencyKey);
}

export async function reopenTask(taskId, body, session, idempotencyKey = createIdempotencyKey("reopen")) {
  return taskCommand(taskId, "reopen", body, session, idempotencyKey);
}

export async function archiveTask(taskId, expectedVersion, session, idempotencyKey = createIdempotencyKey("archive")) {
  return taskCommand(taskId, "archive", { expectedVersion }, session, idempotencyKey);
}
export async function getTaskDetail(taskId, session) {
  return taskRequest(`/api/tasks/${encodeURIComponent(taskId)}`, { session });
}

export async function startTaskWork(taskId, expectedVersion, session, idempotencyKey = createIdempotencyKey("start")) {
  return taskCommand(taskId, "start", { expectedVersion }, session, idempotencyKey);
}

export async function startTaskRevision(taskId, expectedVersion, session, idempotencyKey = createIdempotencyKey("revision")) {
  return taskCommand(taskId, "start-revision", { expectedVersion }, session, idempotencyKey);
}

export async function submitTaskForReview(taskId, body, session, idempotencyKey = createIdempotencyKey("submit")) {
  return taskCommand(taskId, "submit", {
    expectedVersion: body.expectedVersion,
    submissionNote: body.submissionNote,
    proofUrl: body.proofUrl || null,
  }, session, idempotencyKey);
}

export async function submitTaskWithoutRecordedTime(taskId, body, session, idempotencyKey = createIdempotencyKey("notime")) {
  return taskCommand(taskId, "submit-without-time", {
    expectedVersion: body.expectedVersion,
    note: body.note,
    reason: body.reason,
  }, session, idempotencyKey);
}

export function createIdempotencyKey(prefix = "task") {
  const random = crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

async function taskCommand(taskId, action, body, session, idempotencyKey) {
  return taskRequest(`/api/tasks/${encodeURIComponent(taskId)}/${action}`, {
    method: "POST",
    body,
    session,
    idempotencyKey,
  });
}

async function taskRequest(path, { method = "GET", body, session, idempotencyKey = "" } = {}) {
  if (!session?.access_token) {
    throw createTaskClientError("AUTH_REQUIRED", "Task session is missing.", 401);
  }

  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${session.access_token}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await readJson(response);
  if (!response.ok || payload?.ok === false) {
    const error = createTaskClientError(
      payload?.error?.code || "TASK_REQUEST_FAILED",
      payload?.error?.message || "Task request failed.",
      response.status,
      payload?.error?.details || null,
    );
    throw error;
  }
  return payload;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: { code: "INVALID_JSON", message: "Task response was invalid." } };
  }
}

function createTaskClientError(code, message, status, details = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}
