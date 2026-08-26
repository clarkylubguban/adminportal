import assert from "node:assert/strict";
import { Readable } from "node:stream";
import taskAutomationHandler from "../api/task-automation.js";
import { cleanReplyText, sendMetaTextMessage } from "../api/_lib/metaSend.js";

const ACTION_ACTOR = {
  id: "admin-row",
  user_id: "98000000-0000-4000-8000-000000000003",
  email: "cashier@trry.test",
  display_name: "Cashier",
  role: "staff",
  access_role_key: "cashier_front_desk",
  is_active: true,
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("Meta Send uses Graph endpoint, Bearer auth, RESPONSE, and no query token", async () => {
  const calls = [];
  const result = await sendMetaTextMessage({
    pageId: "PAGE-F4",
    recipientPsid: "PSID-F4",
    text: "  Hello customer  ",
    env: metaEnv(),
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return jsonResponse(200, { message_id: "MID-F4-SENT" });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0].url, "https://graph.facebook.com/v23.0/PAGE-F4/messages");
  assert.equal(new URL(calls[0].url).searchParams.has("access_token"), false);
  assert.equal(calls[0].init.headers.Authorization, "Bearer server-only-page-token");
  assert.equal(calls[0].body.recipient.id, "PSID-F4");
  assert.equal(calls[0].body.messaging_type, "RESPONSE");
  assert.equal(calls[0].body.message.text, "Hello customer");
});

test("Meta Send blocks missing token, wrong page, empty text, long text, timeout, and clear Meta error", async () => {
  assert.equal((await sendMetaTextMessage({ pageId: "PAGE-F4", recipientPsid: "PSID", text: "Hi", env: { META_GRAPH_API_VERSION: "v23.0", META_PAGE_ID: "PAGE-F4" } })).status, 503);
  assert.equal((await sendMetaTextMessage({ pageId: "OTHER", recipientPsid: "PSID", text: "Hi", env: metaEnv() })).errorCode, "META_PAGE_MISMATCH");
  assert.equal(cleanReplyText("").errorCode, "REPLY_TEXT_REQUIRED");
  assert.equal(cleanReplyText("x".repeat(2001)).errorCode, "REPLY_TEXT_TOO_LONG");

  const timeout = await sendMetaTextMessage({
    pageId: "PAGE-F4",
    recipientPsid: "PSID",
    text: "Hi",
    env: { ...metaEnv(), META_SEND_TIMEOUT_MS: "1" },
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
  });
  assert.equal(timeout.unknown, true);
  assert.equal(timeout.errorCode, "META_SEND_TIMEOUT");

  const failed = await sendMetaTextMessage({
    pageId: "PAGE-F4",
    recipientPsid: "PSID",
    text: "Hi",
    env: metaEnv(),
    fetchImpl: async () => jsonResponse(400, { error: { code: 10, message: "token redacted" } }),
  });
  assert.equal(failed.definitive, true);
  assert.equal(failed.errorCode, "10");
  assert.equal(JSON.stringify(failed).includes("server-only-page-token"), false);
});

test("Inbox reply route reserves once, sends once, and completes through shared entrypoint", async () => {
  const supabase = createMockSupabase();
  const fetchCalls = [];
  const result = await invokeInbox("POST", "/api/inbox/99000000-0000-4000-8000-000000000001/reply", {
    text: "Hello",
    expectedUpdatedAt: "2026-08-26T00:00:00Z",
    idempotencyKey: "idem-action-one",
  }, {
    supabase,
    env: metaEnv(),
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      return jsonResponse(200, { message_id: "MID-F4-ROUTE" });
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.json.ok, true);
  assert.equal(fetchCalls.length, 1);
  assert.deepEqual(supabase.rpcCalls.map((call) => call.name), ["reserve_inbox_reply", "complete_inbox_reply"]);
});

test("Reply route preserves idempotent sent replay and does not call Meta again", async () => {
  const supabase = createMockSupabase({ reserveResult: { ok: true, replay: true, message: { id: "m" }, conversation: { id: "c" } } });
  let fetchCount = 0;
  const result = await invokeInbox("POST", "/api/inbox/c/reply", {
    text: "Hello",
    idempotencyKey: "idem-action-replay",
  }, {
    supabase,
    env: metaEnv(),
    fetchImpl: async () => {
      fetchCount += 1;
      return jsonResponse(200, { message_id: "MID" });
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.json.replay, true);
  assert.equal(fetchCount, 0);
});

test("Reply route maps closed window and unknown send without calling Meta twice", async () => {
  const closed = createMockSupabase({ reserveResult: { ok: false, error: "REPLY_WINDOW_CLOSED" } });
  let closedFetchCount = 0;
  const closedResult = await invokeInbox("POST", "/api/inbox/c/reply", { text: "Hi", idempotencyKey: "idem-closed" }, {
    supabase: closed,
    env: metaEnv(),
    fetchImpl: async () => {
      closedFetchCount += 1;
      return jsonResponse(200, { message_id: "MID" });
    },
  });
  assert.equal(closedResult.status, 409);
  assert.equal(closedFetchCount, 0);

  const unknown = createMockSupabase();
  const unknownResult = await invokeInbox("POST", "/api/inbox/c/reply", { text: "Hi", idempotencyKey: "idem-unknown" }, {
    supabase: unknown,
    env: metaEnv(),
    fetchImpl: async () => { throw new Error("connection reset"); },
  });
  assert.equal(unknownResult.status, 502);
  assert.equal(unknown.rpcCalls.at(-1).name, "fail_inbox_reply");
  assert.equal(unknown.rpcCalls.at(-1).args.p_status, "unknown");
});

test("Ownership and operational routes call canonical RPCs through task-automation", async () => {
  const supabase = createMockSupabase();
  for (const [path, expectedRpc, body] of [
    ["/api/inbox/c/assign", "mutate_inbox_assignment", { targetUserId: ACTION_ACTOR.user_id, expectedUpdatedAt: "t", idempotencyKey: "idem-assign" }],
    ["/api/inbox/c/note", "add_inbox_internal_note", { body: "Internal only", idempotencyKey: "idem-note" }],
    ["/api/inbox/c/follow-up", "schedule_inbox_follow_up", { snoozedUntil: "2026-08-27T00:00:00Z", idempotencyKey: "idem-follow" }],
    ["/api/inbox/c/close", "close_inbox_conversation", { expectedUpdatedAt: "t", idempotencyKey: "idem-close" }],
  ]) {
    const result = await invokeInbox("POST", path, body, { supabase, env: metaEnv() });
    assert.equal(result.status, 200, path);
    assert.ok(supabase.rpcCalls.some((call) => call.name === expectedRpc), expectedRpc);
  }
});

for (const { name, fn } of tests) {
  await fn();
  console.log(`PASS ${name}`);
}
console.log("PASS Facebook Inbox F4 actions, Meta send, and shared entrypoint routing");

async function invokeInbox(method, url, body, dependencies) {
  const raw = Buffer.from(JSON.stringify(body || {}));
  const request = Readable.from(raw);
  request.method = method;
  request.url = url;
  request.headers = { authorization: "Bearer synthetic-token", "content-type": "application/json" };
  const response = createResponse();
  await taskAutomationHandler(request, response, dependencies);
  return response.result();
}

function createMockSupabase({ reserveResult } = {}) {
  const rpcCalls = [];
  const supabase = {
    auth: {
      async getUser() {
        return { data: { user: { id: ACTION_ACTOR.user_id, email: ACTION_ACTOR.email } }, error: null };
      },
    },
    from(table) {
      if (table === "admin_users") return selectBuilder([ACTION_ACTOR]);
      if (table === "admin_role_action_permissions") return selectBuilder([{ can_perform: true }]);
      if (table === "admin_role_module_permissions") return selectBuilder([{ role_key: "cashier_front_desk", can_access: true }]);
      return selectBuilder([]);
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      if (name === "reserve_inbox_reply") {
        return { data: reserveResult || { ok: true, attemptId: "attempt-1", pageId: "PAGE-F4", customerPsid: "PSID-F4", conversationId: args.p_conversation_id }, error: null };
      }
      if (name === "complete_inbox_reply") {
        return { data: { ok: true, message: { external_message_id: args.p_external_message_id }, conversation: { state: "waiting" } }, error: null };
      }
      if (name === "fail_inbox_reply") return { data: { ok: true }, error: null };
      return { data: { ok: true, conversation: { id: args.p_conversation_id } }, error: null };
    },
    rpcCalls,
  };
  return supabase;
}

function selectBuilder(rows) {
  const builder = {
    select() { return this; },
    eq() { return this; },
    in() { return this; },
    is() { return this; },
    lte() { return this; },
    gt() { return this; },
    or() { return this; },
    async maybeSingle() { return { data: rows[0] || null, error: null }; },
    then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
  };
  return builder;
}

function metaEnv() {
  return {
    META_GRAPH_API_VERSION: "v23.0",
    META_PAGE_ID: "PAGE-F4",
    META_PAGE_ACCESS_TOKEN: "server-only-page-token",
    META_SEND_TIMEOUT_MS: "5000",
  };
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
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
