import assert from "node:assert/strict";
import { Readable } from "node:stream";
import taskAutomationHandler from "../api/task-automation.js";

const ACTION_ACTOR = {
  id: "admin-row",
  user_id: "98000000-0000-4000-8000-000000000002",
  email: "admin@trry.test",
  display_name: "Operations",
  role: "admin",
  access_role_key: "admin_operations",
  is_active: true,
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("Send-state requires admin bearer auth", async () => {
  const result = await invokeInbox("GET", "/api/inbox/c/send-state", null, {
    supabase: createMockSupabase(),
  }, { auth: false });
  assert.equal(result.status, 401);
});

test("Send-state requires Inbox module access", async () => {
  const result = await invokeInbox("GET", "/api/inbox/c/send-state", null, {
    supabase: createMockSupabase({ moduleAccess: false }),
  });
  assert.equal(result.status, 403);
});

test("Send-state returns only safe status fields", async () => {
  const supabase = createMockSupabase({ sendRows: [{ status: "unknown", created_at: "2026-08-27T00:00:00Z" }] });
  const result = await invokeInbox("GET", "/api/inbox/99000000-0000-4000-8000-000000000001/send-state", null, { supabase });

  assert.equal(result.status, 200);
  assert.deepEqual(result.json, { ok: true, status: "unknown" });
  assert.deepEqual(supabase.rpcCalls, []);
  assert.deepEqual(supabase.selectsByTable.inbox_outbound_attempts, ["status,created_at"]);
  assert.equal(result.body.includes("body_hash"), false);
  assert.equal(result.body.includes("external_message_id"), false);
  assert.equal(result.body.includes("recipientPsid"), false);
  assert.equal(result.body.includes("pageAccessToken"), false);
  assert.equal(result.body.includes("META_PAGE_ACCESS_TOKEN"), false);
  assert.equal(result.body.includes("raw"), false);
});

test("Send-state does not send, retry, or create attempts", async () => {
  const result = await invokeInbox("GET", "/api/inbox/c/send-state", null, {
    supabase: createMockSupabase({ sendRows: [{ status: "sent", created_at: "2026-08-27T00:00:00Z" }] }),
    fetchImpl: async () => {
      throw new Error("send-state must not call Meta");
    },
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.json, { ok: true, status: "sent" });
});

for (const { name, fn } of tests) {
  await fn();
  console.log(`PASS ${name}`);
}
console.log("PASS Facebook Inbox F6 send-state action API contract");

async function invokeInbox(method, url, body, dependencies, options = {}) {
  const raw = body ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0);
  const request = Readable.from(raw);
  request.method = method;
  request.url = url;
  request.headers = { accept: "application/json" };
  if (body) request.headers["content-type"] = "application/json";
  if (options.auth !== false) request.headers.authorization = "Bearer synthetic-token";
  const response = createResponse();
  await taskAutomationHandler(request, response, dependencies);
  return response.result();
}

function createMockSupabase({ moduleAccess = true, conversationVisible = true, sendRows = [] } = {}) {
  const rpcCalls = [];
  const selectsByTable = {};
  return {
    auth: {
      async getUser() {
        return { data: { user: { id: ACTION_ACTOR.user_id, email: ACTION_ACTOR.email } }, error: null };
      },
    },
    from(table) {
      if (table === "admin_users") return selectBuilder(table, [ACTION_ACTOR], selectsByTable);
      if (table === "admin_role_module_permissions") return selectBuilder(table, moduleAccess ? [{ can_access: true }] : [{ can_access: false }], selectsByTable);
      if (table === "admin_temporary_module_grants") return selectBuilder(table, [], selectsByTable);
      if (table === "inbox_conversations") return selectBuilder(table, conversationVisible ? [{ id: "99000000-0000-4000-8000-000000000001" }] : [], selectsByTable);
      if (table === "inbox_outbound_attempts") return selectBuilder(table, sendRows, selectsByTable);
      return selectBuilder(table, [], selectsByTable);
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return { data: {}, error: null };
    },
    rpcCalls,
    selectsByTable,
  };
}

function selectBuilder(table, rows, selectsByTable) {
  return {
    select(value) {
      selectsByTable[table] ||= [];
      selectsByTable[table].push(value);
      return this;
    },
    eq() { return this; },
    in() { return this; },
    is() { return this; },
    lte() { return this; },
    gt() { return this; },
    order() { return this; },
    limit() { return this; },
    async maybeSingle() { return { data: rows[0] || null, error: null }; },
    then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
  };
}

function createResponse() {
  const headers = {};
  let body = "";
  return {
    statusCode: 200,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    end(value = "") {
      body += value;
    },
    result() {
      return { status: this.statusCode, headers, body, json: body ? JSON.parse(body) : null };
    },
  };
}
