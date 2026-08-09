import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const root = process.cwd();
const port = Number(process.env.INQUIRY_DRAWER_CLEANUP_PORT || 58234);
const remotePort = port + 100;
const edgePath = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const viewports = [
  { name: "1600", width: 1600, height: 1000 },
  { name: "1024", width: 1024, height: 900 },
  { name: "390", width: 390, height: 844 },
];

const server = createServer(handleRequest);
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const browser = spawn(edgePath, [
  "--headless=new",
  `--remote-debugging-port=${remotePort}`,
  `--user-data-dir=${join(tmpdir(), `trry-inquiry-cleanup-edge-${Date.now()}`)}`,
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
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width < 600 });
    await verifyNoQuoteYet(cdp, viewport);
    await verifyCreateQuotation(cdp, viewport);
    await verifyQuoteSent(cdp, viewport);
    await verifyApproved(cdp, viewport);
    await verifyArtworkPending(cdp, viewport);
    await verifyConverted(cdp, viewport);
  }

  console.log("PASS Inquiry drawer cleanup browser states, legacy removal, quotation single-source UI, footer, and responsive checks");
} finally {
  browser.kill();
  await new Promise((resolve) => server.close(resolve));
}

async function verifyNoQuoteYet(cdp, viewport) {
  await openInquiry(cdp, "NEW-NOQUOTE");
  const result = await drawerState(cdp);
  assertBaseClean(result, viewport, "NEW No Quote Yet");
  assert.equal(result.tabs, "Details|Request|Quotation|Artwork|History", "approved five Inquiry tabs");
  assert.match(result.text, /create quotation/i, `NEW footer shows Create Quotation at ${viewport.name}`);
  assert.equal(result.detailRowsOk, true, `NEW Details rows keep label/value separation at ${viewport.name}`);
  await clickTab(cdp, "request");
  const requestResult = await drawerState(cdp);
  assertBaseClean(requestResult, viewport, "NEW No Quote Yet request tab");
  assert.equal(requestResult.activeDetailRowsOk, true, `NEW Request rows keep label/value separation at ${viewport.name}`);
  assert.equal(requestResult.activePanelText.includes("Reference Files"), true, `NEW Request includes Reference Files at ${viewport.name}`);
  await clickTab(cdp, "quotation");
  const quoteResult = await drawerState(cdp);
  assertBaseClean(quoteResult, viewport, "NEW No Quote Yet quotation tab");
  assert.equal(quoteResult.text.includes("No quotation yet"), true, `NEW empty quotation state renders at ${viewport.name}`);
}

async function verifyCreateQuotation(cdp, viewport) {
  await openInquiry(cdp, "NEW-NOQUOTE", "&action=quote");
  const result = await drawerState(cdp);
  assertBaseClean(result, viewport, "NEW Create Quotation");
  assert.match(result.text, /create quotation/i, `quotation form title renders at ${viewport.name}`);
  for (const label of ["Quoted Amount", "Valid Until", "Quote Breakdown", "Quote Note", "Save Draft", "Publish Quote"]) {
    assert.equal(result.formLabels.includes(label), true, `quotation form includes ${label} at ${viewport.name}`);
  }
  assert.equal(result.quotationPanels, 0, `create quotation state has no duplicate summary quotation panel at ${viewport.name}`);
}

async function verifyQuoteSent(cdp, viewport) {
  await openInquiry(cdp, "QUOTE-SENT");
  await clickTab(cdp, "quotation");
  const result = await drawerState(cdp);
  assertBaseClean(result, viewport, "Quote Sent");
  assert.equal(countText(result.text, "QT-QUOTE-SENT"), 1, `Quote Sent has one quotation reference at ${viewport.name}`);
  assert.equal(result.text.includes("Awaiting customer response"), true, `Quote Sent shows awaiting customer response at ${viewport.name}`);
  assert.equal(result.text.includes("Not yet available until approval"), true, `Quote Sent blocks conversion until approval at ${viewport.name}`);
  assert.match(result.footerText, /waiting for approval/i, `Quote Sent has one waiting footer at ${viewport.name}`);
  assert.equal(countRegex(result.text, /waiting for approval/gi), 1, `Quote Sent has only one waiting footer/action at ${viewport.name}`);
}

async function verifyApproved(cdp, viewport) {
  await openInquiry(cdp, "APPROVED-CREATE");
  await clickTab(cdp, "quotation");
  const result = await drawerState(cdp);
  assertBaseClean(result, viewport, "Approved");
  assert.equal(result.text.includes("Approved"), true, `Approved quote summary renders at ${viewport.name}`);
  assert.match(result.text, /create order/i, `Approved footer shows Create Order at ${viewport.name}`);
  assert.equal(/Pay Online|Pay at Shop|Confirm Payment|PAYMENT REQUIRED|Payment Option|Payment Method|Payment Status/i.test(result.text), false, `Approved Inquiry has no payment UI at ${viewport.name}`);
}

async function verifyArtworkPending(cdp, viewport) {
  await openInquiry(cdp, "ARTWORK-PENDING");
  await clickTab(cdp, "quotation");
  let result = await drawerState(cdp);
  assertBaseClean(result, viewport, "Artwork Pending");
  assert.match(result.footerText, /complete artwork/i, `Artwork Pending footer shows the sole primary workflow action at ${viewport.name}`);
  assert.equal(result.footerAction, "approve_artwork", `Complete Artwork uses approve_artwork at ${viewport.name}`);
  assert.equal(result.primaryWorkflowActions, 1, `Artwork Pending has one visible primary workflow CTA at ${viewport.name}`);
  assert.equal(result.bodyPrimaryWorkflowActions, 0, `Artwork Pending has no body primary workflow CTA at ${viewport.name}`);
  assert.equal(result.text.includes("Open Artwork"), false, `Artwork Pending suppresses duplicate Open Artwork helper at ${viewport.name}`);
  assert.equal(result.text.includes("Approve artwork before Order"), false, `Artwork Pending suppresses duplicate artwork helper copy at ${viewport.name}`);
  assert.equal(result.preorderRows, 5, `Artwork Pending keeps five pre-order requirements at ${viewport.name}`);
  assert.equal(result.preorderRowsStructured, true, `Artwork Pending pre-order rows visually separate status, title, and helper at ${viewport.name}`);

  await clickTab(cdp, "request");
  result = await drawerState(cdp);
  assert.equal(result.activePanelText.includes("Reference Files"), true, `Request tab keeps Reference Files at ${viewport.name}`);
  assert.equal(result.activePanelText.includes("Artwork file saved"), true, `Request tab keeps passive artwork file status at ${viewport.name}`);
  assert.equal(/Open Artwork|Approve Artwork|Complete Artwork/i.test(result.activePanelText), false, `Request tab remains passive at ${viewport.name}`);

  await clickTab(cdp, "artwork");
  result = await drawerState(cdp);
  assert.equal(result.activePanelText.includes("VIEW ARTWORK"), true, `Artwork tab keeps utility VIEW ARTWORK at ${viewport.name}`);
  assert.equal(result.activePanelText.includes("Approval status"), true, `Artwork tab keeps approval status at ${viewport.name}`);
  assert.equal(result.activePanelText.includes("Pending internal review"), true, `Artwork tab shows pending internal review at ${viewport.name}`);

  await openInquiry(cdp, "ARTWORK-PENDING", "&action=primary");
  result = await drawerState(cdp);
  assert.equal(result.text.includes("Open Artwork"), false, `Clicking Complete Artwork does not open duplicate helper at ${viewport.name}`);
  assert.equal(result.bodyPrimaryWorkflowActions, 0, `Clicked artwork footer still has no body primary workflow CTA at ${viewport.name}`);
}

async function verifyConverted(cdp, viewport) {
  await openInquiry(cdp, "CONVERTED-READONLY");
  await clickTab(cdp, "quotation");
  const result = await drawerState(cdp);
  assertBaseClean(result, viewport, "Converted");
  assert.match(result.text, /view order/i, `converted Inquiry footer shows View Order at ${viewport.name}`);
  assert.equal(result.text.includes("Native Order TRRY-ORD-CONVERTED"), true, `converted Inquiry shows native Order reference at ${viewport.name}`);
  assert.equal(/Save Draft|Publish Quote|CREATE ORDER|Confirm Payment/i.test(result.text), false, `converted Inquiry has no mutation/payment controls at ${viewport.name}`);
}

function assertBaseClean(result, viewport, label) {
  assert.equal(result.open, true, `${label} drawer opens at ${viewport.name}`);
  assert.equal(result.width <= Math.min(390, viewport.width), true, `${label} drawer width safe at ${viewport.name}`);
  assert.equal(result.hasFooter, true, `${label} footer reachable at ${viewport.name}`);
  assert.equal(result.hasHorizontalOverflow, false, `${label} no horizontal overflow at ${viewport.name}`);
  assert.equal(result.footerOverlap, false, `${label} footer does not cover tab content at ${viewport.name}`);
  for (const legacy of [
    "More Details",
    "More Actions",
    "NEXT FOLLOW-UP",
    "SAVE OWNER & DATE",
    "Allowed quotation actions",
    "QUOTATION READY FOR CUSTOMER",
    "REVISE QUOTE",
    "Conversation",
    "Customer Link",
    "Copy Customer Message",
    "Mark message as sent",
    "Internal Status",
    "Production Notes",
    "Internal Communication",
  ]) {
    assert.equal(result.text.includes(legacy), false, `${label} removes legacy ${legacy} at ${viewport.name}`);
  }
  assert.equal(result.detailRowsOk, true, `${label} Details labels and values are separated at ${viewport.name}`);
  assert.equal(result.detailsHasFollowUp, false, `${label} Details tab hides follow-up at ${viewport.name}`);
}

async function openInquiry(cdp, inquiryId, suffix = "") {
  await navigate(cdp, `http://127.0.0.1:${port}/qa-inquiry.html?inquiry=${encodeURIComponent(inquiryId)}${suffix}`);
  await waitFor(cdp, `Boolean(document.querySelector(".mvp-drawer.inquiry"))`);
  await delay(150);
}

async function clickTab(cdp, tab) {
  await evaluate(cdp, `document.querySelector('[data-mvp-inquiry-tab="${tab}"]')?.click()`);
  await delay(150);
}

async function drawerState(cdp) {
  return evaluate(cdp, `(() => {
    const drawer = document.querySelector(".mvp-drawer.inquiry");
    const rect = drawer?.getBoundingClientRect();
    const footer = drawer?.querySelector(".mvp-drawer-footer");
    const panel = drawer?.querySelector(".mvp-inquiry-tab-panel:not([hidden])");
    const panelScroller = drawer?.querySelector(".mvp-inquiry-tab-panels");
    const preorderRows = [...(drawer?.querySelectorAll(".mvp-inquiry-preorder-checklist > div") || [])];
    const footerRect = footer?.getBoundingClientRect();
    const panelRect = panel?.getBoundingClientRect();
    const scrollerRect = panelScroller?.getBoundingClientRect();
    const detailRows = [...(drawer?.querySelectorAll('[data-mvp-inquiry-panel="details"] .mvp-inquiry-detail-line') || [])];
    const activeDetailRows = [...(panel?.querySelectorAll(".mvp-inquiry-detail-line") || [])];
    const rowsSeparated = (rows) => rows.every((row) => {
      const label = row.querySelector("span")?.textContent.trim() || "";
      const value = row.querySelector("strong")?.textContent.trim() || "";
      const labelRect = row.querySelector("span")?.getBoundingClientRect();
      const valueRect = row.querySelector("strong")?.getBoundingClientRect();
      const horizontalGap = valueRect && labelRect ? valueRect.left - labelRect.right : 0;
      const stackedGap = valueRect && labelRect ? valueRect.top - labelRect.bottom : 0;
      const separated = horizontalGap >= 10 || stackedGap >= 4;
      return label && value && label !== value && (!labelRect || !valueRect || separated);
    });
    return {
      open: Boolean(drawer),
      width: Math.round(rect?.width || 0),
      tabs: [...(drawer?.querySelectorAll(".mvp-inquiry-tabs [data-mvp-inquiry-tab]") || [])].map((node) => node.textContent.trim()).join("|"),
      text: drawer?.innerText || "",
      activePanelText: panel?.innerText || "",
      footerText: footer?.innerText || "",
      footerAction: footer?.querySelector("[data-ops-customer-action]")?.dataset.opsCustomerAction || "",
      primaryWorkflowActions: drawer?.querySelectorAll(".mvp-inquiry-action-bar .mvp-action-primary:not([disabled])").length || 0,
      bodyPrimaryWorkflowActions: drawer?.querySelectorAll(".mvp-workflow-panel .mvp-action-primary:not([disabled]), .mvp-workflow-panel .mvp-primary-action:not([disabled])").length || 0,
      formLabels: [...(drawer?.querySelectorAll(".mvp-quotation-create-form span, .mvp-quotation-create-actions button") || [])].map((node) => node.textContent.trim()),
      hasFooter: Boolean(footer) && Math.round(footerRect?.bottom || 0) <= window.innerHeight + 1,
      footerOverlap: Boolean(footerRect && scrollerRect && scrollerRect.bottom > footerRect.top + 1),
      hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      detailRowsOk: rowsSeparated(detailRows),
      activeDetailRowsOk: rowsSeparated(activeDetailRows),
      detailsHasFollowUp: detailRows.some((row) => row.innerText.includes("Follow-up")),
      quotationPanels: drawer?.querySelectorAll(".mvp-quotation-panel").length || 0,
      preorderRows: preorderRows.length,
      preorderRowsStructured: preorderRows.length === 0 || preorderRows.every((row) => {
        const status = row.querySelector("span")?.getBoundingClientRect();
        const title = row.querySelector("strong")?.getBoundingClientRect();
        const helper = row.querySelector("small")?.getBoundingClientRect();
        return status && title && helper && status.right <= title.left + 1 && helper.left >= title.left - 1 && helper.top >= title.bottom - 1;
      }),
    };
  })()`);
}

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (url.pathname === "/qa-inquiry.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(qaHtml());
      return;
    }
    const filePath = normalize(join(root, url.pathname));
    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" }[extname(filePath)] || "text/plain";
    response.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
    response.end(await readFile(filePath));
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    response.writeHead(404);
    response.end("Not found");
  }
}

function qaHtml() {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /><link rel="stylesheet" href="/src/styles.css" /></head><body><main id="app"></main><script type="module">
    import { createMvpDashboard } from "/src/mvpDashboard.js";
    const app = document.getElementById("app");
    const base = { customer: "Owner Smoke Synthetic", contact: "owner-smoke@trryapparel.com", source: "Website", service: "DTF", productDesc: "Owner smoke shirt", qty: "12 pcs", fulfillmentMethod: "pickup", priority: "normal", artworkStatus: "pending", createdAt: "2026-08-08T09:00:00.000Z", updatedAt: "2026-08-08T10:00:00.000Z", next: "Quote sent - wait for customer response", followUpDate: "2026-08-09" };
    const rows = [
      { ...base, id: "NEW-NOQUOTE", status: "new", quoteStatus: "new", quotedAmount: 0, amountDue: 0, quoteBreakdown: "", quoteNotes: "" },
      { ...base, id: "QUOTE-SENT", status: "quote_sent", quoteStatus: "sent", quotedAmount: 1616, amountDue: 1616, quotePublishedAt: "2026-08-08T10:10:00.000Z", quoteValidUntil: "2026-08-31", quoteBreakdown: "Owner smoke shirt | 12 pcs | PHP 134.67 | PHP 1616", quoteNotes: "Owner smoke quote note." },
      { ...base, id: "APPROVED-CREATE", status: "approved", quoteStatus: "approved", quotedAmount: 1616, amountDue: 1616, quotePublishedAt: "2026-08-08T10:10:00.000Z", quoteApprovedAt: "2026-08-08T10:30:00.000Z", quoteValidUntil: "2026-08-31", quoteBreakdown: "Owner smoke shirt | 12 pcs | PHP 134.67 | PHP 1616", quoteNotes: "Approved quote note.", artworkStatus: "approved", dueDate: "2026-08-20" },
      { ...base, id: "ARTWORK-PENDING", status: "approved", quoteStatus: "approved", quotedAmount: 1616, amountDue: 1616, quotePublishedAt: "2026-08-08T10:10:00.000Z", quoteApprovedAt: "2026-08-08T10:30:00.000Z", quoteValidUntil: "2026-08-31", quoteBreakdown: "Owner smoke shirt | 12 pcs | PHP 134.67 | PHP 1616", quoteNotes: "Approved quote note.", artworkStatus: "submitted", artworkUrl: "artwork/ARTWORK-PENDING/mockup.png", dueDate: "2026-08-20" },
      { ...base, id: "CONVERTED-READONLY", status: "approved", quoteStatus: "approved", quotedAmount: 1616, amountDue: 1616, quotePublishedAt: "2026-08-08T10:10:00.000Z", quoteApprovedAt: "2026-08-08T10:30:00.000Z", quoteValidUntil: "2026-08-31", quoteBreakdown: "Owner smoke shirt | 12 pcs | PHP 134.67 | PHP 1616", quoteNotes: "Converted quote note.", nativeOrderReference: "TRRY-ORD-CONVERTED", nativeOrderId: "96000000-0000-4000-8000-00000000c001", orderReference: "TRRY-ORD-CONVERTED", artworkStatus: "approved", dueDate: "2026-08-20" }
    ];
    const dashboard = createMvpDashboard({ getAssignmentContext: () => ({ users: [], loadState: "success", error: "" }) });
    function render() {
      const params = new URLSearchParams(location.search);
      dashboard.state.inquiryId = params.get("inquiry");
      if (params.get("action") === "quote") {
        dashboard.state.inquiryActionId = dashboard.state.inquiryId;
        dashboard.state.inquiryTab = "quotation";
      }
      if (params.get("action") === "primary") {
        dashboard.state.inquiryActionId = dashboard.state.inquiryId;
        dashboard.state.inquiryTab = "quotation";
      }
      app.innerHTML = dashboard.renderInquiries({ items: rows, renderArtwork });
      document.body.classList.toggle("mvp-drawer-open", Boolean(document.querySelector(".mvp-drawer")));
      dashboard.bind({ root: app, rerender: render, navigate: (route) => { window.__route = route; }, copy: async () => {}, createOrder: async () => {} });
    }
    function renderArtwork(item) {
      const hasArtwork = Boolean(item.artworkUrl);
      return hasArtwork
        ? '<section class="mvp-drawer-section mvp-artwork-access"><h3>Artwork</h3><strong>Artwork Usable</strong><button class="ops-dark-button mini" data-ops-customer-asset="customer-artwork" data-ops-customer-id="' + item.id + '" type="button">VIEW ARTWORK</button></section>'
        : '<section class="mvp-drawer-section mvp-artwork-access"><h3>Artwork</h3><strong>NO ARTWORK</strong><span>No customer artwork file or supported URL is saved for this inquiry.</span></section>';
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

function countText(text, needle) {
  return String(text || "").split(needle).length - 1;
}

function countRegex(text, pattern) {
  return (String(text || "").match(pattern) || []).length;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
