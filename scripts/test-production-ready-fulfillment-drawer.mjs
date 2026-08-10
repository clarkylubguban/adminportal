import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { buildOpsWorkflowUpdates } from "../api/_lib/opsWorkflow.js";
import { createMvpDashboard } from "../src/mvpDashboard.js";

global.window = { location: { search: "" }, history: { replaceState() {} }, setTimeout };

const ACTOR_ID = "96000000-0000-4000-8000-000000000888";
const OTHER_ACTOR_ID = "96000000-0000-4000-8000-000000000889";
const team = [
  { userId: ACTOR_ID, displayName: "Louvelyngel", email: "louvelyngel@trry.test", role: "staff" },
  { userId: OTHER_ACTOR_ID, displayName: "Rachelle", email: "rachelle@trry.test", role: "staff" },
];

const ready = readyItem();
const completed = { ...ready, id: "TRY-COMPLETE-READY", orderReference: "TRRY-ORD-COMPLETE10", productionStage: "completed", productionCompletedAt: "2026-08-01T15:30:00.000Z", productionCompletedBy: ACTOR_ID };
const legacyReady = { ...ready, id: "TRY-LEGACY-READY10", sourceType: "legacy", nativeOrderId: "", sourceInquiryId: "", sourceInquiryReference: "", orderReference: "TRRY-LEGACY-READY10", odooSO: "SO-READY10", qcStartedAt: "", qcCompletedAt: "", qcStartedBy: "", qcCompletedBy: "" };
const blockedReady = { ...ready, id: "TRY-BLOCKED-READY10", orderReference: "TRRY-ORD-BLOCKED10", blockedReason: "Missing pickup handoff tag" };

const dashboard = createMvpDashboard({
  getAssignmentContext: () => ({ users: team, loadState: "success", error: "" }),
});
dashboard.state.production.pageSize = 10;

global.window.location.search = "?order=TRRY-ORD-READY10";
dashboard.state.productionTab = "overview";
let html = dashboard.renderProduction({ items: [ready, completed, legacyReady, blockedReady] });
assert.ok(html.includes("mvp-production-drawer in-progress ready-fulfillment"), "READY job renders dedicated Ready for Fulfillment drawer shell");
assert.ok(html.includes("READY FOR FULFILLMENT"), "header uses explicit ready-for-fulfillment state");
assert.ok(html.includes("TRRY-ORD-READY10"), "native order reference remains job identity");
assert.ok(html.includes("Current Stage") && html.includes("Ready"), "overview shows operational Ready current stage");
assert.ok(!html.includes("Current Stage</span><strong>READY FOR FULFILLMENT"), "overview does not repeat coarse status as current stage");
assert.ok(html.includes("QC Completed") && html.includes("Aug 1, 2026"), "overview displays persisted QC completion timestamp");
assert.ok(html.includes("Production is ready for fulfillment."), "ready card uses production-owned copy");
assert.ok(html.includes("NOW: READY"), "Ready footer NOW shows operational Ready stage");
assert.ok(html.includes("NEXT: PRODUCTION COMPLETE"), "Ready footer NEXT shows Production Complete");
assert.ok(html.includes("MARK PRODUCTION COMPLETE"), "primary action is production-specific");
assert.ok(html.includes('data-mvp-next="completed"'), "completion action uses existing completed stage transition");
assert.ok(!/Confirm Payment|Pay Online|Pay at Shop|Messenger/i.test(html), "Ready drawer exposes no payment or Messenger action");
assert.ok(!html.includes("Save Fulfillment"), "Ready drawer does not expose fulfillment writes");
assert.ok(!html.includes("PRD-"), "Ready drawer does not invent Production job IDs");

dashboard.state.productionTab = "workflow";
html = dashboard.renderProduction({ items: [ready, completed, legacyReady, blockedReady] });
assert.ok(html.includes("Released to Production"), "workflow includes release step");
assert.ok(html.includes("In Production"), "workflow includes production step");
assert.ok(html.includes("Quality Check"), "workflow includes QC step");
assert.ok(html.includes("Ready for Fulfillment") && html.includes("Current Stage"), "workflow marks Ready for Fulfillment current");
assert.ok(html.includes("Completed") && html.includes("Pending"), "workflow leaves Completed pending");

dashboard.state.productionTab = "assignment";
html = dashboard.renderProduction({ items: [ready, completed, legacyReady, blockedReady] });
assert.ok(html.includes("ASSIGNMENT &amp; NOTES"), "assignment tab renders");
assert.ok(html.includes("Assigned Production Staff") && html.includes("Louvelyngel"), "assignment is visible");
assert.ok(html.includes("Quality Check Note") && html.includes("Passed quantity and print quality."), "QC note is read-only visible");
assert.ok(!html.includes("Save Note"), "Ready assignment does not expose unsupported note writes");

dashboard.state.productionTab = "fulfillment";
html = dashboard.renderProduction({ items: [ready, completed, legacyReady, blockedReady] });
assert.ok(!html.includes('data-mvp-production-tab="fulfillment"'), "Production drawer does not render a Fulfillment tab");
assert.ok(!html.includes("Customer Visible Status"), "Ready Production drawer has no fulfillment-owned body");
assert.ok(html.includes("ORDER SUMMARY"), "stale fulfillment tab state normalizes back to Overview");
assert.ok(!html.includes("Save Fulfillment"), "Production drawer does not expose fulfillment writes");

dashboard.state.productionTab = "history";
html = dashboard.renderProduction({ items: [ready, completed, legacyReady, blockedReady] });
assert.ok(html.includes("Order created"), "history includes order created");
assert.ok(html.includes("Payment confirmed"), "history includes payment prerequisite");
assert.ok(html.includes("Artwork approved"), "history includes artwork prerequisite");
assert.ok(html.includes("Released to production"), "history includes release");
assert.ok(html.includes("Production started"), "history includes production start");
assert.ok(html.includes("Quality check started"), "history includes QC start");
assert.ok(html.includes("Quality check completed"), "history includes QC completion");
assert.ok(html.includes("Ready for fulfillment"), "history derives ready event from QC completion");
assert.ok(!html.includes("Production completed"), "active Ready state does not fabricate Production completed");

global.window.location.search = "?order=TRRY-ORD-BLOCKED10";
dashboard.state.productionTab = "overview";
html = dashboard.renderProduction({ items: [ready, completed, legacyReady, blockedReady] });
assert.ok(html.includes("Missing pickup handoff tag"), "blocker is visible");
assert.match(html, /data-mvp-next="completed" disabled/, "blocked Ready job cannot complete through UI");

global.window.location.search = "?order=TRRY-LEGACY-READY10";
html = dashboard.renderProduction({ items: [ready, completed, legacyReady, blockedReady] });
assert.ok(!html.includes("TRRY-LEGACY-READY10"), "legacy Odoo-only Ready row is not active Production");

global.window.location.search = "?order=TRRY-ORD-COMPLETE10";
html = dashboard.renderProduction({ items: [ready, completed, legacyReady, blockedReady] });
assert.ok(!html.includes("ready-fulfillment"), "completed row does not render active Ready drawer shell");
assert.ok(html.includes("COMPLETED"), "completed row remains readable through existing completed path");

const before = workflowInquiry();
const result = buildOpsWorkflowUpdates("advance_production", { productionStage: "completed", actorUserId: ACTOR_ID }, before, "2026-08-01T15:30:00.000Z");
assert.equal(result.ok, true, "Ready production advances through existing workflow");
assert.equal(result.updates.production_stage, "completed");
assert.equal(result.updates.production_completed_at, "2026-08-01T15:30:00.000Z");
assert.equal(result.updates.production_completed_by, ACTOR_ID);
assert.equal(result.updates.fulfillment_method, undefined, "completion does not write fulfillment method");
assert.equal(result.updates.tracking_substatus, undefined, "completion does not write tracking substatus");
assert.equal(result.updates.tracking_note, undefined, "completion does not write tracking note");

const retry = buildOpsWorkflowUpdates("advance_production", { productionStage: "completed", actorUserId: OTHER_ACTOR_ID }, {
  ...before,
  production_stage: "completed",
  production_completed_at: "2026-08-01T15:30:00.000Z",
  production_completed_by: ACTOR_ID,
}, "2026-08-01T16:00:00.000Z");
assert.equal(retry.ok, true, "duplicate production completion reconciles safely");
assert.equal(retry.noop, true, "duplicate production completion is a no-op");

const failed = buildOpsWorkflowUpdates("advance_production", { productionStage: "completed", actorUserId: ACTOR_ID }, {
  ...before,
  blocked_reason: "Missing pickup handoff tag",
}, "2026-08-01T15:30:00.000Z");
assert.equal(failed.ok, false, "backend failure keeps blocked Ready work from completing");

const source = await readFile("src/mvpDashboard.js", "utf8");
assert.ok(source.includes("productionReadyDrawer"), "Ready drawer uses dedicated shared Production drawer path");
assert.ok(source.includes("MARK PRODUCTION COMPLETE"), "Ready completion action is explicit");
assert.ok(!source.includes("productionReadyFulfillment"), "Ready Production drawer has no fulfillment-owned panel");
assert.ok(source.includes("data-mvp-open-messenger"), "Messenger behavior remains elsewhere and untouched");

await verifyResponsiveReadyDrawer();

console.log("PASS Ready for Fulfillment drawer, read-only fulfillment boundary, production completion action, idempotency, failure, legacy, and responsive checks");

function readyItem(overrides = {}) {
  return {
    id: "TRY-READY-DRAWER",
    status: "won",
    quoteStatus: "approved",
    sourceType: "native",
    nativeOrderId: "96000000-0000-4000-8000-000000001010",
    sourceInquiryId: "TRY-READY-DRAWER",
    sourceInquiryReference: "TRY-READY-DRAWER",
    orderReference: "TRRY-ORD-READY10",
    customer: "Clark Lubguban",
    contact: "+639177021242",
    source: "Website",
    service: "DTF",
    productDesc: "Premium Tshirt",
    qty: "12 pcs",
    sizeBreakdown: "S-2 / M-4 / L-4 / XL-2",
    garmentColor: "Black",
    dueDate: "2026-07-31",
    fulfillmentMethod: "pickup",
    trackingSubstatus: "ready_for_pickup",
    trackingNote: "Bring valid ID.",
    deliveryAddress: "Front counter",
    deliveryCity: "Bacolod",
    artworkStatus: "approved",
    artworkApprovedAt: "2026-07-30T17:54:00.000Z",
    paymentStatus: "paid",
    paymentVerifiedAmount: 850,
    paymentConfirmedAmount: 850,
    paymentConfirmedAt: "2026-07-30T18:12:00.000Z",
    productionStage: "ready",
    productionUpdatedAt: "2026-07-30T18:12:00.000Z",
    productionStartedAt: "2026-07-31T14:25:00.000Z",
    productionStartedBy: ACTOR_ID,
    qcStartedAt: "2026-08-01T14:30:00.000Z",
    qcStartedBy: ACTOR_ID,
    qcCompletedAt: "2026-08-01T15:10:00.000Z",
    qcCompletedBy: ACTOR_ID,
    qcNote: "Passed quantity and print quality.",
    assignedUserId: ACTOR_ID,
    assignedStaff: "Louvelyngel",
    productionNote: "Production completed and passed QC.",
    createdAt: "2026-07-30T11:32:00.000Z",
    ...overrides,
  };
}

function workflowInquiry(overrides = {}) {
  return {
    id: "TRY-READY-DRAWER",
    status: "approved",
    nativeOrderAuthority: true,
    nativeOrderId: "96000000-0000-4000-8000-000000001010",
    quote_status: "approved",
    quoted_amount: 850,
    amount_due: 850,
    odoo_so: "SO-READY",
    product: "DTF",
    product_desc: "Premium Tshirt",
    quantity: "12 pcs",
    due_date: "2026-07-31",
    artwork_status: "approved",
    assigned_staff: "Louvelyngel",
    payment_status: "paid",
    payment_verified_amount: 850,
    production_stage: "ready",
    production_started_at: "2026-07-31T14:25:00.000Z",
    production_started_by: ACTOR_ID,
    qc_started_at: "2026-08-01T14:30:00.000Z",
    qc_completed_at: "2026-08-01T15:10:00.000Z",
    qc_completed_by: ACTOR_ID,
    fulfillment_method: "pickup",
    tracking_substatus: "ready_for_pickup",
    tracking_note: "Bring valid ID.",
    delivery_address: "Front counter",
    blocked_reason: null,
    ...overrides,
  };
}

async function verifyResponsiveReadyDrawer() {
  const root = process.cwd();
  const port = Number(process.env.PRODUCTION_READY_BROWSER_PORT || 58268);
  const remotePort = port + 100;
  const edgePath = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/qa-ready.html") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"></head><body><div id="app"></div><script type="module">
        import { createMvpDashboard } from "/src/mvpDashboard.js";
        const ready = ${JSON.stringify(ready)};
        window.__dashboard = createMvpDashboard({ getAssignmentContext: () => ({ users: ${JSON.stringify(team)}, loadState: "success", error: "" }) });
        window.__dashboard.state.production.pageSize = 10;
        window.__dashboard.state.productionTab = "overview";
        document.getElementById("app").innerHTML = window.__dashboard.renderProduction({ items: [ready] });
      </script></body></html>`);
      return;
    }
    const filePath = join(root, url.pathname.replace(/^\/+/, ""));
    try {
      const body = await readFile(filePath);
      response.writeHead(200, { "Content-Type": contentType(filePath) });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const browser = spawn(edgePath, [
    "--headless=new",
    `--remote-debugging-port=${remotePort}`,
    `--user-data-dir=${join(tmpdir(), `trry-ready-drawer-edge-${Date.now()}`)}`,
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: "ignore" });
  try {
    const wsUrl = await waitForBrowser(remotePort);
    const cdp = await createCdp(wsUrl);
    const page = await newPage(remotePort);
    await cdp.send("Target.attachToTarget", { targetId: page.id, flatten: true }).then((result) => cdp.sessionId = result.sessionId);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    for (const viewport of [
      { width: 1600, height: 1000 },
      { width: 1024, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: viewport.width < 600 });
      await navigate(cdp, `http://127.0.0.1:${port}/qa-ready.html?order=TRRY-ORD-READY10`);
      await waitForText(cdp, "READY FOR FULFILLMENT");
      await delay(300);
      const result = await evaluate(cdp, `(() => {
        const drawer = document.querySelector(".mvp-production-drawer.ready-fulfillment");
        const rect = drawer?.getBoundingClientRect();
        return {
          hasDrawer: Boolean(drawer),
          width: Math.round(rect?.width || 0),
          rightOverflow: rect ? Math.ceil(rect.right - window.innerWidth) : 0,
          tabs: [...document.querySelectorAll("[data-mvp-production-tab]")].map((button) => button.textContent.trim()).join("|"),
          hasComplete: Boolean(drawer?.querySelector('[data-mvp-advance][data-mvp-next="completed"]')),
          hasSaveFulfillment: /Save Fulfillment/i.test(drawer?.innerText || ""),
          hasPaymentAction: /Confirm Payment|Pay Online|Pay at Shop|Messenger/i.test(drawer?.innerText || "")
        };
      })()`);
      assert.equal(result.hasDrawer, true, `READY drawer renders at ${viewport.width}`);
      assert.ok(result.width <= Math.min(390, viewport.width), `drawer width is viewport-safe at ${viewport.width}`);
      assert.ok(result.rightOverflow <= 16, `drawer avoids horizontal overflow beyond scrollbar gutter at ${viewport.width}: ${result.rightOverflow}`);
      assert.equal(result.tabs, "Overview|Workflow|Assignment|History", `tab order matches Figma at ${viewport.width}`);
      assert.equal(result.hasComplete, true, `completion action is present at ${viewport.width}`);
      assert.equal(result.hasSaveFulfillment, false, `no Save Fulfillment at ${viewport.width}`);
      assert.equal(result.hasPaymentAction, false, `no payment/Messenger action at ${viewport.width}`);
    }
  } finally {
    browser.kill();
    server.close();
  }
}

function contentType(path) {
  return { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" }[extname(path)] || "text/plain";
}

async function waitForBrowser(port) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      const data = await response.json();
      if (data.webSocketDebuggerUrl) return data.webSocketDebuggerUrl;
    } catch {}
    await delay(250);
  }
  throw new Error("Browser did not start");
}

async function newPage(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
  return response.json();
}

async function createCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result || {});
    }
  });
  return {
    sessionId: "",
    send(method, params = {}) {
      const callId = ++id;
      const message = { id: callId, method, params };
      if (this.sessionId && !method.startsWith("Target.")) message.sessionId = this.sessionId;
      ws.send(JSON.stringify(message));
      return new Promise((resolve, reject) => pending.set(callId, { resolve, reject }));
    },
  };
}

async function navigate(cdp, url) {
  await cdp.send("Page.navigate", { url });
  await waitFor(cdp, `document.readyState === "complete"`);
}

async function waitForText(cdp, text, timeout = 7000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = await evaluate(cdp, `document.body?.innerText.includes(${JSON.stringify(text)})`);
    if (found) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for text: ${text}`);
}

async function waitFor(cdp, expression) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await evaluate(cdp, expression);
    if (result) return;
    await delay(125);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Evaluation failed");
  return result.result?.value;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
