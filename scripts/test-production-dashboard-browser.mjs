import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const root = process.cwd();
const port = Number(process.env.PRODUCTION_DASHBOARD_BROWSER_PORT || 58248);
const remotePort = port + 100;
const edgePath = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const server = createServer(handleRequest);
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const browser = spawn(edgePath, [
  "--headless=new",
  `--remote-debugging-port=${remotePort}`,
  `--user-data-dir=${join(tmpdir(), `trry-production-dashboard-edge-${Date.now()}`)}`,
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
    await navigate(cdp, `http://127.0.0.1:${port}/qa-production-dashboard.html`);
    await waitForText(cdp, "Track released jobs from queue");
    const result = await evaluate(cdp, `(() => {
      const page = document.querySelector(".mvp-production-dashboard-page");
      const table = document.querySelector(".mvp-production-table-wrap");
      const cards = document.querySelector(".mvp-production-card-list");
      const firstRow = document.querySelector(".mvp-production-table-row");
      const headers = [...document.querySelectorAll(".mvp-production-table-head span")].map((node) => node.textContent.trim().replace(/\\s+↕$/, "")).join("|");
      return {
        hasShell: Boolean(page),
        headers,
        tableVisible: table ? getComputedStyle(table).display !== "none" : false,
        cardsVisible: cards ? getComputedStyle(cards).display !== "none" : false,
        hasReleasedNative: document.body.innerText.includes("TRRY-ORD-QUEUED77"),
        hasUnreleasedReady: document.body.innerText.includes("TRRY-ORD-READY77"),
        hasReadyToRelease: document.body.innerText.includes("READY TO RELEASE"),
        hasPaymentAction: /Confirm Payment|Pay Online|Pay at Shop|Messenger/i.test(document.body.innerText),
        rowCanOpen: Boolean(firstRow?.dataset.mvpOpen === "production"),
      };
    })()`);
    assert.equal(result.hasShell, true, `Production dashboard shell renders at ${viewport.width}`);
    assert.equal(result.headers, "JOB|CUSTOMER|SUMMARY|METHOD|MATERIALS|ARTWORK|DUE|STAFF|STAGE|ACTION", `Figma production column order at ${viewport.width}`);
    assert.equal(result.hasReleasedNative, true, `released native order reference visible at ${viewport.width}`);
    assert.equal(result.hasUnreleasedReady, false, `unreleased ready order hidden at ${viewport.width}`);
    assert.equal(result.hasReadyToRelease, false, `Production does not show READY TO RELEASE at ${viewport.width}`);
    assert.equal(result.hasPaymentAction, false, `Production has no payment action at ${viewport.width}`);
    assert.equal(result.rowCanOpen, true, `production row opens existing drawer at ${viewport.width}`);
    if (viewport.width > 768) assert.equal(result.tableVisible, true, `desktop/tablet table visible at ${viewport.width}`);
    if (viewport.width <= 768) assert.equal(result.cardsVisible, true, `mobile cards visible at ${viewport.width}`);
  }

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate(cdp, `http://127.0.0.1:${port}/qa-production-dashboard.html`);
  await waitForText(cdp, "TRRY-ORD-QUEUED77");
  await evaluate(cdp, `document.querySelector(".mvp-production-table-row")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))`);
  const drawer = await evaluate(cdp, `(() => ({
    productionId: window.__dashboard?.state?.productionId || "",
    hasDrawer: Boolean(document.querySelector(".mvp-drawer.production")),
    text: document.querySelector(".mvp-drawer.production")?.innerText || ""
  }))()`);
  assert.equal(drawer.productionId, "TRY-QUEUED-077", "production row sets selected production id");
  assert.equal(drawer.hasDrawer, true, "existing Production drawer opens from new dashboard row");
  assert.ok(drawer.text.includes("TRRY-ORD-QUEUED77"), "drawer preserves linked Order identity");

  for (const viewport of [
    { width: 1600, height: 1000 },
    { width: 1024, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: viewport.width < 600 });
    await navigate(cdp, `http://127.0.0.1:${port}/qa-production-dashboard.html?order=TRRY-ORD-START77`);
    await waitForText(cdp, "IN PRODUCTION");
    await delay(300);
    const startedDrawer = await evaluate(cdp, `(() => {
      const drawer = document.querySelector(".mvp-production-drawer.in-progress");
      const rect = drawer?.getBoundingClientRect();
      const tabs = [...document.querySelectorAll("[data-mvp-production-tab]")].map((button) => button.textContent.trim()).join("|");
      return {
        hasDrawer: Boolean(drawer),
        width: Math.round(rect?.width || 0),
        rightOverflow: rect ? Math.ceil(rect.right - window.innerWidth) : 0,
        tabs,
        text: drawer?.innerText || "",
        hasQcAction: Boolean(drawer?.querySelector('[data-mvp-advance][data-mvp-next="qc"]')),
        hasPaymentAction: /Confirm Payment|Pay Online|Pay at Shop|Messenger/i.test(drawer?.innerText || "")
      };
    })()`);
    assert.equal(startedDrawer.hasDrawer, true, `IN PRODUCTION drawer renders at ${viewport.width}`);
    assert.ok(startedDrawer.width <= Math.min(390, viewport.width), `drawer width is viewport-safe at ${viewport.width}`);
    assert.ok(startedDrawer.rightOverflow <= 1, `drawer avoids horizontal overflow at ${viewport.width}`);
    assert.equal(startedDrawer.tabs, "Overview|Workflow|Assignment|Fulfillment|History", `tab order matches Figma at ${viewport.width}`);
    assert.equal(startedDrawer.hasQcAction, true, `started drawer exposes QC action at ${viewport.width}`);
    assert.equal(startedDrawer.hasPaymentAction, false, `started drawer has no payment/Messenger action at ${viewport.width}`);

    await evaluate(cdp, `document.querySelector('[data-mvp-production-tab="workflow"]').click()`);
    await waitForText(cdp, "Released to Production");
    const workflowText = await evaluate(cdp, `document.querySelector(".mvp-production-drawer.in-progress")?.innerText || ""`);
    assert.ok(workflowText.includes("Production started") || workflowText.includes("Current Stage"), `workflow tab distinguishes release/start at ${viewport.width}`);
  }

  await evaluate(cdp, `document.querySelector('[data-mvp-production-status="blocked"]').click()`);
  await waitForText(cdp, "TRRY-LEGACY-BLOCK77");
  const blockedFilter = await evaluate(cdp, `[...document.querySelectorAll(".mvp-production-table-row, .mvp-production-mobile-card")].map((node) => node.innerText).join("\\n")`);
  assert.ok(blockedFilter.includes("TRRY-LEGACY-BLOCK77"), "blocked tab filters explicit blocker");
  assert.ok(!blockedFilter.includes("TRRY-ORD-QUEUED77"), "blocked tab excludes clear queued job");

  await navigate(cdp, `http://127.0.0.1:${port}/qa-production-dashboard.html`);
  await evaluate(cdp, `(() => {
    const input = document.querySelector('[data-mvp-filter="production:search"]');
    input.value = "QC Customer";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitForText(cdp, "TRRY-ORD-QC77");
  const searched = await evaluate(cdp, `[...document.querySelectorAll(".mvp-production-table-row, .mvp-production-mobile-card")].map((node) => node.innerText).join("\\n")`);
  assert.ok(searched.includes("TRRY-ORD-QC77"), "search filters by customer");
  assert.ok(!searched.includes("TRRY-ORD-QUEUED77"), "search excludes unrelated jobs");

  console.log("PASS Production dashboard browser layout, responsive table/card behavior, filters, drawer reachability, and release boundary");
} finally {
  browser.kill();
  await new Promise((resolve) => server.close(resolve));
}

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (url.pathname === "/qa-production-dashboard.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(qaHtml());
      return;
    }
    if (url.pathname === "/src/env.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end('window.TRRY_ADMIN_ENV = {"VITE_USE_SUPABASE_DATA":"false"};\n');
      return;
    }
    const appRoutes = new Set(["/", "/inquiries", "/orders", "/production"]);
    const requestedPath = appRoutes.has(url.pathname) ? "/index.html" : url.pathname;
    const filePath = normalize(join(root, requestedPath));
    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" }[extname(filePath)] || "text/plain";
    response.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
    response.end(await readFile(filePath));
  } catch (error) {
    if (!response.headersSent) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.destroy(error);
  }
}

function qaHtml() {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /><link rel="stylesheet" href="/src/styles.css" /></head><body><main id="app"></main><script type="module">
    import { createMvpDashboard } from "/src/mvpDashboard.js";
    const app = document.getElementById("app");
    const team = [
      { userId: "owner-james", displayName: "James", email: "james@trry.test", role: "owner" },
      { userId: "staff-rachelle", displayName: "Rachelle", email: "rachelle@trry.test", role: "staff" }
    ];
    const base = { status: "won", quoteStatus: "approved", artworkStatus: "approved", fulfillmentMethod: "pickup", service: "Embroidery", qty: "12 pcs", dueDate: "2026-08-09", quotedAmount: 850, amountDue: 850, paymentStatus: "paid", paymentVerifiedAmount: 850, assignedUserId: "owner-james", productDesc: "Premium Tshirt", contact: "0917-000-0000", productionUpdatedAt: "2026-08-08T08:00:00.000Z" };
    const rows = [
      { ...base, id: "TRY-READY-077", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000000770", sourceInquiryId: "TRY-READY-077", orderReference: "TRRY-ORD-READY77", customer: "Order Ready", productionStage: "queued" },
      { ...base, id: "TRY-QUEUED-077", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000000771", sourceInquiryId: "TRY-QUEUED-077", sourceInquiryReference: "TRY-QUEUED-077", orderReference: "TRRY-ORD-QUEUED77", customer: "Queued Customer", productionStage: "embroidery" },
      { ...base, id: "TRY-START-077", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000000773", sourceInquiryId: "TRY-START-077", sourceInquiryReference: "TRY-START-077", orderReference: "TRRY-ORD-START77", customer: "Started Customer", productionStage: "screen_printing", productionStartedAt: "2026-08-08T08:15:00.000Z", productionStartedBy: "staff-rachelle", assignedUserId: "staff-rachelle" },
      { ...base, id: "TRY-QC-077", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000000772", sourceInquiryId: "TRY-QC-077", orderReference: "TRRY-ORD-QC77", customer: "QC Customer", service: "DTF", productionStage: "qc", assignedUserId: "staff-rachelle" },
      { ...base, id: "TRY-BLOCK-077", sourceType: "legacy", orderReference: "TRRY-LEGACY-BLOCK77", customer: "Blocked Customer", productionStage: "embroidery", blockedReason: "Thread color missing" }
    ];
    const dashboard = createMvpDashboard({ getAssignmentContext: () => ({ users: team, loadState: "success", error: "" }) });
    window.__dashboard = dashboard;
    function render() {
      app.innerHTML = dashboard.renderProduction({ items: rows });
      document.body.classList.toggle("mvp-drawer-open", Boolean(document.querySelector(".mvp-drawer")));
      dashboard.bind({ root: app, rerender: render, navigate: () => {}, copy: async () => {}, saveProduction: async () => {} });
    }
    render();
  </script></body></html>`;
}

async function waitForBrowser(portValue) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${portValue}/json/version`);
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch {
      await delay(250);
    }
  }
  throw new Error("Browser CDP endpoint did not start.");
}

async function newPage(portValue) {
  const response = await fetch(`http://127.0.0.1:${portValue}/json/new?about:blank`, { method: "PUT" });
  if (!response.ok) throw new Error("Unable to create browser page.");
  return response.json();
}

async function createCdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
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
      message.error ? reject(new Error(message.error.message)) : resolve(message.result || {});
    }
  });
  return {
    sessionId: "",
    send(method, params = {}) {
      const message = { id: ++id, method, params };
      if (this.sessionId && !method.startsWith("Target.")) message.sessionId = this.sessionId;
      socket.send(JSON.stringify(message));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
  };
}

async function navigate(cdp, url) {
  await cdp.send("Page.navigate", { url });
  await waitFor(cdp, `document.readyState === "complete"`);
}

async function waitForText(cdp, text) {
  const escaped = JSON.stringify(text);
  await waitFor(cdp, `document.body && document.body.innerText.includes(${escaped})`);
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
