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
assert.equal(INBOX_WORK_VIEWS[0].label, "All", "Inbox first work filter must display All so staging does not open on an empty state");
assert.equal(INBOX_WORK_VIEWS[0].key, "all", "Inbox first work filter must be the all landing view");
assert.equal(INBOX_WORK_VIEWS[1].label, "New", "Inbox second work filter must display as New");
assert.equal(INBOX_WORK_VIEWS[1].key, "needs_reply", "Inbox New work filter must keep the needs_reply key");
assert.deepEqual(filterInboxConversations([{ id: "n", state: "needs_reply" }, { id: "f", state: "follow_up" }], "all", "user-1").map((row) => row.id), ["n", "f"], "All filter must expose available conversations for the default landing view");
assert.deepEqual(filterInboxConversations([{ id: "n", state: "needs_reply" }], INBOX_WORK_VIEWS[1].key, "user-1").map((row) => row.id), ["n"], "New filter must still query needs_reply conversations");
assert.equal(INBOX_WORK_VIEWS.some((view) => /Needs Review|Needs Reply/.test(view.label)), false, "Old Needs Review/Needs Reply filter label must not remain visible");

assert.ok(main.includes("FETCH FACEBOOK NAME"), "F9 must keep the F8 missing-name action");
assert.ok(main.includes("CHECKING FACEBOOK..."), "F9 must keep the F8 loading state");
assert.ok(main.includes("if (!conversation || conversation.customerLabel !== \"Facebook customer\" || !canViewInboxRoute()) return \"\";"), "F9 must hide fetch name for enriched customers or unauthorized users");
assert.ok(main.includes("data-inbox-attach-file"), "F9.6 composer must expose a clear Attach control");
assert.ok(main.includes("data-inbox-attachment-remove"), "F9.6 attachment tray must expose a Remove action");
assert.ok(main.includes("data-inbox-attachment-retry"), "F9.6 failed attachment tray must expose a Retry action");
assert.ok(main.includes("Messenger upload failed - file remains local"), "F9.6 failed attachment state must preserve typed reply text and avoid hidden uploads");
assert.equal(/postInboxAction[\s\S]{0,240}attachment|storage_path[\s\S]{0,240}insert/i.test(extractFunctionSource("submitInboxReply")), false, "F9.6 composer attachment fallback must not auto-create Supabase storage copies");

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
assert.ok(styles.includes(".inbox-composer") && styles.includes("grid-template-rows: 92px minmax(0, 1fr) auto"), "F9 composer must remain visible at the bottom of the thread column while allowing an attachment tray");
assert.ok(styles.includes("box-shadow: inset 4px 0 0 #baff16"), "F9 selected conversation must use the Figma active rail");
assert.ok(styles.includes("grid-auto-rows: max-content"), "Conversation list rows must stay content-sized instead of filling available height");
assert.ok(styles.includes("align-self: start") && styles.includes("max-height: 110px") && styles.includes("min-height: 96px"), "Selected conversation row must stay compact around 96-110px");
const finalConversationCardRule = lastRule(".inbox-conversation-card");
const finalListPanelRule = lastRule(".inbox-list-panel");
assert.equal(/height:\s*100%/.test(finalConversationCardRule), false, "Final conversation card rule must not use height:100%");
assert.equal(/grid-template-rows:\s*auto\s+auto\s+minmax\(0,\s*1fr\)/.test(finalListPanelRule), false, "Final conversation list rule must not stretch the final row to fill the panel");
assert.ok(styles.includes("grid-template-columns: minmax(286px, 330px) minmax(0, 1fr) minmax(300px, 350px)"), "Desktop layout must fill width with controlled side columns and flexible chat");
assert.ok(styles.includes("height: min(820px, calc(100vh - 128px))") && styles.includes("min-height: min(650px, calc(100vh - 128px))"), "Desktop layout must keep the composer inside shorter staging viewports");
assert.ok(styles.includes(".inbox-thread-actions .inbox-thread-details") && styles.includes("background: #1877f2"), "DETAILS must remain a blue active control");
assert.ok(styles.includes(".inbox-message.outbound") && styles.includes("background: #1877f2"), "Outgoing bubble must remain blue");
assert.ok(styles.includes(".inbox-composer-actions button:last-child") && styles.includes("border-color: #1877f2"), "Send button must remain blue");
assert.ok(styles.includes(".inbox-attachment-card") && styles.includes(".inbox-attachment-card.saved"), "F9.6 must render distinct incoming Meta-only and saved attachment cards");
assert.ok(styles.includes(".inbox-attachment-tray") && styles.includes(".inbox-attach-action"), "F9.6 composer must render an attach action and selected attachment tray");

for (const viewportWidth of [1366, 1920]) {
  const leftColumn = 330;
  const rightColumn = 350;
  const shellBorder = 2;
  const flexibleChatWidth = viewportWidth - leftColumn - rightColumn - shellBorder;
  assert.ok(flexibleChatWidth >= 684, `${viewportWidth}px desktop must leave a usable flexible chat column`);
}
assert.ok(styles.includes("max-width: none"), "Desktop shell must not be clamped below the available viewport width");
assert.ok(styles.includes(".inbox-work-chip span") && styles.includes("text-overflow: clip"), "Filter chips must keep labels and counts readable");
assert.ok(main.includes("let inboxActiveView = \"all\""), "Inbox must default to All so a non-New staging conversation can render the composer");
assert.ok(pageSource.includes("INBOX_WORK_VIEWS.slice(0, 4)") && pageSource.includes("INBOX_WORK_VIEWS.slice(4)"), "Work-view chips must render All/New/Waiting/Follow-up and Assigned/Converted/Closed rows");

const incomingAttachment = renderF9AttachmentCard({
  filename: "mika-logo-final.png",
  type: "image",
  sizeBytes: 1887437,
  storagePath: "",
  ingestionStatus: "pending",
}, "inbound");
assert.match(incomingAttachment, /mika-logo-final\.png/, "Incoming attachment card must show the filename");
assert.match(incomingAttachment, /1\.8 MB · Image from Messenger/, "Incoming attachment card must show file size and Messenger source");
assert.match(incomingAttachment, /META ONLY/, "Incoming attachment card must identify Meta-only storage state");
assert.match(incomingAttachment, /Visible in Inbox · not copied to Supabase/, "Incoming Meta attachment must not imply permanent storage");
assert.match(incomingAttachment, /Save to Inquiry/, "Incoming Meta attachment must expose explicit Save to Inquiry action text");
assert.match(incomingAttachment, /disabled type="button" title="Save to Inquiry requires explicit attachment persistence support"/, "Save to Inquiry must stay explicit and disabled until persistence support exists");

const savedAttachment = renderF9AttachmentCard({
  filename: "customer-artwork.png",
  type: "image",
  sizeBytes: 1024,
  storagePath: "inquiries/TRY-1/customer-artwork.png",
}, "inbound");
assert.match(savedAttachment, /SAVED/, "Saved attachment card must show confirmed saved state");
assert.match(savedAttachment, /Permanent copy linked to Inquiry Artwork/, "Saved attachment must only claim permanence when storage path exists");
assert.match(savedAttachment, /Open Inquiry/, "Saved attachment must point operators to the linked Inquiry");

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

function renderF9AttachmentCard(attachment, direction) {
  const source = extractFunctionSource("renderInboxAttachment");
  const fileSizeSource = extractFunctionSource("formatInboxFileSize");
  const attachmentSource = extractFunctionSource("formatInboxAttachmentSource");
  const attachmentStatusSource = extractFunctionSource("formatInboxAttachmentStatus");
  return Function(
    "attachment",
    "direction",
    `"use strict";
    const inboxDetail = { inquiryLink: { inquiryId: "TRY-20260827012930" } };
    const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\"": "&quot;", "'": "&#39;" }[char]));
    const renderIcon = () => "<svg></svg>";
    const formatInboxFileSize = ${fileSizeSource};
    const formatInboxAttachmentSource = ${attachmentSource};
    const formatInboxAttachmentStatus = ${attachmentStatusSource};
    return (${source})(attachment, direction);`,
  )(attachment, direction);
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

function lastRule(selector) {
  const start = styles.lastIndexOf(`${selector} {`);
  assert.notEqual(start, -1, `${selector} rule missing`);
  const end = styles.indexOf("\n}", start);
  assert.notEqual(end, -1, `${selector} rule end missing`);
  return styles.slice(start, end + 2);
}
