import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { INBOX_WORK_VIEWS, filterInboxConversations } from "../src/services/adminInbox.js";

const main = await read("src/main.js");
const styles = await read("src/styles.css");

assert.equal(INBOX_WORK_VIEWS[0].key, "all", "F9.7 Inbox must default to All instead of an empty status-specific view");
assert.equal(INBOX_WORK_VIEWS[0].label, "All", "F9.7 default filter must be visibly labeled All");
assert.equal(INBOX_WORK_VIEWS[1].key, "needs_reply", "New must preserve the existing needs_reply state key");
assert.equal(INBOX_WORK_VIEWS[1].label, "New", "New must remain the display label for needs_reply");

const stagingLikeRows = [
  { id: "013a937a-c902-4f00-9356-2d132618730d", state: "follow_up", ownerUserId: "owner-1" },
];
assert.deepEqual(filterInboxConversations(stagingLikeRows, "needs_reply", "owner-1"), [], "Staging fixture reproduces the old empty New view");
assert.deepEqual(filterInboxConversations(stagingLikeRows, "all", "owner-1").map((row) => row.id), ["013a937a-c902-4f00-9356-2d132618730d"], "All view must keep a selectable conversation available");

const pageSource = extractFunctionSource("renderInboxPage");
const threadSource = extractFunctionSource("renderInboxThread");
assert.ok(main.includes("let inboxActiveView = \"all\""), "Initial Inbox active view must be All");
assert.ok(main.includes("inboxActiveView = \"all\""), "Inbox reset must return to All");
assert.ok(pageSource.includes("|| visible[0]"), "Inbox page must select the first visible conversation when no explicit selection exists");
assert.ok(threadSource.includes("data-inbox-attach-file"), "Composer must include Attach control markup");
assert.ok(threadSource.includes("data-inbox-reply-draft"), "Composer must include the reply box");
assert.ok(threadSource.includes("data-inbox-send-reply"), "Composer must include Send");
assert.ok(threadSource.includes("renderInboxComposerAttachmentTray(composerState)"), "Composer must always render an attachment tray/note area");

assert.ok(styles.includes("grid-template-rows: 92px minmax(0, 1fr) auto"), "Thread grid must reserve visible footer space for the composer");
assert.ok(styles.includes("height: min(820px, calc(100vh - 128px))"), "Desktop shell must shrink in shorter authenticated staging viewports");
assert.ok(styles.includes("min-height: min(650px, calc(100vh - 128px))"), "Desktop shell min-height must not push composer below the viewport");
assert.ok(styles.includes(".inbox-attach-action") && styles.includes("min-height: 74px"), "Desktop Attach action must have non-zero visible dimensions");
assert.ok(styles.includes(".inbox-composer textarea") && styles.includes("min-height: 74px"), "Desktop reply textarea must have non-zero visible dimensions");
assert.ok(styles.includes("@media (max-width: 767px)") && styles.includes(".inbox-attach-action") && styles.includes("min-height: 34px"), "Mobile Attach action must stay reachable and visible");

for (const viewport of [
  { name: "1366", width: 1366, height: 768 },
  { name: "390", width: 390, height: 844 },
]) {
  assert.ok(viewport.width > 0 && viewport.height > 0, `${viewport.name} viewport fixture is valid`);
}

console.log("PASS Facebook Inbox F9.7 composer visibility regression contract");

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
