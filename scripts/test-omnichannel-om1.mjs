import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  INBOX_CHANNEL_FILTERS,
  INBOX_VISIBLE_WORK_VIEWS,
  filterInboxConversations,
  formatInboxCustomerName,
  getInboxAccountFilterOptions,
  getInboxChannelPresentation,
  getInboxConversationAccountKey,
  normalizeInboxConversationRow,
} from "../src/services/adminInbox.js";

const main = await read("src/main.js");
const styles = await read("src/styles.css");
const pkg = JSON.parse(await read("package.json"));

assert.equal(pkg.scripts["test:omnichannel-om1"], "node scripts/test-omnichannel-om1.mjs", "OM1 test script must be registered");
assert.equal(getInboxChannelPresentation("facebook_messenger").label, "Facebook", "Facebook Messenger must have a compact channel label");
assert.equal(getInboxChannelPresentation("facebook_messenger").fullLabel, "Facebook Messenger", "Facebook Messenger must keep its full channel label");
assert.equal(getInboxChannelPresentation("instagram_dm").label, "Instagram", "Instagram DM must have a compact channel label");
assert.equal(getInboxChannelPresentation("instagram_dm").fullLabel, "Instagram DM", "Instagram DM must keep its full channel label");
assert.equal(getInboxChannelPresentation("future_channel").label, "Future Channel", "Unknown channels must render safely");
assert.deepEqual(INBOX_CHANNEL_FILTERS.map((channel) => channel.label), ["All Channels", "Facebook", "Instagram"], "OM1 channel filters must include all, Facebook, and Instagram");
assert.deepEqual(INBOX_VISIBLE_WORK_VIEWS.map((view) => view.label), ["All", "Follow Up", "Mine"], "OM1 must preserve F9 work filters");

const trryFacebook = normalizeInboxConversationRow({
  conversation: {
    id: "00000000-0000-4000-8000-000000000001",
    state: "needs_reply",
    owner_user_id: "owner-1",
    opened_at: "2026-08-29T01:00:00Z",
    last_message_at: "2026-08-29T02:00:00Z",
  },
  identity: {
    channel: "facebook_messenger",
    external_user_id: "PSID-TRRY",
    page_connection_id: "page-row-trry",
  },
  page: { id: "page-row-trry", page_id: "1153372011199857", page_name: "TRRY Apparel" },
});

const stloFacebook = normalizeInboxConversationRow({
  conversation: {
    id: "00000000-0000-4000-8000-000000000002",
    state: "follow_up",
    owner_user_id: "",
    opened_at: "2026-08-29T01:10:00Z",
    last_message_at: "2026-08-29T01:30:00Z",
  },
  identity: {
    channel: "facebook_messenger",
    external_user_id: "PSID-STLO",
    page_connection_id: "page-row-stlo",
    display_name: "Juan Dela Cruz",
  },
  page: { id: "page-row-stlo", page_id: "2222222222222222", page_name: "STLOLab" },
});

const trryInstagram = normalizeInboxConversationRow({
  conversation: {
    id: "00000000-0000-4000-8000-000000000003",
    state: "needs_reply",
    owner_user_id: "owner-2",
    opened_at: "2026-08-29T01:20:00Z",
    last_message_at: "2026-08-29T01:40:00Z",
  },
  identity: {
    channel: "instagram_dm",
    external_user_id: "IGSID-TRRY",
    page_connection_id: "page-row-trry",
  },
  page: { id: "page-row-trry", page_id: "1153372011199857", page_name: "TRRY Apparel" },
});

assert.equal(trryFacebook.channel, "facebook_messenger", "Facebook channel code must remain canonical");
assert.equal(trryFacebook.channelLabel, "Facebook", "Facebook rows must expose channelLabel");
assert.equal(trryFacebook.channelFullLabel, "Facebook Messenger", "Facebook rows must expose channelFullLabel");
assert.equal(trryFacebook.accountId, "1153372011199857", "Page ID must become the accountId");
assert.equal(trryFacebook.accountLabel, "TRRY Apparel", "Page name must become the accountLabel");
assert.equal(trryFacebook.pageId, "1153372011199857", "Legacy pageId compatibility must remain");
assert.equal(trryFacebook.pageName, "TRRY Apparel", "Legacy pageName compatibility must remain");
assert.equal(trryFacebook.customerLabel, "Facebook customer", "Facebook profile fallback must preserve F8 refresh eligibility");
assert.equal(trryInstagram.customerLabel, "Instagram customer", "Instagram fallback must not be mislabeled as Facebook");
assert.equal(formatInboxCustomerName({ identity: {}, contact: {}, channel: "future_channel" }), "Future Channel customer", "Unknown channel customer fallback must stay safe");

const conversations = [trryFacebook, stloFacebook, trryInstagram];
assert.deepEqual(filterInboxConversations(conversations, "all", "owner-1").map((row) => row.id), conversations.map((row) => row.id), "All work filter must remain unchanged");
assert.deepEqual(filterInboxConversations(conversations, "follow_up", "owner-1").map((row) => row.id), [stloFacebook.id], "Follow Up work filter must remain unchanged");
assert.deepEqual(filterInboxConversations(conversations, "assigned_to_me", "owner-1").map((row) => row.id), [trryFacebook.id], "Mine work filter must remain unchanged");
assert.deepEqual(filterInboxConversations(conversations, "all", "owner-1", { channel: "facebook_messenger" }).map((row) => row.id), [trryFacebook.id, stloFacebook.id], "Facebook channel filter must isolate Facebook rows");
assert.deepEqual(filterInboxConversations(conversations, "all", "owner-1", { channel: "instagram_dm" }).map((row) => row.id), [trryInstagram.id], "Instagram channel filter must isolate synthetic Instagram rows");
assert.deepEqual(filterInboxConversations(conversations, "all", "owner-1", { account: "1153372011199857" }).map((row) => row.id), [trryFacebook.id, trryInstagram.id], "Account filter must isolate rows by connected account");
assert.deepEqual(filterInboxConversations(conversations, "all", "owner-1", { account: "2222222222222222" }).map((row) => row.id), [stloFacebook.id], "STLOLab synthetic account must remain isolated");
assert.deepEqual(filterInboxConversations(conversations, "needs_reply", "owner-1", { channel: "instagram_dm", account: "1153372011199857" }).map((row) => row.id), [trryInstagram.id], "Work, channel, and account filters must compose");

const accountOptions = getInboxAccountFilterOptions(conversations);
assert.deepEqual(accountOptions.map((account) => account.label), ["STLOLab", "TRRY Apparel"], "Account filters must dedupe and sort connected labels");
assert.notEqual(getInboxConversationAccountKey(trryFacebook), getInboxConversationAccountKey(stloFacebook), "Same channel customer traffic from different accounts must not auto-merge");

assert.ok(main.includes("data-inbox-channel-filter"), "Inbox UI must expose a channel filter");
assert.ok(main.includes("data-inbox-account-filter"), "Inbox UI must expose an account filter");
assert.ok(main.includes("INBOX_CHANNEL_FILTERS.map"), "Inbox UI must render channel filter options from the canonical registry");
assert.ok(main.includes("All Accounts"), "Inbox UI must render All Accounts");
assert.equal(main.includes("Needs Reply"), false, "OM1 must not bring back old visible state filters");
assert.equal(main.includes("Assigned to me"), false, "OM1 must not bring back old visible assigned-to-me copy");
assert.ok(main.includes("conversation.channelFullLabel"), "Thread/detail UI must consume normalized full channel labels");
assert.ok(main.includes("conversation.accountLabel"), "Thread/detail UI must consume normalized account labels");
assert.ok(main.includes("getInboxConversationSourceLabel(conversation)"), "Conversation rows must show compact channel/account indicators");
assert.ok(styles.includes(".inbox-channel-account-filters"), "OM1 filter controls must have scoped Inbox styles");
assert.ok(styles.includes(".inbox-card-meta"), "OM1 row channel/account indicator must have scoped Inbox styles");

console.log("PASS Omnichannel Inbox OM1 channel/account foundation");

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}
