import assert from "node:assert/strict";
import { createTaskService } from "../api/_lib/taskService.js";

const OWNER = { userId: "00000000-0000-4000-8000-000000000001", role: "owner", isActive: true };
const STAFF = { userId: "00000000-0000-4000-8000-000000000003", role: "staff", isActive: true };
const TASK_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_TASK_ID = "10000000-0000-4000-8000-000000000002";

const rows = {
  tasks: [
    taskRow({ id: TASK_ID, status: "IN_PROGRESS", assigned_user_id: STAFF.userId }),
    taskRow({ id: OTHER_TASK_ID, status: "DRAFT", assigned_user_id: STAFF.userId }),
  ],
  task_time_entries: [{
    id: "20000000-0000-4000-8000-000000000001",
    task_id: TASK_ID,
    user_id: STAFF.userId,
    cycle_number: 1,
    started_at: "2026-07-25T08:00:00.000Z",
    ended_at: null,
    close_reason: null,
    corrected_at: null,
    created_at: "2026-07-25T08:00:00.000Z",
    updated_at: "2026-07-25T08:00:00.000Z",
  }],
  task_submissions: [{
    id: "40000000-0000-4000-8000-000000000001",
    task_id: TASK_ID,
    cycle_number: 2,
    submitted_by_user_id: STAFF.userId,
    submission_note: "Synthetic no-time submission.",
    proof_url: null,
    submitted_at: "2026-07-25T09:00:00.000Z",
    time_recording_status: "NOT_RECORDED",
    no_time_reason: "Synthetic forgot-to-start reason.",
    reviewer_user_id: null,
    review_decision: "PENDING",
    review_note: null,
    reviewed_at: null,
    created_at: "2026-07-25T09:00:00.000Z",
    updated_at: "2026-07-25T09:00:00.000Z",
  }],
  admin_users: [
    { user_id: STAFF.userId, display_name: "Synthetic Staff", role: "staff", is_active: true },
    { user_id: OWNER.userId, display_name: "Synthetic Owner", role: "owner", is_active: true, email: "must-not-leak@example.com" },
  ],
  task_events: [{
    id: "30000000-0000-4000-8000-000000000001",
    task_id: TASK_ID,
    event_type: "TASK_CREATED",
    actor_user_id: OWNER.userId,
    actor_role: "owner",
    occurred_at: "2026-07-25T07:00:00.000Z",
    previous_status: null,
    next_status: "DRAFT",
    field_changes: { _requestFingerprint: "must-not-leak" },
    reason: null,
  }],
};

async function run() {
const staffClient = new FakeSupabase(rows);
const staffService = createTaskService(staffClient, STAFF);
assert.equal(await staffService.isFeatureEnabled(), true);
const mine = await staffService.listTasks({}, { page: 1, pageSize: 25, from: 0, to: 24 }, { assignedToCaller: true });
assert.equal(mine.tasks.length, 1);
assert.equal(mine.tasks[0].id, TASK_ID);
assert.equal(mine.tasks[0].allowedActions.includes("SUBMIT_FOR_REVIEW"), true);
assert.equal(staffClient.queries.some((query) => query.table === "tasks" && hasFilter(query, "eq", "assigned_user_id", STAFF.userId)), true);
assert.equal(staffClient.queries.some((query) => query.table === "tasks" && hasFilter(query, "neq", "status", "DRAFT")), true);

const staffDetail = await staffService.getTask(TASK_ID);
assert.equal(staffDetail.history[0].actorUserId, undefined);
assert.equal(JSON.stringify(staffDetail).includes("_requestFingerprint"), false);
assert.equal(staffDetail.task.timeTrackingMode, "EXPECTED");
assert.equal(staffDetail.task.assignedUser.displayName, "Synthetic Staff");
assert.equal(staffDetail.task.reviewerUser.displayName, "Synthetic Owner");
assert.equal(JSON.stringify(staffDetail).includes("must-not-leak@example.com"), false);
assert.equal(staffDetail.submissions[0].timeRecordingStatus, "NOT_RECORDED");
assert.equal(staffDetail.submissions[0].noTimeReason, "Synthetic forgot-to-start reason.");
assert.equal(staffDetail.submissions[0].recordedDurationSeconds, null);

const ownerClient = new FakeSupabase(rows);
ownerClient.rpcResults.set("task_assign", {
  data: { id: TASK_ID, replayed: true, serverTime: "2026-07-25T10:00:00.000Z" },
  error: null,
});
const ownerService = createTaskService(ownerClient, OWNER);
const command = await ownerService.execute("task_assign", {
  p_task_id: TASK_ID,
  p_expected_version: 1,
  p_assigned_user_id: STAFF.userId,
  p_idempotency_key: "service-replay",
}, TASK_ID);
assert.equal(command.replayed, true);
assert.equal(command.task.id, TASK_ID);
assert.equal(ownerClient.rpcCalls.at(-1).name, "task_assign");

const conflictClient = new FakeSupabase(rows);
conflictClient.rpcResults.set("task_assign", {
  data: null,
  error: Object.assign(new Error("version conflict"), { code: "40001" }),
});
const conflictService = createTaskService(conflictClient, OWNER);
await assert.rejects(
  () => conflictService.execute("task_assign", {
    p_task_id: TASK_ID,
    p_expected_version: 0,
    p_assigned_user_id: STAFF.userId,
    p_idempotency_key: "service-stale",
  }, TASK_ID),
  (error) => error.code === "40001" && error.currentVersion === 1,
);

assert.equal(ownerClient.queries.some((query) => query.table === "admin_users"), true);
process.stdout.write("PASS caller-scoped task service queries, safe user projections, RPC forwarding, replay, and conflict metadata\n");
}

class FakeSupabase {
  constructor(tableRows) {
    this.rows = structuredClone(tableRows);
    this.queries = [];
    this.rpcCalls = [];
    this.rpcResults = new Map([["task_domain_enabled", { data: true, error: null }]]);
  }

  from(table) {
    const query = new FakeQuery(this, table);
    this.queries.push(query);
    return query;
  }

  async rpc(name, args = {}) {
    this.rpcCalls.push({ name, args });
    return this.rpcResults.get(name) || { data: null, error: null };
  }
}

class FakeQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.filters = [];
    this.slice = null;
    this.countRequested = false;
    this.single = false;
  }

  select(_columns, options = {}) {
    this.countRequested = options.count === "exact";
    return this;
  }

  eq(column, value) { this.filters.push(["eq", column, value]); return this; }
  neq(column, value) { this.filters.push(["neq", column, value]); return this; }
  gte(column, value) { this.filters.push(["gte", column, value]); return this; }
  lte(column, value) { this.filters.push(["lte", column, value]); return this; }
  ilike(column, value) { this.filters.push(["ilike", column, value]); return this; }
  in(column, value) { this.filters.push(["in", column, value]); return this; }
  is(column, value) { this.filters.push(["is", column, value]); return this; }
  not(column, operator, value) { this.filters.push(["not", column, operator, value]); return this; }
  order() { return this; }
  range(from, to) { this.slice = [from, to]; return this; }

  async maybeSingle() {
    const result = this.result();
    return { data: result.data[0] || null, error: result.error };
  }

  then(resolve, reject) {
    return Promise.resolve(this.result()).then(resolve, reject);
  }

  result() {
    let data = structuredClone(this.client.rows[this.table] || []);
    for (const filter of this.filters) data = data.filter((row) => matches(row, filter));
    const count = data.length;
    if (this.slice) data = data.slice(this.slice[0], this.slice[1] + 1);
    return { data, error: null, count: this.countRequested ? count : null };
  }
}

function matches(row, [operator, column, value, extra]) {
  if (operator === "eq") return row[column] === value;
  if (operator === "neq") return row[column] !== value;
  if (operator === "gte") return row[column] >= value;
  if (operator === "lte") return row[column] <= value;
  if (operator === "in") return value.includes(row[column]);
  if (operator === "is") return row[column] === value;
  if (operator === "not" && value === null && extra === undefined) return row[column] !== null;
  if (operator === "not" && extra === null) return row[column] !== null;
  if (operator === "ilike") return String(row[column] || "").toLowerCase().includes(String(value).replaceAll("%", "").toLowerCase());
  return true;
}

function hasFilter(query, operator, column, value) {
  return query.filters.some((filter) => filter[0] === operator && filter[1] === column && filter[2] === value);
}

function taskRow(overrides = {}) {
  return {
    id: TASK_ID,
    task_code: "TSK-000001",
    title: "Synthetic task",
    brief: "Synthetic brief.",
    source_type: "MANUAL",
    source_record_type: null,
    source_record_id: null,
    status: "TO_DO",
    priority: "MEDIUM",
    time_tracking_mode: "EXPECTED",
    assigned_user_id: STAFF.userId,
    reviewer_user_id: OWNER.userId,
    draft_approval_required: false,
    scheduled_date: null,
    start_deadline: null,
    submission_deadline: null,
    approval_deadline: null,
    version: 1,
    completed_at: null,
    cancelled_at: null,
    archived_at: null,
    created_at: "2026-07-25T07:00:00.000Z",
    updated_at: "2026-07-25T07:00:00.000Z",
    ...overrides,
  };
}

await run();
