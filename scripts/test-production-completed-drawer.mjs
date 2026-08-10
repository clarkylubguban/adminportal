import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { createMvpDashboard } from "../src/mvpDashboard.js";

global.window = { location: { search: "" }, history: { replaceState() {} }, setTimeout };

const ACTOR_ID = "96000000-0000-4000-8000-000000000888";
const OTHER_ACTOR_ID = "96000000-0000-4000-8000-000000000889";
const team = [
  { userId: ACTOR_ID, displayName: "Louvelyngel", email: "louvelyngel@trry.test", role: "staff" },
  { userId: OTHER_ACTOR_ID, displayName: "Clark Lubguban", email: "clark@trry.test", role: "owner" },
];

const completed = completedItem();
const legacyCompleted = completedItem({
  id: "TRY-LEGACY-COMPLETED11",
  sourceType: "legacy",
  nativeOrderId: "",
  sourceInquiryId: "",
  sourceInquiryReference: "",
  orderReference: "TRRY-LEGACY-COMPLETE11",
  odooSO: "SO-COMPLETE11",
  productionCompletedAt: "",
  productionCompletedBy: "",
});
const fulfilledOrder = completedItem({
  id: "TRY-FULFILLED-ORDER11",
  orderReference: "TRRY-ORD-FULFILLED11",
  trackingSubstatus: "completed",
  trackingNote: "Customer picked up at front counter.",
});

const dashboard = createMvpDashboard({
  getAssignmentContext: () => ({ users: team, loadState: "success", error: "" }),
});
dashboard.state.production.pageSize = 10;

global.window.location.search = "?order=TRRY-ORD-COMPLETE11";
dashboard.state.productionTab = "overview";
let html = dashboard.renderProduction({ items: [completed, legacyCompleted, fulfilledOrder] });
assert.ok(html.includes("mvp-production-drawer in-progress completed-production"), "completed job renders dedicated completed drawer shell");
assert.ok(html.includes("COMPLETED"), "header uses completed state");
assert.ok(html.includes("TRRY-ORD-COMPLETE11"), "native order reference remains job identity");
assert.ok(html.includes("Current Stage") && html.includes("COMPLETED"), "overview shows Production completed stage");
assert.ok(html.includes("Production Completed"), "overview shows production completion metadata");
assert.ok(html.includes("Aug 1, 2026") && html.includes("Clark Lubguban"), "overview resolves completed timestamp and actor");
assert.ok(html.includes("Production completed") && html.includes("Production work and internal handoff are complete."), "overview uses production-owned copy");
assert.ok(!html.includes("Order completed"), "overview does not imply final Order completion");
assert.ok(!html.includes("completed and delivered"), "overview does not imply customer delivery");
assert.ok(!/Confirm Payment|Pay Online|Pay at Shop|Messenger/i.test(html), "Completed drawer exposes no payment or Messenger action");
assert.ok(!html.includes("MARK PRODUCTION COMPLETE"), "completed drawer has no completion mutation action");
assert.ok(!html.includes("Save Fulfillment"), "completed drawer has no fulfillment write");

dashboard.state.productionTab = "workflow";
html = dashboard.renderProduction({ items: [completed, legacyCompleted, fulfilledOrder] });
assert.ok(html.includes("Released to Production"), "workflow includes release step");
assert.ok(html.includes("In Production"), "workflow includes production step");
assert.ok(html.includes("Quality Check"), "workflow includes QC step");
assert.ok(html.includes("Ready for Fulfillment"), "workflow includes handoff readiness step");
assert.ok(html.includes("Production Completed") && html.includes("Current Stage"), "workflow labels final event as Production Completed");
assert.ok(!html.includes("Order Completed"), "workflow does not label final event as Order Completed");

dashboard.state.productionTab = "assignment";
html = dashboard.renderProduction({ items: [completed, legacyCompleted, fulfilledOrder] });
assert.ok(html.includes("ASSIGNMENT &amp; NOTES"), "assignment tab renders");
assert.ok(html.includes("Assigned Production Staff") && html.includes("Louvelyngel"), "assigned staff is visible read-only");
assert.ok(html.includes("Production Completed By") && html.includes("Clark Lubguban"), "completion actor is visible");
assert.ok(html.includes("Read only"), "notes are explicitly read-only");
assert.ok(!html.includes("data-mvp-save-production"), "completed assignment has no production save hook");
assert.ok(!html.includes("data-mvp-save-qc-note"), "completed assignment has no QC note save hook");
assert.ok(!html.includes("<button") || !html.includes("Reassign</button>"), "completed assignment has no reassign button");

dashboard.state.productionTab = "fulfillment";
html = dashboard.renderProduction({ items: [completed, legacyCompleted, fulfilledOrder] });
assert.ok(!html.includes('data-mvp-production-tab="fulfillment"'), "Production drawer does not render a Fulfillment tab");
assert.ok(!html.includes("Customer Visible Status"), "Completed Production drawer has no fulfillment-owned body");
assert.ok(html.includes("ORDER SUMMARY"), "stale fulfillment tab state normalizes back to Overview");
assert.ok(!html.includes("Save Fulfillment"), "Production drawer does not expose fulfillment writes");

dashboard.state.productionTab = "history";
html = dashboard.renderProduction({ items: [completed, legacyCompleted, fulfilledOrder] });
assert.ok(html.includes("Order created"), "history includes order creation");
assert.ok(html.includes("Payment confirmed"), "history includes read-only payment prerequisite");
assert.ok(html.includes("Artwork approved"), "history includes artwork approval");
assert.ok(html.includes("Released to production"), "history includes release");
assert.ok(html.includes("Production started"), "history includes start metadata");
assert.ok(html.includes("Quality check started"), "history includes QC start");
assert.ok(html.includes("Quality check completed"), "history includes QC completion");
assert.ok(html.includes("Production completed"), "history includes production completion");
assert.ok(!html.includes("Order completed"), "history does not fabricate Order completion");
assert.ok(!html.includes("Production conduction"), "history does not copy Figma typo");

global.window.location.search = "?order=TRRY-LEGACY-COMPLETE11";
dashboard.state.productionTab = "overview";
html = dashboard.renderProduction({ items: [completed, legacyCompleted, fulfilledOrder] });
assert.ok(!html.includes("TRRY-LEGACY-COMPLETE11"), "legacy Odoo-only completed records are not active Production drawer records");
assert.ok(!html.includes("Completion metadata unavailable"), "legacy Odoo-only completed records cannot open active workflow drawers");
assert.ok(!html.includes("mvp-production-drawer"), "no active Production drawer renders for legacy Odoo-only completed records");
assert.ok(!html.includes("PRD-"), "completed drawer does not invent Production job IDs");

global.window.location.search = "?order=TRRY-ORD-FULFILLED11";
dashboard.state.productionTab = "fulfillment";
html = dashboard.renderProduction({ items: [completed, legacyCompleted, fulfilledOrder] });
assert.ok(!html.includes("Customer Tracking"), "Completed Production drawer does not display Order-owned tracking as a tab body");
assert.ok(html.includes("ORDER SUMMARY"), "stale fulfillment tab state normalizes back to Overview");

const source = await readFile("src/mvpDashboard.js", "utf8");
assert.ok(source.includes("productionCompletedDrawer"), "completed drawer uses dedicated shared Production drawer path");
assert.ok(source.includes("Production work and internal handoff are complete."), "production-owned completion copy is encoded");
assert.ok(!source.includes("productionCompletedFulfillment"), "Completed Production drawer has no fulfillment-owned panel");
assert.ok(source.includes("data-mvp-open-messenger"), "Messenger behavior remains elsewhere and untouched");

await verifyResponsiveCompletedDrawer();

console.log("PASS Completed Production drawer, truthful completion semantics, read-only fulfillment boundary, legacy metadata fallback, and responsive checks");

function completedItem(overrides = {}) {
  return {
    id: "TRY-COMPLETED-DRAWER",
    status: "won",
    quoteStatus: "approved",
    sourceType: "native",
    nativeOrderId: "96000000-0000-4000-8000-000000001111",
    sourceInquiryId: "TRY-COMPLETED-DRAWER",
    sourceInquiryReference: "TRY-COMPLETED-DRAWER",
    orderReference: "TRRY-ORD-COMPLETE11",
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
    productionStage: "completed",
    productionUpdatedAt: "2026-07-30T18:12:00.000Z",
    productionStartedAt: "2026-07-31T14:25:00.000Z",
    productionStartedBy: ACTOR_ID,
    qcStartedAt: "2026-08-01T14:30:00.000Z",
    qcStartedBy: ACTOR_ID,
    qcCompletedAt: "2026-08-01T15:10:00.000Z",
    qcCompletedBy: ACTOR_ID,
    productionCompletedAt: "2026-08-01T15:30:00.000Z",
    productionCompletedBy: OTHER_ACTOR_ID,
    qcNote: "Passed quantity and print quality.",
    assignedUserId: ACTOR_ID,
    assignedStaff: "Louvelyngel",
    productionNote: "Production finished and passed QC.",
    createdAt: "2026-07-30T11:32:00.000Z",
    ...overrides,
  };
}

async function verifyResponsiveCompletedDrawer() {
  const root = process.cwd();
  const port = Number(process.env.PRODUCTION_COMPLETED_BROWSER_PORT || 58269);
  const remotePort = port + 100;
  const edgePath = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/qa-completed.html") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"></head><body><div id="app"></div><script type="module">
        import { createMvpDashboard } from "/src/mvpDashboard.js";
        const completed = ${JSON.stringify(completed)};
        window.__dashboard = createMvpDashboard({ getAssignmentContext: () => ({ users: ${JSON.stringify(team)}, loadState: "success", error: "" }) });
        window.__dashboard.state.production.pageSize = 10;
        window.__dashboard.state.productionTab = "overview";
        document.getElementById("app").innerHTML = window.__dashboard.renderProduction({ items: [completed] });
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
    `--user-data-dir=${join(tmpdir(), `trry-completed-drawer-edge-${Date.now()}`)}`,
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
      await navigate(cdp, `http://127.0.0.1:${port}/qa-completed.html?order=TRRY-ORD-COMPLETE11`);
      await waitForText(cdp, "Production completed");
      await delay(300);
      const result = await evaluate(cdp, `(() => {
        const drawer = document.querySelector(".mvp-production-drawer.completed-production");
        const rect = drawer?.getBoundingClientRect();
        return {
          hasDrawer: Boolean(drawer),
          width: Math.round(rect?.width || 0),
          rightOverflow: rect ? Math.ceil(rect.right - window.innerWidth) : 0,
          tabs: [...document.querySelectorAll("[data-mvp-production-tab]")].map((button) => button.textContent.trim()).join("|"),
          hasViewOrder: Boolean(drawer?.querySelector('[data-mvp-route^="/orders?order="]')),
          hasMutation: Boolean(drawer?.querySelector("[data-mvp-advance], [data-mvp-save-production], [data-mvp-save-qc-note], [data-mvp-start-production]")),
          hasSaveFulfillment: /Save Fulfillment/i.test(drawer?.innerText || ""),
          hasPaymentAction: /Confirm Payment|Pay Online|Pay at Shop|Messenger/i.test(drawer?.innerText || ""),
          hasOrderCompletedCopy: /Order completed|completed and delivered/i.test(drawer?.innerText || "")
        };
      })()`);
      assert.equal(result.hasDrawer, true, `Completed drawer renders at ${viewport.width}`);
      assert.ok(result.width <= Math.min(390, viewport.width), `drawer width is viewport-safe at ${viewport.width}`);
      assert.ok(result.rightOverflow <= 16, `drawer avoids horizontal overflow beyond scrollbar gutter at ${viewport.width}: ${result.rightOverflow}`);
      assert.equal(result.tabs, "Overview|Workflow|Assignment|History", `tab order matches Figma at ${viewport.width}`);
      assert.equal(result.hasViewOrder, true, `View Order action exists at ${viewport.width}`);
      assert.equal(result.hasMutation, false, `no production mutation hook at ${viewport.width}`);
      assert.equal(result.hasSaveFulfillment, false, `no Save Fulfillment at ${viewport.width}`);
      assert.equal(result.hasPaymentAction, false, `no payment/Messenger action at ${viewport.width}`);
      assert.equal(result.hasOrderCompletedCopy, false, `no fake Order completion copy at ${viewport.width}`);
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
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const state = await evaluate(cdp, "document.readyState");
    if (state === "complete") return;
    await delay(100);
  }
}

async function waitForText(cdp, text) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const found = await evaluate(cdp, `document.body?.innerText.includes(${JSON.stringify(text)})`);
    if (found) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${text}`);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true });
  return result.result?.value;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
