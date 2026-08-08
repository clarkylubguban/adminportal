import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const root = process.cwd();
const port = Number(process.env.ORDER_READINESS_INTERACTION_PORT || 58249);
const remotePort = port + 100;
const edgePath = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const server = createServer(handleRequest);
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const browser = spawn(edgePath, [
  "--headless=new",
  `--remote-debugging-port=${remotePort}`,
  `--user-data-dir=${join(tmpdir(), `trry-order-readiness-interactions-${Date.now()}`)}`,
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
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });

  await navigate(cdp, `http://127.0.0.1:${port}/qa-order-readiness-interactions.html`);
  await waitForText(cdp, "PRODUCTION REQUIREMENTS");

  let state = await readState(cdp);
  assert.equal(state.activeTab, "requirements", "Requirements tab starts active");
  assert.equal(state.hasRelease, false, "TEST 11 no automatic Release to Production");
  assert.equal(state.paymentStatus, "paid", "TEST 12 payment remains confirmed");
  assert.equal(state.hasInquiryDrawer, false, "TEST 13 Inquiry workflow is not restored");
  assert.equal(state.hasDueDateAction, false, "TEST 1 SET DUE DATE is not reachable in Orders");
  assert.equal(state.hasArtworkAction, false, "TEST 2 REVIEW ARTWORK is not reachable in Orders");
  assert.equal(state.dueReady, true, "TEST 3 inherited agreed due date is READY");
  assert.equal(state.artworkReady, true, "TEST 4 inherited artwork approval is READY");

  await click(cdp, '[data-mvp-readiness-action="staff"]');
  state = await readState(cdp);
  assert.equal(state.editorTitle, "ASSIGN STAFF", "TEST 6 ASSIGN STAFF opens selector");
  assert.ok(state.staffOptions.includes("Rachelle - Staff"), "TEST 7 active eligible staff are available");
  assert.ok(state.staffOptions.includes("Juvy - Staff"), "TEST 7 multiple active staff options are available");
  assert.equal(state.staffOptions.filter((value) => value.includes("Inactive user")).length, 1, "TEST 8 historical user appears only as context");
  assert.ok(state.staffOptions.length > 2, "TEST 8 inactive historical user is not the only usable assignment choice");

  await selectValue(cdp, '[data-mvp-readiness-field="assignedUserId"]', "96000000-0000-4000-8000-000000000902");
  await click(cdp, '[data-mvp-readiness-save-mode="staff"]');
  await waitFor(cdp, `window.__rows[0].assignedUserId === "96000000-0000-4000-8000-000000000902"`);
  state = await readState(cdp);
  assert.equal(state.staffReady, true, "TEST 9 saved assignment makes requirement READY");
  assert.equal(state.activeTab, "requirements", "TEST 10 Requirements stays active after assignment save");
  assert.deepEqual(state.saveCalls.at(-1), { id: "TRY-READINESS-UI", changes: { assignedUserId: "96000000-0000-4000-8000-000000000902" } }, "TEST 9 assignment persists through saveProduction");
  assert.equal(state.hasRelease, true, "All requirements ready exposes explicit Release to Production");
  assert.equal(state.releaseCalls, 0, "TEST 11 release still has not fired automatically");
  assert.equal(state.paymentStatus, "paid", "TEST 12 payment state remains unchanged");
  assert.equal(state.hasInquiryDrawer, false, "TEST 13 no Inquiry drawer/workflow appears");

  console.log("PASS Order readiness action interaction browser flow");
} finally {
  browser.kill();
  await new Promise((resolve) => server.close(resolve));
}

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (url.pathname === "/qa-order-readiness-interactions.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(qaHtml());
      return;
    }
    if (url.pathname === "/src/env.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end('window.TRRY_ADMIN_ENV = {"VITE_USE_SUPABASE_DATA":"false"};\n');
      return;
    }
    const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
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
      { userId: "96000000-0000-4000-8000-000000000901", displayName: "Rachelle", email: "rachelle@trry.test", role: "staff" },
      { userId: "96000000-0000-4000-8000-000000000902", displayName: "Juvy", email: "juvy@trry.test", role: "staff" }
    ];
    window.__rows = [{
      id: "TRY-READINESS-UI",
      status: "approved",
      quoteStatus: "approved",
      sourceType: "native",
      sourceInquiryId: "TRY-READINESS-UI",
      sourceInquiryReference: "TRY-READINESS-UI",
      nativeOrderId: "96000000-0000-4000-8000-000000000900",
      orderReference: "TRRY-ORD-READINESS-UI",
      customer: "Readiness Browser",
      contact: "0917-000-0900",
      source: "Website",
      productDesc: "Premium Shirt",
      service: "DTF",
      qty: "12 pcs",
      fulfillmentMethod: "pickup",
      dueDate: "2026-08-22",
      artworkStatus: "approved",
      artworkUrl: "TRY-READINESS-UI/proofs/artwork.png",
      assignedUserId: "96000000-0000-4000-8000-000000000999",
      assignedStaff: "Former Staff",
      quotedAmount: 1200,
      amountDue: 1200,
      paymentStatus: "paid",
      paymentVerifiedAmount: 1200,
      paymentConfirmedAmount: 1200,
      paymentConfirmedAt: "2026-08-08T09:00:00.000Z",
      productionStage: "queued"
    }];
    window.__saveCalls = [];
    window.__releaseCalls = 0;
    const dashboard = createMvpDashboard({ getAssignmentContext: () => ({ users: team, loadState: "ready", error: "" }) });
    dashboard.state.orderId = "TRRY-ORD-READINESS-UI";
    dashboard.state.orderTab = "requirements";
    window.__dashboard = dashboard;
    function render() {
      app.innerHTML = dashboard.renderOrders({ items: window.__rows });
      document.body.classList.toggle("mvp-drawer-open", Boolean(document.querySelector(".mvp-drawer")));
      dashboard.bind({
        root: app,
        rerender: render,
        navigate: () => {},
        copy: async () => {},
        createOrder: async () => {},
        confirmPayment: async () => {},
        saveProduction: async (id, changes) => {
          window.__saveCalls.push({ id, changes: { ...changes } });
          await new Promise((resolve) => setTimeout(resolve, 30));
          window.__rows = window.__rows.map((item) => {
            if (item.id !== id) return item;
            if (Object.prototype.hasOwnProperty.call(changes, "productionStage")) {
              window.__releaseCalls += 1;
              return { ...item, productionStage: changes.productionStage };
            }
            if (Object.prototype.hasOwnProperty.call(changes, "assignedUserId")) return { ...item, assignedUserId: changes.assignedUserId, assignedStaff: "Juvy - staff" };
            return item;
          });
          return { ok: true };
        }
      });
    }
    render();
  </script></body></html>`;
}

async function readState(cdp) {
  return evaluate(cdp, `(() => {
    const text = document.body.innerText;
    const active = document.querySelector('.mvp-order-drawer-tabs [aria-selected="true"]')?.textContent.trim().toLowerCase() || "";
    const editor = document.querySelector('[data-mvp-readiness-editor]');
    const staffSelect = document.querySelector('[data-mvp-readiness-field="assignedUserId"]');
    const rowTexts = [...document.querySelectorAll('.mvp-order-requirements > div')].map((node) => node.innerText);
    return {
      activeTab: active,
      editorTitle: editor?.querySelector('h4')?.textContent.trim() || "",
      orderStillOpen: Boolean(document.querySelector('.mvp-drawer.order')),
      dueReady: rowTexts.some((row) => row.includes('Agreed due date inherited') && row.includes('Ready / dueDate')),
      artworkReady: rowTexts.some((row) => row.includes('Artwork approval inherited') && row.includes('Ready / artworkStatus')),
      staffReady: rowTexts.some((row) => row.includes('Assigned production staff') && row.includes('Ready / assignedUserId/assignedStaff')),
      hasDueDateAction: Boolean(document.querySelector('[data-mvp-readiness-action="due_date"]')),
      hasArtworkAction: Boolean(document.querySelector('[data-mvp-readiness-action="artwork"]')),
      staffOptions: staffSelect ? [...staffSelect.options].map((option) => option.textContent.trim()) : [],
      hasRelease: text.includes('RELEASE TO PRODUCTION'),
      paymentText: text.match(/Payment requirement[\\s\\S]{0,120}/)?.[0] || "",
      paymentStatus: window.__rows[0].paymentStatus,
      hasInquiryDrawer: Boolean(document.querySelector('.mvp-drawer.inquiry')),
      saveCalls: window.__saveCalls,
      releaseCalls: window.__releaseCalls
    };
  })()`);
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

async function click(cdp, selector) {
  await evaluate(cdp, `(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) throw new Error(${JSON.stringify(`Missing selector: ${selector}`)});
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return true;
  })()`);
  await delay(120);
}

async function setValue(cdp, selector, value) {
  await evaluate(cdp, `(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) throw new Error(${JSON.stringify(`Missing selector: ${selector}`)});
    node.value = ${JSON.stringify(value)};
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

async function selectValue(cdp, selector, value) {
  await setValue(cdp, selector, value);
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Evaluation failed");
  return result.result?.value;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
