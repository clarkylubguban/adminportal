import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  INBOX_WORK_VIEWS,
  formatInboxLastMessageSnippet,
  getSafeIdentitySecondary,
  getSafeProfilePictureUrl,
  normalizeInboxConversationRow,
} from "../src/services/adminInbox.js";

const main = await read("src/main.js");
const styles = await read("src/styles.css");
const pkg = JSON.parse(await read("package.json"));

assert.equal(pkg.scripts["test:facebook-inbox-f9-ui"], "node scripts/test-facebook-inbox-f9-ui.mjs", "F9 UI test script must be registered");
assert.equal(pkg.scripts["test:facebook-inbox-f9-browser"], "node scripts/test-facebook-inbox-f9-browser.mjs", "F9 browser test script must be registered");
assert.equal(pkg.scripts["test:facebook-inbox-f9-responsive"], "node scripts/test-facebook-inbox-f9-responsive.mjs", "F9.1 responsive test script must be registered");
assert.equal(pkg.scripts["test:facebook-inbox-f9-modal"], "node scripts/test-facebook-inbox-f9-modal.mjs", "F9.1 modal test script must be registered");

assert.ok(main.includes("inbox-workspace-shell inbox-grid"), "F9 Inbox must render the reconciled workspace while preserving legacy layout hooks");
assert.ok(main.includes("inbox-list-panel inbox-list"), "F9 must keep the left conversation list surface");
assert.ok(main.includes("inbox-thread-panel inbox-thread"), "F9 must keep the central Messenger thread surface");
assert.ok(main.includes("inbox-context-panel inbox-detail-panel"), "F9 must keep the right operations surface");
const pageSource = extractFunctionSource("renderInboxPage");
assert.equal(pageSource.includes("<h1>Inbox</h1>"), false, "Inbox page title must be removed from the Inbox header");
assert.equal(pageSource.includes("Handle Facebook conversations, qualify leads, and convert them into inquiries."), false, "Inbox subtitle must be removed from the Inbox header");
assert.equal(pageSource.includes("data-inbox-refresh"), false, "Visible Inbox Refresh button must be removed from the header");
assert.ok(pageSource.includes("getInboxPageStatusLabel(selected)"), "F9 cleanup must keep the channel/account pill");
assert.equal(INBOX_WORK_VIEWS[0].key, "all", "F9.7 must default Inbox to All so staging opens with a selectable conversation");
assert.equal(INBOX_WORK_VIEWS[0].label, "All", "F9.7 must display the first Inbox filter as All");
assert.equal(INBOX_WORK_VIEWS[1].key, "needs_reply", "F9.4 must preserve the underlying needs_reply filter key");
assert.equal(INBOX_WORK_VIEWS[1].state, "needs_reply", "F9.4 must preserve the underlying needs_reply state filter");
assert.equal(INBOX_WORK_VIEWS[1].label, "New", "F9.4 must display the needs_reply filter as New");
assert.equal(INBOX_WORK_VIEWS.some((view) => /Needs Review|Needs Reply/.test(view.label)), false, "F9.4 Inbox filter labels must not show the old review/reply copy");
assert.ok(main.includes("Search customer or message…"), "F9 list search placeholder must match the approved copy");
assert.ok(main.includes("INBOX_WORK_VIEWS.slice(0, 4)") && main.includes("INBOX_WORK_VIEWS.slice(4)"), "F9 work views must render All/New/Waiting/Follow-up and Assigned/Converted/Closed rows");
assert.ok(main.includes("renderInboxAvatar(conversation"), "F9 must render safe avatars in the list/thread/panel");
assert.ok(main.includes("conversation.lastMessageSnippet"), "F9 list rows must show the last captured message snippet");
const threadSource = extractFunctionSource("renderInboxThread");
const detailPanelSource = extractFunctionSource("renderInboxDetailPanel");
assert.ok(threadSource.includes('data-inbox-open-modal="customer_details"') && threadSource.includes("DETAILS"), "F9.3 top DETAILS button must open the customer details modal");
assert.equal(detailPanelSource.includes("VIEW CUSTOMER DETAILS"), false, "F9.3 right panel must remove side-panel Customer Details access");
assert.ok(threadSource.includes("data-inbox-attach-file") && threadSource.includes("data-inbox-reply-draft") && threadSource.includes("data-inbox-send-reply"), "F9.6 composer must keep the Figma Attach + reply + Send pattern");
assert.ok(main.includes("META ONLY") && main.includes("Save to Inquiry") && main.includes("Not copied to Supabase") === false, "F9.6 attachments must expose explicit Meta-only and Save to Inquiry language without inventing a new storage claim");
assert.ok(main.includes("Visible in Inbox · not copied to Supabase"), "F9.6 incoming Meta attachments must clearly state they are not permanent storage");
assert.ok(main.includes("ADD NOTE / VIEW NOTES"), "F9.1 summary panel must move notes behind an action");
assert.ok(main.includes("renderInboxModal(selected)"), "F9.1 must render centered modal families from the Inbox page");
assert.equal(pageSource.includes("FACEBOOK INBOX"), false, "F9 must remove the old oversized Facebook Inbox page header copy");
assert.equal(/externalUserId[\s\S]{0,160}inbox-card-main/.test(main), false, "F9 conversation rows must not expose raw PSIDs");

assert.ok(styles.includes("grid-template-columns: minmax(286px, 330px) minmax(0, 1fr) minmax(300px, 350px)"), "Inbox desktop shell must use a flexible center chat column");
assert.ok(styles.includes("height: min(820px, calc(100vh - 128px))"), "Inbox workspace must keep the composer visible in staging viewport heights");
assert.ok(styles.includes("max-width: none") && styles.includes("width: 100%"), "Inbox workspace must fill available desktop width");
assert.ok(styles.includes(".inbox-work-chip-groups"), "F9 compact work view chip styling missing");
assert.ok(styles.includes(".inbox-message-row.inbound") && styles.includes(".inbox-message-row.outbound"), "F9 must preserve left inbound and right outbound message alignment");
assert.ok(styles.includes(".inbox-context-panel"), "F9 right customer and operations panel styling missing");
assert.ok(styles.includes("background: #1877f2"), "F9.3 must use Messenger blue for primary Inbox actions and outbound bubbles");
assert.ok(styles.includes(".inbox-detail-card") && styles.includes("grid-template-columns: repeat(2, minmax(0, 1fr))"), "F9.3 Core card must use a two-column grid");
assert.ok(styles.includes("@media (max-width: 1320px)") && styles.includes("@media (max-width: 1040px)"), "F9 desktop responsiveness must include 1366-safe and smaller fallbacks");
assert.ok(styles.includes("@media (min-width: 768px) and (max-width: 1199px)"), "F9.1 tablet two-pane layout missing");
assert.ok(styles.includes("@media (max-width: 767px)"), "F9.1 mobile single-pane layout missing");

const normalized = normalizeInboxConversationRow({
  conversation: {
    id: "013a937a-c902-4f00-9356-2d132618730d",
    state: "needs_reply",
    owner_user_id: "",
    opened_at: "2026-08-27T01:00:00Z",
    last_message_at: "2026-08-27T01:29:30Z",
    entry_source: "click_to_messenger_ad",
  },
  identity: {
    channel: "facebook_messenger",
    external_user_id: "1234567890123456",
    display_name: "Juan Dela Cruz",
    profile_picture_url: "https://example.invalid/profile.jpg",
  },
  contact: {},
  page: { page_name: "TRRY Apparel" },
  latestMessage: { body: "Hi, can I ask about shirt printing?", message_type: "text" },
});

assert.equal(normalized.customerLabel, "Juan Dela Cruz", "F9 must keep F8 profile name priority");
assert.equal(normalized.customerSecondary, "Messenger", "F9 must not expose raw PSID as the conversation secondary label");
assert.equal(normalized.profilePictureUrl, "https://example.invalid/profile.jpg", "F9 must pass through safe HTTPS profile pictures");
assert.equal(normalized.lastMessageSnippet, "Hi, can I ask about shirt printing?", "F9 rows must expose latest message snippets");

assert.equal(getSafeProfilePictureUrl("http://example.invalid/profile.jpg"), "", "profile avatars must require HTTPS");
assert.equal(getSafeProfilePictureUrl("javascript:alert(1)"), "", "unsafe avatar URLs must be rejected");
assert.equal(getSafeIdentitySecondary({ external_user_id: "PSID-123456789012" }), "Messenger", "raw PSIDs must not appear as customer secondary text");
assert.equal(getSafeIdentitySecondary({ external_username: "juan.delacruz" }), "juan...cruz", "safe usernames may be shortened");
assert.equal(formatInboxLastMessageSnippet({ body: "x".repeat(160) }).length, 140, "long snippets must be compact");

console.log("PASS Facebook Inbox F9 UI source/layout contract");

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
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
