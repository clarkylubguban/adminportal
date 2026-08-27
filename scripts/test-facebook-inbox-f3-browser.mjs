import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const baseUrl = (process.env.F3_STAGING_URL || "https://adminportal-staging-fgdjb8jvk-clarkylubguban1.vercel.app").replace(/\/+$/, "");
const shareUrl = process.env.F3_VERCEL_SHARE_URL || "";
const authorizedEmail = process.env.F3_QA_EMAIL || "";
const authorizedPassword = process.env.F3_QA_PASSWORD || "";
const unauthorizedEmail = process.env.F3_QA_DENIED_EMAIL || "";
const unauthorizedPassword = process.env.F3_QA_DENIED_PASSWORD || "";
const edgePath = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const remotePort = Number(process.env.F3_BROWSER_REMOTE_PORT || 58731);
const browserTransport = process.env.F3_BROWSER_TRANSPORT || "pipe";

assert.ok(authorizedEmail, "F3_QA_EMAIL is required for staging browser acceptance");
assert.ok(authorizedPassword, "F3_QA_PASSWORD is required for staging browser acceptance");

const browserArgs = [
  "--headless=new",
  browserTransport === "pipe" ? "--remote-debugging-pipe" : `--remote-debugging-port=${remotePort}`,
  `--user-data-dir=${join(tmpdir(), `trry-f3-inbox-edge-${Date.now()}`)}`,
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "about:blank",
];
const browser = spawn(edgePath, browserArgs, {
  stdio: browserTransport === "pipe" ? ["ignore", "ignore", "ignore", "pipe", "pipe"] : "ignore",
});

let mutationRequests = [];
let countMutations = false;

try {
  const cdp = browserTransport === "pipe" ? await createPipeCdp(browser) : await createPortCdp(remotePort);
  const page = await cdp.send("Target.createTarget", { url: "about:blank" });
  await cdp.send("Target.attachToTarget", { targetId: page.targetId, flatten: true }).then((result) => cdp.sessionId = result.sessionId);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Network.enable");
  cdp.on("Network.requestWillBeSent", ({ request }) => {
    if (!countMutations || !request) return;
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    if (request.url.includes("/auth/v1/")) return;
    mutationRequests.push(`${request.method} ${request.url}`);
  });

  await setViewport(cdp, 1440, 960);
  if (shareUrl) {
    await navigate(cdp, shareUrl);
    await waitFor(cdp, `location.hostname === ${JSON.stringify(new URL(baseUrl).hostname)}`);
  }
  await signIn(cdp, authorizedEmail, authorizedPassword);
  await navigate(cdp, `${baseUrl}/inbox`);
  await waitForText(cdp, "Customer Inbox");
  await waitForText(cdp, "FACEBOOK INBOX");
  await waitFor(cdp, `document.body.innerText.includes("Customer & Operations") || document.body.innerText.includes("Unable to load Inbox")`);

  const authorizedShell = await evaluate(cdp, `(() => ({
    hasInboxNav: [...document.querySelectorAll("a,button")].some((node) => node.textContent.includes("Inbox")),
    hasDetailPanel: document.body.innerText.includes("Customer & Operations"),
    restricted: document.body.innerText.includes("Inbox access is restricted"),
  }))()`);
  assert.equal(authorizedShell.restricted, false, "authorized account must not see restricted Inbox copy");
  assert.equal(authorizedShell.hasInboxNav, true, "authorized account sees Inbox navigation");
  assert.equal(authorizedShell.hasDetailPanel, true, "authorized Inbox has Customer & Operations detail panel");

  await verifyView(cdp, "needs_reply", ["Facebook customer", "New", "Sent", "Not yet an inquiry", "Not yet captured"]);
  await verifyView(cdp, "waiting", ["TRRY_F3_QA Waiting Customer", "Waiting", "Delivered", "TRRY_F3_QA_REF_WAITING"]);
  await verifyView(cdp, "follow_up", ["TRRY_F3_QA Follow Up Customer", "Follow-up", "Seen", "TRRY_F3_QA_attachment.jpg", "pending"]);
  await verifyView(cdp, "converted", ["TRRY_F3_QA Converted Customer", "Converted", "Inquiry Link", "TRRY-NKC8675V"]);
  await verifyView(cdp, "closed", ["TRRY_F3_QA Closed Customer", "Closed"]);

  await clickView(cdp, "assigned_to_me");
  await waitForText(cdp, "No conversations in this view.");

  countMutations = true;
  mutationRequests = [];
  await evaluate(cdp, `(() => {
    for (const node of document.querySelectorAll("button:disabled, textarea:disabled")) {
      node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      node.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    }
    return document.querySelectorAll("button:disabled, textarea:disabled").length;
  })()`);
  await delay(500);
  countMutations = false;
  assert.deepEqual(mutationRequests, [], `F3 disabled controls must not issue mutation requests: ${mutationRequests.join(", ")}`);

  for (const width of [1366, 1440, 1600, 1920]) {
    await setViewport(cdp, width, 960);
    await navigate(cdp, `${baseUrl}/inbox`);
    await waitForText(cdp, "Customer Inbox");
    await waitForText(cdp, "Customer & Operations");
    const layout = await evaluate(cdp, `(() => {
      const grid = document.querySelector(".inbox-grid");
      const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length : 0;
      return {
        columns,
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 2,
        hasList: Boolean(document.querySelector(".inbox-list")),
        hasThread: Boolean(document.querySelector(".inbox-thread")),
        hasDetails: Boolean(document.querySelector(".inbox-detail-panel")),
      };
    })()`);
    assert.equal(layout.hasList, true, `conversation list exists at ${width}`);
    assert.equal(layout.hasThread, true, `message thread exists at ${width}`);
    assert.equal(layout.hasDetails, true, `detail panel exists at ${width}`);
    assert.ok(layout.columns >= 3, `Inbox uses three-column desktop layout at ${width}`);
    assert.equal(layout.overflowX, false, `Inbox has no horizontal overflow at ${width}`);
  }

  if (unauthorizedEmail && unauthorizedPassword) {
    await signOut(cdp);
    await signIn(cdp, unauthorizedEmail, unauthorizedPassword);
    await navigate(cdp, `${baseUrl}/inbox`);
    await waitFor(cdp, `document.body.innerText.includes("Inbox access is restricted") || document.body.innerText.includes("Access restricted")`);
    const denied = await evaluate(cdp, `document.body.innerText.includes("TRRY_F3_QA")`);
    assert.equal(denied, false, "unauthorized account must not read Inbox QA conversations");
  }

  console.log("PASS Facebook Inbox F3 staging browser acceptance");
} finally {
  browser.kill();
}

async function verifyView(cdp, viewKey, expectedTexts) {
  await clickView(cdp, viewKey);
  await waitFor(cdp, `document.querySelector('[data-inbox-conversation]')`);
  await evaluate(cdp, `document.querySelector('[data-inbox-conversation]')?.click()`);
  for (const text of expectedTexts) await waitForText(cdp, text);
}

async function clickView(cdp, viewKey) {
  const escaped = JSON.stringify(viewKey);
  await waitFor(cdp, `document.querySelector('[data-inbox-view=' + ${escaped} + ']')`);
  await evaluate(cdp, `document.querySelector('[data-inbox-view=' + ${escaped} + ']').click()`);
}

async function signIn(cdp, emailAddress, passwordValue) {
  await navigate(cdp, `${baseUrl}/login`);
  await waitFor(cdp, `document.querySelector("#admin-login-email") && document.querySelector("#admin-login-password")`);
  await evaluate(cdp, `(() => {
    const email = document.querySelector("#admin-login-email");
    const password = document.querySelector("#admin-login-password");
    email.value = ${JSON.stringify(emailAddress)};
    password.value = ${JSON.stringify(passwordValue)};
    email.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: email.value }));
    password.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: password.value }));
    document.querySelector("#admin-login-form").requestSubmit();
  })()`);
  await waitFor(cdp, `document.body && !document.body.innerText.includes("Invalid login") && !document.body.innerText.includes("Unauthorized or disabled admin account.")`);
  await delay(1500);
}

async function signOut(cdp) {
  await navigate(cdp, `${baseUrl}/login`);
  await evaluate(cdp, `localStorage.clear(); sessionStorage.clear();`);
}

async function setViewport(cdp, width, height) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
}

async function waitForBrowser(portValue) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${portValue}/json/version`);
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch {
      await delay(250);
    }
  }
  throw new Error("Browser CDP endpoint did not start.");
}

async function createPortCdp(portValue) {
  const wsUrl = await waitForBrowser(portValue);
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const handlers = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result || {});
      return;
    }
    for (const handler of handlers.get(message.method) || []) handler(message.params || {});
  });
  return {
    sessionId: "",
    on(method, handler) {
      handlers.set(method, [...(handlers.get(method) || []), handler]);
    },
    send(method, params = {}) {
      const message = { id: ++id, method, params };
      if (this.sessionId && !method.startsWith("Target.")) message.sessionId = this.sessionId;
      socket.send(JSON.stringify(message));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
  };
}

async function createPipeCdp(child) {
  const pipeIn = child.stdio[3];
  const pipeOut = child.stdio[4];
  assert.ok(pipeIn && pipeOut, "Browser pipe transport did not expose stdio pipes");
  let id = 0;
  let buffer = "";
  const pending = new Map();
  const handlers = new Map();
  pipeOut.setEncoding("utf8");
  pipeOut.on("data", (chunk) => {
    buffer += chunk;
    let boundary = buffer.indexOf("\0");
    while (boundary >= 0) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 1);
      boundary = buffer.indexOf("\0");
      if (!raw) continue;
      const message = JSON.parse(raw);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        message.error ? reject(new Error(message.error.message)) : resolve(message.result || {});
        continue;
      }
      for (const handler of handlers.get(message.method) || []) handler(message.params || {});
    }
  });
  const cdp = {
    sessionId: "",
    on(method, handler) {
      handlers.set(method, [...(handlers.get(method) || []), handler]);
    },
    send(method, params = {}) {
      const message = { id: ++id, method, params };
      if (this.sessionId && !method.startsWith("Target.")) message.sessionId = this.sessionId;
      pipeIn.write(`${JSON.stringify(message)}\0`);
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
  };
  await cdp.send("Browser.getVersion");
  return cdp;
}

async function navigate(cdp, url) {
  await cdp.send("Page.navigate", { url });
  await waitFor(cdp, `document.readyState === "complete"`);
}

async function waitForText(cdp, text) {
  await waitFor(cdp, `document.body && document.body.innerText.includes(${JSON.stringify(text)})`);
}

async function waitFor(cdp, expression) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const result = await evaluate(cdp, expression);
    if (result) return;
    await delay(125);
  }
  const debug = await evaluate(cdp, `({
    href: location.href,
    text: (document.body?.innerText || "").slice(0, 1200),
    html: (document.body?.innerHTML || "").slice(0, 1200),
  })`);
  throw new Error(`Timed out waiting for: ${expression}\n${JSON.stringify(debug, null, 2)}`);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Evaluation failed");
  return result.result?.value;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

