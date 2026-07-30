import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const root = process.cwd();
const port = Number(process.env.ORDER_DRAWER_BROWSER_PORT || 58260);
const remotePort = port + 100;
const ownerId = "82000000-0000-4000-8000-000000000001";
const adminId = "82000000-0000-4000-8000-000000000002";
const staffId = "82000000-0000-4000-8000-000000000003";
const tokens = {
  owner: "synthetic-order-owner-token",
  admin: "synthetic-order-admin-token",
  staff: "synthetic-order-staff-token",
};
const profiles = {
  owner: profile(ownerId, "Synthetic Owner", "owner"),
  admin: profile(adminId, "Synthetic Admin", "admin"),
  staff: profile(staffId, "Synthetic Staff", "staff"),
};
const ids = {
  unpaid: "QA-ORDER-DRAWER-UNPAID",
  pending: "QA-ORDER-DRAWER-SHOP-PENDING",
  paid: "QA-ORDER-DRAWER-SHOP-PAID",
  ready: "QA-ORDER-DRAWER-READY",
  blocked: "QA-ORDER-DRAWER-BLOCKED",
};
const rows = [
  orderRow(ids.unpaid, "QA ORDER DRAWER PHASE 8D1 - UNPAID", {
    payment_status: "required",
  }),
  orderRow(ids.pending, "QA ORDER DRAWER PHASE 8D1 - PAY AT SHOP", {
    payment_status: "pay_at_shop",
    payment_type: "shop",
    payment_selected_at: "2026-07-30T01:30:00Z",
  }),
  orderRow(ids.paid, "QA ORDER DRAWER PHASE 8D1 - PAID AT SHOP", {
    payment_status: "full_payment_confirmed",
    payment_type: "shop",
    payment_method: "cash",
    payment_confirmed_amount: 2400,
    payment_confirmed_at: "2026-07-30T02:00:00Z",
    payment_verified_amount: 2400,
    payment_verified_at: "2026-07-30T02:00:00Z",
    payment_verified_by: adminId,
    payment_internal_note: "Synthetic paid-at-shop acceptance note",
  }),
  orderRow(ids.ready, "QA ORDER DRAWER PHASE 8D1 - PRODUCTION READY", {}),
  orderRow(ids.blocked, "QA ORDER DRAWER PHASE 8D1 - NOT READY", {
    assigned_user_id: null,
    assigned_staff: null,
    blocked_reason: "Materials unavailable",
  }),
];
const requests = [];
let failOrderId = "";

const server = createServer(handleRequest);
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const edgePath = process.env.EDGE_PATH
  || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const userDataDir = join(tmpdir(), `trry-order-drawer-${Date.now()}`);
const browser = spawn(edgePath, [
  "--headless=new",
  `--remote-debugging-port=${remotePort}`,
  `--user-data-dir=${userDataDir}`,
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "about:blank",
], { stdio: "ignore" });

try {
  const cdpUrl = await waitForCdp(remotePort);
  const cdp = await createCdp(cdpUrl);

  const owner = await createPage(cdp, viewport(1366, 900));
  await seedAuth(cdp, owner, "owner");
  await navigate(cdp, owner, url("/orders"));
  await waitForSelector(cdp, owner, orderSelector(ids.pending));
  await setValue(cdp, owner, '[data-mvp-filter="order:search"]', "QA ORDER DRAWER PHASE 8D1");
  const savedScroll = await evalValue(cdp, owner, `(() => {
    window.scrollTo(0, Math.min(240, Math.max(0, document.scrollingElement.scrollHeight - innerHeight)));
    return window.scrollY;
  })()`);

  await click(cdp, owner, `${orderSelector(ids.pending)} [data-mvp-trigger="action"]`, 50);
  await waitForSelector(cdp, owner, ".mvp-order-detail-state.loading");
  await waitFor(cdp, owner, drawerHas("SHOP PAYMENT PENDING"), "pending Pay at Shop details");
  assert.equal(await evalValue(cdp, owner, `document.body.classList.contains("mvp-drawer-open")`), true);
  assert.equal(await evalValue(cdp, owner, `document.querySelectorAll('[data-ops-customer-action="confirm_shop_payment"]').length`), 1);
  assert.equal(await evalValue(cdp, owner, `document.querySelectorAll('[data-ops-customer-action="confirm_payment"]').length`), 0);
  assert.equal(await evalValue(cdp, owner, `document.querySelectorAll('.mvp-order-detail-drawer [data-ops-customer-asset="customer-artwork"]').length`), 1);
  assert.equal(await evalValue(cdp, owner, `document.querySelector('.mvp-order-detail-drawer').innerText.includes('Odoo')`), false);
  await assertDrawerGeometry(cdp, owner, 560, 1366);
  await captureQaScreenshot(cdp, owner, "desktop-1366");

  await click(cdp, owner, '[data-ops-customer-action="confirm_shop_payment"]');
  await waitForSelector(cdp, owner, '.ops-payment-dialog[role="alertdialog"]');
  await click(cdp, owner, "[data-ops-cancel-shop-payment]");
  await waitFor(cdp, owner, `document.querySelector('.ops-payment-dialog') === null`, "dialog Cancel");
  assert.equal(requests.filter((request) => request.method === "PATCH").length, 0, "Cancel has no mutation");

  await click(cdp, owner, ".mvp-order-detail-close");
  await waitFor(cdp, owner, `document.querySelector('.mvp-order-detail-drawer') === null`, "close button closes");
  assert.equal(
    await evalValue(cdp, owner, `document.activeElement?.dataset?.mvpTrigger`),
    "action",
    "focus restores to opening action",
  );
  assert.equal(
    await evalValue(cdp, owner, `document.querySelector('[data-mvp-filter="order:search"]').value`),
    "QA ORDER DRAWER PHASE 8D1",
    "search remains unchanged",
  );
  assert.ok(
    Math.abs((await evalValue(cdp, owner, "window.scrollY")) - savedScroll) <= 2,
    "page scroll remains unchanged",
  );

  await click(cdp, owner, orderSelector(ids.paid));
  await waitFor(cdp, owner, drawerHas("Synthetic paid-at-shop acceptance note"), "paid details");
  await waitFor(cdp, owner, drawerHas("SHOP PAYMENT CONFIRMED"), "payment history");
  await press(cdp, owner, "Escape");
  await waitFor(cdp, owner, `document.querySelector('.mvp-order-detail-drawer') === null`, "Escape closes");
  assert.equal(await evalValue(cdp, owner, `document.activeElement?.dataset?.mvpTrigger`), "row");

  await click(cdp, owner, orderSelector(ids.ready));
  await waitFor(cdp, owner, drawerHas("READY FOR PRODUCTION"), "ready checklist");
  assert.equal(await evalValue(cdp, owner, `document.querySelectorAll('.mvp-order-readiness-list li.complete').length`), 8);
  await click(cdp, owner, ".mvp-order-detail-backdrop");
  await waitFor(cdp, owner, `document.querySelector('.mvp-order-detail-drawer') === null`, "backdrop closes");

  await evalValue(cdp, owner, `(() => {
    document.querySelector(${JSON.stringify(orderSelector(ids.unpaid))}).click();
    setTimeout(() => document.querySelector(${JSON.stringify(orderSelector(ids.paid))})?.click(), 30);
    return true;
  })()`);
  await waitFor(cdp, owner, drawerHas("QA ORDER DRAWER PHASE 8D1 - PAID AT SHOP"), "rapid switch winner");
  await waitForSelector(cdp, owner, "[data-mvp-open-original-inquiry]");
  assert.equal(
    await evalValue(cdp, owner, `document.querySelector('.mvp-order-detail-drawer').innerText.includes('QA ORDER DRAWER PHASE 8D1 - UNPAID')`),
    false,
    "stale response never replaces active order",
  );
  await click(cdp, owner, '[data-mvp-open-original-inquiry]');
  await waitFor(cdp, owner, `location.pathname === '/inquiries'`, "original inquiry route");
  await waitForSelector(cdp, owner, ".mvp-drawer.inquiry");
  assert.equal(await evalValue(cdp, owner, `document.querySelector('.mvp-drawer.inquiry').innerText.includes('Odoo')`), false);

  await navigate(cdp, owner, url("/orders"));
  await waitForSelector(cdp, owner, orderSelector(ids.ready));
  await click(cdp, owner, orderSelector(ids.ready));
  await waitFor(cdp, owner, drawerHas("READY FOR PRODUCTION"), "ready drawer reopened");
  await click(cdp, owner, "[data-mvp-view-production]");
  await waitFor(cdp, owner, `location.pathname === '/production'`, "Production list navigation");
  assert.equal(await evalValue(cdp, owner, `document.querySelector('.mvp-drawer.production') === null`), true, "Production Drawer not opened");
  assert.equal(
    await evalValue(cdp, owner, `document.querySelector('[data-mvp-filter="production:search"]').value`),
    ids.ready,
    "Production list focused to canonical order",
  );

  await navigate(cdp, owner, url("/orders"));
  await waitForSelector(cdp, owner, orderSelector(ids.blocked));
  failOrderId = ids.blocked;
  await click(cdp, owner, orderSelector(ids.blocked));
  await waitFor(cdp, owner, drawerHas("Unable to load order details."), "calm error state");
  await click(cdp, owner, "[data-mvp-retry-order]");
  await waitFor(cdp, owner, drawerHas("NOT READY FOR PRODUCTION"), "retry success");
  await waitFor(cdp, owner, drawerHas("Production staff assigned / No active blocker"), "missing requirements");
  await click(cdp, owner, ".mvp-order-detail-close");

  await click(cdp, owner, "[data-work-chat-open]");
  await waitForSelector(cdp, owner, 'aside[aria-label="Work Chat"]');
  await click(cdp, owner, "[data-work-chat-close]");

  const admin = await createPage(cdp, viewport(1366, 900));
  await seedAuth(cdp, admin, "admin");
  await navigate(cdp, admin, url("/orders"));
  await waitForSelector(cdp, admin, orderSelector(ids.pending));
  await click(cdp, admin, orderSelector(ids.pending));
  await waitFor(cdp, admin, drawerHas("SHOP PAYMENT PENDING"), "Admin pending drawer");
  assert.equal(await evalValue(cdp, admin, `document.querySelectorAll('[data-ops-customer-action="confirm_shop_payment"]').length`), 1);

  const staff = await createPage(cdp, viewport(1366, 900));
  await seedAuth(cdp, staff, "staff");
  await navigate(cdp, staff, url("/orders"));
  await waitForSelector(cdp, staff, orderSelector(ids.pending));
  await click(cdp, staff, orderSelector(ids.pending));
  await waitFor(cdp, staff, drawerHas("SHOP PAYMENT PENDING"), "Staff pending drawer");
  assert.equal(await evalValue(cdp, staff, `document.querySelectorAll('[data-ops-customer-action="confirm_shop_payment"]').length`), 0);
  assert.equal(await evalValue(cdp, staff, drawerHas("Owner/Admin confirmation required.")), true);

  const staffPatch = await fetch(url(`/api/inquiries/${ids.pending}/customer-actions`), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${tokens.staff}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "confirm_shop_payment",
      receivedAmount: 2400,
      paymentMethod: "cash",
      idempotencyKey: "qa-order-drawer-staff-denied",
    }),
  });
  assert.equal(staffPatch.status, 403, "direct Staff confirmation remains forbidden");

  const tablet = await createPage(cdp, viewport(820, 900));
  await seedAuth(cdp, tablet, "owner");
  await navigate(cdp, tablet, url("/orders"));
  await waitForSelector(cdp, tablet, orderSelector(ids.pending));
  await click(cdp, tablet, orderSelector(ids.pending));
  await waitFor(cdp, tablet, drawerHas("SHOP PAYMENT PENDING"), "tablet drawer");
  await assertDrawerGeometry(cdp, tablet, 520, 820);
  await captureQaScreenshot(cdp, tablet, "tablet-820");

  const mobile = await createPage(cdp, viewport(390, 844, true));
  await seedAuth(cdp, mobile, "owner");
  await navigate(cdp, mobile, url("/orders"));
  await waitForSelector(cdp, mobile, `.mvp-order-mobile-card[data-mvp-id="${ids.pending}"]`);
  await click(cdp, mobile, `.mvp-order-mobile-card[data-mvp-id="${ids.pending}"]`);
  await waitFor(cdp, mobile, drawerHas("SHOP PAYMENT PENDING"), "mobile drawer");
  await assertDrawerGeometry(cdp, mobile, 390, 390);
  await captureQaScreenshot(cdp, mobile, "mobile-390");
  assert.equal(await evalValue(cdp, mobile, `document.scrollingElement.scrollWidth <= innerWidth + 1`), true, "mobile page has no overflow");
  assert.equal(await evalValue(cdp, mobile, `document.querySelector('.mvp-order-detail-header').getBoundingClientRect().top === 0`), true, "mobile header is sticky");
  await click(cdp, mobile, '[data-ops-customer-action="confirm_shop_payment"]');
  await waitForSelector(cdp, mobile, '.ops-payment-dialog[role="alertdialog"]');
  assert.equal(
    await evalValue(cdp, mobile, `document.querySelector('.ops-payment-dialog').getBoundingClientRect().width <= innerWidth`),
    true,
    "mobile payment dialog fits",
  );
  await click(cdp, mobile, "[data-ops-cancel-shop-payment]");

  assert.ok(
    requests.some((request) => request.path === `/api/orders/${ids.pending}` && request.auth === `Bearer ${tokens.owner}`),
    "order endpoint uses bearer authentication",
  );
  assert.equal(
    requests.some((request) => request.path.includes("/payments") && request.method !== "GET"),
    false,
    "Pay Online remains parked",
  );

  process.stdout.write("PASS Order Details Drawer desktop/tablet/mobile, roles, behavior, and regressions\n");
  await cdp.close();
} finally {
  browser.kill("SIGTERM");
  await new Promise((resolve) => server.close(resolve));
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host}`);
  const path = requestUrl.pathname.replace(/\/+$/, "") || "/";
  if (path === "/src/env.js") {
    return send(response, 200, "text/javascript", `window.TRRY_ADMIN_ENV = ${JSON.stringify({
      VITE_SUPABASE_URL: url(""),
      VITE_SUPABASE_ANON_KEY: "synthetic-anon-key",
      VITE_USE_SUPABASE_DATA: "true",
      VITE_ENABLE_TASK_DOMAIN: "true",
      VITE_ENABLE_ADMIN_PAY_AT_SHOP_WORKFLOW: "true",
      VITE_LOCAL_TASK_QA_MODE: "false",
      VITE_ADMIN_ACCESS_CODE: "",
    }, null, 2)};\nwindow.supabase = { createClient: () => ({ channel: () => ({ on() { return this; }, subscribe(callback) { callback("SUBSCRIBED"); return this; } }), removeChannel() {}, realtime: { setAuth() {} }, storage: { from: () => ({ uploadToSignedUrl: async () => ({ error: null }) }) } }) };\n`);
  }
  if (path.startsWith("/rest/v1/")) return handleRest(request, response, path);
  if (path.startsWith("/api/")) return handleApi(request, response, path, requestUrl);
  const filePath = normalize(join(root, path === "/" || !extname(path) ? "index.html" : path));
  if (!filePath.startsWith(root)) return send(response, 403, "text/plain", "Forbidden");
  try {
    return send(response, 200, contentType(filePath), await readFile(filePath));
  } catch {
    return send(response, 404, "text/plain", "Not found");
  }
}

function handleRest(request, response, path) {
  if (path === "/rest/v1/admin_users") {
    const role = roleForToken(request.headers.authorization);
    return sendJson(response, 200, role ? [profiles[role]] : []);
  }
  if (path === "/rest/v1/ops_inquiries") return sendJson(response, 200, rows);
  if (path === "/rest/v1/inquiry_follow_up_events") return sendJson(response, 200, []);
  if (path === "/rest/v1/catalog_products") return sendJson(response, 200, []);
  return sendJson(response, 200, []);
}

async function handleApi(request, response, path, requestUrl) {
  const auth = request.headers.authorization || "";
  const role = roleForToken(auth);
  requests.push({ path, method: request.method, auth });
  if (!role) {
    return sendJson(response, 401, {
      ok: false,
      error: { code: "AUTH_REQUIRED", message: "Authentication required." },
    });
  }
  if (path === "/api/assignment-users") {
    return sendJson(response, 200, {
      ok: true,
      users: Object.values(profiles).map((item) => ({
        id: `profile-${item.role}`,
        userId: item.user_id,
        displayName: item.display_name,
        role: item.role,
        isActive: true,
        assignmentEligible: true,
      })),
    });
  }
  if (path === "/api/tasks" || path === "/api/my-tasks") {
    if (path === "/api/tasks" && role === "staff") {
      return sendJson(response, 403, { ok: false, error: { code: "FORBIDDEN" } });
    }
    return sendJson(response, 200, { ok: true, tasks: [], page: 1, pageSize: 100, total: 0 });
  }
  if (path === "/api/work-chat/bootstrap") {
    return sendJson(response, 200, {
      ok: true,
      currentUser: {
        userId: profiles[role].user_id,
        displayName: profiles[role].display_name,
        role,
      },
      channels: [{
        id: "82000000-0000-4000-8000-000000000100",
        channelKey: "general",
        channelType: "STANDARD",
        name: "GENERAL",
        createdAt: "2026-07-30T00:00:00Z",
        updatedAt: "2026-07-30T00:00:00Z",
      }],
      orderThreads: [],
      activeUsers: [],
      unreadByChannel: {},
      globalUnreadCount: 0,
      unreadMentionCount: 0,
      mentionMessages: [],
      defaultChannelId: "82000000-0000-4000-8000-000000000100",
    });
  }
  if (/^\/api\/work-chat\/channels\/[^/]+\/messages$/.test(path)) {
    return sendJson(response, 200, { ok: true, messages: [] });
  }
  if (/^\/api\/work-chat\/channels\/[^/]+\/read$/.test(path)) {
    return sendJson(response, 200, { ok: true, read: true });
  }
  const orderMatch = path.match(/^\/api\/orders\/([^/]+)$/);
  if (orderMatch) {
    const id = decodeURIComponent(orderMatch[1]);
    if (failOrderId === id) {
      failOrderId = "";
      return sendJson(response, 500, {
        ok: false,
        error: { code: "ORDER_DETAILS_FAILED", message: "Unable to load order details." },
      });
    }
    const row = rows.find((item) => item.id === id);
    if (!row) return sendJson(response, 404, { ok: false, error: { code: "ORDER_NOT_FOUND" } });
    await wait(id === ids.unpaid ? 450 : 120);
    return sendJson(response, 200, { ok: true, order: orderDetail(row) });
  }
  const customerActions = path.match(/^\/api\/inquiries\/([^/]+)\/customer-actions$/);
  if (customerActions) {
    const id = decodeURIComponent(customerActions[1]);
    if (request.method === "PATCH") {
      if (role === "staff") return sendJson(response, 403, { ok: false, error: "shop payment confirmation requires Owner or Admin access" });
      return sendJson(response, 200, { ok: true, inquiry: orderDetail(rows.find((item) => item.id === id)), paymentEvents: paymentHistory(id) });
    }
    if (requestUrl.searchParams.get("view") === "payment-history") {
      return sendJson(response, 200, { ok: true, paymentEvents: paymentHistory(id) });
    }
  }
  if (/^\/api\/inquiries\/[^/]+\/artwork$/.test(path)) {
    return sendJson(response, 404, { ok: false, error: "no artwork uploaded" });
  }
  return sendJson(response, 200, { ok: true });
}

function orderDetail(row) {
  const paymentEvents = paymentHistory(row.id);
  const assigned = row.assigned_user_id ? "Synthetic Staff" : "Not set";
  const checks = [
    ["confirmed-order", "Confirmed TRRY order", true],
    ["approved-quotation", "Approved quotation", true],
    ["product", "Product or service complete", true],
    ["quantity", "Quantity complete", true],
    ["due-date", "Due date set", true],
    ["artwork", "Artwork approved", true],
    ["production-staff", "Production staff assigned", Boolean(row.assigned_user_id)],
    ["blocker", "No active blocker", !row.blocked_reason],
  ].map(([key, label, complete]) => ({ key, label, complete }));
  const activityItems = [
    activity("INQUIRY CREATED", row.created_at),
    activity("QUOTATION SENT", row.quote_published_at),
    activity("QUOTATION APPROVED", row.quote_approved_at),
    activity("ARTWORK APPROVED", row.artwork_approved_at),
    ...paymentEvents.map((event) => ({
      label: event.eventType === "SHOP_PAYMENT_CONFIRMED" ? "SHOP PAYMENT CONFIRMED" : "PAY AT SHOP SELECTED",
      actor: event.actorDisplayName,
      createdAt: event.createdAt,
      note: event.internalNote,
    })),
  ];
  return {
    id: row.id,
    reference: row.id,
    sourceInquiryReference: row.id,
    status: "won",
    statusLabel: "CONFIRMED ORDER",
    customerName: row.customer_name,
    company: row.company,
    contact: row.contact,
    source: row.source,
    channel: row.channel,
    createdAt: row.created_at,
    confirmedAt: null,
    nextAction: row.next_action,
    productDescription: row.product_desc,
    service: row.product,
    quantity: row.size_breakdown || row.quantity,
    sizeBreakdown: row.size_breakdown,
    quotedAmount: row.quoted_amount,
    amountDue: row.amount_due,
    dueDate: row.due_date,
    fulfillmentMethod: row.fulfillment_method,
    deliveryCity: row.delivery_city,
    deliveryAddress: row.delivery_address,
    deliveryLandmark: row.delivery_landmark,
    trackingSubstatus: "",
    trackingNote: "",
    trackingUpdatedAt: null,
    owner: "Synthetic Owner",
    assignedStaff: assigned,
    quoteStatus: row.quote_status,
    quoteApprovedAt: row.quote_approved_at,
    quotePublishedAt: row.quote_published_at,
    quoteSentAt: row.quote_sent_at,
    quoteBreakdown: row.quote_breakdown,
    quoteNotes: row.quote_notes,
    quoteValidUntil: null,
    artworkStatus: row.artwork_status,
    artworkApprovedAt: row.artwork_approved_at,
    artworkRevisionRequest: "",
    artworkAvailable: true,
    paymentStatus: row.payment_status,
    paymentLabel: "",
    paymentMethod: row.payment_method,
    paymentType: row.payment_type,
    paymentConfirmedAmount: row.payment_confirmed_amount,
    paymentConfirmedAt: row.payment_confirmed_at,
    paymentVerifiedAmount: row.payment_verified_amount,
    paymentVerifiedAt: row.payment_verified_at,
    paymentVerifiedBy: row.payment_verified_by ? "Synthetic Admin" : "Not set",
    paymentSelectedAt: row.payment_selected_at,
    paymentInternalNote: row.payment_internal_note,
    paymentProofSubmittedAt: null,
    paymentReviewNote: "",
    paymentRejectedAt: null,
    productionStage: row.production_stage,
    productionNote: row.production_note,
    productionUpdatedAt: row.production_updated_at,
    blockerReason: row.blocked_reason || "",
    notes: "",
    customerNotes: "",
    readiness: {
      ready: checks.every((check) => check.complete),
      checks,
      missing: checks.filter((check) => !check.complete).map((check) => check.label),
    },
    paymentEvents,
    activity: activityItems,
  };
}

function paymentHistory(id) {
  const row = rows.find((item) => item.id === id);
  if (!row || !["pay_at_shop", "full_payment_confirmed"].includes(row.payment_status)) return [];
  const events = [{
    eventType: "PAY_AT_SHOP_SELECTED",
    label: "PAY AT SHOP SELECTED",
    paymentMethod: "",
    amount: row.quoted_amount,
    internalNote: "",
    actorDisplayName: "Customer",
    actorRole: "",
    source: "CUSTOMER",
    createdAt: row.payment_selected_at || "2026-07-30T01:30:00Z",
  }];
  if (row.payment_status === "full_payment_confirmed") {
    events.push({
      eventType: "SHOP_PAYMENT_CONFIRMED",
      label: "SHOP PAYMENT CONFIRMED",
      paymentMethod: row.payment_method,
      amount: row.payment_verified_amount,
      internalNote: row.payment_internal_note,
      actorDisplayName: "Synthetic Admin",
      actorRole: "admin",
      source: "ADMIN",
      createdAt: row.payment_verified_at,
    });
  }
  return events;
}

function orderRow(id, customerName, overrides) {
  return {
    id,
    customer_name: customerName,
    company: "Synthetic QA",
    contact: "Synthetic contact",
    notes: "",
    customer_notes: "",
    source: "QA",
    channel: "synthetic",
    message: "Synthetic Order Drawer QA record.",
    product: "Screen Printing",
    product_desc: "QA Shirt",
    quantity: "12",
    size_breakdown: "S 4 / M 4 / L 4",
    status: "won",
    next_action: "Prepare production handoff",
    due_date: "2026-08-10",
    fulfillment_method: "pickup",
    delivery_city: "",
    delivery_address: "",
    delivery_landmark: "",
    quoted_amount: 2400,
    amount_due: 2400,
    quote_status: "approved",
    quote_approved_at: "2026-07-30T01:00:00Z",
    quote_published_at: "2026-07-30T00:30:00Z",
    quote_sent_at: "2026-07-30T00:30:00Z",
    quote_breakdown: "12 synthetic QA shirts",
    quote_notes: "Synthetic quote notes",
    artwork_status: "approved",
    artwork_url: `${id}/synthetic-artwork.png`,
    artwork_approved_at: "2026-07-30T01:15:00Z",
    payment_status: "required",
    payment_method: "",
    payment_type: "",
    payment_confirmed_amount: null,
    payment_confirmed_at: null,
    payment_verified_amount: null,
    payment_verified_at: null,
    payment_verified_by: null,
    payment_selected_at: null,
    payment_internal_note: "",
    owner_user_id: ownerId,
    assigned_user_id: staffId,
    assigned_staff: "Synthetic Staff",
    production_stage: "queued",
    production_note: "Synthetic read-only production note",
    production_updated_at: "2026-07-30T02:30:00Z",
    blocked_reason: null,
    created_at: "2026-07-30T00:00:00Z",
    updated_at: "2026-07-30T02:30:00Z",
    ...overrides,
  };
}

function profile(userId, displayName, role) {
  return {
    id: `profile-${role}`,
    user_id: userId,
    display_name: displayName,
    role,
    is_active: true,
  };
}

function activity(label, createdAt) {
  return { label, actor: "", createdAt, note: "" };
}

function roleForToken(authorization = "") {
  return Object.entries(tokens).find(([, token]) => authorization === `Bearer ${token}`)?.[0] || "";
}

function orderSelector(id) {
  return `.mvp-table-row[data-mvp-open="order"][data-mvp-id="${id}"]`;
}

function drawerHas(text) {
  return `document.querySelector('.mvp-order-detail-drawer')?.innerText.includes(${JSON.stringify(text)}) === true`;
}

function url(path) {
  return `http://127.0.0.1:${port}${path}`;
}

function viewport(width, height, isMobile = false) {
  return { width, height, isMobile, deviceScaleFactor: isMobile ? 2 : 1 };
}

async function assertDrawerGeometry(cdp, page, expectedMax, viewportWidth) {
  await wait(260);
  const geometry = await evalValue(cdp, page, `(() => {
    const drawer = document.querySelector('.mvp-order-detail-drawer');
    const rect = drawer.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      width: rect.width,
      pageOverflow: document.scrollingElement.scrollWidth > innerWidth + 1,
      drawerOverflow: drawer.scrollWidth > drawer.clientWidth + 1,
    };
  })()`);
  assert.ok(geometry.width <= expectedMax + 1, `drawer width <= ${expectedMax}`);
  if (viewportWidth === 390) assert.ok(Math.abs(geometry.width - viewportWidth) <= 1);
  assert.ok(
    geometry.left >= -1 && geometry.right <= viewportWidth + 1,
    `drawer bounds fit viewport ${viewportWidth}: ${JSON.stringify(geometry)}`,
  );
  assert.equal(geometry.pageOverflow, false);
  assert.equal(geometry.drawerOverflow, false);
}

async function captureQaScreenshot(cdp, page, name) {
  const outputDir = String(process.env.ORDER_DRAWER_SCREENSHOT_DIR || "").trim();
  if (!outputDir) return;
  await mkdir(outputDir, { recursive: true });
  const { data } = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  }, page.sessionId);
  await writeFile(join(outputDir, `${name}.png`), Buffer.from(data, "base64"));
}

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

async function createPage(cdp, metrics) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    ...metrics,
    mobile: metrics.isMobile,
    screenWidth: metrics.width,
    screenHeight: metrics.height,
  }, sessionId);
  return { targetId, sessionId };
}

async function seedAuth(cdp, page, role) {
  const userId = profiles[role].user_id;
  const session = {
    access_token: tokens[role],
    refresh_token: "",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: userId, email: `synthetic-${role}.invalid` },
  };
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `localStorage.setItem("trry_admin_supabase_auth_session_v1", ${JSON.stringify(JSON.stringify(session))});`,
  }, page.sessionId);
}

async function navigate(cdp, page, target) {
  await cdp.send("Page.navigate", { url: target }, page.sessionId);
  await wait(900);
}

async function click(cdp, page, selector, idle = 500) {
  assert.equal(
    await evalValue(cdp, page, `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      element.click();
      return true;
    })()`),
    true,
    `selector missing: ${selector}`,
  );
  await wait(idle);
}

async function setValue(cdp, page, selector, value) {
  assert.equal(
    await evalValue(cdp, page, `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      element.value = ${JSON.stringify(value)};
      element.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`),
    true,
  );
  await wait(400);
}

async function press(cdp, page, key) {
  const keyCode = key === "Escape" ? 27 : key === "Tab" ? 9 : 13;
  const code = key === "Escape" ? "Escape" : key;
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  }, page.sessionId);
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  }, page.sessionId);
  await wait(400);
}

async function waitForSelector(cdp, page, selector, timeout = 8000) {
  return waitFor(
    cdp,
    page,
    `document.querySelector(${JSON.stringify(selector)}) !== null`,
    `selector ${selector}`,
    timeout,
  );
}

async function waitFor(cdp, page, expression, label, timeout = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evalValue(cdp, page, expression)) return;
    await wait(80);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function evalValue(cdp, page, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, page.sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Browser evaluation failed.");
  }
  return result.result?.value;
}

function send(response, status, type, body) {
  response.writeHead(status, { "Content-Type": type });
  response.end(body);
}

function sendJson(response, status, body) {
  send(response, status, "application/json; charset=utf-8", JSON.stringify(body));
}

function contentType(path) {
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
  }[extname(path)] || "text/plain";
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
