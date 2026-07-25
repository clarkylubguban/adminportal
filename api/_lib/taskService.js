import {
  calculateClosedDurationSeconds,
  projectEvent,
  projectSubmission,
  projectTask,
  projectTimeEntry,
} from "./taskProjection.js";

const TASK_SELECT = [
  "id", "task_code", "title", "brief", "source_type", "source_record_type",
  "source_record_id", "status", "priority", "time_tracking_mode", "assigned_user_id", "reviewer_user_id",
  "draft_approval_required", "scheduled_date", "start_deadline",
  "submission_deadline", "approval_deadline", "version", "completed_at",
  "cancelled_at", "archived_at", "created_at", "updated_at",
].join(",");
const TIME_SELECT = [
  "id", "task_id", "user_id", "cycle_number", "started_at", "ended_at",
  "close_reason", "corrected_at", "created_at", "updated_at",
].join(",");
const SUBMISSION_SELECT = [
  "id", "task_id", "cycle_number", "submitted_by_user_id", "submission_note",
  "proof_url", "submitted_at", "reviewer_user_id", "review_decision",
  "time_recording_status", "no_time_reason", "review_note", "reviewed_at", "created_at", "updated_at",
].join(",");
const EVENT_SELECT = [
  "id", "task_id", "event_type", "actor_user_id", "actor_role", "occurred_at",
  "previous_status", "next_status", "field_changes", "reason",
].join(",");

export class TaskNotFoundError extends Error {
  constructor(message = "Task not found.") {
    super(message);
    this.name = "TaskNotFoundError";
    this.code = "NOT_FOUND";
    this.status = 404;
  }
}

export function createTaskService(client, actor, options = {}) {
  const profileClient = options.profileClient || client;

  return {
    actor,
    async isFeatureEnabled() {
      const { data, error } = await client.rpc("task_domain_enabled");
      if (error) throw error;
      return data === true;
    },

    async listTasks(filters, pagination, { assignedToCaller = false } = {}) {
      let query = client
        .from("tasks")
        .select(TASK_SELECT, { count: "exact" })
        .order("updated_at", { ascending: false })
        .range(pagination.from, pagination.to);

      if (assignedToCaller) query = query.eq("assigned_user_id", actor.userId).neq("status", "DRAFT");
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.priority) query = query.eq("priority", filters.priority);
      if (filters.sourceType) query = query.eq("source_type", filters.sourceType);
      if (filters.assignedUserId) query = query.eq("assigned_user_id", filters.assignedUserId);
      if (filters.reviewerUserId) query = query.eq("reviewer_user_id", filters.reviewerUserId);
      if (filters.scheduledDate) query = query.eq("scheduled_date", filters.scheduledDate);
      if (filters.deadlineFrom) query = query.gte("submission_deadline", filters.deadlineFrom);
      if (filters.deadlineTo) query = query.lte("submission_deadline", filters.deadlineTo);
      if (filters.archived === true) query = query.not("archived_at", "is", null);
      if (filters.archived === false) query = query.is("archived_at", null);
      if (filters.search) query = query.ilike("title", `%${filters.search}%`);

      const { data, error, count } = await query;
      if (error) throw error;
      const rows = data || [];
      const context = await loadTaskContexts(client, actor, rows.map((row) => row.id));
      const userMap = await loadUserProfiles(profileClient, collectTaskUserIds(rows));
      return {
        tasks: rows.map((row) => projectTask(row, actor, {
          ...context.get(row.id),
          assignedUser: userMap.get(row.assigned_user_id),
          reviewerUser: userMap.get(row.reviewer_user_id),
        })),
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: count || 0,
      };
    },

    async getTask(taskId) {
      const row = await readTask(client, taskId);
      const [timeResult, submissionResult, eventResult] = await Promise.all([
        client.from("task_time_entries").select(TIME_SELECT).eq("task_id", taskId).order("started_at"),
        client.from("task_submissions").select(SUBMISSION_SELECT).eq("task_id", taskId).order("cycle_number"),
        client.from("task_events").select(EVENT_SELECT).eq("task_id", taskId).order("occurred_at"),
      ]);
      throwIfError(timeResult.error);
      throwIfError(submissionResult.error);
      throwIfError(eventResult.error);

      const entries = timeResult.data || [];
      const events = eventResult.data || [];
      const createdByUserId = actor.role === "staff"
        ? null
        : events.find((event) => event.event_type === "TASK_CREATED")?.actor_user_id || null;
      const submissions = submissionResult.data || [];
      const userMap = await loadUserProfiles(profileClient, collectDetailUserIds(row, submissions, entries));
      const context = {
        ...buildTaskContext(entries, createdByUserId),
        assignedUser: userMap.get(row.assigned_user_id),
        reviewerUser: userMap.get(row.reviewer_user_id),
      };
      return {
        task: projectTask(row, actor, context),
        submissions: submissions.map((submission) => projectSubmission(submission, entries, userMap)),
        timeEntries: entries.map(projectTimeEntry),
        history: events.map((event) => projectEvent(event, actor)),
      };
    },

    async getHistory(taskId, pagination) {
      await readTask(client, taskId);
      const { data, error, count } = await client
        .from("task_events")
        .select(EVENT_SELECT, { count: "exact" })
        .eq("task_id", taskId)
        .order("occurred_at", { ascending: false })
        .range(pagination.from, pagination.to);
      if (error) throw error;
      return {
        events: (data || []).map((event) => projectEvent(event, actor)),
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: count || 0,
      };
    },

    async getTimeEntries(taskId) {
      await readTask(client, taskId);
      const { data, error } = await client
        .from("task_time_entries")
        .select(TIME_SELECT)
        .eq("task_id", taskId)
        .order("started_at");
      if (error) throw error;
      const entries = data || [];
      return {
        entries: entries.map(projectTimeEntry),
        openTimeEntry: entries.find((entry) => entry.ended_at === null) ? projectTimeEntry(entries.find((entry) => entry.ended_at === null)) : null,
        totalClosedDurationSeconds: calculateClosedDurationSeconds(entries),
      };
    },

    async execute(command, args, taskId = null) {
      let rpcResult;
      try {
        rpcResult = await client.rpc(command, args);
      } catch (error) {
        throw await addCurrentVersion(client, taskId, error);
      }
      if (rpcResult.error) throw await addCurrentVersion(client, taskId, rpcResult.error);

      const result = rpcResult.data || {};
      const resolvedTaskId = taskId || result.id;
      if (!resolvedTaskId) throw new Error("Task command did not return a task identifier.");
      const detail = await this.getTask(resolvedTaskId);
      const latestSubmission = detail.submissions.at(-1) || null;
      return {
        ...detail,
        allowedActions: detail.task.allowedActions,
        serverTime: result.serverTime || new Date().toISOString(),
        openTimeEntry: detail.task.openTimeEntry,
        totalClosedDurationSeconds: detail.task.totalClosedDurationSeconds,
        submission: latestSubmission,
        replayed: result.replayed === true,
        currentVersion: detail.task.version,
      };
    },
  };
}

async function readTask(client, taskId) {
  const { data, error } = await client.from("tasks").select(TASK_SELECT).eq("id", taskId).maybeSingle();
  if (error) throw error;
  if (!data) throw new TaskNotFoundError();
  return data;
}

async function loadTaskContexts(client, actor, taskIds) {
  const contexts = new Map();
  if (!taskIds.length) return contexts;
  const timeResult = await client.from("task_time_entries").select(TIME_SELECT).in("task_id", taskIds);
  if (timeResult.error) throw timeResult.error;

  const creators = new Map();
  if (actor.role !== "staff") {
    const eventResult = await client
      .from("task_events")
      .select("task_id,actor_user_id")
      .in("task_id", taskIds)
      .eq("event_type", "TASK_CREATED");
    if (eventResult.error) throw eventResult.error;
    for (const event of eventResult.data || []) creators.set(event.task_id, event.actor_user_id);
  }

  for (const taskId of taskIds) {
    const entries = (timeResult.data || []).filter((entry) => entry.task_id === taskId);
    contexts.set(taskId, buildTaskContext(entries, creators.get(taskId) || null));
  }
  return contexts;
}

function buildTaskContext(entries, createdByUserId) {
  return {
    openTimeEntry: entries.find((entry) => entry.ended_at === null) || null,
    totalClosedDurationSeconds: calculateClosedDurationSeconds(entries),
    hasTimeEntries: entries.length > 0,
    createdByUserId,
  };
}

async function addCurrentVersion(client, taskId, error) {
  if (!taskId || error?.code !== "40001") return error;
  const result = await client.from("tasks").select("version").eq("id", taskId).maybeSingle();
  if (!result.error && result.data) error.currentVersion = result.data.version;
  return error;
}

function throwIfError(error) {
  if (error) throw error;
}

function collectTaskUserIds(rows) {
  const ids = new Set();
  for (const row of rows || []) {
    if (row.assigned_user_id) ids.add(row.assigned_user_id);
    if (row.reviewer_user_id) ids.add(row.reviewer_user_id);
  }
  return [...ids];
}

function collectDetailUserIds(task, submissions, entries) {
  const ids = new Set(collectTaskUserIds([task]));
  for (const submission of submissions || []) {
    if (submission.submitted_by_user_id) ids.add(submission.submitted_by_user_id);
    if (submission.reviewer_user_id) ids.add(submission.reviewer_user_id);
  }
  for (const entry of entries || []) {
    if (entry.user_id) ids.add(entry.user_id);
  }
  return [...ids];
}

async function loadUserProfiles(client, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  const { data, error } = await client
    .from("admin_users")
    .select("user_id,display_name,role,is_active")
    .in("user_id", ids);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.user_id, row]));
}