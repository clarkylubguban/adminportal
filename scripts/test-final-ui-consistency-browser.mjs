import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const root = process.cwd();
const port = Number(process.env.FINAL_UI_BROWSER_PORT || 58270);
const remotePort = port + 100;
const edgePath = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const viewports = [
  { name: "1600", width: 1600, height: 1000 },
  { name: "1366", width: 1366, height: 768 },
  { name: "1024", width: 1024, height: 900 },
  { name: "768", width: 768, height: 1024 },
  { name: "390", width: 390, height: 844 },
  { name: "360", width: 360, height: 800 },
];

const server = createServer(handleRequest);
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const browser = spawn(edgePath, [
  "--headless=new",
  `--remote-debugging-port=${remotePort}`,
  `--user-data-dir=${join(tmpdir(), `trry-final-ui-edge-${Date.now()}`)}`,
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

  for (const viewport of viewports) {
    await setViewport(cdp, viewport);
    await verifyDashboard(cdp, viewport, "/inquiries", "Inquiry", "CODE|CUSTOMER|ITEM|REQUEST|SERVICE|QTY|QUOTE STATUS|FOLLOW-UP|OWNER|ACTION");
    await verifyDashboard(cdp, viewport, "/orders", "Orders", "ORDER|CUSTOMER|SUMMARY|AMOUNT|PAYMENT|PRODUCTION|DUE|OWNER|NEXT ACTION|ACTION");
    await verifyDashboard(cdp, viewport, "/production", "Production", "JOB|CUSTOMER|SUMMARY|METHOD|MATERIALS|ARTWORK|DUE|STAFF|STAGE|ACTION");
    await verifyDrawers(cdp, viewport);
  }

  await setViewport(cdp, viewports[0]);
  await navigate(cdp, `http://127.0.0.1:${port}/order-dashboard?order=TRRY-ORD-READY12`);
  await waitFor(cdp, `location.pathname === "/orders" && location.search === "?order=TRRY-ORD-READY12"`);
  assert.equal(await evaluate(cdp, `location.pathname + location.search`), "/orders?order=TRRY-ORD-READY12", "legacy Order Dashboard route normalizes to /orders and preserves query");

  console.log("PASS Final UI consistency browser matrix for Inquiry, Orders, Production, drawers, identity, ownership, and legacy routing");
} finally {
  browser.kill();
  await new Promise((resolve) => server.close(resolve));
}

async function verifyDashboard(cdp, viewport, route, title, expectedHeaders) {
  await navigate(cdp, `http://127.0.0.1:${port}${route}`);
  await waitForText(cdp, title);
  await delay(250);
  const result = await evaluate(cdp, `(() => {
    const page = document.querySelector(".mvp-page");
    const tableWrap = document.querySelector(".mvp-table-wrap, .mvp-orders-table-wrap, .mvp-production-table-wrap");
    const mobileCards = document.querySelector(".mvp-inquiry-card-list, .mvp-order-card-list, .mvp-production-card-list");
    const headers = [...document.querySelectorAll(".mvp-table-head span, .mvp-orders-table-head span, .mvp-production-table-head span")].map((node) => node.textContent.replace(/[↕\\u2195]/g, "").trim().toUpperCase()).join("|");
    const pageRect = page?.getBoundingClientRect();
    const tableDisplay = tableWrap ? getComputedStyle(tableWrap).display : "";
    const cardDisplay = mobileCards ? getComputedStyle(mobileCards).display : "";
    return {
      hasPage: Boolean(page),
      headers,
      pageLeft: Math.round(pageRect?.left || 0),
      pageRight: Math.round(pageRect?.right || 0),
      hasHorizontalPageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      tableVisible: tableDisplay && tableDisplay !== "none",
      cardsVisible: cardDisplay && cardDisplay !== "none",
      hasFakeProductionId: /PRD-\\d+/i.test(document.body.innerText),
      text: document.body.innerText
    };
  })()`);
  assert.equal(result.hasPage, true, `${route} page shell renders at ${viewport.name}`);
  assert.equal(result.headers, expectedHeaders, `${route} table columns match locked order at ${viewport.name}`);
  assert.equal(result.hasHorizontalPageOverflow, false, `${route} has no horizontal page overflow at ${viewport.name}`);
  assert.equal(result.hasFakeProductionId, false, `${route} does not invent PRD identity at ${viewport.name}`);
  if (viewport.width >= 1024) assert.equal(result.tableVisible, true, `${route} table remains visible at ${viewport.name}`);
  if (viewport.width <= 390) assert.equal(result.cardsVisible, true, `${route} mobile cards render at ${viewport.name}`);
}

async function verifyDrawers(cdp, viewport) {
  await verifyInquiryDrawer(cdp, viewport, "NEW12", "NEW", "Details|Request|Quotation|Artwork|History");
  await verifyInquiryDrawer(cdp, viewport, "NEW12", "CREATE QUOTATION", "Details|Request|Quotation|Artwork|History", "&action=quote");
  await verifyInquiryDrawer(cdp, viewport, "APPROVED12", "APPROVED", "Details|Request|Quotation|Artwork|History");
  await verifyOrderDrawer(cdp, viewport, "TRRY-ORD-AWAIT12", "AWAITING PAYMENT");
  await verifyOrderDrawer(cdp, viewport, "TRRY-ORD-BLOCK12", "BLOCKED");
  await verifyOrderDrawer(cdp, viewport, "TRRY-ORD-READY12", "READY TO RELEASE");
  await verifyOrderDrawer(cdp, viewport, "TRRY-ORD-POSTREL12", "QUEUED FOR PRODUCTION");
  await verifyProductionDrawer(cdp, viewport, "TRRY-ORD-QUEUED12", "QUEUED");
  await verifyProductionDrawer(cdp, viewport, "TRRY-ORD-INPROD12", "IN PRODUCTION", "Overview|Workflow|Assignment|History");
  await verifyProductionDrawer(cdp, viewport, "TRRY-ORD-QC12", "QUALITY CHECK", "Overview|Workflow|Assignment|History");
  await verifyProductionDrawer(cdp, viewport, "TRRY-ORD-FULFILL12", "READY FOR FULFILLMENT", "Overview|Workflow|Assignment|History");
  await verifyProductionDrawer(cdp, viewport, "TRRY-ORD-COMPLETE12", "COMPLETED", "Overview|Workflow|Assignment|History");
}

async function verifyInquiryDrawer(cdp, viewport, inquiry, expectedText, expectedTabs, suffix = "") {
  await navigate(cdp, `http://127.0.0.1:${port}/inquiries?inquiry=${encodeURIComponent(inquiry)}${suffix}`);
  await waitForText(cdp, expectedText);
  const result = await drawerSnapshot(cdp, ".mvp-drawer.inquiry");
  assert.equal(result.open, true, `Inquiry drawer opens at ${viewport.name}`);
  assert.equal(result.width <= Math.min(390, viewport.width), true, `Inquiry drawer width is viewport-safe at ${viewport.name}`);
  assert.equal(result.tabs, expectedTabs, `Inquiry tab order at ${viewport.name}`);
  assert.equal(/Pay Online|Pay at Shop|Confirm Payment/i.test(result.text), false, `Inquiry has no payment workflow at ${viewport.name}`);
  assert.equal(result.hasFooter, true, `Inquiry footer is reachable at ${viewport.name}`);
}

async function verifyOrderDrawer(cdp, viewport, order, expectedText) {
  await navigate(cdp, `http://127.0.0.1:${port}/orders?order=${encodeURIComponent(order)}`);
  await waitForText(cdp, expectedText);
  const result = await drawerSnapshot(cdp, ".mvp-drawer.order");
  assert.equal(result.open, true, `Order drawer opens ${order} at ${viewport.name}`);
  assert.equal(result.width <= Math.min(390, viewport.width), true, `Order drawer width is viewport-safe at ${viewport.name}`);
  assert.equal(result.tabs, "Overview|Requirements|Payment|Fulfillment|History", `Order tab order at ${viewport.name}`);
  assert.equal(result.text.includes(order), true, `Order drawer uses order reference ${order} at ${viewport.name}`);
  if (expectedText === "AWAITING PAYMENT") {
    await evaluate(cdp, `document.querySelector('.mvp-order-drawer-tabs [data-mvp-order-tab="payment"]')?.click()`);
    await waitForText(cdp, "PAYMENT ACTIONS");
    const payment = await drawerSnapshot(cdp, ".mvp-drawer.order");
    assert.equal(/Open Messenger|CONFIRM/i.test(payment.text), true, `Order owns payment/Messenger/admin confirmation at ${viewport.name}`);
  }
  assert.equal(result.hasFooter, true, `Order footer is reachable at ${viewport.name}`);
}

async function verifyProductionDrawer(cdp, viewport, order, expectedText, expectedTabs = "") {
  await navigate(cdp, `http://127.0.0.1:${port}/production?order=${encodeURIComponent(order)}`);
  await waitForText(cdp, expectedText);
  const result = await drawerSnapshot(cdp, ".mvp-drawer.production");
  assert.equal(result.open, true, `Production drawer opens ${order} at ${viewport.name}`);
  assert.equal(result.width <= Math.min(408, viewport.width), true, `Production drawer width is viewport-safe at ${viewport.name}`);
  assert.equal(result.text.includes(order), true, `Production drawer uses linked order identity ${order} at ${viewport.name}`);
  assert.equal(/Pay Online|Pay at Shop|Confirm Payment|Messenger/i.test(result.text), false, `Production drawer has no payment/Messenger action at ${viewport.name}`);
  assert.equal(/Order completed|completed and delivered|Customer picked up/i.test(result.text), false, `Production drawer does not fake order fulfillment at ${viewport.name}`);
  assert.equal(/PRD-\\d+/i.test(result.text), false, `Production drawer does not invent PRD identity at ${viewport.name}`);
  if (expectedTabs) assert.equal(result.tabs, expectedTabs, `Production tab order at ${viewport.name}`);
  if (expectedText === "COMPLETED") {
    assert.equal(result.text.includes("Production completed"), true, `Completed drawer says Production completed at ${viewport.name}`);
    assert.equal(result.tabs.includes("Fulfillment"), false, `Completed Production drawer has no Fulfillment tab at ${viewport.name}`);
    assert.equal(result.text.includes("Customer Tracking"), false, `Completed Production drawer does not expose Order-owned tracking at ${viewport.name}`);
    assert.equal(result.text.includes("VIEW ORDER"), true, `Completed Production drawer routes to Order at ${viewport.name}`);
  }
  assert.equal(result.hasFooter, true, `Production footer is reachable at ${viewport.name}`);
}

async function drawerSnapshot(cdp, selector) {
  await delay(100);
  return evaluate(cdp, `(() => {
    const drawer = document.querySelector(${JSON.stringify(selector)});
    const rect = drawer?.getBoundingClientRect();
    const footer = drawer?.querySelector(".mvp-drawer-footer");
    return {
      open: Boolean(drawer),
      width: Math.round(rect?.width || 0),
      tabs: [...(drawer?.querySelectorAll(".mvp-inquiry-tabs [data-mvp-inquiry-tab], .mvp-order-drawer-tabs [data-mvp-order-tab], .mvp-production-drawer-tabs [data-mvp-production-tab]") || [])].map((node) => node.textContent.trim()).join("|"),
      text: drawer?.innerText || "",
      hasFooter: Boolean(footer) && Math.round(footer.getBoundingClientRect().bottom) <= window.innerHeight + 1,
    };
  })()`);
}

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
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
    if (appRoutes.has(url.pathname)) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(qaHtml());
      return;
    }
    const requestedPath = url.pathname;
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
    const ACTOR = "96000000-0000-4000-8000-000000000888";
    const OWNER = "96000000-0000-4000-8000-000000000889";
    const team = [
      { userId: ACTOR, displayName: "Louvelyngel", email: "lou@trry.test", role: "staff" },
      { userId: OWNER, displayName: "Clark Lubguban", email: "clark@trry.test", role: "owner" }
    ];
    const base = { status: "won", quoteStatus: "approved", artworkStatus: "approved", artworkApprovedAt: "2026-07-30T17:54:00.000Z", paymentStatus: "paid", paymentVerifiedAmount: 1200, paymentConfirmedAmount: 1200, paymentConfirmedAt: "2026-07-30T18:12:00.000Z", fulfillmentMethod: "pickup", service: "DTF", qty: "12 pcs", sizeBreakdown: "S-2 / M-4 / L-4 / XL-2", dueDate: "2026-08-08", assignedUserId: ACTOR, assignedStaff: "Louvelyngel", contact: "+639177021242", source: "Website", quotedAmount: 1200, amountDue: 1200, productionUpdatedAt: "2026-07-30T18:12:00.000Z" };
    const inquiries = [
      { ...base, id: "NEW12", status: "new", quoteStatus: "new", customer: "New Customer", productDesc: "Premium Tshirt", quotedAmount: 0, amountDue: 0, productionStage: "queued", createdAt: "2026-08-08T09:00:00.000Z", notes: "Needs quote." },
      { ...base, id: "APPROVED12", status: "approved", quoteStatus: "approved", customer: "Approved Customer", productDesc: "Team Shirt", nativeOrderReference: "TRRY-ORD-APPROVED12", nativeOrderId: "96000000-0000-4000-8000-000000001212", orderReference: "TRRY-ORD-APPROVED12", quoteApprovedAt: "2026-08-08T10:00:00.000Z" },
      { ...base, id: "SENT12", status: "quote_sent", quoteStatus: "sent", customer: "Quote Sent", productDesc: "Cap", productionStage: "queued" }
    ];
    const orders = [
      { ...base, id: "TRY-AWAIT12", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000001201", sourceInquiryId: "TRY-AWAIT12", sourceInquiryReference: "TRY-AWAIT12", orderReference: "TRRY-ORD-AWAIT12", customer: "Awaiting Payment", productDesc: "Polo", paymentStatus: "awaiting_payment", paymentVerifiedAmount: 0, paymentConfirmedAmount: 0, productionStage: "queued" },
      { ...base, id: "TRY-BLOCK12", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000001202", sourceInquiryId: "TRY-BLOCK12", orderReference: "TRRY-ORD-BLOCK12", customer: "Blocked Order", productDesc: "Uniform", blockedReason: "Materials unavailable", productionStage: "queued" },
      { ...base, id: "TRY-READY12", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000001203", sourceInquiryId: "TRY-READY12", orderReference: "TRRY-ORD-READY12", customer: "Ready Release", productDesc: "Hoodie", productionStage: "queued" },
      { ...base, id: "TRY-POSTREL12", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000001204", sourceInquiryId: "TRY-POSTREL12", orderReference: "TRRY-ORD-POSTREL12", customer: "Post Release", productDesc: "Tote", orderStatus: "released", productionStage: "printing" },
      { ...base, id: "TRY-LEGACY12", sourceType: "legacy", orderReference: "TRRY-LEGACY-12", odooSO: "SO-12", customer: "Legacy Customer", productDesc: "Legacy Item", productionStage: "qc", qcStartedAt: "2026-08-01T14:30:00.000Z", qcStartedBy: ACTOR },
      { ...base, id: "TRY-QUEUED12", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000001205", sourceInquiryId: "TRY-QUEUED12", orderReference: "TRRY-ORD-QUEUED12", customer: "Queued Production", productDesc: "Queued Item", productionStage: "printing", productionStartedAt: "", productionStartedBy: "" },
      { ...base, id: "TRY-INPROD12", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000001206", sourceInquiryId: "TRY-INPROD12", orderReference: "TRRY-ORD-INPROD12", customer: "In Production", productDesc: "Production Item", productionStage: "printing", productionStartedAt: "2026-08-01T10:00:00.000Z", productionStartedBy: ACTOR },
      { ...base, id: "TRY-QC12", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000001207", sourceInquiryId: "TRY-QC12", orderReference: "TRRY-ORD-QC12", customer: "QC Order", productDesc: "QC Item", productionStage: "qc", productionStartedAt: "2026-08-01T10:00:00.000Z", productionStartedBy: ACTOR, qcStartedAt: "2026-08-01T14:30:00.000Z", qcStartedBy: ACTOR },
      { ...base, id: "TRY-FULFILL12", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000001208", sourceInquiryId: "TRY-FULFILL12", orderReference: "TRRY-ORD-FULFILL12", customer: "Fulfillment Ready", productDesc: "Fulfillment Item", productionStage: "ready", productionStartedAt: "2026-08-01T10:00:00.000Z", productionStartedBy: ACTOR, qcStartedAt: "2026-08-01T14:30:00.000Z", qcStartedBy: ACTOR, qcCompletedAt: "2026-08-01T15:10:00.000Z", qcCompletedBy: ACTOR, trackingSubstatus: "ready_for_pickup", trackingNote: "Bring valid ID.", deliveryAddress: "Front counter" },
      { ...base, id: "TRY-COMPLETE12", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000001209", sourceInquiryId: "TRY-COMPLETE12", orderReference: "TRRY-ORD-COMPLETE12", customer: "Complete Production", productDesc: "Complete Item", productionStage: "completed", productionStartedAt: "2026-08-01T10:00:00.000Z", productionStartedBy: ACTOR, qcStartedAt: "2026-08-01T14:30:00.000Z", qcStartedBy: ACTOR, qcCompletedAt: "2026-08-01T15:10:00.000Z", qcCompletedBy: ACTOR, productionCompletedAt: "2026-08-01T15:30:00.000Z", productionCompletedBy: OWNER, trackingSubstatus: "ready_for_pickup", trackingNote: "Bring valid ID.", deliveryAddress: "Front counter" }
    ];
    const dashboard = createMvpDashboard({ getAssignmentContext: () => ({ users: team, loadState: "success", error: "" }) });
    dashboard.state.inquiry.pageSize = 10;
    dashboard.state.order.pageSize = 10;
    dashboard.state.production.pageSize = 10;
    window.__dashboard = dashboard;
    function render() {
      const params = new URLSearchParams(location.search);
      if (params.get("action") === "quote") {
        dashboard.state.inquiryActionId = params.get("inquiry");
        dashboard.state.inquiryTab = "quotation";
      }
      if (location.pathname === "/orders") app.innerHTML = dashboard.renderOrders({ items: orders, renderPayment: renderPaymentForm });
      else if (location.pathname === "/production") app.innerHTML = dashboard.renderProduction({ items: orders });
      else app.innerHTML = dashboard.renderInquiries({ items: inquiries });
      document.body.classList.toggle("mvp-drawer-open", Boolean(document.querySelector(".mvp-drawer")));
      dashboard.bind({ root: app, rerender: render, navigate: (route) => { window.__route = route; }, copy: async () => {}, createOrder: async () => {}, saveProduction: async () => {}, confirmPayment: async () => {} });
    }
    function renderPaymentForm(item) {
      return '<section class="mvp-drawer-section"><h3>PAYMENT ACTIONS</h3><button type="button" data-mvp-open-messenger>Open Messenger</button><button type="button" data-mvp-confirm-payment="' + item.id + '">Confirm Payment</button></section>';
    }
    render();
  </script></body></html>`;
}

async function setViewport(cdp, viewport) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width <= 768 });
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
  await waitFor(cdp, `document.body && document.body.innerText.includes(${JSON.stringify(text)})`);
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
