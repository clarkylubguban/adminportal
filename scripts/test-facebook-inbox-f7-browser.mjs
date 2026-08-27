import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile("src/main.js", "utf8");
const dashboard = await readFile("src/mvpDashboard.js", "utf8");
const f5Browser = await readFile("scripts/test-facebook-inbox-f5-browser.mjs", "utf8");

assert.ok(main.includes("function getInboxDeepLinkConversationId"), "Inbox must parse ?conversation= deep links");
assert.ok(main.includes("new URLSearchParams(window.location.search).get(\"conversation\")"), "Inbox deep links must use the conversation query parameter");
assert.ok(main.includes("function isUuid"), "Inbox deep link ids must be UUID-shaped");
assert.ok(main.includes("requestedConversationId"), "Inbox load must look for the requested deep-link conversation");
assert.ok(main.includes("inboxConversations.find((conversation) => conversation.id === requestedConversationId)"), "Deep link must resolve against conversations returned by the authenticated Inbox read");
assert.ok(main.includes("inboxActiveView = getInboxViewKeyForConversation(requestedConversation)"), "Deep link must switch to the matching visible conversation view");
assert.ok(main.includes("if (!requestedConversation && !visible.some"), "Invalid or inaccessible deep links must fall back safely");
assert.ok(main.includes('if (routePath === "/inbox" && !canViewInboxRoute()) return defaultRoutePath;'), "normalizeRoutePath must keep the Inbox permission gate");
assert.ok(main.includes('if (path === "/inbox" && !canViewInboxRoute()) return defaultRoutePath;'), "getRoutePath must keep the Inbox permission gate");
assert.ok(main.includes('window.history.replaceState({}, "", "/inbox")'), "Manual Inbox view changes must clear stale conversation deep links");
assert.ok(main.includes("data-ops-view-inbox"), "Classic Ops drawer must support linked Inquiry -> Inbox navigation");
assert.ok(main.includes("openInbox: openInboxConversation"), "MVP dashboard must receive the Inbox navigation callback");

assert.ok(dashboard.includes("item.inboxConversationId\n      ? `<button type=\"button\" data-mvp-view-inbox="), "Linked inquiries must replace the generic Messenger action with VIEW INBOX");
assert.ok(dashboard.includes(': `<button type="button" data-mvp-open-messenger>Open Messenger</button>`'), "Unlinked inquiries must not get VIEW INBOX");
assert.ok(dashboard.includes("await openInbox?.(button.dataset.mvpViewInbox)"), "VIEW INBOX must call the internal app route callback");
assert.ok(dashboard.includes("data-mvp-open-messenger") && dashboard.includes("window.open(\"https://www.messenger.com/\""), "Existing generic Messenger fallback must remain available for unlinked inquiries");

assert.ok(main.includes("CONVERT INQUIRY"), "F5 CONVERT INQUIRY label must remain unchanged");
assert.ok(main.includes("CONVERTING..."), "F5 converting state must remain unchanged");
assert.ok(main.includes("VIEW INQUIRY"), "F5 post-conversion VIEW INQUIRY state must remain unchanged");
assert.ok(f5Browser.includes("CONVERT INQUIRY"), "F5 browser assertion must stay aligned to CONVERT INQUIRY");

assert.equal(/odoo/i.test(main.match(/openInboxConversation[\s\S]*?async function submitInboxReply/)?.[0] || ""), false, "F7 Inbox deep linking must not depend on Odoo");

console.log("PASS Facebook Inbox F7 browser/source acceptance");
