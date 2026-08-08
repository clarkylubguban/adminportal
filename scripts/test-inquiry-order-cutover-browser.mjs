import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const root = process.cwd();
const port = Number(process.env.INQUIRY_CUTOVER_BROWSER_PORT || 58230);
const remotePort = port + 100;
const edgePath = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const server = createServer(handleRequest);
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const browser = spawn(edgePath, [
  "--headless=new",
  `--remote-debugging-port=${remotePort}`,
  `--user-data-dir=${join(tmpdir(), `trry-cutover-edge-${Date.now()}`)}`,
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
    await navigate(cdp, `http://127.0.0.1:${port}/qa-cutover.html`);
    await waitForText(cdp, "Create Order");
    await delay(450);
    const result = await evaluate(cdp, `(() => {
      const text = document.body.innerText;
      const drawer = document.querySelector(".mvp-drawer");
      const action = document.querySelector("[data-mvp-create-order]");
      const rect = drawer.getBoundingClientRect();
      return {
        hasCreate: Boolean(action),
        hasPaymentText: /PAYMENT REQUIRED|Amount Due|Payment Option|Payment Method|Payment Status/.test(text),
        hasOdooCreate: /CONFIRM & CREATE ORDER|Add Odoo SO/.test(text),
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 2,
        drawerFits: rect.left >= -1 && rect.right <= window.innerWidth + 1,
        rect: { left: rect.left, right: rect.right, width: rect.width, innerWidth: window.innerWidth, scrollWidth: document.documentElement.scrollWidth },
        routeBefore: location.pathname,
      };
    })()`);
    assert.equal(result.hasCreate, true, `Create Order visible at ${viewport.width}`);
    assert.equal(result.hasPaymentText, false, `Inquiry payment text absent at ${viewport.width}`);
    assert.equal(result.hasOdooCreate, false, `Odoo create controls absent at ${viewport.width}`);
    assert.equal(result.overflowX, false, `No horizontal overflow at ${viewport.width}`);
    assert.equal(result.drawerFits, true, `Drawer fits viewport at ${viewport.width}: ${JSON.stringify(result.rect)}`);
  }

  await evaluate(cdp, `document.querySelector("[data-mvp-create-order]").click()`);
  await waitForText(cdp, "created:TRY-CUTOVER-001");

  for (const route of ["/inquiries", "/orders", "/production"]) {
    await navigate(cdp, `http://127.0.0.1:${port}${route}`);
    const routeCheck = await evaluate(cdp, `({ path: location.pathname, hasApp: Boolean(document.querySelector("#root")) })`);
    assert.equal(routeCheck.path, route);
    assert.equal(routeCheck.hasApp, true);
  }

  await navigate(cdp, `http://127.0.0.1:${port}/order-dashboard?order=TRRY-1234`);
  await waitFor(cdp, `location.pathname === "/orders" && location.search === "?order=TRRY-1234"`);
  const normalized = await evaluate(cdp, `location.pathname + location.search`);
  assert.equal(normalized, "/orders?order=TRRY-1234");

  console.log("PASS Inquiry cutover browser routes and responsive approved drawer checks");
} finally {
  browser.kill();
  await new Promise((resolve) => server.close(resolve));
}

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (url.pathname === "/qa-cutover.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(qaHtml());
      return;
    }
    if (url.pathname === "/src/env.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end('window.TRRY_ADMIN_ENV = {"VITE_USE_SUPABASE_DATA":"false"};\n');
      return;
    }
    const appRoutes = new Set(["/", "/inquiries", "/orders", "/production", "/order-dashboard"]);
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
    const dashboard = createMvpDashboard({ navigate: (route) => { window.__route = route; }, getAssignmentContext: () => ({ users: [], loadState: "success", error: "" }) });
    const inquiry = { id: "TRY-CUTOVER-001", customer: "Cutover Customer", contact: "0917-123-4567", source: "Website", service: "DTF Print", productDesc: "Logo shirt", qty: "10 pcs", status: "sent", quoteStatus: "approved", quotedAmount: 850, amountDue: 850, quoteBreakdown: "Logo shirt | 10 pcs | PHP 850", quoteNotes: "Approved customer quote.", quoteValidUntil: "2026-08-31", quoteApprovedAt: "2026-08-08T02:00:00.000Z", artworkStatus: "approved" };
    dashboard.state.inquiryId = inquiry.id;
    function render() {
      app.innerHTML = dashboard.renderInquiries({ items: [inquiry] });
      document.body.classList.toggle("mvp-drawer-open", Boolean(document.querySelector(".mvp-drawer")));
      dashboard.bind({ root: app, rerender: render, navigate: (route) => { window.__route = route; }, copy: async () => {}, createOrder: async (id) => { window.__created = id; const p = document.createElement("p"); p.textContent = "created:" + id; document.body.appendChild(p); } });
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
  const expected = JSON.stringify(text);
  await waitFor(cdp, `document.body && document.body.innerText.includes(${expected})`);
}

async function waitFor(cdp, expression) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await evaluate(cdp, expression)) return;
    await delay(125);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
  return result.result?.value;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
