import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { INBOX_WORK_VIEWS } from "../src/services/adminInbox.js";

const main = await readFile("src/main.js", "utf8");
const dashboard = await readFile("src/mvpDashboard.js", "utf8");
const f5Browser = await readFile("scripts/test-facebook-inbox-f5-browser.mjs", "utf8");

assert.ok(main.includes("function getInboxDeepLinkConversationId"), "Inbox must parse ?conversation= deep links");
assert.ok(main.includes("new URLSearchParams(window.location.search).get(\"conversation\")"), "Inbox deep links must use the conversation query parameter");
assert.ok(main.includes("function isUuid"), "Inbox deep link ids must be UUID-shaped");
assert.ok(main.includes("requestedConversationId"), "Inbox load must look for the requested deep-link conversation");
assert.ok(main.includes("inboxConversations.find((conversation) => conversation.id === requestedConversationId)"), "Deep link must resolve against conversations returned by the authenticated Inbox read");
assert.ok(main.includes("inboxActiveView = getInboxViewKeyForConversation(requestedConversation)"), "Deep link must switch to the matching visible conversation view");
assert.equal(main.includes("INBOX_VIEWS.some"), false, "Inbox deep-link view lookup must not reference a missing INBOX_VIEWS constant");
assert.ok(main.includes("INBOX_WORK_VIEWS.some"), "Inbox deep-link view lookup must use the imported INBOX_WORK_VIEWS");
assert.ok(main.includes("if (!requestedConversation && !visible.some"), "Invalid or inaccessible deep links must fall back safely");
assert.ok(main.includes('if (routePath === "/inbox" && !canViewInboxRoute()) return defaultRoutePath;'), "normalizeRoutePath must keep the Inbox permission gate");
assert.ok(main.includes('if (path === "/inbox" && !canViewInboxRoute()) return defaultRoutePath;'), "getRoutePath must keep the Inbox permission gate");
assert.ok(main.includes('window.history.replaceState({}, "", "/inbox")'), "Manual Inbox view changes must clear stale conversation deep links");
assert.ok(main.includes("data-ops-view-inbox"), "Classic Ops drawer must support linked Inquiry -> Inbox navigation");
assert.ok(main.includes("openInbox: openInboxConversation"), "MVP dashboard must receive the Inbox navigation callback");
assert.ok(main.includes("async function openInboxInquiry"), "Inbox VIEW INQUIRY handler must exist");
assert.ok(main.includes("navigateTo(`/inquiries?inquiry=${encodeURIComponent(canonicalInquiryId)}`)"), "Inbox VIEW INQUIRY must carry the exact Inquiry identity in the URL");
assert.ok(main.includes("mvpDashboard.state.inquiryId = canonicalInquiryId"), "Inbox VIEW INQUIRY must select the exact MVP Inquiry drawer");
assert.ok(main.includes("mvpDashboard.state.inquiryTab = null"), "Inbox VIEW INQUIRY must open the normal drawer state");
assert.ok(main.includes("syncMvpInquiryDeepLinkSelection(items)"), "Inquiries page must sync direct deep links during render");
assert.ok(main.includes('new URLSearchParams(window.location.search).get("inquiry")'), "Inquiries page must support /inquiries?inquiry=<id>");
assert.ok(main.includes("items.some((item) => item.id === inquiryId) ? inquiryId : null"), "Invalid Inquiry deep links must clear selection instead of opening an unrelated drawer");

assert.ok(dashboard.includes("item.inboxConversationId") && dashboard.includes("data-mvp-view-inbox=") && dashboard.includes("VIEW INBOX"), "Linked inquiries must replace the generic Messenger action with VIEW INBOX");
assert.ok(dashboard.includes(': `<button type="button" data-mvp-open-messenger>Open Messenger</button>`'), "Unlinked inquiries must not get VIEW INBOX");
assert.ok(dashboard.includes("await openInbox?.(button.dataset.mvpViewInbox)"), "VIEW INBOX must call the internal app route callback");
assert.ok(dashboard.includes("data-mvp-open-messenger") && dashboard.includes("window.open(\"https://www.messenger.com/\""), "Existing generic Messenger fallback must remain available for unlinked inquiries");
assert.ok(dashboard.includes('const selected = inquiries.find((item) => item.id === (state.inquiryId || query("inquiry")))'), "Existing MVP Inquiry drawer must open from state or canonical query");
assert.ok(dashboard.includes('priority(item, "Customer follow-up due"') && dashboard.includes('`/inquiries?inquiry=${encodeURIComponent(item.id)}`'), "Existing normal Inquiry deep-link navigation must remain unchanged");

assert.ok(main.includes("CONVERT INQUIRY"), "F5 CONVERT INQUIRY label must remain unchanged");
assert.ok(main.includes("CONVERTING..."), "F5 converting state must remain unchanged");
assert.ok(main.includes("VIEW INQUIRY"), "F5 post-conversion VIEW INQUIRY state must remain unchanged");
assert.ok(f5Browser.includes("CONVERT INQUIRY"), "F5 browser assertion must stay aligned to CONVERT INQUIRY");

assert.equal(/odoo/i.test(main.match(/openInboxConversation[\s\S]*?async function submitInboxReply/)?.[0] || ""), false, "F7 Inbox deep linking must not depend on Odoo");

const getInboxViewKeyForConversation = loadMainFunction("getInboxViewKeyForConversation", ["INBOX_WORK_VIEWS"], [INBOX_WORK_VIEWS]);
for (const state of ["needs_reply", "waiting", "follow_up", "converted", "closed"]) {
  assert.equal(getInboxViewKeyForConversation({ state }), state, `${state} must resolve to the matching Inbox view`);
}
assert.equal(getInboxViewKeyForConversation({ state: "unexpected" }), "all", "Unknown Inbox states must fall back to all");
assert.doesNotThrow(() => getInboxViewKeyForConversation({ state: "converted" }), "Inbox deep-link view lookup must not throw ReferenceError");

const deepLinkBody = extractFunctionBody("loadInboxConversations");
assert.ok(deepLinkBody.includes("const requestedConversationId = getInboxDeepLinkConversationId()"), "Inbox deep-link load path must read the requested conversation");
assert.ok(deepLinkBody.includes("inboxSelectedConversationId = requestedConversation.id"), "Inbox deep-link load path must select the exact conversation");
assert.ok(deepLinkBody.includes('resetInboxSelectionDetailState("idle")'), "Inbox deep-link load path must put detail loading into idle state");
assert.ok(deepLinkBody.includes("window.setTimeout(() => loadInboxConversationDetail(inboxSelectedConversationId), 0)"), "Inbox deep-link load path must load detail for the selected conversation");

console.log("PASS Facebook Inbox F7 browser/source acceptance");

function loadMainFunction(name, argNames, argValues) {
  const source = extractFunctionSource(name);
  return Function(...argNames, `"use strict"; return (${source});`)(...argValues);
}

function extractFunctionBody(name) {
  const source = extractFunctionSource(name);
  return source.slice(source.indexOf("{") + 1, source.lastIndexOf("}"));
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
