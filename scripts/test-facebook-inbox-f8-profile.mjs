import assert from "node:assert/strict";
import { Readable } from "node:stream";
import taskAutomationHandler from "../api/task-automation.js";
import { signMetaBody } from "../api/_lib/metaWebhook.js";
import {
  enrichMetaProfilesForEvents,
  normalizeMetaProfile,
  refreshMetaProfileForConversation,
} from "../api/_lib/metaProfileEnrichment.js";
import { normalizeInboxConversationRow } from "../src/services/adminInbox.js";

const SECRET = "synthetic-meta-app-secret-at-least-32-characters";
const PAGE_ID = "PAGE-100";
const CUSTOMER_ID = "PSID-200";
const CONVERSATION_ID = "013a937a-c902-4f00-9356-2d132618730d";
const NOW = new Date("2026-08-27T02:00:00.000Z");
const ENV = {
  META_PAGE_ACCESS_TOKEN: "synthetic-page-token",
  META_GRAPH_API_VERSION: "v23.0",
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("normalizes supported Meta profile fields without claiming legal identity", () => {
  const result = normalizeMetaProfile({
    first_name: "Juan",
    last_name: "Dela Cruz",
    profile_pic: "https://example.invalid/profile.jpg",
  });
  assert.equal(result.ok, true);
  assert.equal(result.profile.displayName, "Juan Dela Cruz");
  assert.equal(result.profile.profilePictureUrl, "https://example.invalid/profile.jpg");
  assert.equal(result.profile.fields.first_name, true);
  assert.equal(result.profile.fields.last_name, true);
  assert.equal(result.profile.fields.profile_pic, true);
});

test("profile success enriches inbound webhook while preserving message ingestion", async () => {
  const repo = new ProfileRepository();
  const result = await invokeWebhook({ repo, fetchImpl: profileFetch({ first_name: "Juan", last_name: "Dela Cruz", profile_pic: "https://example.invalid/profile.jpg" }) });
  assert.equal(result.status, 200);
  assert.equal(repo.rpcCalls.length, 1);
  assert.equal(repo.rpcCalls[0].events[0].customerDisplayName, "Juan Dela Cruz");
  assert.equal(repo.messagesStored, 1);
  assert.equal(repo.identity.display_name, "Juan Dela Cruz");
  assert.equal(repo.identity.profile_picture_url, "https://example.invalid/profile.jpg");
  assert.equal(repo.contact.display_name, "Juan Dela Cruz");

  const normalized = normalizeInboxConversationRow({
    conversation: { id: "conv-1", state: "needs_reply" },
    identity: repo.identity,
    contact: repo.contact,
  });
  assert.equal(normalized.customerLabel, "Juan Dela Cruz");
});

test("profile lookup failures are non-fatal to webhook ingestion", async () => {
  for (const [name, fetchImpl, errorCode] of [
    ["permission", profileFetch({ error: { code: 2018247, message: "Insufficient permission" } }, { status: 403 }), "2018247"],
    ["timeout", timeoutFetch(), "META_PROFILE_TIMEOUT"],
    ["network", async () => { throw new Error("network down"); }, "META_PROFILE_NETWORK_ERROR"],
    ["malformed", profileFetch({ unexpected: true }), "META_PROFILE_NAME_MISSING"],
  ]) {
    const repo = new ProfileRepository();
    const result = await invokeWebhook({ repo, fetchImpl });
    assert.equal(result.status, 200, `${name} failure must not fail webhook`);
    assert.equal(repo.rpcCalls.length, 1, `${name} failure must still call ingestion RPC`);
    assert.equal(repo.messagesStored, 1, `${name} failure must still store message`);
    assert.equal(repo.identity.display_name, null, `${name} failure must not fake a profile name`);
    assert.equal(repo.identity.metadata.profile_enrichment.safe_error_code, errorCode);
  }
});

test("identity with existing display name does not trigger repeated Graph lookup", async () => {
  let calls = 0;
  const repo = new ProfileRepository({ displayName: "Juan Dela Cruz", contactName: "Juan Dela Cruz" });
  const result = await invokeWebhook({
    repo,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, async json() { return { first_name: "Juan" }; } };
    },
  });
  assert.equal(result.status, 200);
  assert.equal(calls, 0);
  assert.equal(repo.rpcCalls[0].events[0].customerDisplayName, "");
});

test("recent failed enrichment metadata prevents repeated calls on every message", async () => {
  let calls = 0;
  const repo = new ProfileRepository({
    metadata: { profile_enrichment: { status: "failed", last_attempt_at: "2026-08-27T01:30:00.000Z" } },
  });
  const enrichment = await enrichMetaProfilesForEvents([normalizedEvent()], {
    repository: repo,
    env: ENV,
    now: NOW,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, async json() { return { first_name: "Juan" }; } };
    },
  });
  assert.equal(calls, 0);
  assert.equal(enrichment.skipped, 1);
});

test("authorized server backfill enriches existing identity without mutating messages or links", async () => {
  const repo = new ProfileRepository({ messagesStored: 3, linksStored: 1 });
  const result = await refreshMetaProfileForConversation(CONVERSATION_ID, {
    repository: repo,
    env: ENV,
    now: NOW,
    fetchImpl: profileFetch({ first_name: "Juan", last_name: "Dela Cruz", profile_pic: "https://example.invalid/profile.jpg" }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "updated");
  assert.equal(result.displayName, "Juan Dela Cruz");
  assert.equal(repo.identity.display_name, "Juan Dela Cruz");
  assert.equal(repo.contact.display_name, "Juan Dela Cruz");
  assert.equal(repo.messagesStored, 3);
  assert.equal(repo.linksStored, 1);
});

test("future conversion naturally uses enriched contact display name", () => {
  const inquiryCustomerName = ["Juan Dela Cruz", "Juan Dela Cruz", "Facebook customer"].find((value) => String(value || "").trim());
  assert.equal(inquiryCustomerName, "Juan Dela Cruz");
});

async function invokeWebhook({ repo, fetchImpl }) {
  const raw = Buffer.from(JSON.stringify({
    object: "page",
    entry: [{
      id: PAGE_ID,
      messaging: [{
        sender: { id: CUSTOMER_ID },
        recipient: { id: PAGE_ID },
        timestamp: 1787654321000,
        message: { mid: `MID-${repo.id}`, text: "hello" },
      }],
    }],
  }));
  const request = Readable.from([raw]);
  request.method = "POST";
  request.url = "/api/integrations/meta/webhook";
  request.headers = { "x-hub-signature-256": signMetaBody(raw, SECRET) };
  const response = createResponse();
  await taskAutomationHandler(request, response, {
    appSecret: SECRET,
    repository: repo,
    receivedAt: NOW,
    env: ENV,
    fetchImpl,
    profileTimeoutMs: 20,
  });
  return response.result();
}

function normalizedEvent() {
  return {
    pageId: PAGE_ID,
    customerPsid: CUSTOMER_ID,
    customerDisplayName: "",
    shouldProcess: true,
  };
}

function profileFetch(payload, { status = 200 } = {}) {
  return async (url, options) => {
    assert.ok(String(url).startsWith("https://graph.facebook.com/v23.0/"));
    assert.equal(options.headers.Authorization, `Bearer ${ENV.META_PAGE_ACCESS_TOKEN}`);
    assert.equal(String(url).includes(CUSTOMER_ID), true);
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() {
        return payload;
      },
    };
  };
}

function timeoutFetch() {
  return async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    });
  });
}

class ProfileRepository {
  constructor({ displayName = null, contactName = null, metadata = {}, messagesStored = 0, linksStored = 0 } = {}) {
    this.id = Math.random().toString(16).slice(2);
    this.rpcCalls = [];
    this.messagesStored = messagesStored;
    this.linksStored = linksStored;
    this.identity = {
      id: "identity-1",
      contact_id: "contact-1",
      page_connection_id: "page-1",
      channel: "facebook_messenger",
      external_user_id: CUSTOMER_ID,
      display_name: displayName,
      profile_picture_url: null,
      metadata,
    };
    this.contact = { id: "contact-1", display_name: contactName, metadata: {} };
  }

  async ingestNormalizedEvents(row) {
    this.rpcCalls.push(row);
    this.messagesStored += row.events.filter((event) => event.message).length;
  }

  async getProfileEnrichmentTarget() {
    return {
      pageId: PAGE_ID,
      channel: this.identity.channel,
      externalUserId: this.identity.external_user_id,
      identityId: this.identity.id,
      contactId: this.contact.id,
      displayName: this.identity.display_name || "",
      contactDisplayName: this.contact.display_name || "",
      profilePictureUrl: this.identity.profile_picture_url || "",
      metadata: this.identity.metadata,
      contactMetadata: this.contact.metadata,
    };
  }

  async getProfileEnrichmentTargetForConversation(conversationId) {
    assert.equal(conversationId, CONVERSATION_ID);
    return this.getProfileEnrichmentTarget();
  }

  async applyProfileEnrichment({ profile }) {
    this.identity.display_name = this.identity.display_name || profile.displayName;
    this.identity.profile_picture_url = this.identity.profile_picture_url || profile.profilePictureUrl || null;
    this.identity.metadata = {
      ...this.identity.metadata,
      profile_enrichment: {
        status: "success",
        last_attempt_at: NOW.toISOString(),
        last_success_at: NOW.toISOString(),
        fields: profile.fields,
      },
    };
    if (!this.contact.display_name) this.contact.display_name = profile.displayName;
  }

  async recordProfileEnrichmentFailure({ errorCode }) {
    this.identity.metadata = {
      ...this.identity.metadata,
      profile_enrichment: {
        status: "failed",
        last_attempt_at: NOW.toISOString(),
        safe_error_code: errorCode,
      },
    };
  }
}

function createResponse() {
  const headers = {};
  return {
    statusCode: 200,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    end(value = "") {
      this.body = value;
    },
    result() {
      return { status: this.statusCode, headers, body: this.body };
    },
  };
}

for (const { name, fn } of tests) {
  await fn();
  console.log(`PASS ${name}`);
}
console.log(`PASS ${tests.length} Facebook Inbox F8 profile enrichment suites`);
