import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const root = process.cwd();
const port = Number(process.env.WORKBOARD_BROWSER_PORT || 58220);
const screenshotDir = join(root, "qa-screens", "phase-11-workboard");
const staffA = "95000000-0000-4000-8000-000000000010";
const staffB = "95000000-0000-4000-8000-000000000011";
const owner = "95000000-0000-4000-8000-000000000001";
const inactive = "95000000-0000-4000-8000-000000000012";
const received = [];
let syntheticNow = Date.now();

const users = {
  [staffA]: { displayName: "Synthetic Staff A", initials: "SA", role: "staff", isActive: true },
  [staffB]: { displayName: "Synthetic Staff B", initials: "SB", role: "staff", isActive: true },
  [owner]: { displayName: "Synthetic Owner", initials: "SO", role: "owner", isActive: true },
  [inactive]: { displayName: "Former Synthetic Staff", initials: "FS", role: "staff", isActive: false },
};

const tasks = new Map([
  task("task-running", "WB-QA-001", "Running screen print timer", "IN_PROGRESS", { open: true, priority: "HIGH", titleSuffix: "", deadlineHours: 2 }),
  task("task-forgot", "WB-QA-002", "Upload finished embroidery photos before opening portal", "TO_DO", { priority: "MEDIUM", deadlineHours: 4 }),
  task("task-todo", "WB-QA-003", "Start regular production content task", "TO_DO", { priority: "LOW", deadlineHours: 6 }),
  task("task-revision", "WB-QA-004", "Revise CTA poster for uniform inquiry", "NEEDS_REVISION", { priority: "URGENT", reviewerUserId: inactive, deadlineHours: -4 }),
  task("task-none", "WB-QA-005", "Confirm shop checklist without timer", "TO_DO", { mode: "NONE", priority: "MEDIUM", deadlineHours: 8 }),
  task("task-none-revision", "WB-QA-006", "Update non-timed revision note", "NEEDS_REVISION", { mode: "NONE", priority: "HIGH", deadlineHours: 9 }),
  task("task-review-recorded", "WB-QA-007", "Submitted recorded work", "FOR_REVIEW", { priority: "LOW", duration: 1860 }),
  task("task-review-no-time", "WB-QA-008", "Submitted without recorded time", "FOR_REVIEW", { priority: "MEDIUM", noTime: true }),
  task("task-review-none", "WB-QA-009", "Submitted with time not required", "FOR_REVIEW", { mode: "NONE", notRequired: true }),
  task("task-done", "WB-QA-010", "Completed recorded-duration task", "DONE", { duration: 3660 }),
  task("task-long", "WB-QA-011", "Long title containment validation for embroidered campaign photography, detailed proofing, post copy, and upload handoff", "TO_DO", { brief: "Synthetic long brief: keep all copy contained inside the drawer and cards without horizontal overflow. This does not contain customer, payment, artwork, or private staff data.", priority: "URGENT", deadlineHours: -26 }),
  task("task-other-staff", "WB-QA-012", "Staff B private task", "TO_DO", { assignedUserId: staffB }),
  task("task-draft", "WB-QA-013", "Draft hidden from staff", "DRAFT"),
]);

const submissions = new Map([
  ["task-revision", [{ id: "sub-rev-1", taskId: "task-revision", cycleNumber: 1, submittedByUser: users[staffA], submissionNote: "Synthetic previous submission.", submittedAt: iso(-7), timeRecordingStatus: "RECORDED", recordedDurationSeconds: 1200, noTimeReason: null, reviewDecision: "REVISION_REQUESTED", reviewNote: "Synthetic revision note: make CTA clearer and resubmit.", reviewedAt: iso(-5), reviewerUser: users[inactive] }]],
  ["task-review-recorded", [{ id: "sub-rec-1", taskId: "task-review-recorded", cycleNumber: 1, submittedByUser: users[staffA], submissionNote: "Synthetic recorded submission.", submittedAt: iso(-2), timeRecordingStatus: "RECORDED", recordedDurationSeconds: 1860, noTimeReason: null, reviewDecision: "PENDING", reviewerUser: users[owner] }]],
  ["task-review-no-time", [{ id: "sub-nt-1", taskId: "task-review-no-time", cycleNumber: 1, submittedByUser: users[staffA], submissionNote: "Synthetic no-time submission.", submittedAt: iso(-2), timeRecordingStatus: "NOT_RECORDED", recordedDurationSeconds: null, noTimeReason: "Forgot to start timer during synthetic validation.", reviewDecision: "PENDING", reviewerUser: users[owner] }]],
  ["task-review-none", [{ id: "sub-nr-1", taskId: "task-review-none", cycleNumber: 1, submittedByUser: users[staffA], submissionNote: "Synthetic no timer required.", submittedAt: iso(-1), timeRecordingStatus: "NOT_REQUIRED", recordedDurationSeconds: null, noTimeReason: null, reviewDecision: "PENDING", reviewerUser: users[owner] }]],
]);

await mkdir(screenshotDir, { recursive: true });
const server = createServer(handleRequest);
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const edgePath = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const userDataDir = join(tmpdir(), `trry-workboard-edge-${Date.now()}`);
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
  await navigate(cdp, desktop, `http://127.0.0.1:${port}/workboard`);
  await waitForText(cdp, desktop, "Workboard");
  await waitForText(cdp, desktop, "CREATE TASK");
  await assertNoCriticalConsole(cdp, desktop);
  await assertEval(cdp, desktop, `document.body.innerText.includes('Auto Plan Today') === false`, "Auto Plan hidden");
  await assertEval(cdp, desktop, `document.body.innerText.includes('Calendar Quick Direction') === false`, "Calendar Quick hidden");
  await assertEval(cdp, desktop, `document.scrollingElement.scrollWidth <= window.innerWidth + 2`, "desktop no horizontal overflow");
  await screenshot(cdp, desktop, "desktop-workboard.png");

  await click(cdp, desktop, '[data-workboard-create]');
  await waitForText(cdp, desktop, "Create manual task draft");
  await setValue(cdp, desktop, "#workboard-title", "Synthetic Workboard draft");
  await setValue(cdp, desktop, "#workboard-brief", "Synthetic Workboard brief for owner planning validation only.");
  await setValue(cdp, desktop, "#workboard-submission-deadline", "2026-07-26T17:30");
  assert.equal(await evalValue(cdp, desktop, `document.querySelector("#workboard-title")?.value`), "Synthetic Workboard draft", "typed title present before submit");
  await click(cdp, desktop, '[data-workboard-draft-form] button[type="submit"]');
  await waitForText(cdp, desktop, "APPROVE DRAFT");
  assert.equal(received.find((item) => item.path === "/api/tasks" && item.method === "POST")?.body?.title, "Synthetic Workboard draft", "create payload title submitted");
  await click(cdp, desktop, '[data-workboard-approve-draft]');
  await waitForText(cdp, desktop, "TO DO");

  await clickWorkboardTask(cdp, desktop, "Submitted without recorded time");
  await waitForText(cdp, desktop, "TIME NOT RECORDED");
  await waitForText(cdp, desktop, "Forgot to start timer");
  await setValue(cdp, desktop, "#workboard-review-note", "Synthetic revision request from owner.");
  await click(cdp, desktop, '[data-workboard-request-revision]');
  await waitForText(cdp, desktop, "REVISION REQUESTED");

  await clickWorkboardTask(cdp, desktop, "Submitted recorded work");
  await waitForText(cdp, desktop, "RECORDED TIME");
  await setValue(cdp, desktop, "#workboard-review-note", "Synthetic approval note.");
  await click(cdp, desktop, '[data-workboard-approve-work]');
  await waitForText(cdp, desktop, "DONE");
  await setValue(cdp, desktop, "#workboard-reason", "Synthetic reopen check.");
  await click(cdp, desktop, '[data-workboard-reopen]');
  await waitForText(cdp, desktop, "TO DO");

  await clickWorkboardTask(cdp, desktop, "Start regular production content task");
  await setValue(cdp, desktop, "#workboard-reason", "Synthetic cancellation reason.");
  await click(cdp, desktop, '[data-workboard-cancel]');
  await waitForText(cdp, desktop, "CANCELLED");
  await click(cdp, desktop, '[data-workboard-archive]');
  await waitForText(cdp, desktop, "NO AVAILABLE MANAGER ACTION");

  const mobile = await createPage(cdp, { width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });
  await navigate(cdp, mobile, `http://127.0.0.1:${port}/workboard`);
  await waitForText(cdp, mobile, "Workboard");
  await assertEval(cdp, mobile, `document.scrollingElement.scrollWidth <= window.innerWidth + 2`, "mobile no horizontal overflow");
  const smallTargets = await evalValue(cdp, mobile, `[...document.querySelectorAll('button,a,select')].map((el) => { const rect = el.getBoundingClientRect(); return { text: el.innerText.trim(), label: el.getAttribute('aria-label') || '', className: el.className || '', height: Math.round(rect.height), width: Math.round(rect.width), visible: rect.width > 0 && rect.height > 0 }; }).filter((item) => item.visible && item.height < 36).slice(0, 20)`);
  assert.deepEqual(smallTargets, [], "mobile tap targets practical minimum");
  await clickWorkboardTask(cdp, mobile, "Long title containment validation");
  await waitForText(cdp, mobile, "Synthetic long brief");
  await assertEval(cdp, mobile, `document.querySelector('.workboard-drawer').getBoundingClientRect().width <= window.innerWidth`, "mobile drawer fits viewport");
  await screenshot(cdp, mobile, "mobile-workboard-drawer.png");

  assert.ok(received.some((item) => item.path === "/api/tasks" && item.method === "GET" && item.auth === "Bearer synthetic-staff-a-token"), "manager list auth used");
  assert.ok(received.some((item) => item.path === "/api/tasks" && item.method === "POST" && item.idempotency), "create idempotency used");
  assert.ok(received.some((item) => item.path.includes("/approve-draft") && item.body?.expectedVersion), "approve draft expectedVersion used");
  assert.ok(received.some((item) => item.path.includes("/request-revision") && item.body?.reviewNote), "request revision payload used");
  assert.ok(received.some((item) => item.path.includes("/approve") && item.body?.expectedVersion), "approve work expectedVersion used");
  process.stdout.write(`PASS browser desktop/mobile Workboard QA with screenshots in ${screenshotDir}\n`);
  await cdp.close();} finally {
  browser.kill("SIGTERM");
  await new Promise((resolve) => server.close(resolve));
}

function task(id, code, title, status, overrides = {}) {
  const assignedUserId = overrides.assignedUserId || staffA;
  const reviewerUserId = overrides.reviewerUserId || owner;
  const open = overrides.open === true;
  return [id, baseTask(id, code, `${title}${overrides.titleSuffix || ""}`, status, overrides)];
}

function baseTask(id, code, title, status, overrides = {}) {
  const assignedUserId = overrides.assignedUserId || staffA;
  const reviewerUserId = overrides.reviewerUserId || owner;
  const open = overrides.open === true;
  return {
    id,
    taskCode: code,
    title,
    brief: overrides.brief || `Synthetic brief for ${code}. No customer, payment, artwork, phone, or private staff data.`,
    sourceType: overrides.sourceType || "MANUAL",
    sourceRecordType: null,
    sourceRecordId: null,
    status,
    priority: overrides.priority || "MEDIUM",
    timeTrackingMode: overrides.mode || "EXPECTED",
    assignedUserId,
    reviewerUserId,
    assignedUser: users[assignedUserId],
    reviewerUser: users[reviewerUserId],
    draftApprovalRequired: false,
    scheduledDate: iso(-1),
    startDeadline: null,
    submissionDeadline: iso(overrides.deadlineHours ?? 24),
    approvalDeadline: null,
    version: 1,
    completedAt: status === "DONE" ? iso(-1) : null,
    cancelledAt: null,
    archivedAt: null,
    createdAt: iso(-30),
    updatedAt: iso(-1),
    allowedActions: [],
    openTimeEntry: open ? { id: `${id}-time-open`, taskId: id, userId: assignedUserId, cycleNumber: 1, startedAt: iso(-0.02), endedAt: null } : null,
    totalClosedDurationSeconds: overrides.duration || 0,
  };
}

function iso(hoursOffset) {
  return new Date(syntheticNow + hoursOffset * 3600000).toISOString();
}

async function handleRequest(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path.startsWith("/api/")) return handleApi(request, response, path, url);
  if (path === "/src/env.js") return send(response, 200, "text/javascript", `window.TRRY_ADMIN_ENV = ${JSON.stringify({ VITE_USE_SUPABASE_DATA: "false", VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "", VITE_ENABLE_TASK_DOMAIN: "true", VITE_LOCAL_TASK_QA_MODE: "true", VITE_LOCAL_TASK_QA_ROLE: "owner", VITE_LOCAL_TASK_QA_USER_ID: owner, VITE_ADMIN_ACCESS_CODE: "" }, null, 2)};\n`);
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
  const auth = request.headers.authorization || "";
  const idempotency = request.headers["idempotency-key"] || "";
  const body = await readJsonBody(request);
  received.push({ path, method: request.method, auth, idempotency, body });
  if (auth !== "Bearer synthetic-staff-a-token") return sendJson(response, 401, { ok: false, error: { code: "AUTH_REQUIRED", message: "Authentication required." } });
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
  if (path === "/api/my-tasks") {
    const status = url.searchParams.get("status") || "";
    const visible = [...tasks.values()].filter((item) => item.assignedUserId === staffA && item.status !== "DRAFT" && (!status || item.status === status));
    return sendJson(response, 200, { ok: true, tasks: visible.map(project), page: 1, pageSize: 100, total: visible.length });
  }
  if (path === "/api/tasks" && request.method === "GET") {
    const status = url.searchParams.get("status") || "";
    const archived = url.searchParams.get("archived") === "true";
    const visible = [...tasks.values()].filter((item) => (!status || item.status === status) && (archived ? item.archivedAt : !item.archivedAt));
    return sendJson(response, 200, { ok: true, tasks: visible.map(project), page: 1, pageSize: 100, total: visible.length });
  }
  if (path === "/api/tasks" && request.method === "POST") {
    const id = `task-created-${Date.now()}`;
    const created = { ...baseTask(id, `WB-QA-${tasks.size + 1}`, body.title, "DRAFT"), brief: body.brief, sourceType: body.sourceType || "MANUAL", priority: body.priority || "MEDIUM", assignedUserId: body.assignedUserId || staffA, reviewerUserId: body.reviewerUserId || owner, assignedUser: users[body.assignedUserId || staffA], reviewerUser: users[body.reviewerUserId || owner], timeTrackingMode: body.timeTrackingMode || "EXPECTED", submissionDeadline: body.submissionDeadline || iso(24), version: 1 };
    tasks.set(id, created);
    return sendJson(response, 200, mutation(created));
  }
  const match = path.match(/^\/api\/tasks\/([^/]+)(?:\/([^/]+(?:-[^/]+)?))?$/);
  if (!match) return sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Task resource not found." } });
  const [, taskId, action = ""] = match;
  const current = tasks.get(taskId);
  if (!current) return sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Task resource not found." } });
  if (!action && request.method === "GET") return sendJson(response, 200, detail(current));
  if (Number(body.expectedVersion) !== current.version) return sendJson(response, 409, { ok: false, error: { code: "VERSION_CONFLICT", message: "Task version is stale.", details: { currentVersion: current.version } } });
  if (action === "draft" && request.method === "PATCH") return updateDraft(response, current, body);
  if (action === "assign") return assignExisting(response, current, body);
  if (action === "approve-draft") return approveDraft(response, current, body);
  if (action === "request-revision") return requestRevision(response, current, body);
  if (action === "approve") return approveWork(response, current, body);
  if (action === "cancel") return cancelExisting(response, current, body);
  if (action === "reopen") return reopenExisting(response, current, body);
  if (action === "archive") return archiveExisting(response, current, body);
  if (action === "start" || action === "start-revision") return startTask(response, current, action);
  if (action === "submit") return submitTask(response, current, body, idempotency);
  if (action === "submit-without-time") return submitNoTime(response, current, body, idempotency);
  return sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Task resource not found." } });
}

function updateDraft(response, current, body) {
  if (Number(body.expectedVersion) !== current.version) return sendJson(response, 409, { ok: false, error: { code: "VERSION_CONFLICT", message: "Task version is stale." } });
  Object.assign(current, { title: body.title || current.title, brief: body.brief || current.brief, priority: body.priority || current.priority, assignedUserId: body.assignedUserId || current.assignedUserId, reviewerUserId: body.reviewerUserId || current.reviewerUserId, assignedUser: users[body.assignedUserId || current.assignedUserId], reviewerUser: users[body.reviewerUserId || current.reviewerUserId], timeTrackingMode: body.timeTrackingMode || current.timeTrackingMode });
  current.version += 1;
  return sendJson(response, 200, mutation(current));
}
function assignExisting(response, current, body) {
  current.assignedUserId = body.assignedUserId || current.assignedUserId;
  current.assignedUser = users[current.assignedUserId];
  current.version += 1;
  return sendJson(response, 200, mutation(current));
}
function approveDraft(response, current) { current.status = "TO_DO"; current.version += 1; return sendJson(response, 200, mutation(current)); }
function requestRevision(response, current, body) {
  current.status = "NEEDS_REVISION";
  current.version += 1;
  const rows = submissions.get(current.id) || [];
  if (rows.length) rows[rows.length - 1].reviewDecision = "REVISION_REQUESTED", rows[rows.length - 1].reviewNote = body.reviewNote;
  return sendJson(response, 200, mutation(current));
}
function approveWork(response, current, body) {
  current.status = "DONE";
  current.completedAt = new Date().toISOString();
  current.version += 1;
  const rows = submissions.get(current.id) || [];
  if (rows.length) rows[rows.length - 1].reviewDecision = "APPROVED", rows[rows.length - 1].reviewNote = body.reviewNote || null;
  return sendJson(response, 200, mutation(current));
}
function cancelExisting(response, current) { current.status = "CANCELLED"; current.cancelledAt = new Date().toISOString(); current.version += 1; return sendJson(response, 200, mutation(current)); }
function reopenExisting(response, current) { current.status = "TO_DO"; current.cancelledAt = null; current.completedAt = null; current.archivedAt = null; current.version += 1; return sendJson(response, 200, mutation(current)); }
function archiveExisting(response, current) { current.archivedAt = new Date().toISOString(); current.version += 1; return sendJson(response, 200, mutation(current)); }
function startTask(response, current) {
  const otherOpen = [...tasks.values()].find((item) => item.openTimeEntry && item.id !== current.id);
  if (otherOpen) return sendJson(response, 409, { ok: false, error: { code: "TIMER_ALREADY_OPEN", message: "A conflicting timer is already open." } });
  current.status = "IN_PROGRESS";
  current.openTimeEntry = { id: `${current.id}-time-${Date.now()}`, taskId: current.id, userId: staffA, cycleNumber: 1, startedAt: new Date().toISOString(), endedAt: null };
  current.version += 1;
  return sendJson(response, 200, mutation(current));
}

function submitTask(response, current, body) {
  if (!body.submissionNote) return sendJson(response, 400, { ok: false, error: { code: "VALIDATION_ERROR", message: "Submission note is required." } });
  let duration = null;
  let status = current.timeTrackingMode === "NONE" ? "NOT_REQUIRED" : "RECORDED";
  if (current.timeTrackingMode === "EXPECTED") {
    if (!current.openTimeEntry) return sendJson(response, 409, { ok: false, error: { code: "TIMER_REQUIRED", message: "An open task timer is required." } });
    const endedAt = new Date().toISOString();
    duration = Math.max(1, Math.floor((Date.parse(endedAt) - Date.parse(current.openTimeEntry.startedAt)) / 1000));
    current.totalClosedDurationSeconds += duration;
    current.openTimeEntry = null;
  }
  current.status = "FOR_REVIEW";
  current.version += 1;
  addSubmission(current, body.submissionNote, status, null, duration);
  return sendJson(response, 200, mutation(current));
}

function submitNoTime(response, current, body) {
  if (!body.note || !body.reason) return sendJson(response, 400, { ok: false, error: { code: "VALIDATION_ERROR", message: "Reason is required." } });
  current.status = "FOR_REVIEW";
  current.version += 1;
  current.openTimeEntry = null;
  addSubmission(current, body.note, "NOT_RECORDED", body.reason, null);
  return sendJson(response, 200, mutation(current));
}

function addSubmission(current, note, timeRecordingStatus, noTimeReason, duration) {
  const rows = submissions.get(current.id) || [];
  rows.push({ id: `${current.id}-sub-${rows.length + 1}`, taskId: current.id, cycleNumber: rows.length + 1, submittedByUser: users[staffA], submissionNote: note, submittedAt: new Date().toISOString(), timeRecordingStatus, noTimeReason, recordedDurationSeconds: timeRecordingStatus === "RECORDED" ? duration : null, reviewDecision: "PENDING", reviewerUser: users[current.reviewerUserId] });
  submissions.set(current.id, rows);
}

function mutation(current) {
  return { ok: true, ...detail(current), allowedActions: project(current).allowedActions, serverTime: new Date().toISOString(), openTimeEntry: current.openTimeEntry, totalClosedDurationSeconds: current.totalClosedDurationSeconds, submission: (submissions.get(current.id) || []).at(-1) || null, currentVersion: current.version };
}

function detail(current) {
  return { ok: true, task: project(current), submissions: submissions.get(current.id) || [], timeEntries: current.openTimeEntry ? [current.openTimeEntry] : [], history: [] };
}

function project(current) {
  const projected = { ...current, allowedActions: allowed(current) };
  return projected;
}

function allowed(current) {
  if (current.status === "DRAFT" && current.assignedUserId && current.reviewerUserId) return ["EDIT_DRAFT", "ASSIGN", "APPROVE_DRAFT", "CANCEL"];
  if (current.status === "TO_DO" && current.timeTrackingMode === "EXPECTED") return ["ASSIGN", "CANCEL"];
  if (current.status === "TO_DO" && current.timeTrackingMode === "NONE") return ["ASSIGN", "CANCEL"];
  if (current.status === "IN_PROGRESS" && current.timeTrackingMode === "EXPECTED") return ["SUBMIT_FOR_REVIEW"];
  if (current.status === "FOR_REVIEW") return ["REQUEST_REVISION", "APPROVE_WORK"];
  if (current.status === "NEEDS_REVISION" && current.timeTrackingMode === "EXPECTED") return ["ASSIGN", "CANCEL"];
  if (current.status === "NEEDS_REVISION" && current.timeTrackingMode === "NONE") return ["ASSIGN", "CANCEL"];
  if (current.status === "DONE" || current.status === "CANCELLED") return current.archivedAt ? [] : ["REOPEN", "ARCHIVE"];
  return [];
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
  const listeners = [];
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result || {});
    }
    for (const listener of listeners) listener(message);
  };
  return {
    send(method, params = {}, sessionId = undefined) {
      const message = { id: ++id, method, params };
      if (sessionId) message.sessionId = sessionId;
      ws.send(JSON.stringify(message));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    on(listener) { listeners.push(listener); },
    close() { ws.close(); },
  };
}

async function createPage(cdp, viewport) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Log.enable", {}, sessionId);
  const page = { targetId, sessionId, consoleErrors: [] };
  cdp.on((message) => {
    if (message.sessionId !== sessionId) return;
    if (message.method === "Runtime.exceptionThrown") {
      page.consoleErrors.push(`exception: ${message.params?.exceptionDetails?.text || "runtime exception"}`);
    }
    if (message.method === "Log.entryAdded" && ["error", "warning"].includes(message.params?.entry?.level)) {
      page.consoleErrors.push(`${message.params.entry.level}: ${message.params.entry.text}`);
    }
    if (message.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(message.params?.type)) {
      const text = (message.params.args || []).map((arg) => arg.value || arg.description || "").join(" ");
      page.consoleErrors.push(`${message.params.type}: ${text}`);
    }
  });
  await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, mobile: viewport.isMobile, screenWidth: viewport.width, screenHeight: viewport.height }, sessionId);
  return page;
}

async function navigate(cdp, page, url) {
  await cdp.send("Page.navigate", { url }, page.sessionId);
  await waitForIdle(900);
}

async function waitForText(cdp, page, text, timeout = 7000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evalBool(cdp, page, `document.body && document.body.innerText.includes(${JSON.stringify(text)})`)) return;
    await waitForIdle(100);
  }
  const bodyText = await evalValue(cdp, page, `document.body?.innerText?.slice(0, 5000) || ""`).catch((error) => `body read failed: ${error.message}`);
  const href = await evalValue(cdp, page, `window.location.href`).catch(() => "unknown-url");
  const errors = page.consoleErrors.length ? `\nConsole/runtime:\n${page.consoleErrors.slice(-10).join("\n")}` : "";
  throw new Error(`Timed out waiting for text: ${text}\nURL: ${href}\nBody:\n${bodyText}${errors}`);
}

async function clickWorkboardTask(cdp, page, text) {
  const expression = `(() => {
    const visible = [...document.querySelectorAll('.workboard-table tr, .workboard-card-list .my-task-card')].find((node) => node.innerText.includes(${JSON.stringify(text)}));
    const id = visible?.querySelector('[data-workboard-open]')?.dataset.workboardOpen;
    const el = id ? document.querySelector('[data-workboard-open="' + CSS.escape(id) + '"]') : [...document.querySelectorAll('[data-workboard-open]')].find((node) => node.innerText.includes(${JSON.stringify(text)}));
    if (!el) return false;
    el.click();
    return true;
  })()`;
  assert.equal(await evalValue(cdp, page, expression), true, `workboard open target missing: ${text}`);
  await waitForIdle(900);
  assert.equal(await evalBool(cdp, page, `document.querySelector('.workboard-drawer') !== null`), true, `workboard drawer did not open for ${text}`);
}
async function clickTask(cdp, page, text) {
  const expression = `(() => {
    const visible = [...document.querySelectorAll('.my-task-card')].find((node) => node.innerText.includes(${JSON.stringify(text)}));
    const id = visible?.querySelector('[data-task-open]')?.dataset.taskOpen;
    const el = id ? document.querySelector('[data-task-open="' + CSS.escape(id) + '"]') : [...document.querySelectorAll('[data-task-open]')].find((node) => node.innerText.includes(${JSON.stringify(text)}));
    if (!el) return false;
    el.click();
    return true;
  })()`;
  assert.equal(await evalValue(cdp, page, expression), true, `task open target missing: ${text}`);
  await waitForIdle(900);
  const drawerOpen = await evalBool(cdp, page, `document.querySelector('.my-task-drawer') !== null`);
  if (!drawerOpen) {
    const openers = await evalValue(cdp, page, `[...document.querySelectorAll('[data-task-open]')].map((node) => ({ id: node.dataset.taskOpen, text: node.innerText })).slice(0, 12)`);
    throw new Error(`task drawer did not open for ${text}: ${JSON.stringify(openers)}`);
  }
}

async function click(cdp, page, selector) {
  assert.equal(await evalValue(cdp, page, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`), true, `selector missing: ${selector}`);
  await waitForIdle(500);
}

async function setValue(cdp, page, selector, value) {
  const expression = `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
  assert.equal(await evalValue(cdp, page, expression), true, `input missing: ${selector}`);
}

async function screenshot(cdp, page, filename) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, page.sessionId);
  await writeFile(join(screenshotDir, filename), Buffer.from(data, "base64"));
}

async function assertTimerAdvances(cdp, page) {
  const before = await evalValue(cdp, page, `document.querySelector('.my-tasks-running-pin small')?.innerText || ''`);
  await waitForIdle(1500);
  const after = await evalValue(cdp, page, `document.querySelector('.my-tasks-running-pin small')?.innerText || ''`);
  assert.notEqual(before, after, "running timer should advance visibly");
}

async function assertNoCriticalConsole(cdp, page) {
  const critical = page.consoleErrors.filter((message) => !message.includes("favicon"));
  assert.deepEqual(critical, [], "browser console/runtime errors");
}
async function assertEval(cdp, page, expression, message) { assert.equal(await evalBool(cdp, page, expression), true, message); }
async function evalBool(cdp, page, expression) { return Boolean(await evalValue(cdp, page, expression)); }
async function evalValue(cdp, page, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, page.sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
  return result.result?.value;
}
function waitForIdle(ms = 250) { return new Promise((resolve) => setTimeout(resolve, ms)); }
