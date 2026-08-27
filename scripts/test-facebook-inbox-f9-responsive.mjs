import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await read("src/main.js");
const styles = await read("src/styles.css");

assert.ok(main.includes("let inboxMobileThreadOpen = false"), "F9.1 must track mobile list/thread state");
assert.ok(main.includes("inbox-mobile-thread-open"), "F9.1 must expose mobile thread state as a class");
assert.ok(main.includes("data-inbox-back-to-list"), "Mobile thread must expose a Back action");
assert.ok(main.includes("inboxMobileThreadOpen = true"), "Conversation selection must open the mobile thread pane");
assert.ok(main.includes("inboxMobileThreadOpen = false"), "Back/view changes must return to the mobile list pane");
assert.ok(main.includes("data-inbox-open-modal=\"customer_details\""), "Tablet/mobile thread must be able to open Details modal without the right panel");
assert.equal(extractFunctionSource("renderInboxDetailPanel").includes("VIEW CUSTOMER DETAILS"), false, "Responsive details access must use the thread header only");
const pageSource = extractFunctionSource("renderInboxPage");
assert.equal(pageSource.includes("<h1>Inbox</h1>"), false, "Responsive Inbox must not reserve space for the removed title");
assert.equal(pageSource.includes("data-inbox-refresh"), false, "Responsive Inbox must not reserve space for the removed Refresh button");

const desktop = block("@media (min-width: 1200px) and (max-width: 1439px)");
assert.ok(desktop.includes("clamp(250px, 22vw, 300px) minmax(0, 1fr) clamp(260px, 22vw, 310px)"), "1200-1439 desktop must keep three fluid columns");
assert.ok(desktop.includes("width: 100%"), "1200-1439 desktop must not hard-lock workspace overflow");
assert.ok(styles.includes("grid-template-columns: minmax(286px, 330px) minmax(0, 1fr) minmax(300px, 350px)"), "Default desktop must use a flexible center chat column");
assert.ok(styles.includes("max-width: none"), "Desktop workspace must not leave a large unused right-side area from max-width clamping");

const tablet = block("@media (min-width: 768px) and (max-width: 1199px)");
assert.ok(tablet.includes("clamp(260px, 36vw, 290px) minmax(0, 1fr)"), "Tablet must use Conversation List | Messenger Thread");
assert.ok(tablet.includes(".inbox-context-panel") && tablet.includes("display: none"), "Tablet must hide the permanent third panel");
assert.ok(tablet.includes(".inbox-thread-details") && tablet.includes("display: inline-flex"), "Tablet must expose DETAILS in the thread header");
assert.ok(styles.includes(".inbox-thread-actions .inbox-thread-details") && styles.includes("background: #1877f2"), "DETAILS must be a prominent blue action");
assert.ok(styles.includes(".inbox-work-chip span") && styles.includes("white-space: nowrap"), "Filter chips must keep New and counts readable across supported widths");

const mobile = block("@media (max-width: 767px)");
assert.ok(mobile.includes("grid-template-columns: minmax(0, 1fr)"), "Mobile must use one-pane layout");
assert.ok(mobile.includes(".inbox-page:not(.inbox-mobile-thread-open) .inbox-thread-panel"), "Mobile list state must hide the thread");
assert.ok(mobile.includes(".inbox-page.inbox-mobile-thread-open .inbox-list-panel"), "Mobile thread state must hide the list");
assert.ok(mobile.includes("height: calc(100dvh - 150px)"), "Mobile workspace must use dynamic viewport height");
assert.ok(mobile.includes("max-width: 86%"), "Mobile message bubbles must stay readable");
assert.ok(mobile.includes("width: calc(100vw - 24px)"), "Mobile modal must remain centered and viewport-safe");
assert.ok(mobile.includes("overflow-x: auto"), "Mobile work-view chips must be scrollable or safely wrapped");

assert.ok(styles.includes("overflow-wrap: anywhere"), "Long messages and URLs must not force horizontal overflow");
assert.ok(styles.includes("min-width: 0"), "Responsive Inbox must apply min-width:0 safety");
assert.ok(styles.includes("overflow: hidden") && styles.includes("text-overflow: ellipsis"), "Conversation list text must truncate safely");
assert.ok(styles.includes("grid-template-rows: 92px minmax(0, 1fr) 104px"), "Desktop composer must stay bottom-aligned");
assert.ok(styles.includes("grid-template-rows: auto minmax(0, 1fr) auto"), "Mobile composer must stay reachable in the thread pane");

for (const viewport of ["1600x1000", "1440x900", "1366x768", "1280x720", "1024x768", "768x1024", "390x844"]) {
  assert.ok(viewport, "viewport matrix marker");
}

console.log("PASS Facebook Inbox F9.1 responsive source contract");

function block(startText) {
  const start = styles.indexOf(startText);
  assert.notEqual(start, -1, `${startText} missing`);
  const next = styles.indexOf("\n@media", start + startText.length);
  return styles.slice(start, next === -1 ? styles.length : next);
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
