import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const root = process.cwd();
const port = Number(process.env.CALENDAR_BROWSER_PORT || 58240);
const screenshotDir = join(root, "qa-screens", "phase-8-6-calendar");
const owner = "95000000-0000-4000-8000-000000000001";
const admin = "95000000-0000-4000-8000-000000000002";
const staffA = "95000000-0000-4000-8000-000000000010";
const staffB = "95000000-0000-4000-8000-000000000011";
const received = [];
let activeQaRole = "owner";
let activeQaUserId = owner;

const users = {
  [owner]: { displayName: "Synthetic Owner", initials: "SO", role: "owner", isActive: true },
  [admin]: { displayName: "Synthetic Admin", initials: "SA", role: "admin", isActive: true },
  [staffA]: { displayName: "Synthetic Staff A", initials: "SA", role: "staff", isActive: true },
  [staffB]: { displayName: "Synthetic Staff B", initials: "SB", role: "staff", isActive: true },
};

const events = [
  event("task-multi", "CAL-001", "Synthetic multi-date task", "scheduledStart", "SCHEDULED START", "2026-08-03T00:00:00.000Z", staffA, "MANUAL", "TO_DO", "HIGH"),
  event("task-multi", "CAL-001", "Synthetic multi-date task", "taskDeadline", "TASK DEADLINE", "2026-08-03T15:30:00.000Z", staffA, "MANUAL", "TO_DO", "HIGH", true),
  event("task-review", "CAL-002", "Synthetic review deadline task", "reviewDeadline", "REVIEW DEADLINE", "2026-08-04T16:00:00.000Z", staffA, "PRODUCTION", "FOR_REVIEW", "URGENT"),
  event("task-done", "CAL-003", "Synthetic completed task", "completed", "COMPLETED", "2026-08-02T05:00:00.000Z", staffA, "SHOP_TASK", "DONE", "LOW"),
  event("task-other", "CAL-004", "Synthetic Staff B private task", "taskDeadline", "TASK DEADLINE", "2026-08-03T06:00:00.000Z", staffB, "MANUAL", "TO_DO", "MEDIUM"),
];

await mkdir(screenshotDir, { recursive: true });
const server = createServer(handleRequest);
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const edgePath = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const userDataDir = join(tmpdir(), `trry-calendar-edge-${Date.now()}`);
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

let cdp;
try {
  const cdpUrl = await waitForCdp(remotePort);
  cdp = await createCdp(cdpUrl);
  const desktop = await createPage(cdp, { width: 1366, height: 900, isMobile: false, deviceScaleFactor: 1 });
  await navigate(cdp, desktop, `http://127.0.0.1:${port}/calendar?qaRole=owner`);
  await waitForText(cdp, desktop, "Calendar");
  await waitForText(cdp, desktop, "SCHEDULED START");
  await waitForText(cdp, desktop, "Read-only task schedule");
  await waitForText(cdp, desktop, "SUBMISSION DEADLINE");
  await waitForText(cdp, desktop, "TODAY");
  await assertNoCriticalConsole(cdp, desktop);
  await assertEval(cdp, desktop, `document.querySelector('.calendar-grid') !== null`, "month grid rendered");
  await assertEval(cdp, desktop, `document.querySelector('.calendar-month-view').getBoundingClientRect().width >= document.querySelector('.calendar-layout').getBoundingClientRect().width - 2`, "desktop Calendar month uses full layout width");
  await assertEval(cdp, desktop, `document.querySelector('.calendar-agenda').getBoundingClientRect().top > document.querySelector('.calendar-month-view').getBoundingClientRect().bottom`, "desktop Agenda appears below month grid");
  await assertEval(cdp, desktop, `Math.max(...[...document.querySelectorAll('.calendar-icon-button svg')].map((svg) => svg.getBoundingClientRect().width)) <= 18`, "Calendar nav SVG width constrained");
  await assertEval(cdp, desktop, `Math.max(...[...document.querySelectorAll('.calendar-icon-button')].map((button) => button.getBoundingClientRect().width)) <= 44`, "Calendar nav buttons compact");
  await assertEval(cdp, desktop, `document.querySelector('.calendar-toolbar')?.getBoundingClientRect().height < 96`, "Calendar toolbar compact");
  await assertEval(cdp, desktop, `Boolean([...document.querySelectorAll('.calendar-dot')].find((item) => item.textContent.includes('CAL-001') && item.textContent.includes('Synthetic multi-date')))`, "Calendar day item includes task code and shortened title");
  await assertEval(cdp, desktop, `document.body.innerText.includes('CREATE TASK') === false`, "Calendar create hidden");
  await assertEval(cdp, desktop, `document.body.innerText.includes('Auto Plan Today') === false`, "Auto Plan hidden");
  await assertEval(cdp, desktop, `document.body.innerText.includes('My Tasks') === false`, "My Tasks flag independent");
  await assertEval(cdp, desktop, `document.body.innerText.includes('Workboard') === false`, "Workboard flag independent");
  await assertEval(cdp, desktop, `document.scrollingElement.scrollWidth <= window.innerWidth + 2`, "desktop no horizontal overflow");
  await screenshot(cdp, desktop, "desktop-calendar.png");

  await setSelect(cdp, desktop, "#calendar-source-filter", "PRODUCTION");
  await waitForText(cdp, desktop, "CAL-002");
  await assertEval(cdp, desktop, `document.body.innerText.includes('Synthetic multi-date task') === false`, "source filter narrowed data");
  await click(cdp, desktop, "[data-calendar-clear]");
  await waitForText(cdp, desktop, "SYNTHETIC MULTI-DATE TASK");
  await click(cdp, desktop, '[data-calendar-date="2026-08-03"]');
  await waitForText(cdp, desktop, "Synthetic multi-date task");
  await assertEval(cdp, desktop, `document.querySelector('.calendar-agenda h2')?.innerText.includes('Aug 3, 2026')`, "selected date updates Agenda heading");
  await assertEval(cdp, desktop, `Boolean([...document.querySelectorAll('.calendar-agenda-item')].find((item) => ['CAL-001', 'Synthetic multi-date task', 'SCHEDULED START', '8:00 AM', 'TO DO', 'MANUAL', 'SYNTHETIC STAFF A', 'HIGH'].every((text) => item.innerText.includes(text))))`, "selected Agenda card exposes full task information");
  await click(cdp, desktop, '[data-calendar-event="task-multi:scheduledStart"]');
  await waitForText(cdp, desktop, "Read-only Calendar projection");
  await assertEval(cdp, desktop, `[...document.querySelectorAll('.calendar-drawer button')].every((button) => !/APPROVE|ASSIGN|START|SUBMIT|CREATE|DELETE|RESCHEDULE/i.test(button.innerText))`, "Calendar drawer read-only");
  await click(cdp, desktop, "[data-calendar-close]");

  await click(cdp, desktop, "[data-calendar-next]");
  await waitForText(cdp, desktop, "September 2026");
  await waitForText(cdp, desktop, "No dated tasks this month");
  await waitForText(cdp, desktop, "Tasks without canonical dates");
  await click(cdp, desktop, "[data-calendar-prev]");
  await waitForText(cdp, desktop, "August 2026");

  await navigate(cdp, desktop, `http://127.0.0.1:${port}/calendar?qaRole=expired`);
  await waitForText(cdp, desktop, "Authentication required");
  await waitForText(cdp, desktop, "LOGIN AGAIN");
  await assertEval(cdp, desktop, `document.querySelector('.calendar-toolbar') === null`, "auth failure hides Calendar toolbar");
  await assertEval(cdp, desktop, `document.querySelector('.calendar-layout') === null`, "auth failure hides Calendar grid");

  const rolePage = await createPage(cdp, { width: 1366, height: 900, isMobile: false, deviceScaleFactor: 1 });
  await navigate(cdp, rolePage, `http://127.0.0.1:${port}/calendar?qaRole=staff`);
  await waitForText(cdp, rolePage, "Synthetic Staff A");
  await assertEval(cdp, rolePage, `document.body.innerText.includes('Synthetic Staff B private task') === false`, "staff calendar cannot see other assignee");
  assert.equal(await evalValue(cdp, rolePage, `fetch('/api/task-calendar?assignedUserId=${staffB}', { headers: { Authorization: 'Bearer synthetic-staff-a-token' } }).then((response) => response.json()).then((payload) => payload.events.length)`), 0, "staff assignee spoof did not reveal events");

  await navigate(cdp, rolePage, `http://127.0.0.1:${port}/calendar?qaRole=admin`);
  await waitForText(cdp, rolePage, "CAL-004");

  const tablet = await createPage(cdp, { width: 820, height: 1100, isMobile: false, deviceScaleFactor: 1 });
  await navigate(cdp, tablet, `http://127.0.0.1:${port}/calendar?qaRole=owner`);
  await waitForText(cdp, tablet, "Calendar");
  await waitForText(cdp, tablet, "AGENDA");
  await assertEval(cdp, tablet, `document.querySelector('.calendar-agenda').getBoundingClientRect().top > document.querySelector('.calendar-month-view').getBoundingClientRect().bottom`, "tablet Agenda appears below month grid");
  await assertEval(cdp, tablet, `document.scrollingElement.scrollWidth <= window.innerWidth + 2`, "tablet no horizontal overflow");
  await screenshot(cdp, tablet, "tablet-calendar.png");

  const mobile = await createPage(cdp, { width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });
  await navigate(cdp, mobile, `http://127.0.0.1:${port}/calendar?qaRole=staff`);
  await waitForText(cdp, mobile, "AGENDA");
  await waitForText(cdp, mobile, "SCHEDULED START");
  await assertEval(cdp, mobile, `document.querySelector('.calendar-agenda').getBoundingClientRect().top > document.querySelector('.calendar-month-view').getBoundingClientRect().bottom`, "mobile Agenda appears below month grid");
  await assertEval(cdp, mobile, `document.querySelector('.mobile-bottom-nav a[href="/calendar"]') !== null`, "mobile Calendar nav visible");
  await assertEval(cdp, mobile, `document.scrollingElement.scrollWidth <= window.innerWidth + 2`, "mobile no horizontal overflow");
  await screenshot(cdp, mobile, "mobile-calendar.png");

  assert.ok(received.some((item) => item.path === "/api/task-calendar" && item.auth), "Calendar API used bearer auth");
  assert.equal(received.some((item) => item.method !== "GET" && item.path === "/api/task-calendar"), false, "Calendar did not mutate through its endpoint");
  process.stdout.write(`PASS browser desktop/tablet/mobile Calendar QA with screenshots in ${screenshotDir}\n`);
} finally {
  cdp?.close?.();
  await stopBrowser(browser);
  server.close();
}

function event(taskId, taskCode, title, typeKey, type, dateTime, assignedUserId, sourceType, status, priority, overdue = false) {
  const [dateKey] = dateTime.startsWith("2026-08-04T16:") ? ["2026-08-05"] : [dateTime.slice(0, 10)];
  return {
    key: `${taskId}:${typeKey}`,
    taskId,
    taskCode,
    title,
    sourceType,
    status,
    priority,
    assignedUserId,
    assignee: users[assignedUserId],
    dateTime,
    dateKey,
    projectionType: type,
    projectionTypeKey: typeKey,
    projectionPriority: typeKey === "scheduledStart" ? 10 : typeKey === "taskDeadline" ? 20 : typeKey === "reviewDeadline" ? 30 : 40,
    overdue,
    taskPath: `/tasks/${taskId}`,
  };
}

async function handleRequest(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path.startsWith("/api/")) return handleApi(request, response, path, url);
  if (path === "/src/env.js") {
    const referer = new URL(request.headers.referer || `http://${request.headers.host}/calendar?qaRole=owner`);
    activeQaRole = referer.searchParams.get("qaRole") || "owner";
    activeQaUserId = activeQaRole === "admin" ? admin : activeQaRole === "staff" ? staffA : owner;
    return send(response, 200, "text/javascript", `window.TRRY_ADMIN_ENV = ${JSON.stringify({ VITE_USE_SUPABASE_DATA: "false", VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "", VITE_ENABLE_TASK_DOMAIN: "true", VITE_ENABLE_CALENDAR: "true", VITE_ENABLE_WORKBOARD: "false", VITE_ENABLE_MY_TASKS: "false", VITE_ENABLE_AUTO_PLAN_TODAY: "false", VITE_LOCAL_TASK_QA_MODE: "true", VITE_LOCAL_TASK_QA_ROLE: activeQaRole, VITE_LOCAL_TASK_QA_USER_ID: activeQaUserId, VITE_ADMIN_ACCESS_CODE: "" }, null, 2)};\n`);
  }
  const filePath = normalize(join(root, path === "/" || !extname(path) ? "index.html" : path));
  if (!filePath.startsWith(root)) return send(response, 403, "text/plain", "Forbidden");
  try {
    const type = extname(filePath) === ".css" ? "text/css" : extname(filePath) === ".js" ? "text/javascript" : "text/html";
    return send(response, 200, type, await readFile(filePath));
  } catch {
    return send(response, 404, "text/plain", "Not found");
  }
}

async function handleApi(request, response, path, url) {
  try {
    const referer = new URL(request.headers.referer || `http://${request.headers.host}/calendar?qaRole=${activeQaRole}`);
    activeQaRole = referer.searchParams.get("qaRole") || activeQaRole;
  } catch {}
  received.push({ path, method: request.method, auth: request.headers.authorization || "" });
  if (path === "/api/assignment-users") return sendJson(response, 200, { users: Object.entries(users).map(([userId, user]) => ({ userId, ...user })) });
  if (path === "/api/admin-users/effective-access") {
    if (activeQaRole === "expired") return sendJson(response, 401, { ok: false, error: "admin session required" });
    const source = activeQaRole === "staff" ? "temporary" : "permanent";
    return sendJson(response, 200, { ok: true, access: { module: "calendar", allowed: true, source, expiresAt: null } });
  }
  if (path !== "/api/task-calendar") return sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Not found." } });
  if (request.method !== "GET") return sendJson(response, 405, { ok: false, error: { code: "VALIDATION_ERROR", message: "Method not allowed." } });
  if (activeQaRole === "expired") return sendJson(response, 401, { ok: false, error: { code: "AUTH_REQUIRED", message: "Authentication required." } });
  if (!request.headers.authorization) return sendJson(response, 401, { ok: false, error: { code: "AUTH_REQUIRED", message: "Authentication required." } });
  const source = url.searchParams.get("sourceType") || "";
  const status = url.searchParams.get("status") || "";
  const assignedUserId = url.searchParams.get("assignedUserId") || "";
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";
  const visible = events.filter((item) => {
    if (activeQaRole === "staff" && item.assignedUserId !== staffA) return false;
    if (assignedUserId && item.assignedUserId !== assignedUserId) return false;
    if (source && item.sourceType !== source) return false;
    if (status && item.status !== status) return false;
    if (from && item.dateKey < from) return false;
    if (to && item.dateKey > to) return false;
    return true;
  });
  return sendJson(response, 200, { ok: true, timeZone: "Asia/Manila", from: url.searchParams.get("from"), to: url.searchParams.get("to"), events: visible });
}

function sendJson(response, status, payload) {
  return send(response, status, "application/json", JSON.stringify(payload));
}

function send(response, status, type, body) {
  response.writeHead(status, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store" });
  response.end(body);
}

async function waitForCdp(remotePort) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try {
      const response = await fetch(`http://127.0.0.1:${remotePort}/json/version`);
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Edge CDP did not start");
}

async function createCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    }
  });
  return {
    close() {
      socket.close();
    },
    send(method, params = {}, sessionId = null) {
      const callId = ++id;
      socket.send(JSON.stringify({ id: callId, method, params, ...(sessionId ? { sessionId } : {}) }));
      return new Promise((resolve, reject) => pending.set(callId, { resolve, reject }));
    },
  };
}

async function stopBrowser(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 3000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function createPage(cdp, viewport) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    mobile: viewport.isMobile,
  }, sessionId);
  return { sessionId };
}

async function navigate(cdp, page, url) {
  await cdp.send("Page.navigate", { url }, page.sessionId);
  await cdp.send("Page.loadEventFired", {}, page.sessionId).catch(() => {});
}

async function evalValue(cdp, page, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, page.sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function assertEval(cdp, page, expression, message) {
  assert.equal(await evalValue(cdp, page, expression), true, message);
}

async function waitForText(cdp, page, text) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    if (await evalValue(cdp, page, `document.body?.innerText.includes(${JSON.stringify(text)})`)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for text: ${text}`);
}

async function click(cdp, page, selector) {
  const ok = await evalValue(cdp, page, `document.querySelector(${JSON.stringify(selector)})?.click(); true`);
  assert.equal(ok, true, `click failed: ${selector}`);
}

async function setSelect(cdp, page, selector, value) {
  await evalValue(cdp, page, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
}

async function screenshot(cdp, page, name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, page.sessionId);
  await writeFile(join(screenshotDir, name), Buffer.from(data, "base64"));
}

async function assertNoCriticalConsole(cdp, page) {
  const errors = await evalValue(cdp, page, `window.__calendarConsoleErrors || []`);
  assert.deepEqual(errors, []);
}
