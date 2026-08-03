import { runTaskApi, TaskApiError } from "./taskApi.js";
import {
  parseApproveBody,
  parseApproveAndAssignBody,
  parseAssignBody,
  parseCreateTask,
  parseDraftUpdate,
  parseExpectedVersionBody,
  parseHistoryQuery,
  parseReasonBody,
  parseSubmitBody,
  parseSubmitWithoutTimeBody,
  parseTaskListQuery,
  parseTimeCorrectionBody,
  requireIdempotencyKey,
  taskIdFromRequest,
  timeEntryIdFromRequest,
} from "./taskValidation.js";

const MANAGER_ROLES = new Set(["owner", "admin"]);

export function handleTaskCollection(request, response, dependencies = {}) {
  return runTaskApi(request, response, {
    methods: ["GET", "POST"],
    handler: async (context) => {
      requireManager(context.actor);
      if (request.method === "GET") {
        const { filters, pagination } = parseTaskListQuery(request);
        return context.service.listTasks(filters, pagination);
      }

      const body = parseCreateTask(await context.readBody(request));
      const idempotencyKey = requireIdempotencyKey(request);
      const result = await context.service.execute("task_create", {
        p_title: body.title,
        p_brief: body.brief,
        p_source_type: body.sourceType,
        p_source_record_type: body.sourceRecordType,
        p_source_record_id: body.sourceRecordId,
        p_priority: body.priority,
        p_assigned_user_id: body.assignedUserId,
        p_reviewer_user_id: body.reviewerUserId,
        p_draft_approval_required: body.draftApprovalRequired,
        p_scheduled_date: body.scheduledDate,
        p_start_deadline: body.startDeadline,
        p_submission_deadline: body.submissionDeadline,
        p_approval_deadline: body.approvalDeadline,
        p_external_workflow_id: null,
        p_external_task_number: null,
        p_idempotency_key: idempotencyKey,
        p_time_tracking_mode: body.timeTrackingMode,
      });
      return mutationProjection(result);
    },
  }, dependencies);
}

export function handleMyTasks(request, response, dependencies = {}) {
  return runTaskApi(request, response, {
    methods: ["GET"],
    handler: async ({ service }) => {
      const { filters, pagination } = parseTaskListQuery(request, { myTasks: true });
      return service.listTasks(filters, pagination, { assignedToCaller: true });
    },
  }, dependencies);
}

export function handleTaskDetail(request, response, dependencies = {}) {
  return runTaskApi(request, response, {
    methods: ["GET"],
    handler: async ({ service }) => {
      const detail = await service.getTask(taskIdFromRequest(request));
      return { ...detail, allowedActions: detail.task.allowedActions };
    },
  }, dependencies);
}

export function handleTaskHistory(request, response, dependencies = {}) {
  return runTaskApi(request, response, {
    methods: ["GET"],
    handler: async ({ service }) => service.getHistory(taskIdFromRequest(request), parseHistoryQuery(request)),
  }, dependencies);
}

export function handleTaskTimeEntries(request, response, dependencies = {}) {
  return runTaskApi(request, response, {
    methods: ["GET"],
    handler: async ({ service }) => service.getTimeEntries(taskIdFromRequest(request)),
  }, dependencies);
}

export function handleUpdateDraft(request, response, dependencies = {}) {
  return runTaskApi(request, response, mutationConfig(async ({ service, readBody }) => {
    const taskId = taskIdFromRequest(request);
    const current = await service.getTask(taskId);
    const body = parseDraftUpdate(await readBody(request), current.task);
    return service.execute("task_update_draft", {
      p_task_id: taskId,
      p_expected_version: body.expectedVersion,
      p_title: body.title,
      p_brief: body.brief,
      p_priority: body.priority,
      p_assigned_user_id: body.assignedUserId,
      p_reviewer_user_id: body.reviewerUserId,
      p_draft_approval_required: body.draftApprovalRequired,
      p_scheduled_date: body.scheduledDate,
      p_start_deadline: body.startDeadline,
      p_submission_deadline: body.submissionDeadline,
      p_approval_deadline: body.approvalDeadline,
      p_idempotency_key: requireIdempotencyKey(request),
      p_time_tracking_mode: body.timeTrackingMode,
    }, taskId);
  }, "PATCH"), dependencies);
}

export function handleAssign(request, response, dependencies = {}) {
  return command(request, response, dependencies, "task_assign", parseAssignBody, (taskId, body, key) => ({
    p_task_id: taskId,
    p_expected_version: body.expectedVersion,
    p_assigned_user_id: body.assignedUserId,
    p_idempotency_key: key,
  }));
}

export function handleApproveDraft(request, response, dependencies = {}) {
  return versionOnlyCommand(request, response, dependencies, "task_approve_draft");
}

export function handleApproveAndAssign(request, response, dependencies = {}) {
  return command(request, response, dependencies, "task_approve_and_assign", parseApproveAndAssignBody, (taskId, body, key) => ({
    p_task_id: taskId,
    p_expected_version: body.expectedVersion,
    p_assigned_user_id: body.assignedUserId,
    p_reviewer_user_id: body.reviewerUserId,
    p_start_deadline: body.startDeadline,
    p_submission_deadline: body.submissionDeadline,
    p_approval_deadline: body.approvalDeadline,
    p_idempotency_key: key,
  }));
}

export function handleStartWork(request, response, dependencies = {}) {
  return versionOnlyCommand(request, response, dependencies, "task_start_work");
}

export function handleSubmit(request, response, dependencies = {}) {
  return command(request, response, dependencies, "task_submit_for_review", parseSubmitBody, (taskId, body, key) => ({
    p_task_id: taskId,
    p_expected_version: body.expectedVersion,
    p_submission_note: body.submissionNote,
    p_proof_url: body.proofUrl,
    p_idempotency_key: key,
  }));
}

export function handleSubmitWithoutTime(request, response, dependencies = {}) {
  return command(
    request,
    response,
    dependencies,
    "task_submit_without_time",
    parseSubmitWithoutTimeBody,
    (taskId, body, key) => ({
      p_task_id: taskId,
      p_expected_version: body.expectedVersion,
      p_submission_note: body.note,
      p_no_time_reason: body.reason,
      p_idempotency_key: key,
    }),
  );
}
export function handleRequestRevision(request, response, dependencies = {}) {
  return command(
    request,
    response,
    dependencies,
    "task_request_revision",
    (body) => parseReasonBody(body, "reviewNote"),
    (taskId, body, key) => ({
      p_task_id: taskId,
      p_expected_version: body.expectedVersion,
      p_review_note: body.reviewNote,
      p_idempotency_key: key,
    }),
  );
}

export function handleStartRevision(request, response, dependencies = {}) {
  return versionOnlyCommand(request, response, dependencies, "task_start_revision");
}

export function handleApproveWork(request, response, dependencies = {}) {
  return command(request, response, dependencies, "task_approve_work", parseApproveBody, (taskId, body, key) => ({
    p_task_id: taskId,
    p_expected_version: body.expectedVersion,
    p_review_note: body.reviewNote,
    p_idempotency_key: key,
  }));
}

export function handleCancel(request, response, dependencies = {}) {
  return reasonCommand(request, response, dependencies, "task_cancel");
}

export function handleReopen(request, response, dependencies = {}) {
  return reasonCommand(request, response, dependencies, "task_reopen");
}

export function handleArchive(request, response, dependencies = {}) {
  return versionOnlyCommand(request, response, dependencies, "task_archive");
}

export function handleCorrectTimeEntry(request, response, dependencies = {}) {
  return command(request, response, dependencies, "task_correct_time_entry", parseTimeCorrectionBody, (taskId, body, key) => ({
    p_task_id: taskId,
    p_time_entry_id: timeEntryIdFromRequest(request),
    p_expected_version: body.expectedVersion,
    p_started_at: body.startedAt,
    p_ended_at: body.endedAt,
    p_reason: body.reason,
    p_idempotency_key: key,
  }));
}

function versionOnlyCommand(request, response, dependencies, rpcName) {
  return command(request, response, dependencies, rpcName, parseExpectedVersionBody, (taskId, body, key) => ({
    p_task_id: taskId,
    p_expected_version: body.expectedVersion,
    p_idempotency_key: key,
  }));
}

function reasonCommand(request, response, dependencies, rpcName) {
  return command(request, response, dependencies, rpcName, parseReasonBody, (taskId, body, key) => ({
    p_task_id: taskId,
    p_expected_version: body.expectedVersion,
    p_reason: body.reason,
    p_idempotency_key: key,
  }));
}

function command(request, response, dependencies, rpcName, parseBody, buildArguments) {
  return runTaskApi(request, response, mutationConfig(async ({ service, readBody }) => {
    const taskId = taskIdFromRequest(request);
    const body = parseBody(await readBody(request));
    const key = requireIdempotencyKey(request);
    return service.execute(rpcName, buildArguments(taskId, body, key), taskId);
  }), dependencies);
}

function mutationConfig(execute, method = "POST") {
  return {
    methods: [method],
    handler: async (context) => mutationProjection(await execute(context)),
  };
}

function mutationProjection(result) {
  return {
    task: result.task,
    allowedActions: result.allowedActions,
    serverTime: result.serverTime,
    openTimeEntry: result.openTimeEntry,
    totalClosedDurationSeconds: result.totalClosedDurationSeconds,
    submission: result.submission,
    replayed: result.replayed === true,
    currentVersion: result.currentVersion,
  };
}

function requireManager(actor) {
  if (!MANAGER_ROLES.has(actor.role)) {
    throw new TaskApiError("FORBIDDEN", 403, "Manager task scope is not permitted.");
  }
}
