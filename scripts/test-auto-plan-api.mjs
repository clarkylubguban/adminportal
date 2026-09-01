import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handleAutoPlanToday, parseAutoPlanBody } from "../api/_lib/autoPlanToday.js";

const OWNER = { userId: "96000000-0000-4000-8000-000000000001", role: "owner", isActive: true };
const ADMIN = { userId: "96000000-0000-4000-8000-000000000002", role: "admin", isActive: true };
const STAFF = { userId: "96000000-0000-4000-8000-000000000003", role: "staff", isActive: true };

assert.equal(parseAutoPlanBody({ quickDirection: "  Plan content today  " }).quickDirection, "Plan content today");
assert.equal(parseAutoPlanBody({}).quickDirection, "");
assert.throws(() => parseAutoPlanBody({ quickDirection: "<script>" }), /raw HTML/);
assert.throws(() => parseAutoPlanBody({ quickDirection: "ok", maximumTasks: 10 }), /may not choose/);
assert.throws(() => parseAutoPlanBody({ quickDirection: "ok", n8nEndpoint: "https://example.com" }), /may not choose/);
assert.throws(() => parseAutoPlanBody({ quickDirection: "ok", requestedBy: OWNER.userId }), /may not choose/);

const unauthenticated = await invoke({ actor: null });
assert.equal(unauthenticated.status, 401);
assert.equal(unauthenticated.body.error.code, "AUTH_REQUIRED");

for (const actor of [ADMIN, STAFF]) {
  const denied = await invoke({ actor });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "FORBIDDEN");
}

const disabled = await invoke({ actor: OWNER, config: { enabled: false, endpointUrl: "http://127.0.0.1:9/plan" } });
assert.equal(disabled.status, 503);
assert.equal(disabled.body.error.code, "FEATURE_DISABLED");

const missingEndpoint = await invoke({ actor: OWNER, config: { enabled: true, endpointUrl: "" } });
assert.equal(missingEndpoint.status, 503);
assert.equal(missingEndpoint.body.error.code, "INTEGRATION_UNAVAILABLE");

const calls = [];
const okSupabase = fakeSupabase({ calls, taskCount: 2 });
const sent = [];
const success = await invoke({
  actor: OWNER,
  supabase: okSupabase,
  body: { quickDirection: "  content for uniforms  " },
  fetch: async (url, init) => {
    sent.push({ url, init, body: JSON.parse(init.body) });
    return { ok: true, status: 202 };
  },
});
assert.equal(success.status, 202);
assert.equal(success.body.ok, true);
assert.equal(success.body.draftsReceived, 2);
assert.equal(success.body.request.quickDirection, "content for uniforms");
assert.equal(calls.find((call) => call.table === "planning_requests" && call.action === "insert").row.requested_by_user_id, OWNER.userId);
assert.equal(calls.find((call) => call.table === "planning_requests" && call.action === "insert").row.maximum_tasks, 3);
assert.equal(sent[0].body.maximumTasks, 3);
assert.equal(sent[0].body.context.businessContext.productionCapacitySnapshot.source, "public.tasks status counts only");
assert.deepEqual(sent[0].body.context.businessContext.priorityServices, []);
assert.equal(JSON.stringify(sent[0].body).includes("synthetic-secret"), false);
assert.equal(JSON.stringify(sent[0].body).includes("N8N_AUTO_PLAN_TODAY_TOKEN"), false);
assert.equal(JSON.stringify(sent[0].body).includes("customerName"), false);

const duplicateCalls = [];
const duplicate = await invoke({
  actor: OWNER,
  supabase: fakeSupabase({ calls: duplicateCalls, duplicateInsert: true, taskCount: 2 }),
  fetch: async () => { throw new Error("duplicate planning requests must not redispatch"); },
});
assert.equal(duplicate.status, 202);
assert.equal(duplicate.body.replayed, true);
assert.equal(duplicateCalls.some((call) => call.action === "insert"), true);
assert.equal(duplicateCalls.some((call) => call.action === "update"), false);

const failedCalls = [];
const failed = await invoke({
  actor: OWNER,
  supabase: fakeSupabase({ calls: failedCalls, taskCount: 0 }),
  fetch: async () => ({ ok: false, status: 503 }),
});
assert.equal(failed.status, 502);
assert.equal(failed.body.error.code, "DISPATCH_FAILED");
assert.ok(failedCalls.some((call) => call.table === "planning_requests" && call.action === "update"));

console.log("PASS Auto Plan Today API, owner boundary, context, dispatch, and idempotency suites");

async function invoke(options = {}) {
  const request = Readable.from([JSON.stringify(options.body || { quickDirection: "Synthetic direction" })]);
  request.method = "POST";
  request.url = "/api/planning/auto-plan-today";
  request.headers = { "idempotency-key": options.idempotencyKey || "phase-8-7-key", authorization: "Bearer synthetic" };
  const response = createResponse();
  await handleAutoPlanToday(request, response, {
    actor: options.actor,
    supabase: options.supabase || fakeSupabase({ calls: [] }),
    readBody: async () => options.body || { quickDirection: "Synthetic direction" },
    config: {
      enabled: true,
      endpointUrl: "http://127.0.0.1:9999/plan",
      integrationToken: "",
      timeoutMs: 1000,
      ...options.config,
    },
    skipDatabaseFeatureGate: options.skipDatabaseFeatureGate ?? false,
    fetch: options.fetch || (async () => ({ ok: true, status: 202 })),
    now: new Date("2026-08-03T08:00:00.000Z"),
  });
  return response.result();
}

function fakeSupabase({ calls, duplicateInsert = false, taskCount = 0 }) {
  let planning = {
    id: "96000000-0000-4000-8000-000000000087",
    request_code: "PLN-SYNTHETIC123456",
    requested_by_user_id: OWNER.userId,
    quick_direction: "Synthetic direction",
    maximum_tasks: 3,
    status: "REQUESTED",
    requested_at: "2026-08-03T08:00:00.000Z",
    completed_at: null,
  };
  return {
    auth: {
      async getUser() {
        return { data: { user: null }, error: { message: "synthetic unauthenticated" } };
      },
    },
    async rpc(name) {
      calls.push({ action: "rpc", name });
      return { data: true, error: null };
    },
    from(table) {
      const state = { table, values: {}, row: null };
      const builder = {
        select() { state.action = state.action || "select"; return builder; },
        insert(row) { state.action = "insert"; state.row = row; calls.push({ table, action: "insert", row }); return builder; },
        update(row) { state.action = "update"; state.row = row; calls.push({ table, action: "update", row }); return builder; },
        eq(key, value) { state.values[key] = value; return builder; },
        in(key, value) { state.values[key] = value; return builder; },
        is(key, value) { state.values[key] = value; return builder; },
        async single() {
          if (table === "planning_requests" && state.action === "insert" && duplicateInsert) return { data: null, error: { code: "23505", message: "duplicate" } };
          if (table === "planning_requests") {
            planning = { ...planning, ...state.row, id: planning.id, requested_at: planning.requested_at };
            return { data: planning, error: null };
          }
          return { data: null, error: null };
        },
        async maybeSingle() {
          if (table === "task_feature_flags") return { data: { enabled: true }, error: null };
          if (table === "planning_requests") return { data: planning, error: null };
          return { data: null, error: null };
        },
        then(resolve) {
          if (table === "tasks") {
            const rows = Array.from({ length: taskCount }, (_, index) => ({
              id: `96000000-0000-4000-8000-00000000009${index}`,
              status: "DRAFT",
              assigned_user_id: null,
              source_type: index % 2 ? "DAILY_CONTENT" : "AI_MARKETING",
            }));
            return Promise.resolve({ data: rows, error: null }).then(resolve);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
}

function createResponse() {
  const headers = {};
  return {
    statusCode: 200,
    body: undefined,
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    end(value) { this.body = value; },
    result() { return { status: this.statusCode, headers, body: typeof this.body === "string" ? JSON.parse(this.body) : this.body }; },
  };
}
