import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const appPort = 6180 + Math.floor(Math.random() * 500);
const chromePort = 9580 + Math.floor(Math.random() * 500);
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const userDataDir = await mkdtemp(join(tmpdir(), "trry-employee-e1-chrome-"));
const now = Date.now();
const employees = [
  { id: "owner-row", userId: "owner-user", email: "owner@trry.test", displayName: "Clark Owner", role: "owner", isActive: true, createdAt: "2026-08-01T00:00:00Z", lastSignInAt: new Date(now - 90_000).toISOString() },
  { id: "admin-row", userId: "admin-user", email: "admin@trry.test", displayName: "Lou Admin", role: "admin", isActive: true, createdAt: "2026-08-02T00:00:00Z", lastSignInAt: new Date(now - 60 * 60 * 1000).toISOString() },
  { id: "staff-row", userId: "staff-user", email: "staff@trry.test", displayName: "Juvy Staff", role: "staff", isActive: true, createdAt: "2026-08-03T00:00:00Z", lastSignInAt: "2026-08-20T02:00:00Z" },
  { id: "disabled-row", userId: "disabled-user", email: "disabled@trry.test", displayName: "Former Staff", role: "staff", isActive: false, createdAt: "2026-08-04T00:00:00Z", lastSignInAt: null },
];

let currentRole = "owner";
let chrome;
const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  if (/^\/api\/admin-users\/?$/.test(url.pathname)) {
    const users = currentRole === "admin" ? employees.filter((user) => user.role === "staff") : employees;
    send(response, 200, "application/json", JSON.stringify({ ok: true, users }));
    return;
  }
  if (/^\/api\/admin-users\/[^/]+\/?$/.test(url.pathname)) {
    send(response, 200, "application/json", JSON.stringify({ ok: true, user: employees[0] }));
    return;
  }
  if (url.pathname === "/src/env.js") {
    send(response, 200, "text/javascript", `window.TRRY_ADMIN_ENV=${JSON.stringify({
      VITE_USE_SUPABASE_DATA: "false",
      VITE_LOCAL_TASK_QA_MODE: "true",
      VITE_LOCAL_TASK_QA_ROLE: currentRole,
    })};\n`);
    return;
  }
  const path = ["/settings", "/settings/people-access", "/overview"].includes(url.pathname) ? "/index.html" : url.pathname;
  try {
    const body = await readFile(join(root, path.replace(/^\/+/, "")));
    send(response, 200, getContentType(path), body);
  } catch {
    send(response, 404, "text/plain", "Not found");
  }
});

try {
  await new Promise((resolve) => server.listen(appPort, "127.0.0.1", resolve));
  chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${chromePort}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ], { stdio: "ignore" });
  await waitForChrome(chromePort);
  const page = await createPage(chromePort);
  const cdp = await connectWebSocket(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  currentRole = "owner";
  for (const viewport of [
    { label: "1366", width: 1366, height: 900 },
    { label: "1440", width: 1440, height: 900 },
    { label: "1920", width: 1920, height: 1080 },
    { label: "390", width: 390, height: 844 },
  ]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.width <= 760,
    });
    await navigate(cdp, `http://127.0.0.1:${appPort}/settings/people-access`);
    await waitForEmployeeRows(cdp, 3, `${viewport.label}: active employee rows`);
    const value = await evaluate(cdp, `(() => {
      const text = document.body.innerText;
      const root = document.documentElement;
      const invite = [...document.querySelectorAll("button")].find((button) => button.textContent.includes("INVITE EMPLOYEE"));
      const controls = ["#employee-search", "#employee-role-filter", "#employee-status-filter"].map((selector) => document.querySelector(selector));
      return {
        title: document.querySelector("h1")?.textContent,
        headers: [...document.querySelectorAll(".employees-table-header span")].map((item) => item.textContent.trim()),
        hasOverflow: root.scrollWidth > window.innerWidth + 1,
        inviteVisible: Boolean(invite && invite.getBoundingClientRect().width > 0 && invite.getBoundingClientRect().bottom <= window.innerHeight),
        controlsUsable: controls.every((item) => item && item.getBoundingClientRect().width > 40),
        rows: document.querySelectorAll(".employee-row").length,
        activeCopy: text.includes("Showing 3 active employees"),
        noTempAccess: !text.includes("TEMP ·") && !text.includes("REVOKE NOW") && !text.includes("TEMPORARY ACCESS ACTIVE") && !text.includes("Authorize for Today"),
        editButton: Boolean(document.querySelector("[data-staff-edit]")),
        inviteButton: Boolean(document.querySelector("[data-staff-new]")),
      };
    })()`);
    assert.equal(value.title, "People & Access", `${viewport.label}: wrong page`);
    assert.deepEqual(value.headers, ["EMPLOYEE", "ROLE", "STATUS", "LAST LOGIN", "ACCESS", "ACTION"], `${viewport.label}: headers mismatch`);
    assert.equal(value.hasOverflow, false, `${viewport.label}: page overflow`);
    assert.equal(value.inviteVisible, true, `${viewport.label}: invite hidden`);
    assert.equal(value.controlsUsable, true, `${viewport.label}: filters unusable`);
    assert.equal(value.rows, 3, `${viewport.label}: active employee rows did not load`);
    assert.equal(value.activeCopy, true, `${viewport.label}: active count copy mismatch`);
    assert.equal(value.noTempAccess, true, `${viewport.label}: temporary access UI present`);
    assert.equal(value.editButton, true, `${viewport.label}: edit action missing`);
    assert.equal(value.inviteButton, true, `${viewport.label}: invite action missing`);
  }

  await navigate(cdp, `http://127.0.0.1:${appPort}/settings/people-access`);
  await cdp.send("Runtime.evaluate", { expression: `document.querySelector("#employee-search").value = "admin"; document.querySelector("#employee-search").dispatchEvent(new Event("input", { bubbles: true }));` });
  assert.equal((await evaluate(cdp, `document.querySelectorAll(".employee-row").length`)), 1, "Search filter failed.");
  await cdp.send("Runtime.evaluate", { expression: `document.querySelector("#employee-role-filter").value = "staff"; document.querySelector("#employee-role-filter").dispatchEvent(new Event("change", { bubbles: true }));` });
  assert.equal((await evaluate(cdp, `document.querySelectorAll(".employee-row").length`)), 0, "Role filter failed with active search.");
  await cdp.send("Runtime.evaluate", { expression: `document.querySelector("[data-employee-reset]").click();` });
  assert.equal((await evaluate(cdp, `document.querySelectorAll(".employee-row").length`)), 3, "Reset failed.");
  await cdp.send("Runtime.evaluate", { expression: `document.querySelector("[data-employee-view-deactivated]").click();` });
  assert.equal((await evaluate(cdp, `document.body.innerText.includes("Showing 1 deactivated employees") && document.querySelectorAll(".employee-row").length === 1`)), true, "View Deactivated failed.");
  await cdp.send("Runtime.evaluate", { expression: `document.querySelector("[data-staff-edit]").click();` });
  assert.equal((await evaluate(cdp, `Boolean(document.querySelector(".staff-drawer"))`)), true, "Edit drawer did not open.");
  await cdp.send("Runtime.evaluate", { expression: `document.querySelector("[data-staff-close]").click(); document.querySelector("[data-staff-new]").click();` });
  assert.equal((await evaluate(cdp, `Boolean(document.querySelector(".staff-drawer")) && document.body.innerText.includes("INVITE EMPLOYEE")`)), true, "Invite drawer did not open.");

  currentRole = "admin";
  await navigate(cdp, `http://127.0.0.1:${appPort}/settings/people-access`);
  await waitForEmployeeRows(cdp, 1, "Admin employee rows");
  assert.equal((await evaluate(cdp, `document.body.innerText.includes("People & Access") && document.querySelectorAll(".employee-row").length === 1`)), true, "Admin view did not use authorized API rows.");

  currentRole = "staff";
  await navigate(cdp, `http://127.0.0.1:${appPort}/settings/people-access`);
  assert.equal((await evaluate(cdp, `!document.body.innerText.includes("People & Access") && !document.body.innerText.includes("INVITE EMPLOYEE")`)), true, "Staff can access Employee management.");

  process.stdout.write("PASS Employee E1 browser walkthrough: owner/admin/staff and 1366, 1440, 1920, 390\n");
} finally {
  if (chrome) chrome.kill();
  server.close();
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
}

function send(response, status, contentType, body) {
  response.writeHead(status, { "content-type": contentType });
  response.end(body);
}

function getContentType(path) {
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
  }[extname(path)] || "application/octet-stream";
}

async function waitForChrome(debugPort) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("Timed out waiting for Chrome DevTools.");
}

async function createPage(debugPort) {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" });
  if (!response.ok) throw new Error(`Unable to create Chrome page: ${response.status}`);
  return response.json();
}

async function navigate(cdp, url) {
  await cdp.send("Page.navigate", { url });
  const deadline = Date.now() + 15_000;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(cdp, `(() => ({
      ready: document.readyState,
      rootLength: document.querySelector("#root")?.innerHTML.length || 0,
      text: document.body.innerText.slice(0, 200),
      url: location.href
    }))()`);
    if (last.ready === "complete" && last.rootLength > 500) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}; last=${JSON.stringify(last)}`);
}

async function waitForEmployeeRows(cdp, expected, label) {
  const deadline = Date.now() + 15_000;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(cdp, `(() => ({
      rows: document.querySelectorAll(".employee-row").length,
      loading: document.body.innerText.includes("Loading employees"),
      text: document.body.innerText.slice(0, 200)
    }))()`);
    if (last.rows === expected && !last.loading) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}; last=${JSON.stringify(last)}`);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true });
  return result.result.result.value;
}

function connectWebSocket(url) {
  const socket = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message);
  });

  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((resolveSend, rejectSend) => {
            pending.set(id, { resolve: resolveSend, reject: rejectSend });
          });
        },
      });
    });
    socket.addEventListener("error", reject);
  });
}
