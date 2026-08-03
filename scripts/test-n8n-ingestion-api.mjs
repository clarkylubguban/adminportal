import assert from "node:assert/strict";
import { Readable } from "node:stream";
import {
  handleN8nTaskDrafts,
  hashCanonicalPayload,
  signN8nBody,
} from "../api/_lib/n8nTaskIngestion.js";

const SECRET = "phase-8-3-synthetic-secret-at-least-32-characters";
const NOW = new Date("2026-08-03T03:40:00.000Z");
const BASE = {
  provider: "n8n",
  workflowName: "Synthetic Task Planner",
  externalExecutionId: "exec-phase-8-3-001",
  planningRequestId: "96000000-0000-4000-8000-000000000001",
  requestTimestamp: "2026-08-03T03:39:30.000Z",
  requestExpiresAt: "2026-08-03T03:44:30.000Z",
  idempotencyKey: "phase-8-3-valid",
  taskDrafts: [
    {
      externalTaskId: "draft-001",
      sourceType: "AI_MARKETING",
      title: "Synthetic campaign draft",
      brief: "Disposable Phase 8.3 automation draft.",
      priority: "MEDIUM",
      scheduledDate: "2026-08-04",
      suggestedAssignee: { label: "Suggested Staff", reason: "Capacity hint only" },
    },
    {
      externalTaskId: "draft-002",
      sourceType: "DAILY_CONTENT",
      title: "Synthetic content draft",
      brief: "Disposable Phase 8.3 content draft.",
    },
  ],
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("valid signed requests are accepted and forwarded to the service-role RPC", async () => {
  const calls = [];
  const result = await invoke(BASE, {
    client: fakeClient(calls, { receiptId: "97000000-0000-4000-8000-000000000001", tasksCreated: 2, taskIds: ["t1", "t2"] }),
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.tasksCreated, 2);
  assert.equal(calls[0].name, "task_ingest_n8n_drafts");
  assert.equal(calls[0].args.p_task_drafts[0].assignedUserId, undefined);
});

test("missing and invalid signatures are rejected before database access", async () => {
  const calls = [];
  const missing = await invoke(BASE, { client: fakeClient(calls), omitSignature: true });
  assert.equal(missing.status, 401);
  const invalid = await invoke(BASE, { client: fakeClient(calls), signature: "sha256=" + "0".repeat(64) });
  assert.equal(invalid.status, 401);
  assert.equal(calls.length, 0);
});

test("expired and excessively future-dated timestamps are rejected", async () => {
  const expired = await invoke({ ...BASE, requestExpiresAt: "2026-08-03T03:39:59.000Z" });
  assert.equal(expired.status, 401);
  assert.equal(expired.body.error.code, "REQUEST_EXPIRED");

  const future = await invoke({ ...BASE, requestTimestamp: "2026-08-03T03:45:00.000Z", requestExpiresAt: "2026-08-03T03:49:00.000Z" });
  assert.equal(future.status, 401);
  assert.equal(future.body.error.code, "REQUEST_NOT_YET_VALID");
});

test("payload hashes and idempotency headers must match the signed body", async () => {
  const badHash = await invoke({ ...BASE, payloadHash: "a".repeat(64) }, { preHashed: true });
  assert.equal(badHash.status, 400);
  assert.equal(badHash.body.error.code, "PAYLOAD_HASH_MISMATCH");

  const badKey = await invoke(BASE, { idempotencyHeader: "different-key" });
  assert.equal(badKey.status, 400);
  assert.equal(badKey.body.error.code, "IDEMPOTENCY_REQUIRED");
});

test("invalid source types, assignment attempts, status attempts, and duplicate task ids are rejected", async () => {
  const manual = await invoke(withDraft({ sourceType: "MANUAL" }));
  assert.equal(manual.status, 400);

  const assigned = await invoke(withDraft({ assignedUserId: "96000000-0000-4000-8000-000000000099" }));
  assert.equal(assigned.status, 400);
  assert.deepEqual(assigned.body.error.details.fields, ["assignedUserId"]);

  const status = await invoke(withDraft({ status: "DONE" }));
  assert.equal(status.status, 400);

  const duplicate = await invoke({
    ...BASE,
    taskDrafts: [BASE.taskDrafts[0], { ...BASE.taskDrafts[1], externalTaskId: "draft-001" }],
  });
  assert.equal(duplicate.status, 400);
});

test("maximum task, title, brief, and payload-size limits are enforced", async () => {
  const tooMany = await invoke({ ...BASE, taskDrafts: [0, 1, 2, 3].map((item) => ({ ...BASE.taskDrafts[0], externalTaskId: `draft-${item}` })) });
  assert.equal(tooMany.status, 400);

  const longTitle = await invoke(withDraft({ title: "x".repeat(201) }));
  assert.equal(longTitle.status, 400);

  const longBrief = await invoke(withDraft({ brief: "x".repeat(10001) }));
  assert.equal(longBrief.status, 400);

  const payload = signPayload(BASE);
  const tooLarge = await invokeRaw(payload.raw, payload.headers, { limits: { maxPayloadBytes: 20, maxTasks: 3, maxTitleLength: 200, maxBriefLength: 10000 } });
  assert.equal(tooLarge.status, 413);
});

test("database replay, conflict, and planning-state responses are mapped safely", async () => {
  const replay = await invoke(BASE, {
    client: fakeClient([], { receiptId: "r1", tasksCreated: 2, taskIds: ["t1"], replayed: true, status: "REPLAYED" }),
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);

  const conflict = await invoke(BASE, { client: fakeErrorClient({ code: "23505", message: "duplicate key value" }) });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, "IDEMPOTENCY_CONFLICT");

  const state = await invoke(BASE, { client: fakeErrorClient({ code: "55000", message: "planning request is not awaiting automation" }) });
  assert.equal(state.status, 409);
  assert.equal(state.body.error.code, "INVALID_PLANNING_STATE");
});

test("public, admin, and staff bearer callers cannot bypass integration authentication", async () => {
  for (const token of ["", "Bearer synthetic-admin", "Bearer synthetic-staff"]) {
    const result = await invoke(BASE, { extraHeaders: token ? { authorization: token } : {}, omitSignature: true });
    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, "SIGNATURE_INVALID");
  }
});

for (const { name, fn } of tests) {
  await fn();
  console.log(`PASS ${name}`);
}
console.log(`PASS ${tests.length} n8n ingestion API suites`);

function withDraft(patch) {
  return { ...BASE, taskDrafts: [{ ...BASE.taskDrafts[0], ...patch }] };
}

function signPayload(body, options = {}) {
  const prepared = { ...body };
  if (!options.preHashed) prepared.payloadHash = hashCanonicalPayload({ ...prepared, payloadHash: undefined });
  const raw = Buffer.from(JSON.stringify(prepared), "utf8");
  const headers = {
    "content-type": "application/json",
    "x-trry-request-timestamp": prepared.requestTimestamp,
    "x-trry-request-expires-at": prepared.requestExpiresAt,
    "idempotency-key": options.idempotencyHeader || prepared.idempotencyKey,
    "x-trry-signature": options.omitSignature
      ? undefined
      : options.signature || signN8nBody(raw, { secret: SECRET, timestamp: prepared.requestTimestamp, expiresAt: prepared.requestExpiresAt }),
    ...options.extraHeaders,
  };
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) delete headers[key];
  }
  return { raw, headers };
}

async function invoke(body, options = {}) {
  const payload = signPayload(body, options);
  return invokeRaw(payload.raw, payload.headers, options);
}

async function invokeRaw(raw, headers, options = {}) {
  const request = Readable.from([raw]);
  request.method = "POST";
  request.url = "/api/integrations/n8n/task-drafts";
  request.headers = headers;
  const response = createResponse();
  await handleN8nTaskDrafts(request, response, {
    secret: SECRET,
    now: NOW,
    client: options.client || fakeClient([]),
    limits: options.limits,
  });
  return response.result();
}

function fakeClient(calls = [], data = { receiptId: "r1", planningRequestId: BASE.planningRequestId, tasksCreated: 2, taskIds: ["t1", "t2"], replayed: false, status: "COMPLETED" }) {
  return {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data, error: null };
    },
  };
}

function fakeErrorClient(error) {
  return {
    async rpc() {
      return { data: null, error };
    },
  };
}

function createResponse() {
  const headers = {};
  return {
    statusCode: 200,
    body: undefined,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    end(value) {
      this.body = value;
      return this;
    },
    result() {
      return { status: this.statusCode, headers, body: typeof this.body === "string" ? JSON.parse(this.body) : this.body };
    },
  };
}
