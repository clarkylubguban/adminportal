import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import {
  filterInboxConversations,
  formatInboxCustomerName,
  getInboxOutboundStatus,
  getInboxReplyWindowState,
  normalizeInboxConversationDetail,
  normalizeInboxConversationRow,
  sortInboxConversations,
} from "../src/services/adminInbox.js";

const main = await read("src/main.js");
const service = await read("src/services/adminInbox.js");
const styles = await read("src/styles.css");
const pkg = JSON.parse(await read("package.json"));
const migrations = await readdir(new URL("../supabase/migrations/", import.meta.url));

assert.equal(
  migrations.some((file) => /facebook_inbox_f3/i.test(file)),
  false,
  "F3 must not add a Supabase migration"
);

assert.ok(pkg.scripts["test:facebook-inbox-f3-read"], "F3 read test script must be registered");
assert.ok(main.includes('"/inbox": "Inbox"'), "canonical /inbox route missing");
assert.ok(main.includes("canViewInboxRoute() ? [{ label: \"Inbox\", path: \"/inbox\""), "Inbox nav must be gated by module access");
assert.ok(main.includes('getAdminModuleAccess(session, "inbox")'), "Inbox route must consume canonical module access");
assert.ok(main.includes('path === "/inbox" && !canViewInboxRoute()'), "direct /inbox route must be gated");
assert.ok(main.includes("getAdminInboxConversationRows(adminAuthSession)"), "Inbox list must use authenticated read service");
assert.ok(main.includes("getAdminInboxConversationDetail(adminAuthSession, conversationId)"), "Inbox detail must use authenticated read service");
assert.ok(main.includes('title="Available in a later Inbox phase"'), "future mutation controls must be disabled with helper title");
assert.equal(/data-inbox-(reply|send|assign|note|close|convert)[^"]*"/.test(main), false, "F3 must not expose mutation data hooks");

assert.ok(service.includes('"inbox_conversations"'), "conversation read missing");
assert.ok(service.includes('"inbox_messages"'), "message read missing");
assert.ok(service.includes('"inbox_attachments"'), "attachment read missing");
assert.ok(service.includes('"inbox_inquiry_links"'), "inquiry link read missing");
assert.equal(service.includes("meta_webhook_events"), false, "raw webhook event table must not be read by browser service");
assert.equal(/createSupabase|writeSupabase|updateSupabase|fetch\(/.test(service), false, "Inbox F3 service must stay read-only");

assert.ok(styles.includes(".inbox-grid"), "Inbox layout CSS missing");
assert.ok(styles.includes("grid-template-columns: minmax(240px, 0.9fr) minmax(360px, 1.5fr) minmax(260px, 0.95fr)"), "desktop three-column Inbox layout missing");
assert.ok(styles.includes("@media (max-width: 860px)"), "Inbox responsive layout missing");

const normalized = normalizeInboxConversationRow({
  conversation: {
    id: "conv-1",
    state: "needs_reply",
    owner_user_id: null,
    opened_at: "2026-08-25T08:00:00Z",
    last_message_at: "2026-08-25T09:00:00Z",
    last_inbound_at: "2026-08-25T09:00:00Z",
    reply_window_expires_at: "2026-08-26T09:00:00Z",
    entry_source: "ADS",
    referral_ref: "campaign-ref",
    ad_id: "AD-1",
  },
  identity: { channel: "facebook_messenger", external_user_id: "PSID-1234567890" },
  contact: {},
  page: { page_name: "TRRY Apparel" },
  inquiryLink: null,
});

assert.equal(normalized.customerLabel, "Facebook customer", "F2 has no profile API, fallback display name must be neutral");
assert.equal(normalized.ownerLabel, "Unassigned", "null owner must display as Unassigned");
assert.equal(normalized.entrySource, "ADS", "entry source must be preserved");
assert.equal(normalized.adId, "AD-1", "ad id must be preserved");

const sorted = sortInboxConversations([
  { id: "old", openedAt: "2026-08-25T07:00:00Z", lastMessageAt: "" },
  { id: "new", openedAt: "2026-08-25T06:00:00Z", lastMessageAt: "2026-08-25T08:00:00Z" },
]);
assert.equal(sorted[0].id, "new", "conversation ordering must use last_message_at with opened_at fallback");

const views = [
  { id: "a", state: "needs_reply", ownerUserId: "user-1" },
  { id: "b", state: "waiting", ownerUserId: "user-2" },
  { id: "c", state: "closed", ownerUserId: "user-1" },
];
assert.deepEqual(filterInboxConversations(views, "needs_reply", "user-1").map((row) => row.id), ["a"]);
assert.deepEqual(filterInboxConversations(views, "assigned_to_me", "user-1").map((row) => row.id), ["a", "c"], "Assigned to me must filter owner_user_id, not state");

const detail = normalizeInboxConversationDetail({
  messages: [
    { id: "m2", direction: "outbound", body: "Later", sent_at: "2026-08-25T09:00:00Z", delivered_at: "2026-08-25T09:01:00Z" },
    { id: "m1", direction: "inbound", body: "Earlier", sent_at: "2026-08-25T08:00:00Z" },
  ],
  attachments: [{ id: "att-1", message_id: "m1", attachment_type: "image", source_url: "https://example.invalid/meta.jpg", ingestion_status: "pending" }],
});
assert.deepEqual(detail.messages.map((message) => message.id), ["m1", "m2"], "thread messages must be ordered sent_at ASC");
assert.equal(detail.messages[0].attachments[0].storagePath, "", "source URL must not be exposed as a public asset");
assert.equal(getInboxOutboundStatus({ direction: "outbound", read_at: "2026-08-25T09:02:00Z" }), "Seen");
assert.equal(getInboxOutboundStatus({ direction: "outbound", delivered_at: "2026-08-25T09:01:00Z" }), "Delivered");
assert.equal(getInboxOutboundStatus({ direction: "outbound" }), "Sent");
assert.equal(getInboxReplyWindowState("2026-08-25T13:00:00Z", new Date("2026-08-25T10:00:00Z")).tone, "soon");
assert.equal(formatInboxCustomerName({ identity: {}, contact: {} }), "Facebook customer");

process.stdout.write("PASS Facebook Inbox F3 read-only surface contract\n");

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}
