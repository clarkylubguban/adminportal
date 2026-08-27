import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile("src/main.js", "utf8");
const service = await readFile("src/services/adminInbox.js", "utf8");
const styles = await readFile("src/styles.css", "utf8");

assert.ok(main.includes("refreshInboxFacebookProfile"), "F8.1 UI must use the authenticated profile refresh service");
assert.ok(main.includes("data-inbox-refresh-facebook-profile"), "F8.1 Inbox details must render a refresh profile action hook");
assert.ok(main.includes("FETCH FACEBOOK NAME"), "missing Facebook names must show the fetch label");
assert.ok(main.includes("CHECKING FACEBOOK..."), "profile refresh loading state must be visible");
assert.ok(main.includes("Facebook name unavailable"), "profile refresh failures must be safe and compact");
assert.ok(main.includes("await refreshInboxSelection()"), "successful profile refresh must reload Inbox rows");
assert.ok(main.includes("inboxSelectedConversationId = conversation.id"), "successful profile refresh must preserve selected conversation");
assert.ok(main.includes("force: true"), "F8.1 click action must request a forced server-side refresh");
assert.ok(service.includes('postInboxAction(authSession, conversationId, "refresh-profile", { force })'), "service wrapper must post to the existing refresh-profile endpoint");
assert.ok(styles.includes(".inbox-profile-refresh"), "profile refresh UI must have compact styling");

const renderInboxFacebookNameRefresh = loadRenderFunction();
assert.match(
  renderInboxFacebookNameRefresh({ id: "conv-1", customerLabel: "Facebook customer" }, { canAccess: true }),
  /data-inbox-refresh-facebook-profile[\s\S]*FETCH FACEBOOK NAME/,
  "missing Facebook customer names must show the refresh action"
);
assert.equal(
  renderInboxFacebookNameRefresh({ id: "conv-1", customerLabel: "Juan Dela Cruz" }, { canAccess: true }),
  "",
  "existing Facebook names must hide the refresh action"
);
assert.equal(
  renderInboxFacebookNameRefresh({ id: "conv-1", customerLabel: "Facebook customer" }, { canAccess: false }),
  "",
  "Inbox refresh action must require Inbox access"
);
assert.match(
  renderInboxFacebookNameRefresh({ id: "conv-1", customerLabel: "Facebook customer" }, { canAccess: true, state: "loading" }),
  /disabled[\s\S]*CHECKING FACEBOOK\.\.\./,
  "loading state must disable the action and show checking label"
);
assert.match(
  renderInboxFacebookNameRefresh({ id: "conv-1", customerLabel: "Facebook customer" }, { canAccess: true, state: "blocked", message: "Facebook name unavailable (2018247)" }),
  /Facebook name unavailable \(2018247\)/,
  "Meta denied state must show safe error only"
);

const success = await runRefreshAction({
  refreshResult: { ok: true, status: "updated", displayName: "Juan Dela Cruz", fields: {} },
});
assert.equal(success.refreshCalls.length, 1, "refresh action must call the service once");
assert.deepEqual(success.refreshCalls[0], { token: "session-token", conversationId: "conv-1", force: true });
assert.equal(success.refreshSelectionCalls, 1, "successful refresh must reload Inbox rows");
assert.equal(success.state.inboxSelectedConversationId, "conv-1", "successful refresh must preserve selected conversation");
assert.equal(success.state.inboxProfileRefreshMessage, "", "successful refresh must clear blocked message");

const denied = await runRefreshAction({
  refreshResult: { ok: false, error: "2018247" },
});
assert.equal(denied.refreshSelectionCalls, 0, "Meta denied refresh must not reload as success");
assert.equal(denied.state.inboxProfileRefreshState, "blocked");
assert.equal(denied.state.inboxProfileRefreshMessage, "Facebook name unavailable (2018247)");

const renderedUi = renderInboxFacebookNameRefresh({ id: "conv-1", customerLabel: "Facebook customer" }, { canAccess: true, state: "blocked", message: "Facebook name unavailable (2018247)" });
assert.equal(/PSID|PAGE_ACCESS_TOKEN|META_PAGE_ACCESS_TOKEN|service_role|Bearer|raw Meta/i.test(renderedUi), false, "new UI must not expose PSID, tokens, service role, or raw Meta responses");

console.log("PASS Facebook Inbox F8.1 browser/source profile refresh acceptance");

function loadRenderFunction() {
  const source = extractFunctionSource("renderInboxFacebookNameRefresh");
  return (conversation, options = {}) => Function(
    "conversation",
    "canAccessInbox",
    "state",
    "message",
    `"use strict";
    const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\"": "&quot;", "'": "&#39;" }[char]));
    const canViewInboxRoute = () => canAccessInbox;
    let inboxProfileRefreshState = state || "idle";
    let inboxProfileRefreshMessage = message || "";
    return (${source})(conversation);`,
  )(conversation, options.canAccess !== false, options.state || "idle", options.message || "");
}

async function runRefreshAction({ refreshResult }) {
  const source = extractFunctionSource("refreshSelectedInboxFacebookProfile");
  const formatSource = extractFunctionSource("formatInboxProfileRefreshError");
  const state = {
    inboxProfileRefreshState: "idle",
    inboxProfileRefreshMessage: "",
    inboxMutationError: "",
    inboxSelectedConversationId: "",
  };
  const refreshCalls = [];
  let renderCalls = 0;
  let refreshSelectionCalls = 0;
  await Function(
    "state",
    "refreshCalls",
    "refreshResult",
    `"use strict";
    let inboxProfileRefreshState = state.inboxProfileRefreshState;
    let inboxProfileRefreshMessage = state.inboxProfileRefreshMessage;
    let inboxMutationError = state.inboxMutationError;
    let inboxSelectedConversationId = state.inboxSelectedConversationId;
    const adminAuthSession = { access_token: "session-token" };
    const getSelectedInboxConversation = () => ({ id: "conv-1", customerLabel: "Facebook customer" });
    const render = () => { state.renderCalls = (state.renderCalls || 0) + 1; };
    const refreshInboxSelection = async () => { state.refreshSelectionCalls = (state.refreshSelectionCalls || 0) + 1; };
    const refreshInboxFacebookProfile = async (authSession, conversationId, options) => {
      refreshCalls.push({ token: authSession.access_token, conversationId, force: options.force });
      return refreshResult;
    };
    const formatInboxProfileRefreshError = ${formatSource};
    return (async () => {
      await (${source})();
      state.inboxProfileRefreshState = inboxProfileRefreshState;
      state.inboxProfileRefreshMessage = inboxProfileRefreshMessage;
      state.inboxMutationError = inboxMutationError;
      state.inboxSelectedConversationId = inboxSelectedConversationId;
    })();`,
  )(state, refreshCalls, refreshResult);
  renderCalls = state.renderCalls || 0;
  refreshSelectionCalls = state.refreshSelectionCalls || 0;
  assert.ok(renderCalls >= 2, "profile refresh action must rerender around async work");
  return { state, refreshCalls, refreshSelectionCalls };
}

function extractFunctionSource(name) {
  let start = main.indexOf(`async function ${name}`);
  if (start === -1) start = main.indexOf(`function ${name}`);
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
