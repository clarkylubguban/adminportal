import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const opsBoard = await readFile("src/services/opsBoard.js", "utf8");
const main = await readFile("src/main.js", "utf8");
const dashboard = await readFile("src/mvpDashboard.js", "utf8");
const packageJson = JSON.parse(await readFile("package.json", "utf8"));

assert.equal(packageJson.scripts["test:facebook-inbox-f7-lineage"], "node scripts/test-facebook-inbox-f7-lineage.mjs");
assert.equal(packageJson.scripts["test:facebook-inbox-f7-browser"], "node scripts/test-facebook-inbox-f7-browser.mjs");
assert.equal(packageJson.scripts["test:facebook-inbox-f7-db"], "node scripts/test-facebook-inbox-f7-db.mjs");

assert.ok(opsBoard.includes('export const INBOX_INQUIRY_LINKS_TABLE = "inbox_inquiry_links";'), "F7 must use the existing Inbox/Inquiry link table");
assert.ok(opsBoard.includes("addInboxLineageToInquiries"), "Ops inquiries must be enriched with Inbox lineage");
assert.ok(opsBoard.includes('select: "conversation_id,inquiry_id,converted_at"'), "Ops enrichment must read only minimal lineage columns");
assert.ok(opsBoard.includes("inboxConversationId: link.conversation_id"), "Ops inquiries must expose the linked conversation UUID");
assert.ok(opsBoard.includes("inboxConvertedAt: link.converted_at"), "Ops inquiries must expose conversion timestamp metadata");

assert.ok(main.includes("openInboxConversation"), "App must expose Inquiry -> Inbox navigation");
assert.ok(main.includes("`/inbox?conversation=${encodeURIComponent(conversationId)}`"), "Inquiry -> Inbox must target the exact conversation deep link");
assert.ok(main.includes("canViewInboxRoute()"), "Inbox deep links must preserve the existing Inbox permission gate");
assert.ok(main.includes("getInboxDeepLinkConversationId"), "Inbox route must read the conversation query param");
assert.ok(main.includes("getInboxViewKeyForConversation"), "Inbox deep link must select the matching conversation view");
assert.ok(main.includes("data-inbox-view-inquiry"), "Inbox -> Inquiry VIEW INQUIRY action must remain available");

assert.ok(dashboard.includes("data-mvp-view-inbox"), "Inquiry drawer must render a VIEW INBOX action for linked inquiries");
assert.ok(dashboard.includes("VIEW INBOX"), "Inquiry drawer must label the linked action VIEW INBOX");
assert.ok(dashboard.includes("item.inboxConversationId"), "Inquiry drawer must only render VIEW INBOX when lineage exists");
assert.ok(dashboard.includes("data-mvp-open-messenger"), "Non-linked inquiries must keep the existing Messenger fallback action");
assert.ok(dashboard.includes("openInbox"), "MVP dashboard must call the app-level Inbox navigation callback");

for (const source of [opsBoard, main, dashboard]) {
  assert.equal(/external_user_id|sender_external_id|recipientPsid|page_access_token|META_PAGE_ACCESS_TOKEN/i.test(source), false, "F7 UI/source must not expose Messenger PSIDs or Meta tokens");
}

console.log("PASS Facebook Inbox F7 lineage source contract");
