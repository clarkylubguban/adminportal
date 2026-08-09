import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const root = process.cwd();
const port = Number(process.env.ORDER_READY_RELEASE_BROWSER_PORT || 58246);
const remotePort = port + 100;
const edgePath = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const server = createServer(handleRequest);
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const browser = spawn(edgePath, [
  "--headless=new",
  `--remote-debugging-port=${remotePort}`,
  `--user-data-dir=${join(tmpdir(), `trry-order-ready-release-edge-${Date.now()}`)}`,
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
    await navigate(cdp, `http://127.0.0.1:${port}/qa-ready-release.html`);
    await waitForText(cdp, "READY TO RELEASE");
    const result = await evaluate(cdp, `(() => {
      const drawer = document.querySelector(".mvp-order-drawer");
      const rect = drawer.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        right: Math.round(rect.right),
        releaseVisible: Boolean(document.querySelector("[data-mvp-release-order]")),
        confirmVisible: document.body.innerText.includes("CONFIRM PAYMENT"),
        productionHasReadyBeforeRelease: window.__productionBefore.includes("TRRY-ORD-READY77"),
      };
    })()`);
    assert.equal(result.width, viewport.width <= 390 ? 390 : 390, `drawer keeps normalized 390px width at ${viewport.width}`);
    assert.equal(result.releaseVisible, true, `release button visible at ${viewport.width}`);
    assert.equal(result.confirmVisible, false, `confirmed payment does not show Confirm Payment at ${viewport.width}`);
    assert.equal(result.productionHasReadyBeforeRelease, false, `ready order is not pre-visible in Production at ${viewport.width}`);
  }

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate(cdp, `http://127.0.0.1:${port}/qa-ready-release.html`);
  await waitForText(cdp, "READY TO RELEASE");
  await evaluate(cdp, `(() => {
    const button = document.querySelector("[data-mvp-release-order]");
    button.click();
    button.click();
  })()`);
  await waitForText(cdp, "QUEUED FOR PRODUCTION");
  const afterRelease = await evaluate(cdp, `(() => ({
    calls: window.__releaseCalls,
    productionStage: window.__rows[0].productionStage,
    orderText: document.querySelector(".mvp-order-drawer")?.innerText || "",
    productionText: window.__dashboard.renderProduction({ items: window.__rows }),
  }))()`);
  assert.equal(afterRelease.calls, 1, "double click sends only one release request while in flight");
  assert.equal(afterRelease.productionStage, "queued", "successful release preserves queued stage in local read model");
  assert.ok(!afterRelease.orderText.includes("READY TO RELEASE"), "released drawer no longer displays READY TO RELEASE");
  assert.ok(afterRelease.orderText.includes("QUEUED FOR PRODUCTION"), "released drawer displays post-release Orders status");
  assert.ok(afterRelease.productionText.includes("TRRY-ORD-READY77"), "Production resolves the released job after persisted readback");

  await navigate(cdp, `http://127.0.0.1:${port}/qa-ready-release.html?fail=1`);
  await waitForText(cdp, "READY TO RELEASE");
  await evaluate(cdp, `document.querySelector("[data-mvp-release-order]").click()`);
  await waitForText(cdp, "Synthetic release failure");
  const afterFailure = await evaluate(cdp, `(() => ({
    productionStage: window.__rows[0].productionStage,
    orderText: document.querySelector(".mvp-order-drawer")?.innerText || "",
  }))()`);
  assert.equal(afterFailure.productionStage, "queued", "failed release leaves durable state unchanged");
  assert.ok(afterFailure.orderText.includes("READY TO RELEASE"), "failed release remains READY");
  assert.ok(afterFailure.orderText.includes("Synthetic release failure"), "failed release shows truthful error");

  console.log("PASS Ready release browser action, persistence readback, duplicate protection, failure state, and responsive drawer checks");
} finally {
  browser.kill();
  await new Promise((resolve) => server.close(resolve));
}

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (url.pathname === "/qa-ready-release.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(qaHtml(url.searchParams.get("fail") === "1"));
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

function qaHtml(shouldFail) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /><link rel="stylesheet" href="/src/styles.css" /></head><body><main id="app"></main><script type="module">
    import { createMvpDashboard } from "/src/mvpDashboard.js";
    const app = document.getElementById("app");
    const team = [{ userId: "owner-james", displayName: "James", email: "james@trry.test", role: "owner" }];
    window.__rows = [{
      id: "TRY-READY-077",
      status: "won",
      quoteStatus: "approved",
      sourceType: "native",
      sourceInquiryId: "TRY-READY-077",
      sourceInquiryReference: "TRY-READY-077",
      nativeOrderId: "96000000-0000-4000-8000-000000000777",
      orderReference: "TRRY-ORD-READY77",
      customer: "Browser Ready",
      contact: "0917-000-0077",
      source: "Website",
      productDesc: "Premium Tshirt",
      service: "Embroidery",
      qty: "12 pcs",
      dueDate: "2026-08-09",
      fulfillmentMethod: "pickup",
      artworkStatus: "approved",
      assignedUserId: "owner-james",
      quotedAmount: 850,
      amountDue: 850,
      paymentStatus: "paid",
      paymentVerifiedAmount: 850,
      paymentConfirmedAmount: 850,
      productionStage: "queued",
      quoteApprovedAt: "2026-07-31T02:46:00.000Z"
    }];
    window.__releaseCalls = 0;
    const dashboard = createMvpDashboard({ getAssignmentContext: () => ({ users: team, loadState: "success", error: "" }) });
    dashboard.state.orderId = "TRY-READY-077";
    dashboard.state.orderTab = "payment";
    window.__dashboard = dashboard;
    function render() {
      const productionBefore = dashboard.renderProduction({ items: window.__rows });
      app.innerHTML = '<h1>ORDER READY QA</h1><section data-before>PRODUCTION BEFORE</section>' + dashboard.renderOrders({ items: window.__rows });
      document.body.classList.toggle("mvp-drawer-open", Boolean(document.querySelector(".mvp-drawer")));
      dashboard.bind({
        root: app,
        rerender: render,
        navigate: () => {},
        copy: async () => {},
        confirmPayment: async () => {},
        saveProduction: async (id, changes) => {
          window.__releaseCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 80));
          if (${JSON.stringify(shouldFail)}) throw new Error("Synthetic release failure");
          if (!changes.releaseProduction) throw new Error("Release must not send a production stage");
          window.__rows = window.__rows.map((item) => item.id === id ? { ...item, orderStatus: "released", productionStage: "queued", productionUpdatedAt: "2026-08-01T05:00:00.000Z" } : item);
          return { orderStatus: "released", productionStage: "queued" };
        }
      });
      window.__productionBefore = productionBefore;
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
