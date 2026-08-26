import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile("src/main.js", "utf8");
const service = await readFile("src/services/adminInbox.js", "utf8");
const styles = await readFile("src/styles.css", "utf8");
const taskAutomation = await readFile("api/task-automation.js", "utf8");
const vercel = JSON.parse(await readFile("vercel.json", "utf8"));

assert.ok(main.includes("data-inbox-reply-draft"), "F4 composer textarea must be active in the existing Inbox thread");
assert.ok(main.includes("data-inbox-send-reply"), "F4 Send button binding missing");
assert.ok(main.includes("Reply window closed"), "closed 24-hour window copy missing");
assert.ok(main.includes("Free-form Messenger replies are unavailable."), "Utility Messaging must not be offered in F4");
assert.ok(main.includes("Owned by ${owner}"), "other-owner disabled composer copy missing");
assert.ok(main.includes("data-inbox-assign-me"), "Assign to me control missing");
assert.ok(main.includes("data-inbox-reassign"), "Reassign control missing");
assert.ok(main.includes("data-inbox-add-note"), "Internal note control missing");
assert.ok(main.includes("data-inbox-follow-up"), "Follow-up control missing");
assert.ok(main.includes("data-inbox-close"), "Close control missing");
assert.ok(main.includes('title="Available in F5"') && main.includes("Convert to Inquiry"), "Convert to Inquiry must remain disabled for F5");
assert.ok(main.includes("expectedUpdatedAt: conversation.updatedAt"), "F4 mutations must carry optimistic concurrency timestamps");
assert.ok(main.includes("getAdminActionPermission(session, key)"), "Inbox UI must consume canonical action permission helper");
assert.ok(main.includes('getAdminAssignmentUsers(session, { moduleKey: "inbox" })'), "Inbox assignment users must be module-filtered");

assert.ok(service.includes('"/api/inbox/capability"'), "safe Meta reply capability endpoint missing");
assert.ok(service.includes('postInboxAction(authSession, conversationId, "reply"'), "reply action service missing");
assert.ok(service.includes("REPLY_WINDOW_CLOSED"), "safe reply-window error mapping missing");

assert.ok(taskAutomation.includes('pathname.startsWith("/api/inbox/")'), "Inbox writes must route through shared task-automation entrypoint");
assert.equal(vercel.rewrites.find((item) => item.source === "/api/inbox/:path*")?.destination, "/api/task-automation");
assert.ok(styles.includes(".inbox-composer-actions"), "composer action CSS missing");
assert.ok(styles.includes(".inbox-detail-card textarea"), "note/follow-up control CSS missing");

console.log("PASS Facebook Inbox F4 browser/source acceptance");
