import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { lookupMetaProfile } from "../api/_lib/metaProfileEnrichment.js";
import { getMetaReplyCapability, resolveMetaPageCredential, sendMetaTextMessage } from "../api/_lib/metaSend.js";
import {
  filterInboxConversations,
  getInboxAccountFilterOptions,
  normalizeInboxConversationRow,
} from "../src/services/adminInbox.js";

const metaSend = await read("api/_lib/metaSend.js");
const metaProfile = await read("api/_lib/metaProfileEnrichment.js");
const ingestion = await read("api/_lib/metaInboxIngestion.js");
const main = await read("src/main.js");
const pkg = JSON.parse(await read("package.json"));

assert.equal(pkg.scripts["test:omnichannel-om2"], "node scripts/test-omnichannel-om2.mjs", "OM2 test script must be registered");
assert.ok(metaSend.includes("resolveMetaPageCredential"), "Meta send must centralize page credential resolution");
assert.ok(metaSend.includes("META_PAGE_ACCESS_TOKENS_JSON"), "Meta send must support server-side multi-page credential mapping");
assert.ok(metaSend.includes("META_PAGE_ACCESS_TOKEN_"), "Meta send must support page-keyed server-side env vars");
assert.ok(metaProfile.includes("resolveMetaPageCredential"), "Profile enrichment must route credentials by page");
assert.equal(/create\s+table|alter\s+table/i.test(metaSend), false, "OM2 send routing must not require schema changes");
assert.equal(/create\s+table|alter\s+table/i.test(metaProfile), false, "OM2 profile routing must not require schema changes");
assert.ok(ingestion.includes("ensurePageConnection(normalized.pageId") || ingestion.includes("ensurePageConnection(pageId"), "Webhook ingestion must resolve page connections from event page_id");
assert.ok(ingestion.includes(".eq(\"page_connection_id\", pageConnectionId)") && ingestion.includes(".eq(\"channel\", channel)") && ingestion.includes(".eq(\"external_user_id\", externalUserId)"), "Identity lookup must remain page + channel + external user scoped");
assert.ok(main.includes("data-inbox-account-filter") && main.includes("All Accounts"), "OM2 must keep OM1 account filtering in the active Inbox UI");

const env = {
  META_GRAPH_API_VERSION: "v23.0",
  META_PAGE_ACCESS_TOKENS_JSON: JSON.stringify({
    "PAGE-A": "token-a",
    "PAGE-B": "token-b",
  }),
};

assert.deepEqual(resolveMetaPageCredential("PAGE-A", env), { pageId: "PAGE-A", token: "token-a", source: "map" }, "Page A must resolve its own mapped token");
assert.deepEqual(resolveMetaPageCredential("PAGE-B", env), { pageId: "PAGE-B", token: "token-b", source: "map" }, "Page B must resolve its own mapped token");
assert.equal(resolveMetaPageCredential("PAGE-C", env).token, "", "Unknown pages must not fall back to another mapped page token");
assert.equal(getMetaReplyCapability(env).replyConfigured, true, "Reply capability must be true when a page token map is configured");
assert.equal(getMetaReplyCapability({ META_GRAPH_API_VERSION: "v23.0", META_PAGE_ID: "PAGE-A", META_PAGE_ACCESS_TOKEN: "legacy-token" }).replyConfigured, true, "Legacy single-page capability must remain compatible");

const sendCalls = [];
for (const pageId of ["PAGE-A", "PAGE-B"]) {
  const result = await sendMetaTextMessage({
    pageId,
    recipientPsid: `PSID-${pageId}`,
    text: `Reply for ${pageId}`,
    env,
    fetchImpl: async (url, init) => {
      sendCalls.push({ pageId, url, auth: init.headers.Authorization, body: JSON.parse(init.body) });
      return jsonResponse(200, { message_id: `MID-${pageId}` });
    },
  });
  assert.equal(result.ok, true, `${pageId} send must succeed`);
}

assert.equal(sendCalls[0].url, "https://graph.facebook.com/v23.0/PAGE-A/messages", "Page A send must use Page A Graph endpoint");
assert.equal(sendCalls[1].url, "https://graph.facebook.com/v23.0/PAGE-B/messages", "Page B send must use Page B Graph endpoint");
assert.equal(sendCalls[0].auth, "Bearer token-a", "Page A send must use Page A token");
assert.equal(sendCalls[1].auth, "Bearer token-b", "Page B send must use Page B token");
assert.equal(sendCalls[0].body.recipient.id, "PSID-PAGE-A", "Page A send must preserve Page A recipient");
assert.equal(sendCalls[1].body.recipient.id, "PSID-PAGE-B", "Page B send must preserve Page B recipient");

const legacyMismatch = await sendMetaTextMessage({
  pageId: "PAGE-B",
  recipientPsid: "PSID-B",
  text: "Wrong page must not borrow legacy token",
  env: { META_GRAPH_API_VERSION: "v23.0", META_PAGE_ID: "PAGE-A", META_PAGE_ACCESS_TOKEN: "legacy-token" },
  fetchImpl: async () => {
    throw new Error("should not send");
  },
});
assert.equal(legacyMismatch.errorCode, "META_PAGE_MISMATCH", "Legacy single-page token must not be reused for a different Page");

const profileCalls = [];
for (const pageId of ["PAGE-A", "PAGE-B"]) {
  const result = await lookupMetaProfile({ pageId, channel: "facebook_messenger", externalUserId: `PSID-${pageId}` }, {
    env,
    fetchImpl: async (url, init) => {
      profileCalls.push({ pageId, url, auth: init.headers.Authorization });
      return jsonResponse(200, { first_name: pageId, last_name: "Customer", profile_pic: "https://example.invalid/profile.jpg" });
    },
  });
  assert.equal(result.ok, true, `${pageId} profile lookup must succeed`);
}

assert.equal(profileCalls[0].url, "https://graph.facebook.com/v23.0/PSID-PAGE-A?fields=first_name%2Clast_name%2Cname%2Cprofile_pic", "Page A profile lookup must target Page A customer PSID");
assert.equal(profileCalls[1].url, "https://graph.facebook.com/v23.0/PSID-PAGE-B?fields=first_name%2Clast_name%2Cname%2Cprofile_pic", "Page B profile lookup must target Page B customer PSID");
assert.equal(profileCalls[0].auth, "Bearer token-a", "Page A profile lookup must use Page A token");
assert.equal(profileCalls[1].auth, "Bearer token-b", "Page B profile lookup must use Page B token");

const pageA = normalizeInboxConversationRow({
  conversation: { id: "conv-a", state: "needs_reply", last_message_at: "2026-08-29T01:00:00Z" },
  identity: { channel: "facebook_messenger", external_user_id: "SAME-NAME-PSID", page_connection_id: "page-a" },
  page: { id: "page-a", page_id: "PAGE-A", page_name: "Fog Heads Only" },
});
const pageB = normalizeInboxConversationRow({
  conversation: { id: "conv-b", state: "needs_reply", last_message_at: "2026-08-29T01:05:00Z" },
  identity: { channel: "facebook_messenger", external_user_id: "SAME-NAME-PSID", page_connection_id: "page-b" },
  page: { id: "page-b", page_id: "PAGE-B", page_name: "Owner Page B" },
});

assert.notEqual(pageA.accountId, pageB.accountId, "Same human/PSID-like fixture must remain account-scoped");
assert.deepEqual(getInboxAccountFilterOptions([pageA, pageB]).map((account) => account.label), ["Fog Heads Only", "Owner Page B"], "Account filter must expose both Page A and Page B labels");
assert.deepEqual(filterInboxConversations([pageA, pageB], "all", "", { account: "PAGE-A" }).map((row) => row.id), ["conv-a"], "Page A account filter must isolate Page A");
assert.deepEqual(filterInboxConversations([pageA, pageB], "all", "", { account: "PAGE-B" }).map((row) => row.id), ["conv-b"], "Page B account filter must isolate Page B");

const serializedSend = JSON.stringify({ sendCalls: sendCalls.map(({ pageId, url, body }) => ({ pageId, url, body })) });
assert.equal(/token-a|token-b|legacy-token/.test(serializedSend), false, "Test-safe serialized output must not expose tokens");

console.log("PASS Omnichannel Inbox OM2 multi-Facebook-page source contract");

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
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
