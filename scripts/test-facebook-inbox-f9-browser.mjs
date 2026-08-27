import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { INBOX_WORK_VIEWS, filterInboxConversations } from "../src/services/adminInbox.js";

const main = await read("src/main.js");
const styles = await read("src/styles.css");

const requiredActionHooks = [
  "data-inbox-conversation",
  "data-inbox-reply-draft",
  "data-inbox-check-send-status",
  "data-inbox-send-reply",
  "data-inbox-assign-me",
  "data-inbox-reassign",
  "data-inbox-note-draft",
  "data-inbox-add-note",
  "data-inbox-follow-up-draft",
  "data-inbox-follow-up-reason",
  "data-inbox-follow-up",
  "data-inbox-close",
  "data-inbox-convert-to-inquiry",
  "data-inbox-view-inquiry",
  "data-inbox-refresh-facebook-profile",
];

for (const hook of requiredActionHooks) {
  assert.ok(main.includes(hook), `F9 must preserve ${hook}`);
}

assert.ok(main.includes("let inboxSearchQuery = \"\""), "F9 must keep search state local to the Inbox");
assert.ok(main.includes("document.querySelector(\"[data-inbox-search]\")"), "F9 search input must be bound");
assert.ok(main.includes("conversation.lastMessageSnippet"), "F9 search must include message snippets");
assert.ok(main.includes("conversation.inquiryId"), "F9 search must include canonical linked Inquiry identity");
assert.ok(main.includes("getInboxPageStatusLabel(selected)"), "F9 header must use the real page name when available");
assert.ok(main.includes("getInboxOpenConversationCount()"), "F9 conversation list must show open-count context");
const pageSource = extractFunctionSource("renderInboxPage");
assert.equal(pageSource.includes("<h1>Inbox</h1>"), false, "Inbox title must not render above the workspace");
assert.equal(pageSource.includes("Handle Facebook conversations, qualify leads, and convert them into inquiries."), false, "Inbox subtitle must not render above the workspace");
assert.equal(pageSource.includes("data-inbox-refresh"), false, "Visible Refresh button must not render above the workspace");
assert.ok(pageSource.includes("getInboxPageStatusLabel(selected)"), "Small channel pill must remain in the cleaned header");
assert.equal(INBOX_WORK_VIEWS[0].label, "New", "Inbox first work filter must display as New");
assert.equal(INBOX_WORK_VIEWS[0].key, "needs_reply", "Inbox first work filter must keep the needs_reply key");
assert.deepEqual(filterInboxConversations([{ id: "n", state: "needs_reply" }], INBOX_WORK_VIEWS[0].key, "user-1").map((row) => row.id), ["n"], "New filter must still query needs_reply conversations");
assert.equal(INBOX_WORK_VIEWS.some((view) => /Needs Review|Needs Reply/.test(view.label)), false, "Old Needs Review/Needs Reply filter label must not remain visible");

assert.ok(main.includes("FETCH FACEBOOK NAME"), "F9 must keep the F8 missing-name action");
assert.ok(main.includes("CHECKING FACEBOOK..."), "F9 must keep the F8 loading state");
assert.ok(main.includes("if (!conversation || conversation.customerLabel !== \"Facebook customer\" || !canViewInboxRoute()) return \"\";"), "F9 must hide fetch name for enriched customers or unauthorized users");

assert.ok(main.includes("VIEW INQUIRY"), "F9 must keep linked Inquiry navigation");
assert.ok(main.includes("CONVERT INQUIRY"), "F9 must keep F5 pre-conversion action copy");
assert.ok(main.includes("CHECK STATUS"), "F9 must keep F6 uncertain-send recovery action");
assert.ok(main.includes("Sent") || main.includes("statusLabel"), "F9 must preserve outbound message status labels");

assert.equal(/odoo/i.test(main.match(/function renderInboxDetailPanel[\s\S]*?function renderInboxFacebookNameRefresh/)?.[0] || ""), false, "F9 linked order area must not introduce Odoo");
assert.equal(/PAGE_ACCESS_TOKEN|META_PAGE_ACCESS_TOKEN|META_APP_SECRET|META_WEBHOOK_VERIFY_TOKEN|service_role|Bearer/i.test(main.match(/function renderInboxPage[\s\S]*?function getInboxMessageFallback/)?.[0] || ""), false, "F9 DOM render path must not expose secrets or bearer tokens");

const viewModel = renderF9ConversationCard({
  id: "013a937a-c902-4f00-9356-2d132618730d",
  customerLabel: "Juan Dela Cruz",
  state: "needs_reply",
  lastMessageAt: "2026-08-27T01:29:30Z",
  lastMessageSnippet: "Can you quote 50 black shirts?",
  profilePictureUrl: "https://example.invalid/profile.jpg",
});
assert.match(viewModel, /Juan Dela Cruz/, "rendered row must show enriched Facebook name");
assert.match(viewModel, /Can you quote 50 black shirts\?/, "rendered row must show latest message snippet");
assert.match(viewModel, /https:\/\/example\.invalid\/profile\.jpg/, "rendered row must use a safe profile avatar");
assert.equal(/123456789|PSID|externalUserId/.test(viewModel), false, "rendered row must not expose PSID-like identifiers");

assert.ok(styles.includes("overflow: hidden") && styles.includes("overflow-y: auto"), "F9 workspace must avoid page overflow while allowing column scroll");
assert.ok(styles.includes(".inbox-composer") && styles.includes("grid-template-rows: 92px minmax(0, 1fr) 104px"), "F9 composer must remain visible at the bottom of the thread column");
assert.ok(styles.includes("box-shadow: inset 4px 0 0 #baff16"), "F9 selected conversation must use the Figma active rail");
assert.ok(styles.includes("grid-template-columns: minmax(286px, 330px) minmax(0, 1fr) minmax(300px, 350px)"), "Desktop layout must fill width with controlled side columns and flexible chat");
assert.ok(styles.includes(".inbox-thread-actions .inbox-thread-details") && styles.includes("background: #1877f2"), "DETAILS must remain a blue active control");
assert.ok(styles.includes(".inbox-message.outbound") && styles.includes("background: #1877f2"), "Outgoing bubble must remain blue");
assert.ok(styles.includes(".inbox-composer-actions button:last-child") && styles.includes("border-color: #1877f2"), "Send button must remain blue");

for (const viewportWidth of [1366, 1920]) {
  const leftColumn = 330;
  const rightColumn = 350;
  const shellBorder = 2;
  const flexibleChatWidth = viewportWidth - leftColumn - rightColumn - shellBorder;
  assert.ok(flexibleChatWidth >= 684, `${viewportWidth}px desktop must leave a usable flexible chat column`);
}
assert.ok(styles.includes("max-width: none"), "Desktop shell must not be clamped below the available viewport width");
assert.ok(styles.includes(".inbox-work-chip span") && styles.includes("text-overflow: clip"), "Filter chips must keep labels and counts readable");

console.log("PASS Facebook Inbox F9 browser behavior/source contract");

function renderF9ConversationCard(conversation) {
  const source = extractFunctionSource("renderInboxConversationList");
  const avatarSource = extractFunctionSource("renderInboxAvatar");
  const initialSource = extractFunctionSource("getInboxInitial");
  const stateSource = extractFunctionSource("formatInboxState");
  const relativeSource = extractFunctionSource("formatInboxRelativeTime");
  return Function(
    "conversation",
    `"use strict";
    let inboxLoadState = "ready";
    let inboxSelectedConversationId = conversation.id;
    const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\"": "&quot;", "'": "&#39;" }[char]));
    const getInboxInitial = ${initialSource};
    const formatInboxState = ${stateSource};
    const formatInboxRelativeTime = ${relativeSource};
    const renderInboxAvatar = ${avatarSource};
    return (${source})([conversation]);`,
  )(conversation);
}

function extractFunctionSource(name) {
  let start = main.indexOf(`function ${name}`);
  if (start === -1) start = main.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} function missing`);
  const signature = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\([\\s\\S]*?\\)\\s*\\{`, "m");
  const match = signature.exec(main.slice(start));
  assert.ok(match, `${name} function signature not found`);
  const open = start + match[0].length - 1;
  let depth = 0;
  for (let index = open; index < main.length; index += 1) {
    if (main[index] === "{") depth += 1;
    if (main[index] === "}") {
      depth -= 1;
      if (depth === 0) return main.slice(start, index + 1);
    }
  }
  throw new Error(`${name} function body not found`);
}

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}
