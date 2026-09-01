const MANAGER_ROLES = new Set(["owner", "admin"]);
const TERMINAL_STATUSES = new Set(["DONE", "CANCELLED"]);

export function projectTask(row, actor, context = {}) {
  const task = {
    id: field(row, "id"),
    taskCode: field(row, "task_code", "taskCode"),
    title: field(row, "title"),
    brief: field(row, "brief"),
    sourceType: field(row, "source_type", "sourceType"),
    sourceRecordType: field(row, "source_record_type", "sourceRecordType"),
    sourceRecordId: field(row, "source_record_id", "sourceRecordId"),
    status: field(row, "status"),
    priority: field(row, "priority"),
    timeTrackingMode: field(row, "time_tracking_mode", "timeTrackingMode") || "EXPECTED",
    assignedUserId: field(row, "assigned_user_id", "assignedUserId"),
    reviewerUserId: field(row, "reviewer_user_id", "reviewerUserId"),
    draftApprovalRequired: Boolean(field(row, "draft_approval_required", "draftApprovalRequired")),
    scheduledDate: nullable(field(row, "scheduled_date", "scheduledDate")),
    startDeadline: nullable(field(row, "start_deadline", "startDeadline")),
    submissionDeadline: nullable(field(row, "submission_deadline", "submissionDeadline")),
    approvalDeadline: nullable(field(row, "approval_deadline", "approvalDeadline")),
    version: Number(field(row, "version") || 0),
    completedAt: nullable(field(row, "completed_at", "completedAt")),
    cancelledAt: nullable(field(row, "cancelled_at", "cancelledAt")),
    archivedAt: nullable(field(row, "archived_at", "archivedAt")),
    createdAt: nullable(field(row, "created_at", "createdAt")),
    updatedAt: nullable(field(row, "updated_at", "updatedAt")),
  };

  const openTimeEntry = context.openTimeEntry ? projectTimeEntry(context.openTimeEntry) : null;
  const totalClosedDurationSeconds = Number(context.totalClosedDurationSeconds || 0);
  const internal = {
    ...task,
    createdByUserId: context.createdByUserId || null,
    hasTimeEntries: Boolean(context.hasTimeEntries),
  };
  const manager = MANAGER_ROLES.has(actor.role);

  return {
    ...task,
    ...(manager ? {
      automationTrace: {
        planningRequestId: nullable(field(row, "planning_request_id", "planningRequestId")),
        automationReceiptId: nullable(field(row, "automation_receipt_id", "automationReceiptId")),
        externalTaskId: nullable(field(row, "external_task_id", "externalTaskId")),
        suggestedAssignee: sanitizeSuggestedAssignee(field(row, "automation_metadata", "automationMetadata")?.suggestedAssignee),
      },
    } : {}),
    assignedUser: projectUser(context.assignedUser),
    reviewerUser: projectUser(context.reviewerUser),
    allowedActions: calculateAllowedActions(internal, actor, openTimeEntry),
    openTimeEntry,
    totalClosedDurationSeconds,
  };
}

function sanitizeSuggestedAssignee(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    label: nullable(value.label),
    externalUserId: nullable(value.externalUserId),
    reason: nullable(value.reason),
  };
}

export function projectSubmission(row, timeEntries = [], userMap = new Map()) {
  const timeRecordingStatus = field(row, "time_recording_status", "timeRecordingStatus") || "RECORDED";
  const taskId = field(row, "task_id", "taskId");
  const cycleNumber = Number(field(row, "cycle_number", "cycleNumber") || 0);
  const cycleEntries = timeEntries.filter((entry) =>
    field(entry, "task_id", "taskId") === taskId
    && Number(field(entry, "cycle_number", "cycleNumber")) === cycleNumber
    && field(entry, "ended_at", "endedAt"),
  );
  return {
    id: field(row, "id"),
    taskId,
    cycleNumber,
    submittedByUserId: field(row, "submitted_by_user_id", "submittedByUserId"),
    submittedByUser: projectUser(userMap.get(field(row, "submitted_by_user_id", "submittedByUserId"))),
    submissionNote: field(row, "submission_note", "submissionNote") || "",
    proofUrl: nullable(field(row, "proof_url", "proofUrl")),
    submittedAt: nullable(field(row, "submitted_at", "submittedAt")),
    timeRecordingStatus,
    noTimeReason: nullable(field(row, "no_time_reason", "noTimeReason")),
    hasReliableRecordedDuration: timeRecordingStatus === "RECORDED",
    recordedDurationSeconds: timeRecordingStatus === "RECORDED"
      ? calculateClosedDurationSeconds(cycleEntries)
      : null,
    reviewerUserId: nullable(field(row, "reviewer_user_id", "reviewerUserId")),
    reviewerUser: projectUser(userMap.get(field(row, "reviewer_user_id", "reviewerUserId"))),
    reviewDecision: field(row, "review_decision", "reviewDecision"),
    reviewNote: nullable(field(row, "review_note", "reviewNote")),
    reviewedAt: nullable(field(row, "reviewed_at", "reviewedAt")),
    createdAt: nullable(field(row, "created_at", "createdAt")),
    updatedAt: nullable(field(row, "updated_at", "updatedAt")),
  };
}

export function projectTimeEntry(row) {
  return {
    id: field(row, "id"),
    taskId: field(row, "task_id", "taskId"),
    userId: field(row, "user_id", "userId"),
    cycleNumber: Number(field(row, "cycle_number", "cycleNumber") || 0),
    startedAt: nullable(field(row, "started_at", "startedAt")),
    endedAt: nullable(field(row, "ended_at", "endedAt")),
    closeReason: nullable(field(row, "close_reason", "closeReason")),
    correctedAt: nullable(field(row, "corrected_at", "correctedAt")),
    createdAt: nullable(field(row, "created_at", "createdAt")),
    updatedAt: nullable(field(row, "updated_at", "updatedAt")),
  };
}

export function projectEvent(row, actor) {
  const manager = MANAGER_ROLES.has(actor.role);
  const event = {
    id: field(row, "id"),
    taskId: field(row, "task_id", "taskId"),
    eventType: field(row, "event_type", "eventType"),
    occurredAt: nullable(field(row, "occurred_at", "occurredAt")),
    previousStatus: nullable(field(row, "previous_status", "previousStatus")),
    nextStatus: nullable(field(row, "next_status", "nextStatus")),
    reason: nullable(field(row, "reason")),
    changes: sanitizeEventChanges(field(row, "field_changes", "fieldChanges"), manager),
  };

  if (manager) {
    event.actorUserId = nullable(field(row, "actor_user_id", "actorUserId"));
    event.actorRole = nullable(field(row, "actor_role", "actorRole"));
  }
  return event;
}

export function calculateClosedDurationSeconds(entries) {
  return entries.reduce((total, row) => {
    const start = Date.parse(field(row, "started_at", "startedAt"));
    const end = Date.parse(field(row, "ended_at", "endedAt"));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return total;
    return total + Math.floor((end - start) / 1000);
  }, 0);
}

export function calculateAllowedActions(task, actor, openTimeEntry = null) {
  if (!actor?.isActive) return [];
  const role = actor.role;
  const owner = role === "owner";
  const admin = role === "admin";
  const assignee = task.assignedUserId === actor.userId;
  const reviewer = task.reviewerUserId === actor.userId;
  const manager = owner || admin;
  const adminOwnManual = admin
    && task.sourceType === "MANUAL"
    && (task.createdByUserId === actor.userId || reviewer);
  const actions = [];

  if (task.status === "DRAFT" && (owner || (admin && task.sourceType === "MANUAL"))) actions.push("EDIT_DRAFT");
  if (manager && ["TO_DO", "NEEDS_REVISION"].includes(task.status) && !openTimeEntry) actions.push("ASSIGN");
  if (
    task.status === "DRAFT"
    && task.assignedUserId
    && task.reviewerUserId
    && (owner || (admin && task.sourceType === "MANUAL" && !task.draftApprovalRequired))
  ) actions.push("APPROVE_DRAFT");
  if (
    task.status === "DRAFT"
    && (owner || (admin && ["MANUAL", "PRODUCTION", "SHOP_TASK"].includes(task.sourceType) && !task.draftApprovalRequired))
  ) actions.push("APPROVE_AND_ASSIGN");
  if (task.status === "TO_DO" && assignee && task.timeTrackingMode === "EXPECTED") {
    actions.push("START_WORK", "SUBMIT_WITHOUT_RECORDED_TIME");
  }
  if (task.status === "TO_DO" && assignee && task.timeTrackingMode === "NONE") actions.push("START_WORK", "SUBMIT_FOR_REVIEW");
  if (task.status === "IN_PROGRESS" && assignee && task.timeTrackingMode === "EXPECTED" && openTimeEntry?.userId === actor.userId) actions.push("SUBMIT_FOR_REVIEW");
  if (task.status === "IN_PROGRESS" && assignee && task.timeTrackingMode === "NONE" && !openTimeEntry) actions.push("SUBMIT_FOR_REVIEW");
  if (task.status === "FOR_REVIEW" && (owner || (admin && reviewer))) actions.push("REQUEST_REVISION", "APPROVE_WORK");
  if (task.status === "NEEDS_REVISION" && assignee && task.timeTrackingMode === "EXPECTED") {
    actions.push("START_REVISION", "SUBMIT_WITHOUT_RECORDED_TIME");
  }
  if (task.status === "NEEDS_REVISION" && assignee && task.timeTrackingMode === "NONE") actions.push("START_REVISION", "SUBMIT_FOR_REVIEW");
  if (["DRAFT", "TO_DO", "IN_PROGRESS", "NEEDS_REVISION"].includes(task.status) && (owner || adminOwnManual)) actions.push("CANCEL");
  if (owner && TERMINAL_STATUSES.has(task.status)) actions.push("REOPEN");
  if (TERMINAL_STATUSES.has(task.status) && !task.archivedAt && !openTimeEntry && (owner || adminOwnManual)) actions.push("ARCHIVE");
  if (owner && task.hasTimeEntries) actions.push("CORRECT_TIME_ENTRY");
  return actions;
}

export function projectUser(row) {
  if (!row) return null;
  const displayName = String(field(row, "display_name", "displayName") || "").trim();
  const role = String(field(row, "role") || "").trim().toLowerCase();
  const isActive = field(row, "is_active", "isActive") !== false;
  return {
    displayName: displayName || "TRRY teammate",
    initials: createInitials(displayName || role || "TRRY teammate"),
    role,
    isActive,
  };
}
function sanitizeEventChanges(value, manager) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const allowed = manager
    ? new Set([
      "sourceType", "assignedUserId", "reviewerUserId", "draftApprovalRequired",
      "titleChanged", "briefChanged", "priority", "assignmentChanged", "cycleNumber",
      "hasProof", "submissionId", "timeRecordingStatus", "timeEntryId", "oldStartedAt", "oldEndedAt", "closeReason",
      "newStartedAt", "newEndedAt",
    ])
    : new Set(["assignmentChanged", "cycleNumber", "hasProof", "submissionId", "timeRecordingStatus"]);
  return Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key)));
}

function field(row, ...keys) {
  for (const key of keys) {
    if (row && Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  }
  return undefined;
}

function nullable(value) {
  return value === undefined ? null : value;
}

function createInitials(value) {
  const parts = String(value || "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "TT";
}
