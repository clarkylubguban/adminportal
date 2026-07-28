import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const root = process.cwd();
const port = Number(process.env.WORK_CHAT_LAUNCHER_PORT || 58240);
const owner = "96000000-0000-4000-8000-000000000001";
const staff = "96000000-0000-4000-8000-000000000010";
const channelGeneral = "96000000-0000-4000-8000-000000000101";
const channelFrontDesk = "96000000-0000-4000-8000-000000000102";
const channelProduction = "96000000-0000-4000-8000-000000000103";
const received = [];

const server = createServer(handleRequest);
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const edgePath = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const userDataDir = join(tmpdir(), `trry-work-chat-launcher-${Date.now()}`);
const remotePort = port + 100;
const browser = spawn(edgePath, [
  "--headless=new",
  `--remote-debugging-port=${remotePort}`,
  `--user-data-dir=${userDataDir}`,
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "about:blank",
], { stdio: "ignore" });

try {
  const cdpUrl = await waitForCdp(remotePort);
  const cdp = await createCdp(cdpUrl);
  const desktop = await createPage(cdp, { width: 1366, height: 900, isMobile: false, deviceScaleFactor: 1 });
  await seedAuth(cdp, desktop);
  await navigate(cdp, desktop, `http://127.0.0.1:${port}/overview`);
  await waitForText(cdp, desktop, "OVERVIEW");
  await waitForSelector(cdp, desktop, "[data-work-chat-open]");

  await click(cdp, desktop, "[data-work-chat-open]");
  await assertDrawerOpen(cdp, desktop, "click opens Work Chat drawer");
  await waitForText(cdp, desktop, "GENERAL");
  await waitForText(cdp, desktop, "FRONT DESK");
  await waitForText(cdp, desktop, "PRODUCTION");
  assert.equal(await evalBool(cdp, desktop, `document.body.classList.contains("work-chat-open")`), true, "body open state set");

  await click(cdp, desktop, "[data-work-chat-close]");
  await assertDrawerClosed(cdp, desktop, "close button closes Work Chat drawer");

  await pressLauncher(cdp, desktop, "Enter");
  await assertDrawerOpen(cdp, desktop, "Enter opens Work Chat drawer");
  await press(cdp, desktop, "Escape");
  await assertDrawerClosed(cdp, desktop, "Escape closes Work Chat drawer");

  await pressLauncher(cdp, desktop, " ");
  await assertDrawerOpen(cdp, desktop, "Space opens Work Chat drawer");
  await click(cdp, desktop, "[data-work-chat-close]");

  await click(cdp, desktop, "[data-work-chat-open]");
  await waitForSelector(cdp, desktop, ".work-chat-drawer");
  await click(cdp, desktop, "[data-work-chat-open]");
  await waitForIdle(300);
  assert.equal(await evalValue(cdp, desktop, `document.querySelectorAll(".work-chat-drawer").length`), 1, "re-render does not duplicate drawer behavior");

  await navigate(cdp, desktop, `http://127.0.0.1:${port}/orders`);
  await waitForText(cdp, desktop, "ORDERS");
  await waitForSelector(cdp, desktop, "[data-work-chat-open]");
  await click(cdp, desktop, "[data-work-chat-open]");
  await assertDrawerOpen(cdp, desktop, "launcher works after route navigation");

  const mobile = await createPage(cdp, { width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });
  await seedAuth(cdp, mobile);
  await navigate(cdp, mobile, `http://127.0.0.1:${port}/overview`);
  await waitForText(cdp, mobile, "OVERVIEW");
  await click(cdp, mobile, "[data-work-chat-open]");
  await assertDrawerOpen(cdp, mobile, "mobile 390px launcher opens drawer");
  await assertEval(cdp, mobile, `document.querySelector(".work-chat-drawer").getBoundingClientRect().width <= window.innerWidth`, "mobile drawer fits viewport");

  assert.ok(received.some((item) => item.path === "/api/work-chat/bootstrap" && item.auth === "Bearer synthetic-owner-token"), "bootstrap used authenticated session");
  process.stdout.write("PASS Work Chat launcher browser interaction regression\n");
  await cdp.close();
} finally {
  browser.kill("SIGTERM");
  await new Promise((resolve) => server.close(resolve));
}

async function handleRequest(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/src/env.js") {
    return send(response, 200, "text/javascript", `window.TRRY_ADMIN_ENV = ${JSON.stringify({
      VITE_SUPABASE_URL: `http://127.0.0.1:${port}`,
      VITE_SUPABASE_ANON_KEY: "synthetic-anon-key",
      VITE_USE_SUPABASE_DATA: "true",
      VITE_ENABLE_TASK_DOMAIN: "true",
      VITE_LOCAL_TASK_QA_MODE: "false",
      VITE_ADMIN_ACCESS_CODE: "",
    }, null, 2)};\nwindow.supabase = { createClient: () => ({ channel: () => ({ on() { return this; }, subscribe(callback) { callback("SUBSCRIBED"); return this; } }), removeChannel() {}, realtime: { setAuth() {} }, storage: { from: () => ({ uploadToSignedUrl: async () => ({ error: null }) }) } }) };\n`);
  }
  if (path.startsWith("/rest/v1/")) return handleRest(request, response, path);
  if (path.startsWith("/api/")) return handleApi(request, response, path, url);
  const filePath = normalize(join(root, path === "/" || !extname(path) ? "index.html" : path));
  if (!filePath.startsWith(root)) return send(response, 403, "text/plain", "Forbidden");
  try {
    return send(response, 200, contentType(filePath), await readFile(filePath));
  } catch {
    return send(response, 404, "text/plain", "Not found");
  }
}

async function handleRest(request, response, path) {
  if (path === "/rest/v1/admin_users") {
    return sendJson(response, 200, [{
      id: "synthetic-owner",
      user_id: owner,
      email: "synthetic-owner.invalid",
      display_name: "Synthetic Owner",
      role: "owner",
      is_active: true,
    }]);
  }
  if (path === "/rest/v1/ops_inquiries") return sendJson(response, 200, []);
  if (path === "/rest/v1/catalog_products") return sendJson(response, 200, []);
  return sendJson(response, 200, []);
}

async function handleApi(request, response, path, url) {
  const auth = request.headers.authorization || "";
  received.push({ path, method: request.method, auth });
  if (auth !== "Bearer synthetic-owner-token") return sendJson(response, 401, { ok: false, error: { code: "AUTH_REQUIRED", message: "Authentication required." } });
  if (path === "/api/assignment-users") return sendJson(response, 200, { ok: true, users: [
    { userId: owner, displayName: "Synthetic Owner", role: "owner", isActive: true, assignmentEligible: true },
    { userId: staff, displayName: "Synthetic Staff", role: "staff", isActive: true, assignmentEligible: true },
  ] });
  if (path === "/api/tasks" || path === "/api/my-tasks") return sendJson(response, 200, { ok: true, tasks: [], page: 1, pageSize: 100, total: 0 });
  if (path === "/api/work-chat/bootstrap") return sendJson(response, 200, {
    ok: true,
    currentUser: { userId: owner, email: "synthetic-owner.invalid", displayName: "Synthetic Owner", role: "owner" },
    channels: [
      channel(channelGeneral, "general", "GENERAL"),
      channel(channelFrontDesk, "front-desk", "FRONT DESK"),
      channel(channelProduction, "production", "PRODUCTION"),
    ],
    orderThreads: [],
    activeUsers: [
      { userId: owner, email: "synthetic-owner.invalid", displayName: "Synthetic Owner", role: "owner" },
      { userId: staff, email: "synthetic-staff.invalid", displayName: "Synthetic Staff", role: "staff" },
    ],
    unreadByChannel: {},
    globalUnreadCount: 0,
    unreadMentionCount: 0,
    mentionMessages: [],
    defaultChannelId: channelGeneral,
  });
  const messagesMatch = path.match(/^\/api\/work-chat\/channels\/([^/]+)\/messages$/);
  if (messagesMatch && request.method === "GET") return sendJson(response, 200, { ok: true, messages: [] });
  const readMatch = path.match(/^\/api\/work-chat\/channels\/([^/]+)\/read$/);
  if (readMatch) return sendJson(response, 200, { ok: true, read: true });
  return sendJson(response, 200, { ok: true, orders: [], products: [], clients: [], inquiries: [] });
}

function channel(id, key, name) {
  return { id, channelKey: key, channelType: "STANDARD", name, updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
}

async function waitForCdp(remotePort) {
  for (let i = 0; i < 100; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${remotePort}/json/version`);
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch {}
    await waitForIdle(100);
  }
  throw new Error("Edge CDP did not become ready.");
}

async function createCdp(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(message.error.message)) : resolve(message.result || {});
  };
  return {
    send(method, params = {}, sessionId = undefined) {
      const message = { id: ++id, method, params };
      if (sessionId) message.sessionId = sessionId;
      ws.send(JSON.stringify(message));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() { ws.close(); },
  };
}

async function createPage(cdp, viewport) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, mobile: viewport.isMobile, screenWidth: viewport.width, screenHeight: viewport.height }, sessionId);
  return { targetId, sessionId };
}

async function seedAuth(cdp, page) {
  const session = {
    access_token: "synthetic-owner-token",
    refresh_token: "",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: owner, email: "synthetic-owner.invalid" },
  };
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `localStorage.setItem("trry_admin_supabase_auth_session_v1", ${JSON.stringify(JSON.stringify(session))});`,
  }, page.sessionId);
}

async function navigate(cdp, page, url) {
  await cdp.send("Page.navigate", { url }, page.sessionId);
  await waitForIdle(900);
}

async function click(cdp, page, selector) {
  assert.equal(await evalValue(cdp, page, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`), true, `selector missing: ${selector}`);
  await waitForIdle(700);
}

async function pressLauncher(cdp, page, key) {
  assert.equal(await evalValue(cdp, page, `(() => { const el = document.querySelector("[data-work-chat-open]"); if (!el) return false; el.focus(); return document.activeElement === el; })()`), true, "launcher focus failed");
  await press(cdp, page, key);
}

async function press(cdp, page, key) {
  const event = keyEvent(key);
  await cdp.send("Input.dispatchKeyEvent", { ...event, type: "rawKeyDown" }, page.sessionId);
  if (key === " ") await cdp.send("Input.dispatchKeyEvent", { ...event, type: "char", text: " " }, page.sessionId);
  await cdp.send("Input.dispatchKeyEvent", { ...event, type: "keyUp" }, page.sessionId);
  await waitForIdle(700);
}

function keyEvent(key) {
  if (key === "Escape") return { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
  if (key === " ") return { key: " ", code: "Space", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 };
  return { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
}

async function waitForText(cdp, page, text, timeout = 7000) {
  await waitFor(cdp, page, `document.body && document.body.innerText.includes(${JSON.stringify(text)})`, `text ${text}`, timeout);
}

async function waitForSelector(cdp, page, selector, timeout = 7000) {
  await waitFor(cdp, page, `document.querySelector(${JSON.stringify(selector)}) !== null`, `selector ${selector}`, timeout);
}

async function waitFor(cdp, page, expression, label, timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evalBool(cdp, page, expression)) return;
    await waitForIdle(100);
  }
  const bodyText = await evalValue(cdp, page, `document.body?.innerText?.slice(0, 3000) || ""`).catch((error) => `body read failed: ${error.message}`);
  throw new Error(`Timed out waiting for ${label}\nBody:\n${bodyText}`);
}

async function assertDrawerOpen(cdp, page, message) {
  assert.equal(await evalBool(cdp, page, `document.querySelector(".work-chat-drawer") !== null`), true, message);
}

async function assertDrawerClosed(cdp, page, message) {
  assert.equal(await evalBool(cdp, page, `document.querySelector(".work-chat-drawer") === null`), true, message);
}

async function assertEval(cdp, page, expression, message) { assert.equal(await evalBool(cdp, page, expression), true, message); }
async function evalBool(cdp, page, expression) { return Boolean(await evalValue(cdp, page, expression)); }
async function evalValue(cdp, page, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, page.sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
  return result.result?.value;
}

function sendJson(response, status, body) { send(response, status, "application/json", JSON.stringify(body)); }
function send(response, status, type, body) { response.writeHead(status, { "Content-Type": type }); response.end(body); }
function contentType(path) { return { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" }[extname(path)] || "text/plain"; }
function waitForIdle(ms = 250) { return new Promise((resolve) => setTimeout(resolve, ms)); }
