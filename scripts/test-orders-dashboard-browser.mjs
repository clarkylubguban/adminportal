import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const root = process.cwd();
const port = Number(process.env.ORDERS_DASHBOARD_BROWSER_PORT || 58244);
const remotePort = port + 100;
const edgePath = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const server = createServer(handleRequest);
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const browser = spawn(edgePath, [
  "--headless=new",
  `--remote-debugging-port=${remotePort}`,
  `--user-data-dir=${join(tmpdir(), `trry-orders-dashboard-edge-${Date.now()}`)}`,
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
    await navigate(cdp, `http://127.0.0.1:${port}/qa-orders-dashboard.html`);
    await waitForText(cdp, "Track payment, release readiness");
    await delay(350);
    const result = await evaluate(cdp, `(() => {
      const table = document.querySelector(".mvp-orders-table-wrap");
      const cards = document.querySelector(".mvp-order-card-list");
      const firstRow = document.querySelector(".mvp-orders-table-row");
      const headers = [...document.querySelectorAll(".mvp-orders-table-head span")].map((node) => node.textContent.trim()).join("|");
      const page = document.querySelector(".mvp-orders-dashboard-page");
      const rect = page.getBoundingClientRect();
      return {
        hasShell: Boolean(page),
        headers,
        tableVisible: table ? getComputedStyle(table).display !== "none" : false,
        cardsVisible: cards ? getComputedStyle(cards).display !== "none" : false,
        hasNativeReference: document.body.innerText.includes("TRRY-ORD-AWAIT01"),
        hasLegacyReference: document.body.innerText.includes("TRRY-LEGACY-PROD01"),
        hasDrawerBefore: Boolean(document.querySelector(".mvp-drawer")),
        rowCanOpen: Boolean(firstRow?.dataset.mvpOpen === "order"),
        pageLeft: rect.left,
        pageRight: rect.right,
        bodyOverflowX: document.documentElement.scrollWidth > window.innerWidth + 2,
      };
    })()`);
    assert.equal(result.hasShell, true, `dashboard shell renders at ${viewport.width}`);
    assert.equal(result.headers, "ORDER|CUSTOMER|SUMMARY|AMOUNT|PAYMENT|PRODUCTION|DUE|OWNER|NEXT ACTION|ACTION", `Figma table column order at ${viewport.width}`);
    assert.equal(result.hasNativeReference, true, `native order reference visible at ${viewport.width}`);
    assert.equal(result.hasLegacyReference, true, `legacy compatibility reference visible at ${viewport.width}`);
    assert.equal(result.rowCanOpen, true, `row opens existing drawer at ${viewport.width}`);
    if (viewport.width > 768) assert.equal(result.tableVisible, true, `desktop/tablet table visible at ${viewport.width}`);
    if (viewport.width <= 768) assert.equal(result.cardsVisible, true, `mobile cards visible at ${viewport.width}`);
  }

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate(cdp, `http://127.0.0.1:${port}/qa-orders-dashboard.html`);
  await waitForText(cdp, "TRRY-ORD-AWAIT01");
  const clickResult = await evaluate(cdp, `(() => {
    const row = document.querySelector(".mvp-orders-table-row");
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return { hasRow: Boolean(row), orderId: window.__dashboard?.state?.orderId || "", text: document.body.innerText.slice(0, 500) };
  })()`);
  assert.equal(clickResult.hasRow, true, "desktop row exists before drawer click");
  const afterClick = await evaluate(cdp, `({ orderId: window.__dashboard?.state?.orderId || "", hasDrawer: Boolean(document.querySelector(".mvp-drawer")), text: document.body.innerText.slice(0, 800) })`);
  assert.equal(afterClick.orderId, "TRY-AWAIT-001", `row click should set selected order state: ${JSON.stringify(afterClick)}`);
  assert.equal(afterClick.hasDrawer, true, `row click should render drawer: ${JSON.stringify(afterClick)}`);
  const drawer = await evaluate(cdp, `({ open: Boolean(document.querySelector(".mvp-drawer.order")), text: document.querySelector(".mvp-drawer")?.innerText || "" })`);
  assert.equal(drawer.open, true, "existing order drawer opens from dashboard row");
  assert.ok(drawer.text.includes("TRRY-ORD-AWAIT01"), "drawer uses native order reference");

  await navigate(cdp, `http://127.0.0.1:${port}/order-dashboard?order=TRRY-1234`);
  await waitFor(cdp, `location.pathname === "/orders" && location.search === "?order=TRRY-1234"`);
  const normalized = await evaluate(cdp, `location.pathname + location.search`);
  assert.equal(normalized, "/orders?order=TRRY-1234");

  console.log("PASS Orders dashboard browser layout, drawer, identity, and compatibility route checks");
} finally {
  browser.kill();
  await new Promise((resolve) => server.close(resolve));
}

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (url.pathname === "/qa-orders-dashboard.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(qaHtml());
      return;
    }
    if (url.pathname === "/order-dashboard") {
      response.writeHead(302, { Location: `/orders${url.search}` });
      response.end();
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
    const team = [{ userId: "owner-james", displayName: "James", email: "james@trry.test", role: "owner" }];
    const base = { status: "won", quoteStatus: "approved", artworkStatus: "approved", fulfillmentMethod: "pickup", service: "Embroidery", qty: "40 pcs", dueDate: "2026-08-09", quotedAmount: 3200, amountDue: 3200, assignedUserId: "owner-james" };
    const rows = [
      { ...base, id: "TRY-AWAIT-001", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000000001", sourceInquiryId: "TRY-AWAIT-001", sourceInquiryReference: "TRY-AWAIT-001", orderReference: "TRRY-ORD-AWAIT01", customer: "Teresa Gonzales", contact: "+63 917 420 9911", productDesc: "Polo shirts", paymentStatus: "awaiting_payment", productionStage: "queued" },
      { ...base, id: "TRY-REVIEW-001", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000000002", orderReference: "TRRY-ORD-REVIEW01", customer: "Review Customer", contact: "0917-000-0002", productDesc: "Team jackets", paymentStatus: "proof_submitted", productionStage: "queued" },
      { ...base, id: "TRY-READY-001", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000000003", orderReference: "TRRY-ORD-READY01", customer: "Ready Customer", contact: "0917-000-0003", productDesc: "Caps", paymentStatus: "paid", paymentVerifiedAmount: 3200, productionStage: "queued" },
      { ...base, id: "TRY-PROD-001", sourceType: "legacy", orderReference: "TRRY-LEGACY-PROD01", odooSO: "SO-LEGACY-PROD01", customer: "Legacy Production", contact: "0917-000-0004", productDesc: "Tote bags", paymentStatus: "paid", paymentVerifiedAmount: 3200, productionStage: "printing" },
      { ...base, id: "TRY-BLOCK-001", sourceType: "legacy", orderReference: "TRRY-LEGACY-BLOCK01", customer: "Blocked Customer", contact: "0917-000-0005", productDesc: "Uniforms", paymentStatus: "paid", paymentVerifiedAmount: 3200, productionStage: "queued", blockedReason: "Materials unavailable" }
    ];
    const dashboard = createMvpDashboard({ getAssignmentContext: () => ({ users: team, loadState: "success", error: "" }) });
    window.__dashboard = dashboard;
    function render() {
      app.innerHTML = dashboard.renderOrders({ items: rows });
      document.body.classList.toggle("mvp-drawer-open", Boolean(document.querySelector(".mvp-drawer")));
      dashboard.bind({ root: app, rerender: render, navigate: (route) => { window.__route = route; }, copy: async () => {}, confirmPayment: async () => {}, saveProduction: async () => {} });
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
