import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const root = process.cwd();
const port = Number(process.env.AUTO_PLAN_BROWSER_PORT || 58270);
const screenshotDir = join(root, "qa-screens", "phase-8-7-auto-plan");
const owner = "95000000-0000-4000-8000-000000000001";
const staffA = "95000000-0000-4000-8000-000000000010";
let activeQaRole = "owner";
let syntheticNow = Date.now();
const receivedPlans = [];

const users = {
  [owner]: { displayName: "Synthetic Owner", initials: "SO", role: "owner", isActive: true },
  [staffA]: { displayName: "Synthetic Staff A", initials: "SA", role: "staff", isActive: true },
};

const tasks = new Map([
  task("task-existing", "WB-AP-001", "[DRY RUN] Existing active task", "TO_DO"),
]);

await mkdir(screenshotDir, { recursive: true });
const server = createServer(handleRequest);
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const edgePath = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const userDataDir = join(tmpdir(), `trry-auto-plan-edge-${Date.now()}`);
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
  const cdp = await createCdp(await waitForCdp(remotePort));
  const desktop = await createPage(cdp, { width: 1366, height: 900, isMobile: false, deviceScaleFactor: 1 });
  await navigate(cdp, desktop, `http://127.0.0.1:${port}/workboard?qaRole=owner`);
  await waitForText(cdp, desktop, "AUTO PLAN TODAY");
  await waitForText(cdp, desktop, "Quick Direction");
  await setValue(cdp, desktop, "#auto-plan-quick-direction", "  Plan a safe synthetic campaign today  ");
  await Promise.all([
    click(cdp, desktop, "[data-auto-plan-submit]"),
    click(cdp, desktop, "[data-auto-plan-submit]"),
  ]);
  await waitForText(cdp, desktop, "2 drafts received");
  assert.equal(receivedPlans.length, 1, "duplicate clicks should not create duplicate planning requests");
  assert.equal(receivedPlans[0].body.quickDirection, "Plan a safe synthetic campaign today");
  await waitForText(cdp, desktop, "Codex auto plan marketing draft");
  await clickWorkboardTask(cdp, desktop, "Codex auto plan marketing draft");
  await waitForText(cdp, desktop, "AI-GENERATED DRAFT");
  await waitForText(cdp, desktop, "Owner approval activates it");
  await screenshot(cdp, desktop, "desktop-owner-auto-plan-draft.png");

  const mobile = await createPage(cdp, { width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });
  await navigate(cdp, mobile, `http://127.0.0.1:${port}/workboard?qaRole=owner`);
  await waitForText(cdp, mobile, "AUTO PLAN TODAY");
  await assertEval(cdp, mobile, `document.scrollingElement.scrollWidth <= window.innerWidth + 2`, "390px no overflow");
  await screenshot(cdp, mobile, "mobile-390-auto-plan.png");

  const narrow = await createPage(cdp, { width: 360, height: 780, isMobile: true, deviceScaleFactor: 2 });
  await navigate(cdp, narrow, `http://127.0.0.1:${port}/workboard?qaRole=owner`);
  await waitForText(cdp, narrow, "AUTO PLAN TODAY");
  await assertEval(cdp, narrow, `document.scrollingElement.scrollWidth <= window.innerWidth + 2`, "360px no overflow");

  await navigate(cdp, desktop, `http://127.0.0.1:${port}/workboard?qaRole=admin`);
  await waitForText(cdp, desktop, "Workboard");
  await assertEval(cdp, desktop, `document.body.innerText.includes('AUTO PLAN TODAY') === false`, "admin auto plan hidden");
  assert.equal(await evalValue(cdp, desktop, `fetch('/api/planning/auto-plan-today', { method: 'POST', headers: { 'content-type': 'application/json', 'authorization': 'Bearer synthetic-staff-a-token', 'idempotency-key': 'admin-denied' }, body: JSON.stringify({ quickDirection: 'deny' }) }).then((r) => r.status)`), 403);

  await navigate(cdp, desktop, `http://127.0.0.1:${port}/workboard?qaRole=staff`);
  await waitForText(cdp, desktop, "Overview");
  await assertEval(cdp, desktop, `document.body.innerText.includes('AUTO PLAN TODAY') === false`, "staff auto plan hidden");
  assert.equal(await evalValue(cdp, desktop, `fetch('/api/planning/auto-plan-today', { method: 'POST', headers: { 'content-type': 'application/json', 'authorization': 'Bearer synthetic-staff-a-token', 'idempotency-key': 'staff-denied' }, body: JSON.stringify({ quickDirection: 'deny' }) }).then((r) => r.status)`), 403);

  await cdp.close();
  process.stdout.write(`PASS Auto Plan Today browser QA with screenshots in ${screenshotDir}\n`);
} finally {
  browser.kill("SIGTERM");
  await new Promise((resolve) => server.close(resolve));
}

async function handleRequest(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path.startsWith("/api/")) return handleApi(request, response, path, url);
  if (path === "/src/env.js") {
    const referer = new URL(request.headers.referer || `http://${request.headers.host}/workboard?qaRole=owner`);
    activeQaRole = referer.searchParams.get("qaRole") || "owner";
    const qaUserId = activeQaRole === "staff" ? staffA : owner;
    return send(response, 200, "text/javascript", `window.TRRY_ADMIN_ENV = ${JSON.stringify({ VITE_USE_SUPABASE_DATA: "false", VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "", VITE_ENABLE_TASK_DOMAIN: "true", VITE_ENABLE_WORKBOARD: "true", VITE_ENABLE_MY_TASKS: "false", VITE_ENABLE_CALENDAR: "false", VITE_ENABLE_AUTO_PLAN_TODAY: "true", VITE_LOCAL_TASK_QA_MODE: "true", VITE_LOCAL_TASK_QA_ROLE: activeQaRole, VITE_LOCAL_TASK_QA_USER_ID: qaUserId, VITE_ADMIN_ACCESS_CODE: "" }, null, 2)};\n`);
  }
  const filePath = normalize(join(root, path === "/" || !extname(path) ? "index.html" : path));
  if (!filePath.startsWith(root)) return send(response, 403, "text/plain", "Forbidden");
  try {
    const body = await readFile(filePath);
    send(response, 200, contentType(filePath), body);
  } catch {
    send(response, 404, "text/plain", "Not found");
  }
}

async function handleApi(request, response, path, url) {
  const body = await readJsonBody(request);
  if (request.headers.authorization !== "Bearer synthetic-staff-a-token") return sendJson(response, 401, { ok: false, error: { code: "AUTH_REQUIRED", message: "Authentication required." } });
  if (path === "/api/assignment-users") {
    return sendJson(response, 200, {
      ok: true,
      users: Object.entries(users).map(([id, user]) => ({
        id: `assignment-${id}`,
        userId: id,
        displayName: user.displayName,
        role: user.role,
        initials: user.initials,
        isActive: user.isActive,
        assignmentEligible: user.isActive,
      })),
    });
  }
  if (path === "/api/planning/auto-plan-today") {
    if (activeQaRole !== "owner") return sendJson(response, 403, { ok: false, error: { code: "FORBIDDEN", message: "Auto Plan Today is Owner-only." } });
    if (body.requestedBy || body.n8nEndpoint || body.maximumTasks) return sendJson(response, 400, { ok: false, error: { code: "VALIDATION_ERROR", message: "Browser may not choose planning authority." } });
    receivedPlans.push({ body: { quickDirection: String(body.quickDirection || "").trim().replace(/\s+/g, " ") } });
    await waitForIdle(180);
    addAutomationDrafts();
    return sendJson(response, 202, { ok: true, request: { id: "plan-ui", requestCode: "PLN-AUTOPLANUI", status: "COMPLETED", quickDirection: receivedPlans.at(-1).body.quickDirection, maximumTasks: 3, requestedAt: new Date().toISOString(), completedAt: new Date().toISOString() }, traceCode: "PLN-AUTOPLANUI", draftsReceived: 2, draftTaskIds: ["task-auto-1", "task-auto-2"], dispatchStatus: "COMPLETED", replayed: false });
  }
  if (path === "/api/tasks" && request.method === "GET") {
    const status = url.searchParams.get("status") || "";
    const visible = [...tasks.values()].filter((item) => (!status || item.status === status) && !item.archivedAt);
    return sendJson(response, 200, { ok: true, tasks: visible.map(project), page: 1, pageSize: 100, total: visible.length });
  }
  const match = path.match(/^\/api\/tasks\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Task resource not found." } });
  const current = tasks.get(match[1]);
  if (!current) return sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Task resource not found." } });
  if (!match[2] && request.method === "GET") return sendJson(response, 200, detail(current));
  return sendJson(response, 200, mutation(current));
}

function addAutomationDrafts() {
  if (tasks.has("task-auto-1")) return;
  tasks.set("task-auto-1", task("task-auto-1", "WB-AP-101", "Codex auto plan marketing draft", "DRAFT", { sourceType: "AI_MARKETING", assignedUserId: null, reviewerUserId: null, automationTrace: true })[1]);
  tasks.set("task-auto-2", task("task-auto-2", "WB-AP-102", "Codex auto plan daily content draft", "DRAFT", { sourceType: "DAILY_CONTENT", assignedUserId: null, reviewerUserId: null, automationTrace: true })[1]);
}

function task(id, code, title, status, overrides = {}) {
  return [id, {
    id,
    taskCode: code,
    title,
    brief: `Synthetic Auto Plan brief for ${code}. No customer, payment, artwork, phone, or private staff data.`,
    sourceType: overrides.sourceType || "MANUAL",
    sourceRecordType: null,
    sourceRecordId: null,
    status,
    priority: "MEDIUM",
    timeTrackingMode: "EXPECTED",
    assignedUserId: Object.hasOwn(overrides, "assignedUserId") ? overrides.assignedUserId : staffA,
    reviewerUserId: Object.hasOwn(overrides, "reviewerUserId") ? overrides.reviewerUserId : owner,
    assignedUser: users[Object.hasOwn(overrides, "assignedUserId") ? overrides.assignedUserId : staffA] || null,
    reviewerUser: users[Object.hasOwn(overrides, "reviewerUserId") ? overrides.reviewerUserId : owner] || null,
    draftApprovalRequired: overrides.sourceType === "AI_MARKETING" || overrides.sourceType === "DAILY_CONTENT",
    scheduledDate: null,
    startDeadline: null,
    submissionDeadline: iso(24),
    approvalDeadline: null,
    version: 1,
    completedAt: null,
    cancelledAt: null,
    archivedAt: null,
    createdAt: iso(-1),
    updatedAt: iso(-1),
    openTimeEntry: null,
    totalClosedDurationSeconds: 0,
    automationTrace: overrides.automationTrace ? { planningRequestId: "plan-ui", automationReceiptId: "receipt-ui", externalTaskId: `${id}-external`, suggestedAssignee: { label: "Suggestion only", reason: "Synthetic capacity hint" } } : undefined,
    allowedActions: [],
  }];
}

function project(current) {
  return { ...current, allowedActions: allowed(current) };
}

function allowed(current) {
  if (current.status === "DRAFT") {
    if (activeQaRole === "admin" && ["AI_MARKETING", "DAILY_CONTENT"].includes(current.sourceType)) return [];
    if (activeQaRole === "staff") return [];
    return ["EDIT_DRAFT", "APPROVE_AND_ASSIGN", "CANCEL"];
  }
  return activeQaRole === "staff" ? [] : ["ASSIGN", "CANCEL"];
}

function detail(current) {
  return { ok: true, task: project(current), submissions: [], timeEntries: [], history: [] };
}

function mutation(current) {
  current.version += 1;
  return { ok: true, ...detail(current), allowedActions: project(current).allowedActions, serverTime: new Date().toISOString(), currentVersion: current.version };
}

function iso(hoursOffset) {
  return new Date(syntheticNow + hoursOffset * 3600000).toISOString();
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, status, body) { send(response, status, "application/json", JSON.stringify(body)); }
function send(response, status, type, body) { response.writeHead(status, { "Content-Type": type }); response.end(body); }
function contentType(path) { return { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" }[extname(path)] || "text/plain"; }

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
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result || {});
    }
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
  return sessionId;
}

async function navigate(cdp, sessionId, url) {
  await cdp.send("Page.navigate", { url }, sessionId);
  await waitForLoad(cdp, sessionId);
}

async function waitForLoad(cdp, sessionId) {
  for (let i = 0; i < 100; i += 1) {
    const state = await evalValue(cdp, sessionId, "document.readyState");
    if (state === "complete") return;
    await waitForIdle(100);
  }
  throw new Error("Page did not load.");
}

async function waitForText(cdp, sessionId, text) {
  const needle = JSON.stringify(text);
  for (let i = 0; i < 120; i += 1) {
    if (await evalValue(cdp, sessionId, `document.body.innerText.includes(${needle})`)) return;
    await waitForIdle(100);
  }
  const body = await evalValue(cdp, sessionId, "document.body.innerText");
  throw new Error(`Text not found: ${text}\n${body.slice(0, 1200)}`);
}

async function click(cdp, sessionId, selector) {
  await evalValue(cdp, sessionId, `document.querySelector(${JSON.stringify(selector)})?.click()`);
  await waitForIdle(80);
}

async function clickWorkboardTask(cdp, sessionId, label) {
  const js = `{
    const button = [...document.querySelectorAll('[data-workboard-open]')].find((item) => item.innerText.includes(${JSON.stringify(label)}));
    if (!button) throw new Error('task button not found');
    button.click();
  }`;
  await evalValue(cdp, sessionId, js);
  await waitForIdle(150);
}

async function setValue(cdp, sessionId, selector, value) {
  const js = `{
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) throw new Error('input not found');
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }`;
  await evalValue(cdp, sessionId, js);
}

async function assertEval(cdp, sessionId, expression, message) {
  assert.equal(await evalValue(cdp, sessionId, expression), true, message);
}

async function evalValue(cdp, sessionId, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime evaluation failed.");
  return result.result.value;
}

async function screenshot(cdp, sessionId, name) {
  const result = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, sessionId);
  await writeFile(join(screenshotDir, name), Buffer.from(result.data, "base64"));
}

function waitForIdle(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
