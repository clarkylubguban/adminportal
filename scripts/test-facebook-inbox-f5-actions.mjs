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

test("Convert route requires admin bearer auth", async () => {
  const result = await invokeInbox("POST", "/api/inbox/c/convert-to-inquiry", { idempotencyKey: "idem-convert-api" }, {
    supabase: createMockSupabase(),
  }, { auth: false });
  assert.equal(result.status, 401);
});

test("Convert route requires Inbox module access and protected action permission", async () => {
  const noModule = await invokeInbox("POST", "/api/inbox/c/convert-to-inquiry", { idempotencyKey: "idem-convert-api" }, {
    supabase: createMockSupabase({ moduleAccess: false }),
  });
  assert.equal(noModule.status, 403);

  const noAction = await invokeInbox("POST", "/api/inbox/c/convert-to-inquiry", { idempotencyKey: "idem-convert-api" }, {
    supabase: createMockSupabase({ convertPermission: false }),
  });
  assert.equal(noAction.status, 403);
  assert.equal(noAction.json.error, "INBOX_CONVERT_TO_INQUIRY_DENIED");
});

test("Convert route calls F5 RPC and returns Inquiry, conversation, and replay flag", async () => {
  const supabase = createMockSupabase();
  const result = await invokeInbox("POST", "/api/inbox/99000000-0000-4000-8000-000000000001/convert-to-inquiry", {
    idempotencyKey: "idem-convert-api-success",
  }, { supabase });

  assert.equal(result.status, 200);
  assert.equal(result.json.ok, true);
  assert.equal(result.json.inquiry.id, "TRY-20260827010101");
  assert.equal(result.json.conversation.state, "converted");
  assert.equal(result.json.replay, false);
  assert.deepEqual(supabase.rpcCalls, [{
    name: "convert_inbox_conversation_to_inquiry",
    args: {
      p_conversation_id: "99000000-0000-4000-8000-000000000001",
      p_actor_user_id: ACTION_ACTOR.user_id,
      p_idempotency_key: "idem-convert-api-success",
    },
  }]);
});

test("Convert route maps missing conversation to 404", async () => {
  const result = await invokeInbox("POST", "/api/inbox/missing/convert-to-inquiry", { idempotencyKey: "idem-missing-api" }, {
    supabase: createMockSupabase({ convertResult: { ok: false, error: "CONVERSATION_NOT_FOUND" } }),
  });
  assert.equal(result.status, 404);
});

for (const { name, fn } of tests) {
  await fn();
  console.log(`PASS ${name}`);
}
console.log("PASS Facebook Inbox F5 convert action API contract");

async function invokeInbox(method, url, body, dependencies, options = {}) {
  const raw = Buffer.from(JSON.stringify(body || {}));
  const request = Readable.from(raw);
  request.method = method;
  request.url = url;
  request.headers = { "content-type": "application/json" };
  if (options.auth !== false) request.headers.authorization = "Bearer synthetic-token";
  const response = createResponse();
  await taskAutomationHandler(request, response, dependencies);
  return response.result();
}

function createMockSupabase({ moduleAccess = true, convertPermission = true, convertResult = null } = {}) {
  const rpcCalls = [];
  return {
    auth: {
      async getUser() {
        return { data: { user: { id: ACTION_ACTOR.user_id, email: ACTION_ACTOR.email } }, error: null };
      },
    },
    from(table) {
      if (table === "admin_users") return selectBuilder([ACTION_ACTOR]);
      if (table === "admin_role_module_permissions") return selectBuilder(moduleAccess ? [{ can_access: true }] : [{ can_access: false }]);
      if (table === "admin_role_action_permissions") return selectBuilder(convertPermission ? [{ can_perform: true }] : [{ can_perform: false }]);
      if (table === "admin_temporary_module_grants") return selectBuilder([]);
      return selectBuilder([]);
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return {
        data: convertResult || {
          ok: true,
          replay: false,
          inquiry: { id: "TRY-20260827010101", source: "FB", channel: "Facebook Messenger" },
          conversation: { id: args.p_conversation_id, state: "converted" },
        },
        error: null,
      };
    },
    rpcCalls,
  };
}

function selectBuilder(rows) {
  return {
    select() { return this; },
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
