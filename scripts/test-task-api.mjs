import assert from "node:assert/strict";
import { authenticateTaskRequest, mapTaskError } from "../api/_lib/taskApi.js";
import { calculateAllowedActions, projectEvent, projectTask } from "../api/_lib/taskProjection.js";
import {
  handleApproveDraft,
  handleApproveAndAssign,
  handleApproveWork,
  handleArchive,
  handleAssign,
  handleCancel,
  handleCorrectTimeEntry,
  handleMyTasks,
  handleReopen,
  handleRequestRevision,
  handleStartRevision,
  handleStartWork,
  handleSubmit,
  handleSubmitWithoutTime,
  handleTaskCollection,
  handleTaskDetail,
  handleTaskHistory,
  handleTaskTimeEntries,
  handleUpdateDraft,
} from "../api/_lib/taskRouteHandlers.js";

const IDS = {
  owner: "00000000-0000-4000-8000-000000000001",
  admin: "00000000-0000-4000-8000-000000000002",
  staff: "00000000-0000-4000-8000-000000000003",
  staff2: "00000000-0000-4000-8000-000000000004",
  task: "10000000-0000-4000-8000-000000000001",
  task2: "10000000-0000-4000-8000-000000000002",
  entry: "20000000-0000-4000-8000-000000000001",
};
const ACTORS = {
  owner: { userId: IDS.owner, role: "owner", isActive: true },
  admin: { userId: IDS.admin, role: "admin", isActive: true },
  staff: { userId: IDS.staff, role: "staff", isActive: true },
  staff2: { userId: IDS.staff2, role: "staff", isActive: true },
};
const tests = [];

test("feature flag blocks reads before records are queried", async () => {
  let queried = false;
  const service = {
    isFeatureEnabled: async () => false,
    listTasks: async () => { queried = true; return {}; },
  };
  const result = await invoke(handleTaskCollection, ACTORS.owner, service, { method: "GET", url: "/api/tasks" });
  assert.equal(result.status, 503);
  assert.equal(result.body.error.code, "FEATURE_DISABLED");
  assert.equal(queried, false);
});

test("missing, invalid, inactive, and unauthorized accounts are distinguished safely", async () => {
  const missing = await invoke(handleMyTasks, null, null, { method: "GET", url: "/api/my-tasks", dependencies: {} });
  assert.equal(missing.status, 401);
  assert.equal(missing.body.error.code, "AUTH_REQUIRED");

  await assert.rejects(
    () => authenticateTaskRequest(authRequest(), { authClient: authClientFixture({ authError: true }) }),
    (error) => error.code === "AUTH_REQUIRED",
  );
  await assert.rejects(
    () => authenticateTaskRequest(authRequest(), { authClient: authClientFixture({ account: { user_id: IDS.staff, role: "staff", is_active: false } }) }),
    (error) => error.code === "ACCOUNT_INACTIVE",
  );
  await assert.rejects(
    () => authenticateTaskRequest(authRequest(), { authClient: authClientFixture({ account: null }) }),
    (error) => error.code === "FORBIDDEN",
  );
});

test("authentication derives actor identity and role server-side", async () => {
  const callerClient = {};
  const context = await authenticateTaskRequest(authRequest(), {
    authClient: authClientFixture({ account: { user_id: IDS.admin, role: "ADMIN", is_active: true } }),
    callerClient,
  });
  assert.deepEqual(context.actor, ACTORS.admin);
  assert.equal(context.callerClient, callerClient);
});

test("manager list is denied to staff and My Tasks forces caller scope", async () => {
  const domain = new MemoryDomain();
  const denied = await invoke(handleTaskCollection, ACTORS.staff, domain.service(ACTORS.staff), { method: "GET", url: "/api/tasks" });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "FORBIDDEN");

  const scopedService = domain.service(ACTORS.staff);
  const mine = await invoke(handleMyTasks, ACTORS.staff, scopedService, { method: "GET", url: "/api/my-tasks?status=TO_DO" });
  assert.equal(mine.status, 200);
  assert.equal(scopedService.lastListOptions.assignedToCaller, true);
  const spoofed = await invoke(handleMyTasks, ACTORS.staff, scopedService, {
    method: "GET",
    url: `/api/my-tasks?assignedUserId=${IDS.staff2}`,
    query: { assignedUserId: IDS.staff2 },
  });
  assert.equal(spoofed.status, 400);
});

test("strict validation rejects unknown fields, malformed values, and missing command controls", async () => {
  const domain = new MemoryDomain();
  const ownerService = domain.service(ACTORS.owner);
  const base = {
    method: "POST",
    url: "/api/tasks",
    headers: { "idempotency-key": "validation-create" },
    body: createBody(),
  };
  const unknown = await invoke(handleTaskCollection, ACTORS.owner, ownerService, {
    ...base,
    body: { ...base.body, actorRole: "owner" },
  });
  assert.equal(unknown.body.error.code, "VALIDATION_ERROR");

  const badSource = await invoke(handleTaskCollection, ACTORS.owner, ownerService, {
    ...base,
    headers: { "idempotency-key": "validation-source" },
    body: { ...base.body, sourceType: "CALENDAR" },
  });
  assert.equal(badSource.status, 400);

  const noKey = await invoke(handleTaskCollection, ACTORS.owner, ownerService, { ...base, headers: {} });
  assert.equal(noKey.status, 400);

  const noVersion = await invoke(handleStartWork, ACTORS.staff, domain.service(ACTORS.staff), {
    method: "POST",
    url: `/api/tasks/${IDS.task}/start`,
    query: { id: IDS.task },
    headers: { "idempotency-key": "validation-version" },
    body: {},
  });
  assert.equal(noVersion.body.error.code, "VALIDATION_ERROR");

  const badProof = await invoke(handleSubmit, ACTORS.staff, domain.service(ACTORS.staff), {
    method: "POST",
    url: `/api/tasks/${IDS.task}/submit`,
    query: { id: IDS.task },
    headers: { "idempotency-key": "validation-proof" },
    body: { expectedVersion: 1, submissionNote: "Synthetic proof.", proofUrl: "http://invalid.example" },
  });
  assert.equal(badProof.status, 400);

  const badTime = await invoke(handleCorrectTimeEntry, ACTORS.owner, ownerService, {
    method: "POST",
    url: `/api/tasks/${IDS.task}/time-entries/${IDS.entry}/correct`,
    query: { id: IDS.task, entryId: IDS.entry },
    headers: { "idempotency-key": "validation-time" },
    body: { expectedVersion: 1, startedAt: "2026-07-25T12:00:00Z", endedAt: "2026-07-25T11:00:00Z", reason: "Synthetic correction." },
  });
  assert.equal(badTime.status, 400);
});

test("full create-to-archive lifecycle executes through route handlers", async () => {
  const domain = new MemoryDomain();
  const created = await invoke(handleTaskCollection, ACTORS.owner, domain.service(ACTORS.owner), {
    method: "POST",
    url: "/api/tasks",
    headers: { "idempotency-key": "life-create" },
    body: createBody(),
  });
  assertOk(created);
  const taskId = created.body.task.id;
  let version = created.body.currentVersion;

  version = resultVersion(await action(handleUpdateDraft, ACTORS.owner, domain, taskId, "draft", version, {
    title: "Synthetic revised task",
  }, "PATCH"));
  version = resultVersion(await action(handleAssign, ACTORS.owner, domain, taskId, "assign", version, {
    assignedUserId: IDS.staff,
  }));
  version = resultVersion(await action(handleApproveDraft, ACTORS.owner, domain, taskId, "approve-draft", version));
  version = resultVersion(await action(handleStartWork, ACTORS.staff, domain, taskId, "start", version));
  version = resultVersion(await action(handleSubmit, ACTORS.staff, domain, taskId, "submit", version, {
    submissionNote: "Synthetic cycle one.",
    proofUrl: "https://invalid.example/proof-one",
  }));
  version = resultVersion(await action(handleRequestRevision, ACTORS.admin, domain, taskId, "request-revision", version, {
    reviewNote: "Synthetic revision request.",
  }));
  version = resultVersion(await action(handleStartRevision, ACTORS.staff, domain, taskId, "start-revision", version));
  version = resultVersion(await action(handleSubmit, ACTORS.staff, domain, taskId, "submit", version, {
    submissionNote: "Synthetic cycle two.",
    proofUrl: "https://invalid.example/proof-two",
  }, "life-submit-2"));
  version = resultVersion(await action(handleApproveWork, ACTORS.admin, domain, taskId, "approve", version, {
    reviewNote: "Synthetic approval.",
  }));
  const archived = await action(handleArchive, ACTORS.owner, domain, taskId, "archive", version);
  assertOk(archived);
  assert.equal(archived.body.task.status, "DONE");
  assert.ok(archived.body.task.archivedAt);
  assert.equal(domain.submissions.length, 2);
  assert.equal(domain.events.filter((event) => event.eventType === "SUBMITTED").length, 2);
});

test("cancel and reopen paths preserve role boundaries", async () => {
  const domain = new MemoryDomain();
  const task = domain.seedTask({ status: "TO_DO", assignedUserId: IDS.staff, reviewerUserId: IDS.admin });
  const staffCancel = await action(handleCancel, ACTORS.staff, domain, task.id, "cancel", task.version, { reason: "Not permitted." });
  assert.equal(staffCancel.status, 403);

  const cancelled = await action(handleCancel, ACTORS.owner, domain, task.id, "cancel", task.version, { reason: "Synthetic cancellation." }, "cancel-owner");
  assertOk(cancelled);
  const reopened = await action(handleReopen, ACTORS.owner, domain, task.id, "reopen", cancelled.body.currentVersion, { reason: "Synthetic reopen." });
  assertOk(reopened);
  assert.equal(reopened.body.task.status, "TO_DO");
});

test("admin and staff mutation boundaries remain separated", async () => {
  const domain = new MemoryDomain();
  const aiDraft = domain.seedTask({ sourceType: "AI_MARKETING", draftApprovalRequired: true });
  const adminApproval = await action(handleApproveDraft, ACTORS.admin, domain, aiDraft.id, "approve-draft", aiDraft.version);
  assert.equal(adminApproval.status, 403);

  const reviewTask = domain.seedTask({
    status: "FOR_REVIEW",
    assignedUserId: IDS.staff,
    reviewerUserId: IDS.owner,
  });
  const nonReviewer = await action(handleApproveWork, ACTORS.admin, domain, reviewTask.id, "approve", reviewTask.version, {});
  assert.equal(nonReviewer.status, 403);

  const managerStart = domain.seedTask({ status: "TO_DO", assignedUserId: IDS.staff });
  const ownerStart = await action(handleStartWork, ACTORS.owner, domain, managerStart.id, "start", managerStart.version);
  assert.equal(ownerStart.status, 403);

  const manual = domain.seedTask({
    sourceType: "MANUAL",
    createdByUserId: IDS.admin,
    reviewerUserId: IDS.admin,
    assignedUserId: IDS.staff,
    draftApprovalRequired: false,
  });
  const adminApproved = await action(handleApproveDraft, ACTORS.admin, domain, manual.id, "approve-draft", manual.version);
  assertOk(adminApproved);
});

test("approve-and-assign atomically activates permitted drafts", async () => {
  const domain = new MemoryDomain();
  const manual = domain.seedTask({
    sourceType: "PRODUCTION",
    assignedUserId: null,
    reviewerUserId: null,
    draftApprovalRequired: false,
  });
  const initialVersion = manual.version;
  const approved = await invoke(handleApproveAndAssign, ACTORS.admin, domain.service(ACTORS.admin), {
    method: "POST",
    url: `/api/tasks/${manual.id}/approve-and-assign`,
    query: { id: manual.id },
    headers: { "idempotency-key": "approve-assign-production" },
    body: {
      expectedVersion: initialVersion,
      assignedUserId: IDS.staff,
      reviewerUserId: IDS.admin,
      submissionDeadline: "2026-07-26T08:00:00Z",
    },
  });
  assertOk(approved);
  assert.equal(approved.body.task.status, "TO_DO");
  assert.equal(approved.body.task.assignedUserId, IDS.staff);
  assert.equal(approved.body.task.reviewerUserId, IDS.admin);
  assert.equal(domain.events.filter((event) => event.eventType === "DRAFT_APPROVED").length, 1);
  assert.equal(domain.events.filter((event) => event.eventType === "ASSIGNED").length, 0);

  const replay = await invoke(handleApproveAndAssign, ACTORS.admin, domain.service(ACTORS.admin), {
    method: "POST",
    url: `/api/tasks/${manual.id}/approve-and-assign`,
    query: { id: manual.id },
    headers: { "idempotency-key": "approve-assign-production" },
    body: {
      expectedVersion: initialVersion,
      assignedUserId: IDS.staff,
      reviewerUserId: IDS.admin,
      submissionDeadline: "2026-07-26T08:00:00Z",
    },
  });
  assertOk(replay);
  assert.equal(replay.body.replayed, true);
  assert.equal(domain.events.filter((event) => event.eventType === "DRAFT_APPROVED").length, 1);
});

test("approve-and-assign denies staff, stale versions, missing reviewer, and AI activation by admin", async () => {
  const domain = new MemoryDomain();
  const aiDraft = domain.seedTask({
    sourceType: "DAILY_CONTENT",
    assignedUserId: null,
    reviewerUserId: null,
    draftApprovalRequired: true,
  });
  const adminDenied = await invoke(handleApproveAndAssign, ACTORS.admin, domain.service(ACTORS.admin), {
    method: "POST",
    url: `/api/tasks/${aiDraft.id}/approve-and-assign`,
    query: { id: aiDraft.id },
    headers: { "idempotency-key": "approve-assign-ai-admin" },
    body: { expectedVersion: aiDraft.version, assignedUserId: IDS.staff, reviewerUserId: IDS.admin },
  });
  assert.equal(adminDenied.status, 403);

  const staffDenied = await invoke(handleApproveAndAssign, ACTORS.staff, domain.service(ACTORS.staff), {
    method: "POST",
    url: `/api/tasks/${aiDraft.id}/approve-and-assign`,
    query: { id: aiDraft.id },
    headers: { "idempotency-key": "approve-assign-ai-staff" },
    body: { expectedVersion: aiDraft.version, assignedUserId: IDS.staff, reviewerUserId: IDS.admin },
  });
  assert.equal(staffDenied.status, 403);

  const missingReviewer = await invoke(handleApproveAndAssign, ACTORS.owner, domain.service(ACTORS.owner), {
    method: "POST",
    url: `/api/tasks/${aiDraft.id}/approve-and-assign`,
    query: { id: aiDraft.id },
    headers: { "idempotency-key": "approve-assign-missing-reviewer" },
    body: { expectedVersion: aiDraft.version, assignedUserId: IDS.staff },
  });
  assert.equal(missingReviewer.status, 400);

  const stale = await invoke(handleApproveAndAssign, ACTORS.owner, domain.service(ACTORS.owner), {
    method: "POST",
    url: `/api/tasks/${aiDraft.id}/approve-and-assign`,
    query: { id: aiDraft.id },
    headers: { "idempotency-key": "approve-assign-stale" },
    body: { expectedVersion: aiDraft.version + 1, assignedUserId: IDS.staff, reviewerUserId: IDS.owner },
  });
  assert.equal(stale.body.error.code, "VERSION_CONFLICT");

  const ownerApproved = await invoke(handleApproveAndAssign, ACTORS.owner, domain.service(ACTORS.owner), {
    method: "POST",
    url: `/api/tasks/${aiDraft.id}/approve-and-assign`,
    query: { id: aiDraft.id },
    headers: { "idempotency-key": "approve-assign-ai-owner" },
    body: { expectedVersion: aiDraft.version, assignedUserId: IDS.staff, reviewerUserId: IDS.owner },
  });
  assertOk(ownerApproved);
  assert.equal(ownerApproved.body.task.status, "TO_DO");
});

test("time correction is owner-only and preserves open/closed shape", async () => {
  const domain = new MemoryDomain();
  const task = domain.seedTask({ status: "DONE", assignedUserId: IDS.staff });
  domain.timeEntries.push({
    id: IDS.entry,
    taskId: task.id,
    userId: IDS.staff,
    startedAt: "2026-07-25T08:00:00.000Z",
    endedAt: "2026-07-25T09:00:00.000Z",
  });
  const staffDenied = await correct(ACTORS.staff, domain, task);
  assert.equal(staffDenied.status, 403);
  const ownerCorrected = await correct(ACTORS.owner, domain, task);
  assertOk(ownerCorrected);
});

test("replays are explicit, conflicting keys fail, and stale versions are canonical", async () => {
  const domain = new MemoryDomain();
  const task = domain.seedTask({ status: "TO_DO", assignedUserId: IDS.staff });
  const initialVersion = task.version;
  const first = await action(handleStartWork, ACTORS.staff, domain, task.id, "start", initialVersion, {}, "replay-start");
  assertOk(first);
  const replay = await action(handleStartWork, ACTORS.staff, domain, task.id, "start", initialVersion, {}, "replay-start");
  assertOk(replay);
  assert.equal(replay.body.replayed, true);
  assert.equal(domain.events.filter((event) => event.eventType === "STARTED").length, 1);

  const conflict = await action(handleSubmit, ACTORS.staff, domain, task.id, "submit", first.body.currentVersion, {
    submissionNote: "Different command.",
  }, "replay-start");
  assert.equal(conflict.body.error.code, "IDEMPOTENCY_CONFLICT");

  const stale = await action(handleSubmit, ACTORS.staff, domain, task.id, "submit", 1, {
    submissionNote: "Stale command.",
  }, "stale-submit");
  assert.equal(stale.body.error.code, "VERSION_CONFLICT");
  assert.equal(stale.body.error.details.currentVersion, first.body.currentVersion);
});

test("same key cannot mutate different tasks and simultaneous stale commands have one winner", async () => {
  const domain = new MemoryDomain();
  const firstTask = domain.seedTask({ status: "TO_DO", assignedUserId: IDS.staff });
  const secondTask = domain.seedTask({ status: "TO_DO", assignedUserId: IDS.staff }, IDS.task2);
  const first = await action(handleStartWork, ACTORS.staff, domain, firstTask.id, "start", firstTask.version, {}, "global-key");
  assertOk(first);
  const crossTask = await action(handleStartWork, ACTORS.staff, domain, secondTask.id, "start", secondTask.version, {}, "global-key");
  assert.equal(crossTask.body.error.code, "IDEMPOTENCY_CONFLICT");

  const raceTask = domain.seedTask({ status: "TO_DO", assignedUserId: IDS.staff });
  const results = await Promise.all([
    action(handleStartWork, ACTORS.staff, domain, raceTask.id, "start", raceTask.version, {}, "race-a"),
    action(handleStartWork, ACTORS.staff, domain, raceTask.id, "start", raceTask.version, {}, "race-b"),
  ]);
  assert.equal(results.filter((result) => result.status === 200).length, 1);
  assert.equal(results.filter((result) => result.body.error?.code === "VERSION_CONFLICT").length, 1);
});

test("detail, history, and time endpoints return only role-safe projections", async () => {
  const domain = new MemoryDomain();
  const task = domain.seedTask({ status: "TO_DO", assignedUserId: IDS.staff });
  domain.events.push({
    id: "30000000-0000-4000-8000-000000000001",
    taskId: task.id,
    eventType: "ASSIGNED",
    actorUserId: IDS.owner,
    actorRole: "owner",
    occurredAt: "2026-07-25T08:00:00.000Z",
    changes: { assignmentChanged: true },
  });
  const detail = await readAction(handleTaskDetail, ACTORS.staff, domain, task.id);
  const history = await readAction(handleTaskHistory, ACTORS.staff, domain, task.id, "history");
  const time = await readAction(handleTaskTimeEntries, ACTORS.staff, domain, task.id, "time-entries");
  assertOk(detail);
  assertOk(history);
  assertOk(time);
  const serialized = JSON.stringify([detail.body, history.body, time.body]);
  for (const forbidden of ["phone", "paymentReference", "privateNote", "serviceRoleKey", "_requestFingerprint"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("projection strips manager-only deltas and actor metadata from staff history", () => {
  const staffEvent = projectEvent({
    id: "30000000-0000-4000-8000-000000000001",
    task_id: IDS.task,
    event_type: "DRAFT_UPDATED",
    actor_user_id: IDS.owner,
    actor_role: "owner",
    field_changes: {
      titleChanged: true,
      assignmentChanged: true,
      _requestFingerprint: "secret-fingerprint",
    },
  }, ACTORS.staff);
  assert.deepEqual(staffEvent.changes, { assignmentChanged: true });
  assert.equal("actorUserId" in staffEvent, false);
  assert.equal(JSON.stringify(staffEvent).includes("secret-fingerprint"), false);

  const projected = projectTask(taskRow(), ACTORS.staff, {
    openTimeEntry: { id: IDS.entry, task_id: IDS.task, user_id: IDS.staff, cycle_number: 1, started_at: "2026-07-25T08:00:00Z" },
    createdByUserId: IDS.owner,
    hasTimeEntries: true,
  });
  assert.equal(projected.allowedActions.includes("SUBMIT_FOR_REVIEW"), true);
  assert.equal("createdByUserId" in projected, false);
});

test("allowed actions reflect status, assignment, reviewer, and manager scope", () => {
  const base = {
    status: "DRAFT",
    sourceType: "AI_MARKETING",
    timeTrackingMode: "EXPECTED",
    assignedUserId: IDS.staff,
    reviewerUserId: IDS.admin,
    draftApprovalRequired: true,
    createdByUserId: IDS.owner,
    archivedAt: null,
    hasTimeEntries: false,
  };
  assert.deepEqual(
    calculateAllowedActions(base, ACTORS.owner),
    ["EDIT_DRAFT", "ASSIGN", "APPROVE_DRAFT", "APPROVE_AND_ASSIGN", "CANCEL"],
  );
  assert.deepEqual(calculateAllowedActions(base, ACTORS.admin), ["ASSIGN"]);
  assert.deepEqual(
    calculateAllowedActions({ ...base, status: "TO_DO", sourceType: "MANUAL" }, ACTORS.staff),
    ["START_WORK", "SUBMIT_WITHOUT_RECORDED_TIME"],
  );
  assert.deepEqual(
    calculateAllowedActions({ ...base, status: "TO_DO", sourceType: "MANUAL", timeTrackingMode: "NONE" }, ACTORS.staff),
    ["START_WORK", "SUBMIT_FOR_REVIEW"],
  );
  assert.deepEqual(
    calculateAllowedActions({ ...base, status: "FOR_REVIEW" }, ACTORS.admin),
    ["REQUEST_REVISION", "APPROVE_WORK"],
  );
  assert.deepEqual(
    calculateAllowedActions({ ...base, status: "DONE", hasTimeEntries: true }, ACTORS.owner),
    ["REOPEN", "ARCHIVE", "CORRECT_TIME_ENTRY"],
  );
});
test("forgot-to-start API requires reason and preserves no-time semantics", async () => {
  const domain = new MemoryDomain();
  const task = domain.seedTask({ status: "TO_DO", assignedUserId: IDS.staff, timeTrackingMode: "EXPECTED" });
  const missingReason = await action(handleSubmitWithoutTime, ACTORS.staff, domain, task.id, "submit-without-time", task.version, {
    note: "Synthetic completed work.",
  });
  assert.equal(missingReason.status, 400);

  const initialVersion = task.version;
  const submitted = await action(handleSubmitWithoutTime, ACTORS.staff, domain, task.id, "submit-without-time", initialVersion, {
    note: "Synthetic completed work.",
    reason: "Forgot to start timer.",
  }, "fallback-submit");
  assertOk(submitted);
  assert.equal(submitted.body.task.status, "FOR_REVIEW");
  assert.equal(submitted.body.submission.timeRecordingStatus, "NOT_RECORDED");
  assert.equal(submitted.body.submission.noTimeReason, "Forgot to start timer.");
  assert.equal(submitted.body.submission.recordedDurationSeconds, null);
  assert.equal(domain.timeEntries.filter((entry) => entry.taskId === task.id).length, 0);

  const replay = await action(handleSubmitWithoutTime, ACTORS.staff, domain, task.id, "submit-without-time", initialVersion, {
    note: "Synthetic completed work.",
    reason: "Forgot to start timer.",
  }, "fallback-submit");
  assertOk(replay);
  assert.equal(replay.body.replayed, true);
  assert.equal(domain.submissions.filter((submission) => submission.taskId === task.id).length, 1);
  assert.equal(domain.events.filter((event) => event.taskId === task.id && event.eventType === "SUBMITTED_WITHOUT_TIME").length, 1);
});

test("forgot-to-start API rejects non-assignees and unknown fields", async () => {
  const domain = new MemoryDomain();
  const task = domain.seedTask({ status: "TO_DO", assignedUserId: IDS.staff, timeTrackingMode: "EXPECTED" });
  const denied = await action(handleSubmitWithoutTime, ACTORS.staff2, domain, task.id, "submit-without-time", task.version, {
    note: "Synthetic completed work.",
    reason: "Synthetic reason.",
  });
  assert.equal(denied.status, 403);
  const unknown = await invoke(handleSubmitWithoutTime, ACTORS.staff, domain.service(ACTORS.staff), {
    method: "POST",
    url: `/api/tasks/${task.id}/submit-without-time`,
    query: { id: task.id },
    headers: { "idempotency-key": "fallback-unknown" },
    body: { expectedVersion: task.version, note: "Synthetic note.", reason: "Synthetic reason.", duration: 5 },
  });
  assert.equal(unknown.status, 400);
});

test("NONE mode starts without timer and submits without fabricated duration", async () => {
  const domain = new MemoryDomain();
  const todo = domain.seedTask({ status: "TO_DO", assignedUserId: IDS.staff, timeTrackingMode: "NONE" });
  const initialVersion = todo.version;
  const started = await action(handleStartWork, ACTORS.staff, domain, todo.id, "start", initialVersion, undefined, "none-start");
  assertOk(started);
  assert.equal(started.body.task.status, "IN_PROGRESS");
  assert.equal(domain.timeEntries.filter((entry) => entry.taskId === todo.id).length, 0);
  assert.equal(domain.events.filter((event) => event.taskId === todo.id && event.eventType === "STARTED").length, 1);

  const replay = await action(handleStartWork, ACTORS.staff, domain, todo.id, "start", initialVersion, undefined, "none-start");
  assertOk(replay);
  assert.equal(replay.body.replayed, true);
  assert.equal(domain.events.filter((event) => event.taskId === todo.id && event.eventType === "STARTED").length, 1);

  const submitted = await action(handleSubmit, ACTORS.staff, domain, todo.id, "submit", started.body.task.version, {
    submissionNote: "Synthetic checklist complete.",
  }, "none-submit");
  assertOk(submitted);
  assert.equal(submitted.body.submission.timeRecordingStatus, "NOT_REQUIRED");
  assert.equal(submitted.body.submission.recordedDurationSeconds, null);
  assert.equal(domain.timeEntries.filter((entry) => entry.taskId === todo.id).length, 0);

  const revision = domain.seedTask({ status: "NEEDS_REVISION", assignedUserId: IDS.staff, timeTrackingMode: "NONE" });
  const revisionStarted = await action(handleStartRevision, ACTORS.staff, domain, revision.id, "start-revision", revision.version, undefined, "none-revision-start");
  assertOk(revisionStarted);
  assert.equal(revisionStarted.body.task.status, "IN_PROGRESS");
  assert.equal(domain.timeEntries.filter((entry) => entry.taskId === revision.id).length, 0);
  const revisionSubmitted = await action(handleSubmit, ACTORS.staff, domain, revision.id, "submit", revisionStarted.body.task.version, {
    submissionNote: "Synthetic revision complete.",
  }, "none-revision-submit");
  assertOk(revisionSubmitted);
  assert.equal(revisionSubmitted.body.submission.timeRecordingStatus, "NOT_REQUIRED");

  const fallbackTask = domain.seedTask({ status: "TO_DO", assignedUserId: IDS.staff, timeTrackingMode: "NONE" });
  const fallbackDenied = await action(handleSubmitWithoutTime, ACTORS.staff, domain, fallbackTask.id, "submit-without-time", fallbackTask.version, {
    note: "Synthetic note.",
    reason: "Should not be accepted.",
  });
  assert.notEqual(fallbackDenied.status, 200);
});
test("database errors map to stable categories without raw details", () => {
  const mapped = mapTaskError({
    code: "40001",
    message: "sensitive sql relation detail",
    currentVersion: 7,
    stack: "private stack",
  });
  assert.equal(mapped.code, "VERSION_CONFLICT");
  assert.deepEqual(mapped.details, { currentVersion: 7 });
  assert.equal(mapped.message.includes("sql"), false);
});


function test(name, run) {
  tests.push({ name, run });
}

async function invoke(handler, actor, service, options) {
  const request = {
    method: options.method || "GET",
    url: options.url || "/",
    headers: options.headers || {},
    query: options.query || queryFromUrl(options.url || "/"),
    body: options.body,
  };
  const response = responseFixture();
  const dependencies = options.dependencies ?? (
    actor
      ? {
        authenticate: async () => ({ actor }),
        createService: () => service,
      }
      : undefined
  );
  await handler(request, response, dependencies);
  return { status: response.statusCode, body: response.body, headers: response.headers };
}

async function action(handler, actor, domain, taskId, suffix, version, extra = {}, method = "POST", key = null) {
  if (typeof method !== "string" || !["POST", "PATCH"].includes(method)) {
    key = method;
    method = "POST";
  }
  return invoke(handler, actor, domain.service(actor), {
    method,
    url: `/api/tasks/${taskId}/${suffix}`,
    query: { id: taskId },
    headers: { "idempotency-key": key || `life-${suffix}` },
    body: { expectedVersion: version, ...extra },
  });
}

async function readAction(handler, actor, domain, taskId, suffix = "") {
  return invoke(handler, actor, domain.service(actor), {
    method: "GET",
    url: `/api/tasks/${taskId}${suffix ? `/${suffix}` : ""}`,
    query: { id: taskId },
  });
}

async function correct(actor, domain, task) {
  return invoke(handleCorrectTimeEntry, actor, domain.service(actor), {
    method: "POST",
    url: `/api/tasks/${task.id}/time-entries/${IDS.entry}/correct`,
    query: { id: task.id, entryId: IDS.entry },
    headers: { "idempotency-key": `correct-${actor.role}` },
    body: {
      expectedVersion: task.version,
      startedAt: "2026-07-25T08:05:00Z",
      endedAt: "2026-07-25T09:05:00Z",
      reason: "Synthetic correction.",
    },
  });
}

function resultVersion(result) {
  assertOk(result);
  return result.body.currentVersion;
}

function assertOk(result) {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.ok, true);
}

function authRequest() {
  return { headers: { authorization: "Bearer synthetic-token" } };
}

function authClientFixture({ authError = false, account = { user_id: IDS.owner, role: "owner", is_active: true } } = {}) {
  return {
    auth: {
      getUser: async () => authError
        ? { data: null, error: { message: "invalid" } }
        : { data: { user: { id: account?.user_id || IDS.owner } }, error: null },
    },
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: account, error: null }; },
      };
    },
  };
}

function responseFixture() {
  return {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value) { this.body = JSON.parse(value); },
  };
}

function queryFromUrl(url) {
  const parsed = new URL(url, "http://localhost");
  return Object.fromEntries(parsed.searchParams.entries());
}

function createBody() {
  return {
    title: "Synthetic task",
    brief: "Synthetic brief with no live data.",
    sourceType: "MANUAL",
    priority: "MEDIUM",
    assignedUserId: IDS.staff,
    reviewerUserId: IDS.admin,
    draftApprovalRequired: false,
  };
}

function taskRow(overrides = {}) {
  return {
    id: IDS.task,
    task_code: "TSK-000001",
    title: "Synthetic task",
    brief: "Synthetic brief.",
    source_type: "MANUAL",
    source_record_type: null,
    source_record_id: null,
    status: "IN_PROGRESS",
    priority: "MEDIUM",
    assigned_user_id: IDS.staff,
    reviewer_user_id: IDS.admin,
    draft_approval_required: false,
    version: 1,
    ...overrides,
  };
}

class MemoryDomain {
  constructor() {
    this.featureEnabled = true;
    this.tasks = new Map();
    this.events = [];
    this.timeEntries = [];
    this.submissions = [];
    this.idempotency = new Map();
    this.sequence = 10;
  }

  seedTask(overrides = {}, id = null) {
    const task = {
      id: id || `10000000-0000-4000-8000-${String(this.sequence++).padStart(12, "0")}`,
      taskCode: `TSK-${String(this.sequence).padStart(6, "0")}`,
      title: "Synthetic seeded task",
      brief: "Synthetic brief.",
      sourceType: "MANUAL",
      sourceRecordType: null,
      sourceRecordId: null,
      status: "DRAFT",
      priority: "MEDIUM",
      timeTrackingMode: "EXPECTED",
      assignedUserId: IDS.staff,
      reviewerUserId: IDS.admin,
      createdByUserId: IDS.owner,
      draftApprovalRequired: false,
      scheduledDate: null,
      startDeadline: null,
      submissionDeadline: null,
      approvalDeadline: null,
      version: 1,
      completedAt: null,
      cancelledAt: null,
      archivedAt: null,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
      ...overrides,
    };
    this.tasks.set(task.id, task);
    return task;
  }

  service(actor) {
    const domain = this;
    return {
      lastListOptions: null,
      async isFeatureEnabled() { return domain.featureEnabled; },
      async listTasks(_filters, pagination, options = {}) {
        this.lastListOptions = options;
        const visible = [...domain.tasks.values()].filter((task) => domain.canRead(actor, task));
        const scoped = options.assignedToCaller
          ? visible.filter((task) => task.assignedUserId === actor.userId && task.status !== "DRAFT")
          : visible;
        return { tasks: scoped.map(publicTask), page: pagination.page, pageSize: pagination.pageSize, total: scoped.length };
      },
      async getTask(taskId) {
        const task = domain.requireVisible(actor, taskId);
        return {
          task: publicTask(task),
          submissions: domain.submissions.filter((row) => row.taskId === taskId),
          timeEntries: domain.timeEntries.filter((row) => row.taskId === taskId),
          history: domain.events.filter((row) => row.taskId === taskId).map((row) => publicEvent(row, actor)),
        };
      },
      async getHistory(taskId, pagination) {
        domain.requireVisible(actor, taskId);
        const events = domain.events.filter((row) => row.taskId === taskId).map((row) => publicEvent(row, actor));
        return { events, page: pagination.page, pageSize: pagination.pageSize, total: events.length };
      },
      async getTimeEntries(taskId) {
        domain.requireVisible(actor, taskId);
        const entries = domain.timeEntries.filter((row) => row.taskId === taskId);
        return {
          entries,
          openTimeEntry: entries.find((entry) => !entry.endedAt) || null,
          totalClosedDurationSeconds: entries.reduce((total, entry) => total + (entry.endedAt ? 3600 : 0), 0),
        };
      },
      async execute(command, args, taskId = null) {
        return domain.execute(actor, command, args, taskId);
      },
    };
  }

  execute(actor, command, args, taskId) {
    const key = args.p_idempotency_key;
    const fingerprint = JSON.stringify({ command, taskId, args });
    const replay = this.idempotency.get(key);
    if (replay) {
      if (replay.fingerprint !== fingerprint) throw dbError("23505", "idempotency key conflict");
      return this.commandResult(this.tasks.get(replay.taskId), true);
    }

    let task;
    if (command === "task_create") {
      if (!["owner", "admin"].includes(actor.role) || (actor.role === "admin" && args.p_source_type !== "MANUAL")) {
        throw dbError("42501", "create forbidden");
      }
      task = this.seedTask({
        title: args.p_title,
        brief: args.p_brief,
        sourceType: args.p_source_type,
        sourceRecordType: args.p_source_record_type,
        sourceRecordId: args.p_source_record_id,
        priority: args.p_priority,
        timeTrackingMode: args.p_time_tracking_mode || "EXPECTED",
        assignedUserId: args.p_assigned_user_id,
        reviewerUserId: args.p_reviewer_user_id,
        draftApprovalRequired: args.p_draft_approval_required,
        scheduledDate: args.p_scheduled_date,
        startDeadline: args.p_start_deadline,
        submissionDeadline: args.p_submission_deadline,
        approvalDeadline: args.p_approval_deadline,
        createdByUserId: actor.userId,
      });
      this.record(task, "TASK_CREATED", actor);
    } else {
      task = this.tasks.get(taskId);
      if (!task) throw dbError("P0002", "task not found");
      this.requireVersion(task, args.p_expected_version);
      this.applyCommand(actor, command, task, args);
      task.version += 1;
      task.updatedAt = new Date().toISOString();
    }
    this.idempotency.set(key, { fingerprint, taskId: task.id });
    return this.commandResult(task, false);
  }

  applyCommand(actor, command, task, args) {
    const manager = ["owner", "admin"].includes(actor.role);
    if (command === "task_update_draft") {
      if (!manager || (actor.role === "admin" && task.sourceType !== "MANUAL") || task.status !== "DRAFT") throw dbError("42501", "draft update forbidden");
      Object.assign(task, {
        title: args.p_title,
        brief: args.p_brief,
        priority: args.p_priority,
        timeTrackingMode: args.p_time_tracking_mode || "EXPECTED",
        assignedUserId: args.p_assigned_user_id,
        reviewerUserId: args.p_reviewer_user_id,
        draftApprovalRequired: args.p_draft_approval_required,
        scheduledDate: args.p_scheduled_date,
        startDeadline: args.p_start_deadline,
        submissionDeadline: args.p_submission_deadline,
        approvalDeadline: args.p_approval_deadline,
      });
      return this.record(task, "DRAFT_UPDATED", actor);
    }
    if (command === "task_assign") {
      if (!manager) throw dbError("42501", "assignment forbidden");
      task.assignedUserId = args.p_assigned_user_id;
      return this.record(task, "ASSIGNED", actor);
    }
    if (command === "task_approve_draft") {
      const adminAllowed = actor.role === "admin" && task.sourceType === "MANUAL" && !task.draftApprovalRequired;
      if (task.status !== "DRAFT" || !(actor.role === "owner" || adminAllowed)) throw dbError("42501", "approval forbidden");
      task.status = "TO_DO";
      return this.record(task, "DRAFT_APPROVED", actor);
    }
    if (command === "task_approve_and_assign") {
      const adminAllowed = actor.role === "admin"
        && ["MANUAL", "PRODUCTION", "SHOP_TASK"].includes(task.sourceType)
        && !task.draftApprovalRequired;
      if (task.status !== "DRAFT" || !(actor.role === "owner" || adminAllowed)) throw dbError("42501", "approval forbidden");
      if (!this.isEligibleAssignee(args.p_assigned_user_id)) throw dbError("42501", "target user cannot be assigned");
      if (!this.isEligibleReviewer(args.p_reviewer_user_id)) throw dbError("42501", "reviewer cannot approve");
      task.assignedUserId = args.p_assigned_user_id;
      task.reviewerUserId = args.p_reviewer_user_id;
      task.startDeadline = args.p_start_deadline || task.startDeadline;
      task.submissionDeadline = args.p_submission_deadline || task.submissionDeadline;
      task.approvalDeadline = args.p_approval_deadline || task.approvalDeadline;
      task.status = "TO_DO";
      return this.record(task, "DRAFT_APPROVED", actor);
    }
    if (command === "task_start_work") {
      if (task.status !== "TO_DO" || task.assignedUserId !== actor.userId) throw dbError("42501", "only assignee may start task");
      if (!["EXPECTED", "NONE"].includes(task.timeTrackingMode)) throw dbError("55000", "invalid time tracking mode");
      task.status = "IN_PROGRESS";
      if (task.timeTrackingMode === "EXPECTED") {
        this.timeEntries.push({
          id: IDS.entry,
          taskId: task.id,
          userId: actor.userId,
          cycleNumber: this.submissions.filter((row) => row.taskId === task.id).length + 1,
          startedAt: new Date().toISOString(),
          endedAt: null,
        });
      }
      return this.record(task, "STARTED", actor);
    }
    if (command === "task_submit_for_review") {
      if (task.assignedUserId !== actor.userId) throw dbError("42501", "only assignee may submit");
      const entry = this.timeEntries.find((row) => row.taskId === task.id && !row.endedAt);
      let cycleNumber;
      let timeRecordingStatus;
      if (task.timeTrackingMode === "EXPECTED") {
        if (task.status !== "IN_PROGRESS" || !entry) throw dbError("55000", "open timer required");
        entry.endedAt = new Date().toISOString();
        cycleNumber = entry.cycleNumber;
        timeRecordingStatus = "RECORDED";
      } else {
        if (!["TO_DO", "IN_PROGRESS", "NEEDS_REVISION"].includes(task.status) || entry) throw dbError("55000", "invalid no-time task state");
        cycleNumber = nextCycle(this, task.id);
        timeRecordingStatus = "NOT_REQUIRED";
      }
      task.status = "FOR_REVIEW";
      this.submissions.push({
        id: `40000000-0000-4000-8000-${String(this.submissions.length + 1).padStart(12, "0")}`,
        taskId: task.id,
        cycleNumber,
        submissionNote: args.p_submission_note,
        proofUrl: args.p_proof_url,
        timeRecordingStatus,
        noTimeReason: null,
        recordedDurationSeconds: timeRecordingStatus === "RECORDED" ? 1 : null,
      });
      return this.record(task, "SUBMITTED", actor);
    }
    if (command === "task_submit_without_time") {
      const entry = this.timeEntries.find((row) => row.taskId === task.id && !row.endedAt);
      if (task.timeTrackingMode !== "EXPECTED" || !["TO_DO", "NEEDS_REVISION"].includes(task.status) || entry) {
        throw dbError("55000", "no-time fallback is unavailable");
      }
      if (task.assignedUserId !== actor.userId) throw dbError("42501", "only assignee may submit");
      task.status = "FOR_REVIEW";
      this.submissions.push({
        id: `40000000-0000-4000-8000-${String(this.submissions.length + 1).padStart(12, "0")}`,
        taskId: task.id,
        cycleNumber: nextCycle(this, task.id),
        submissionNote: args.p_submission_note,
        proofUrl: null,
        timeRecordingStatus: "NOT_RECORDED",
        noTimeReason: args.p_no_time_reason,
        recordedDurationSeconds: null,
      });
      return this.record(task, "SUBMITTED_WITHOUT_TIME", actor);
    }    if (command === "task_request_revision") {
      if (task.status !== "FOR_REVIEW" || !(actor.role === "owner" || (actor.role === "admin" && task.reviewerUserId === actor.userId))) {
        throw dbError("42501", "review forbidden");
      }
      task.status = "NEEDS_REVISION";
      return this.record(task, "REVISION_REQUESTED", actor);
    }
    if (command === "task_start_revision") {
      if (task.status !== "NEEDS_REVISION" || task.assignedUserId !== actor.userId) throw dbError("42501", "only assignee may revise task");
      if (!["EXPECTED", "NONE"].includes(task.timeTrackingMode)) throw dbError("55000", "invalid time tracking mode");
      task.status = "IN_PROGRESS";
      if (task.timeTrackingMode === "EXPECTED") {
        this.timeEntries.push({
          id: `20000000-0000-4000-8000-${String(this.timeEntries.length + 1).padStart(12, "0")}`,
          taskId: task.id,
          userId: actor.userId,
          cycleNumber: this.submissions.filter((row) => row.taskId === task.id).length + 1,
          startedAt: new Date().toISOString(),
          endedAt: null,
        });
      }
      return this.record(task, "REVISION_STARTED", actor);
    }
    if (command === "task_approve_work") {
      if (task.status !== "FOR_REVIEW" || !(actor.role === "owner" || (actor.role === "admin" && task.reviewerUserId === actor.userId))) {
        throw dbError("42501", "review forbidden");
      }
      task.status = "DONE";
      task.completedAt = new Date().toISOString();
      this.record(task, "WORK_APPROVED", actor);
      return this.record(task, "COMPLETED", actor);
    }
    if (command === "task_cancel") {
      const adminAllowed = actor.role === "admin"
        && task.sourceType === "MANUAL"
        && [task.createdByUserId, task.reviewerUserId].includes(actor.userId);
      if (!(actor.role === "owner" || adminAllowed)) throw dbError("42501", "cancel forbidden");
      task.status = "CANCELLED";
      task.cancelledAt = new Date().toISOString();
      return this.record(task, "CANCELLED", actor);
    }
    if (command === "task_reopen") {
      if (actor.role !== "owner") throw dbError("42501", "reopen forbidden");
      task.status = "TO_DO";
      task.completedAt = null;
      task.cancelledAt = null;
      task.archivedAt = null;
      return this.record(task, "REOPENED", actor);
    }
    if (command === "task_archive") {
      const adminAllowed = actor.role === "admin"
        && task.sourceType === "MANUAL"
        && [task.createdByUserId, task.reviewerUserId].includes(actor.userId);
      if (!(actor.role === "owner" || adminAllowed)) throw dbError("42501", "archive forbidden");
      task.archivedAt = new Date().toISOString();
      return this.record(task, "ARCHIVED", actor);
    }
    if (command === "task_correct_time_entry") {
      if (actor.role !== "owner") throw dbError("42501", "time correction forbidden");
      const entry = this.timeEntries.find((row) => row.id === args.p_time_entry_id && row.taskId === task.id);
      if (!entry) throw dbError("P0002", "time entry not found");
      entry.startedAt = args.p_started_at;
      entry.endedAt = args.p_ended_at;
      return this.record(task, "TIME_ENTRY_CORRECTED", actor);
    }
    throw new Error(`Unsupported command ${command}`);
  }

  commandResult(task, replayed) {
    return {
      task: publicTask(task),
      allowedActions: [],
      serverTime: new Date().toISOString(),
      openTimeEntry: this.timeEntries.find((row) => row.taskId === task.id && !row.endedAt) || null,
      totalClosedDurationSeconds: 0,
      submission: this.submissions.filter((row) => row.taskId === task.id).at(-1) || null,
      replayed,
      currentVersion: task.version,
    };
  }

  requireVersion(task, expected) {
    if (task.version !== expected) {
      const error = dbError("40001", "task version conflict");
      error.currentVersion = task.version;
      throw error;
    }
  }

  isEligibleAssignee(userId) {
    return [IDS.staff, IDS.admin, IDS.owner].includes(userId);
  }

  isEligibleReviewer(userId) {
    return [IDS.admin, IDS.owner].includes(userId);
  }

  record(task, eventType, actor) {
    this.events.push({
      id: `30000000-0000-4000-8000-${String(this.events.length + 1).padStart(12, "0")}`,
      taskId: task.id,
      eventType,
      actorUserId: actor.userId,
      actorRole: actor.role,
      occurredAt: new Date().toISOString(),
      changes: {},
    });
  }

  canRead(actor, task) {
    return ["owner", "admin"].includes(actor.role)
      || (actor.role === "staff" && task.assignedUserId === actor.userId && task.status !== "DRAFT");
  }

  requireVisible(actor, taskId) {
    const task = this.tasks.get(taskId);
    if (!task || !this.canRead(actor, task)) throw dbError("P0002", "task not found");
    return task;
  }
}

function publicTask(task) {
  const { createdByUserId: _createdByUserId, ...safe } = task;
  return { ...safe, allowedActions: [], openTimeEntry: null, totalClosedDurationSeconds: 0 };
}

function publicEvent(event, actor) {
  const safe = {
    id: event.id,
    taskId: event.taskId,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    changes: event.changes || {},
  };
  if (actor.role !== "staff") {
    safe.actorUserId = event.actorUserId;
    safe.actorRole = event.actorRole;
  }
  return safe;
}

function nextCycle(domain, taskId) {
  const cycles = [
    ...domain.timeEntries.filter((row) => row.taskId === taskId).map((row) => row.cycleNumber),
    ...domain.submissions.filter((row) => row.taskId === taskId).map((row) => row.cycleNumber),
  ];
  return Math.max(0, ...cycles) + 1;
}
function dbError(code, message) {
  return Object.assign(new Error(message), { code });
}

for (const { name, run } of tests) {
  try {
    await run();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${name}\n${error.stack || error}\n`);
    process.exitCode = 1;
  }
}
if (!process.exitCode) process.stdout.write(`PASS ${tests.length} task API suites\n`);
