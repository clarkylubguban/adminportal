import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderOnlinePaymentReview } from "../src/paymentReviewView.js";

const main = await readFile("src/main.js", "utf8");
const styles = await readFile("src/styles.css", "utf8");
const vercel = await readFile("vercel.json", "utf8");
const build = await readFile("scripts/build.mjs", "utf8");

assert.match(main, /renderOnlinePaymentReview/);
assert.match(main, /getPaymentReview/);
assert.match(main, /openPaymentProof/);
assert.match(main, /updatePaymentReview/);
assert.match(main, /createPaymentReviewIdempotencyKey/);
assert.match(main, /renderPayment: renderOpsPaymentStage/g);
assert.match(main, /PAYMENT_STALE/);
assert.match(vercel, /payment-review/);
assert.match(vercel, /payment-proof/);
assert.match(build, /VITE_ENABLE_ADMIN_ONLINE_PAYMENT_REVIEW[\s\S]+?"false"/);

const payment = {
  inquiryId: "QA-ONLINE-PAY-9A",
  customer: "QA ONLINE PAYMENT REVIEW PHASE 9A",
  paymentStatus: "proof_submitted",
  paymentMethod: "gcash",
  paymentType: "full",
  submittedAmount: 1500,
  quotedAmount: 1500,
  amountDue: 1500,
  customerReference: "QA-REF",
  customerNote: "Synthetic QA only",
  submittedAt: "2026-07-30T01:00:00.000Z",
  receipt: {
    available: true,
    filename: "qa-receipt.pdf",
    contentType: "application/pdf",
    sizeBytes: 2048,
  },
  reviewNote: "",
  verifiedAmount: null,
  verifiedBy: "",
  verifiedAt: null,
  internalNote: "",
  version: "2026-07-30T01:00:00.000Z",
  history: [{
    eventType: "ONLINE_PAYMENT_REVIEW_STARTED",
    label: "ONLINE PAYMENT REVIEW STARTED",
    actorDisplayName: "QA Admin",
    actorRole: "admin",
    paymentMethod: "gcash",
    amount: 1500,
    createdAt: "2026-07-30T01:01:00.000Z",
  }],
  permissions: {
    canRead: true,
    canStartReview: true,
    canConfirm: true,
    canRequestCorrection: true,
  },
};

const managerHtml = renderOnlinePaymentReview(
  { id: payment.inquiryId },
  { status: "ready", payment },
);
assert.match(managerHtml, /VIEW RECEIPT/);
assert.match(managerHtml, /CONFIRM PAYMENT/);
assert.match(managerHtml, /REQUEST CORRECTION/);
assert.match(managerHtml, /ONLINE PAYMENT REVIEW STARTED/);
assert.doesNotMatch(managerHtml, /payment_proof_path|payments\/|11111111-/);

const staffHtml = renderOnlinePaymentReview(
  { id: payment.inquiryId },
  {
    status: "ready",
    payment: {
      ...payment,
      permissions: {
        canRead: true,
        canStartReview: false,
        canConfirm: false,
        canRequestCorrection: false,
      },
    },
  },
);
assert.match(staffHtml, /READ ONLY/);
assert.doesNotMatch(staffHtml, /data-payment-review-action/);

const correctionHtml = renderOnlinePaymentReview(
  { id: payment.inquiryId },
  {
    status: "ready",
    payment,
    dialog: "correction",
    dialogError: "Synthetic validation error",
    draft: { reviewNote: "Please upload a clearer receipt", internalNote: "QA only" },
  },
);
assert.match(correctionHtml, /Please upload a clearer receipt/);
assert.match(correctionHtml, /Synthetic validation error/);
assert.doesNotMatch(correctionHtml, /alert\(|confirm\(|prompt\(/);

const port = 58391;
const remotePort = 58491;
let currentHtml = managerHtml;
const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style></head><body><main style="max-width:760px;margin:0 auto">${currentHtml}</main><script>window.__qaErrors=[];addEventListener("error",(event)=>window.__qaErrors.push(event.message));</script></body></html>`);
});
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const edgePath = process.env.EDGE_PATH
  || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browser = spawn(edgePath, [
  "--headless=new",
  `--remote-debugging-port=${remotePort}`,
  `--user-data-dir=${join(tmpdir(), `trry-payment-review-${Date.now()}`)}`,
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "about:blank",
], { stdio: "ignore" });

try {
  const cdp = await createCdp(await waitForCdp(remotePort));
  const page = await createPage(cdp, 1366, 900);

  for (const [width, height, html] of [
    [1366, 900, managerHtml],
    [1024, 900, managerHtml],
    [820, 1000, correctionHtml],
    [390, 844, correctionHtml],
  ]) {
    currentHtml = html;
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      mobile: width === 390,
      screenWidth: width,
      screenHeight: height,
      deviceScaleFactor: width === 390 ? 2 : 1,
    }, page.sessionId);
    await cdp.send("Page.navigate", {
      url: `http://127.0.0.1:${port}/?viewport=${width}&t=${Date.now()}`,
    }, page.sessionId);
    await waitFor(cdp, page, `document.querySelector('.payment-review-section') !== null && Array.isArray(window.__qaErrors)`);
    const overflow = await evalValue(cdp, page, "document.documentElement.scrollWidth - document.documentElement.clientWidth");
    assert.ok(overflow <= 1, `${width}px payment review must not overflow horizontally`);
    assert.equal(await evalValue(cdp, page, `(() => { const button=document.querySelector("button"); button?.focus(); return document.activeElement===button; })()`), true);
    if (html.includes("payment-review-dialog")) {
      assert.equal(await evalValue(cdp, page, `(() => { const field=document.querySelector("[data-payment-review-field]"); field?.focus(); return document.activeElement===field; })()`), true);
      await pressTab(cdp, page);
      assert.equal(await evalValue(cdp, page, `document.querySelector(".payment-review-dialog").getBoundingClientRect().width <= innerWidth`), true);
    }
    assert.deepEqual(await evalValue(cdp, page, "window.__qaErrors"), []);
  }
  cdp.close();
} finally {
  browser.kill("SIGTERM");
  await new Promise((resolve) => server.close(resolve));
}

console.log("PASS Phase 9A shared Inquiry/Order payment review component, Staff read-only state, and 1366/1024/820/390 responsive QA");

async function waitForCdp(debugPort) {
  for (let index = 0; index < 100; index += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch {}
    await wait(100);
  }
  throw new Error("Edge CDP did not become ready.");
}

async function createCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const handlers = pending.get(message.id);
    pending.delete(message.id);
    message.error ? handlers.reject(new Error(message.error.message)) : handlers.resolve(message.result || {});
  };
  return {
    send(method, params = {}, sessionId = undefined) {
      const message = { id: ++id, method, params };
      if (sessionId) message.sessionId = sessionId;
      socket.send(JSON.stringify(message));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() {
      socket.close();
    },
  };
}

async function createPage(cdp, width, height) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    mobile: false,
    screenWidth: width,
    screenHeight: height,
    deviceScaleFactor: 1,
  }, sessionId);
  return { targetId, sessionId };
}

async function waitFor(cdp, page, expression, timeout = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evalValue(cdp, page, expression)) return;
    await wait(80);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function evalValue(cdp, page, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, page.sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Browser evaluation failed.");
  return result.result?.value;
}

async function pressTab(cdp, page) {
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9,
  }, page.sessionId);
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9,
  }, page.sessionId);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
