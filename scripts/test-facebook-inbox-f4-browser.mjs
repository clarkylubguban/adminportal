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
assert.equal(main.includes('window.confirm("Close this Inbox conversation?")'), false, "Close must use inline confirmation, not native window.confirm");
assert.ok(main.includes("data-inbox-close-confirmation"), "Inline close confirmation state missing");
assert.ok(main.includes("data-inbox-close-cancel"), "Inline close cancel control missing");
assert.ok(main.includes("data-inbox-close-confirm"), "Inline close confirm control missing");
assert.ok(main.includes("Confirm Close"), "Inline close confirmation copy missing");
assert.ok(main.includes("Close this conversation?"), "Inline close question missing");
assert.ok(main.includes("Convert to Inquiry") || main.includes("CONVERT TO INQUIRY"), "Inquiry conversion area must remain present");
assert.ok(main.includes("expectedUpdatedAt: conversation.updatedAt"), "F4 mutations must carry optimistic concurrency timestamps");
assert.ok(main.includes("getAdminActionPermission(session, key)"), "Inbox UI must consume canonical action permission helper");
assert.ok(main.includes('getAdminAssignmentUsers(session, { moduleKey: "inbox" })'), "Inbox assignment users must be module-filtered");
assert.ok(main.includes("Internal Notes"), "Internal notes list section missing");
assert.ok(main.includes("Add Internal Note"), "Add internal note section missing");
assert.ok(main.includes("No internal notes yet."), "Internal note empty state missing");
assert.ok(main.includes("renderInboxNotes(inboxDetail?.notes || [])"), "Persisted internal notes must render from detail payload");
assert.ok(main.includes("getInboxNoteActorLabel"), "Internal notes need an actor label fallback");
assert.ok(main.includes("Internal staff"), "Internal note actor fallback missing");
assert.equal(main.includes("const messages = inboxDetail?.messages || [];") && main.includes("const notes = inboxDetail?.notes || [];"), false, "Internal notes must not be mixed into the customer message thread");
assert.ok(main.includes("Send status uncertain.") && main.includes("Check Business Suite before trying again."), "Unknown send-state warning copy missing");
assert.ok(main.includes("Send already in progress."), "Sending send-state copy missing");
assert.ok(main.indexOf('inboxSendState.status === "unknown"') < main.indexOf("!inboxReplyCapability.replyConfigured"), "Unknown send-state must take precedence over not-configured copy");
assert.ok(main.indexOf('inboxSendState.status === "sending"') < main.indexOf("!inboxReplyCapability.replyConfigured"), "Sending send-state must take precedence over not-configured copy");

assert.ok(service.includes('"/api/inbox/capability"'), "safe Meta reply capability endpoint missing");
assert.ok(service.includes('"/send-state"') || service.includes("}/send-state`"), "safe Inbox send-state endpoint missing");
assert.ok(service.includes('postInboxAction(authSession, conversationId, "reply"'), "reply action service missing");
assert.ok(service.includes("REPLY_WINDOW_CLOSED"), "safe reply-window error mapping missing");

assert.ok(taskAutomation.includes('pathname.startsWith("/api/inbox/")'), "Inbox writes must route through shared task-automation entrypoint");
assert.equal(vercel.rewrites.find((item) => item.source === "/api/inbox/:path*")?.destination, "/api/task-automation");
assert.ok(styles.includes(".inbox-composer-actions"), "composer action CSS missing");
assert.ok(styles.includes(".inbox-detail-card textarea"), "note/follow-up control CSS missing");
assert.ok(styles.includes(".inbox-note-list"), "Internal notes list CSS missing");
assert.ok(styles.includes(".inbox-close-confirm"), "Inline close confirmation CSS missing");

console.log("PASS Facebook Inbox F4 browser/source acceptance");
