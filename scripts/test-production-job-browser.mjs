import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const root = process.cwd();
const port = Number(process.env.PRODUCTION_DRAWER_BROWSER_PORT || 58280);
const remotePort = port + 100;
const ownerId = "83000000-0000-4000-8000-000000000001";
const adminId = "83000000-0000-4000-8000-000000000002";
const staffId = "83000000-0000-4000-8000-000000000003";
const tokens = {
  owner: "synthetic-production-owner-token",
  admin: "synthetic-production-admin-token",
  staff: "synthetic-production-staff-token",
};
const profiles = {
  owner: profile(ownerId, "Synthetic Owner", "owner"),
  admin: profile(adminId, "Synthetic Admin", "admin"),
  staff: profile(staffId, "Synthetic Staff", "staff"),
};
const ids = {
  dtf: "QA-PRODUCTION-DRAWER-DTF",
  embroidery: "QA-PRODUCTION-DRAWER-EMBROIDERY",
  screen: "QA-PRODUCTION-DRAWER-SCREEN",
  missing: "QA-PRODUCTION-DRAWER-MISSING",
  blocked: "QA-PRODUCTION-DRAWER-BLOCKED",
  active: "QA-PRODUCTION-DRAWER-ACTIVE",
  qc: "QA-PRODUCTION-DRAWER-QC",
  ready: "QA-PRODUCTION-DRAWER-READY",
  completed: "QA-PRODUCTION-DRAWER-COMPLETED",
  unassigned: "QA-PRODUCTION-DRAWER-UNASSIGNED",
};
const rows = [
  jobRow(ids.dtf, "QA PRODUCTION DRAWER PHASE 8D2 - DTF", { product: "DTF Printing" }),
  jobRow(ids.embroidery, "QA PRODUCTION DRAWER PHASE 8D2 - EMBROIDERY", { product: "Embroidery" }),
  jobRow(ids.screen, "QA PRODUCTION DRAWER PHASE 8D2 - SCREEN", { product: "Screen Printing" }),
  jobRow(ids.missing, "QA PRODUCTION DRAWER PHASE 8D2 - MISSING", {
    product: "",
    product_desc: "",
    quantity: "",
    size_breakdown: "",
    due_date: null,
    artwork_status: "pending",
    assigned_user_id: null,
    assigned_staff: null,
  }),
  jobRow(ids.blocked, "QA PRODUCTION DRAWER PHASE 8D2 - BLOCKED", {
    blocked_reason: "Synthetic material blocker",
  }),
  jobRow(ids.active, "QA PRODUCTION DRAWER PHASE 8D2 - ACTIVE", {
    product: "DTF Printing",
    production_stage: "printing",
  }),
  jobRow(ids.qc, "QA PRODUCTION DRAWER PHASE 8D2 - QC", { production_stage: "qc_finishing" }),
  jobRow(ids.ready, "QA PRODUCTION DRAWER PHASE 8D2 - READY", { production_stage: "ready_for_fulfillment" }),
  jobRow(ids.completed, "QA PRODUCTION DRAWER PHASE 8D2 - COMPLETED", { production_stage: "completed" }),
  jobRow(ids.unassigned, "QA PRODUCTION DRAWER PHASE 8D2 - UNASSIGNED", {
    assigned_user_id: null,
    assigned_staff: null,
  }),
];
const requests = [];
let failJobId = "";
let revision = 0;

const server = createServer(handleRequest);
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const edgePath = process.env.EDGE_PATH
  || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browser = spawn(edgePath, [
  "--headless=new",
  `--remote-debugging-port=${remotePort}`,
  `--user-data-dir=${join(tmpdir(), `trry-production-drawer-${Date.now()}`)}`,
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "about:blank",
], { stdio: "ignore" });

try {
  const cdp = await createCdp(await waitForCdp(remotePort));

  const owner = await createPage(cdp, viewport(1366, 900));
  await seedAuth(cdp, owner, "owner");
  await navigate(cdp, owner, url("/production"));
  await waitForSelector(cdp, owner, rowSelector(ids.dtf));
  await setValue(cdp, owner, '[data-mvp-filter="production:search"]', "QA PRODUCTION DRAWER PHASE 8D2");
  const savedScroll = await evalValue(cdp, owner, `(() => {
    window.scrollTo(0, Math.min(220, Math.max(0, document.scrollingElement.scrollHeight - innerHeight)));
    return window.scrollY;
  })()`);

  await click(cdp, owner, `${rowSelector(ids.dtf)} [data-mvp-trigger="action"]`, 30);
  await waitForSelector(cdp, owner, ".mvp-production-detail-state.loading");
  await waitFor(cdp, owner, drawerHas("READY FOR PRODUCTION"), "ready DTF drawer");
  assert.equal(await evalValue(cdp, owner, `document.body.classList.contains("mvp-drawer-open")`), true);
  assert.equal(await evalValue(cdp, owner, `document.querySelector('.mvp-production-detail-drawer')?.getAttribute('role')`), "dialog");
  assert.equal(await evalValue(cdp, owner, drawerHas("START DTF PRINTING")), true);
  assert.equal(await evalValue(cdp, owner, `document.querySelector('.mvp-production-readiness').innerText.includes('Payment')`), false);
  assert.equal(await evalValue(cdp, owner, drawerHas("Odoo")), false);
  assert.equal(
    await evalValue(cdp, owner, `document.querySelectorAll('[data-ops-customer-asset="customer-artwork"]').length > 0`),
    true,
  );
  await assertDrawerGeometry(cdp, owner, 560, 1366);
  await captureQaScreenshot(cdp, owner, "desktop-1366");

  await setValue(cdp, owner, `[data-mvp-production-note-editor="${ids.dtf}"]`, "Synthetic updated production note");
  await click(cdp, owner, `[data-mvp-save-production-note="${ids.dtf}"]`, 30);
  await waitFor(cdp, owner, drawerHas("Production note saved."), "note update success");
  assert.equal(rows.find((row) => row.id === ids.dtf).production_note, "Synthetic updated production note");

  await click(cdp, owner, `[data-mvp-request-stage-advance="${ids.dtf}"]`);
  await waitForSelector(cdp, owner, '.mvp-production-confirm-dialog[role="alertdialog"]');
  const patchCountBeforeCancel = patchRequests().length;
  await click(cdp, owner, "[data-mvp-cancel-production-confirm]");
  assert.equal(patchRequests().length, patchCountBeforeCancel, "cancel stage performs no mutation");
  await click(cdp, owner, `[data-mvp-request-stage-advance="${ids.dtf}"]`);
  await click(cdp, owner, `[data-mvp-confirm-production-action="${ids.dtf}"]`, 30);
  await waitFor(cdp, owner, drawerHas("DTF PRINTING"), "stage advances exactly once");
  assert.equal(rows.find((row) => row.id === ids.dtf).production_stage, "printing");

  await click(cdp, owner, ".mvp-production-detail-close");
  await waitFor(cdp, owner, `document.querySelector('.mvp-production-detail-drawer') === null`, "close button");
  assert.equal(await evalValue(cdp, owner, `document.activeElement?.dataset?.mvpTrigger`), "action");
  assert.equal(
    await evalValue(cdp, owner, `document.querySelector('[data-mvp-filter="production:search"]').value`),
    "QA PRODUCTION DRAWER PHASE 8D2",
  );
  assert.ok(Math.abs((await evalValue(cdp, owner, "window.scrollY")) - savedScroll) <= 2);

  await click(cdp, owner, rowSelector(ids.blocked));
  await waitFor(cdp, owner, drawerHas("Synthetic material blocker"), "blocked drawer");
  await click(cdp, owner, `[data-mvp-request-clear-blocker="${ids.blocked}"]`);
  await waitForSelector(cdp, owner, ".mvp-production-confirm-dialog");
  const blockerPatchCount = patchRequests().length;
  await click(cdp, owner, "[data-mvp-cancel-production-confirm]");
  assert.equal(patchRequests().length, blockerPatchCount, "cancel blocker performs no mutation");
  await click(cdp, owner, `[data-mvp-request-clear-blocker="${ids.blocked}"]`);
  await click(cdp, owner, `[data-mvp-confirm-production-action="${ids.blocked}"]`, 30);
  await waitFor(cdp, owner, drawerHas("No active blocker."), "blocker cleared");
  assert.equal(rows.find((row) => row.id === ids.blocked).blocked_reason, null);
  await press(cdp, owner, "Escape");
  await waitFor(cdp, owner, `document.querySelector('.mvp-production-detail-drawer') === null`, "Escape close");

  await evalValue(cdp, owner, `(() => {
    document.querySelector(${JSON.stringify(rowSelector(ids.embroidery))}).click();
    setTimeout(() => document.querySelector(${JSON.stringify(rowSelector(ids.screen))})?.click(), 25);
    return true;
  })()`);
  await waitFor(cdp, owner, drawerHas("QA PRODUCTION DRAWER PHASE 8D2 - SCREEN"), "rapid switch winner");
  await waitFor(cdp, owner, drawerHas("START SCREEN PRINTING"), "rapid switch details");
  assert.equal(await evalValue(cdp, owner, drawerHas("QA PRODUCTION DRAWER PHASE 8D2 - EMBROIDERY")), false);
  await setValue(cdp, owner, `[data-mvp-production-blocker="${ids.screen}"]`, "Synthetic screen blocker");
  await click(cdp, owner, `[data-mvp-set-production-blocker="${ids.screen}"]`, 30);
  await waitFor(cdp, owner, drawerHas("Production blocker set."), "manager blocker set");
  assert.equal(rows.find((row) => row.id === ids.screen).blocked_reason, "Synthetic screen blocker");
  await click(cdp, owner, ".mvp-production-detail-close");

  failJobId = ids.missing;
  await click(cdp, owner, rowSelector(ids.missing));
  await waitFor(cdp, owner, drawerHas("Unable to load production details."), "calm error");
  await click(cdp, owner, `[data-mvp-retry-production="${ids.missing}"]`);
  await waitFor(cdp, owner, drawerHas("NOT READY FOR PRODUCTION"), "retry and readiness");
  assert.equal(await evalValue(cdp, owner, drawerHas("Product/service complete / Quantity complete / Due date set / Artwork approved / Staff assigned")), true);
  assert.equal(await evalValue(cdp, owner, `document.querySelector('[data-mvp-request-stage-advance]') === null`), true);
  await click(cdp, owner, ".mvp-production-detail-close");

  await click(cdp, owner, rowSelector(ids.completed));
  await waitFor(cdp, owner, drawerHas("COMPLETED JOBS ARE READ-ONLY."), "completed lock");
  assert.equal(await evalValue(cdp, owner, `document.querySelectorAll('[data-mvp-save-production-note],[data-mvp-save-production-assignment],[data-mvp-request-stage-advance]').length`), 0);
  await click(cdp, owner, ".mvp-production-detail-close");

  await click(cdp, owner, rowSelector(ids.active));
  await waitFor(cdp, owner, drawerHas("MOVE TO QUALITY CHECK"), "active action");
  await click(cdp, owner, `[data-mvp-production-view-order="${ids.active}"]`);
  await waitFor(cdp, owner, `location.pathname === '/orders'`, "Order Drawer route");
  await waitForSelector(cdp, owner, ".mvp-order-detail-drawer");
  assert.equal(await evalValue(cdp, owner, `document.querySelector('.mvp-production-detail-drawer') === null`), true);

  await navigate(cdp, owner, url("/production"));
  await waitForSelector(cdp, owner, rowSelector(ids.active));
  await click(cdp, owner, "[data-work-chat-open]");
  await waitForSelector(cdp, owner, 'aside[aria-label="Work Chat"]');
  await click(cdp, owner, "[data-work-chat-close]");

  const admin = await createPage(cdp, viewport(1366, 900));
  await seedAuth(cdp, admin, "admin");
  await navigate(cdp, admin, url("/production"));
  await waitForSelector(cdp, admin, rowSelector(ids.missing));
  await click(cdp, admin, rowSelector(ids.missing));
  await waitFor(cdp, admin, drawerHas("QA PRODUCTION DRAWER PHASE 8D2 - MISSING"), "Admin controls");
  assert.equal(await evalValue(cdp, admin, `document.querySelectorAll('[data-mvp-save-production-assignment]').length`), 1);
  await setValue(cdp, admin, `[data-mvp-production-assignment="${ids.missing}"]`, staffId);
  await click(cdp, admin, `[data-mvp-save-production-assignment="${ids.missing}"]`, 30);
  await waitFor(cdp, admin, drawerHas("Assignment updated."), "Admin assignment");
  await click(cdp, admin, ".mvp-production-detail-close");
  const updatedAssignmentRow = await evalValue(
    cdp,
    admin,
    `document.querySelector(${JSON.stringify(rowSelector(ids.missing))}).innerText`,
  );
  assert.ok(/synthetic staff/i.test(updatedAssignmentRow), `updated assignment row: ${updatedAssignmentRow}`);

  const staff = await createPage(cdp, viewport(1366, 900));
  await seedAuth(cdp, staff, "staff");
  await navigate(cdp, staff, url("/production"));
  await waitForSelector(cdp, staff, rowSelector(ids.active));
  await click(cdp, staff, rowSelector(ids.active));
  await waitFor(cdp, staff, drawerHas("MOVE TO QUALITY CHECK"), "assigned Staff drawer");
  assert.equal(await evalValue(cdp, staff, `document.querySelectorAll('[data-mvp-save-production-assignment]').length`), 0);
  assert.equal(await evalValue(cdp, staff, `document.querySelectorAll('[data-mvp-save-production-note]').length`), 1);
  assert.equal(await evalValue(cdp, staff, `document.querySelector('[data-mvp-request-stage-advance]').disabled`), false);
  await click(cdp, staff, ".mvp-production-detail-close");
  await click(cdp, staff, rowSelector(ids.unassigned));
  await waitFor(cdp, staff, drawerHas("QA PRODUCTION DRAWER PHASE 8D2 - UNASSIGNED"), "unassigned Staff drawer");
  assert.equal(await evalValue(cdp, staff, `document.querySelectorAll('[data-mvp-save-production-note]').length`), 0);
  assert.equal(await evalValue(cdp, staff, `document.querySelector('[data-mvp-request-stage-advance]')?.disabled`), true);

  const tablet = await createPage(cdp, viewport(820, 900));
  await seedAuth(cdp, tablet, "owner");
  await navigate(cdp, tablet, url("/production"));
  await waitForSelector(cdp, tablet, rowSelector(ids.qc));
  await click(cdp, tablet, rowSelector(ids.qc));
  await waitFor(cdp, tablet, drawerHas("QUALITY CHECK"), "tablet alias");
  await assertDrawerGeometry(cdp, tablet, 520, 820);
  await captureQaScreenshot(cdp, tablet, "tablet-820");

  const mobile = await createPage(cdp, viewport(390, 844, true));
  await seedAuth(cdp, mobile, "owner");
  await navigate(cdp, mobile, url("/production"));
  await waitForSelector(cdp, mobile, mobileSelector(ids.ready));
  await click(cdp, mobile, mobileSelector(ids.ready));
  await waitFor(cdp, mobile, drawerHas("READY"), "mobile alias");
  await assertDrawerGeometry(cdp, mobile, 390, 390);
  await captureQaScreenshot(cdp, mobile, "mobile-390");
  assert.equal(await evalValue(cdp, mobile, `document.querySelector('.mvp-production-detail-header').getBoundingClientRect().top === 0`), true);
  assert.equal(await evalValue(cdp, mobile, `document.querySelector('.mvp-production-detail-footer').getBoundingClientRect().bottom <= innerHeight + 1`), true);
  await click(cdp, mobile, ".mvp-production-detail-backdrop");
  await waitFor(cdp, mobile, `document.querySelector('.mvp-production-detail-drawer') === null`, "mobile backdrop");

  assert.ok(requests.some((entry) => entry.path === `/api/production/${ids.dtf}` && entry.auth === `Bearer ${tokens.owner}`));
  assert.equal(requests.some((entry) => /odoo/i.test(entry.path)), false);
  assert.equal(requests.some((entry) => /payment/i.test(entry.path) && entry.method !== "GET"), false);
  assert.equal(patchRequests().filter((entry) => entry.body.action === "advance_production_stage" && entry.id === ids.dtf).length, 1);

  process.stdout.write("PASS Production Job Drawer desktop/tablet/mobile, roles, operations, and regressions\n");
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
      VITE_ADMIN_ACCESS_CODE: "",
    })};\nwindow.supabase = { createClient: () => ({ channel: () => ({ on() { return this; }, subscribe(callback) { callback("SUBSCRIBED"); return this; } }), removeChannel() {}, realtime: { setAuth() {} }, storage: { from: () => ({ uploadToSignedUrl: async () => ({ error: null }) }) } }) };\n`);
  }
  if (path.startsWith("/rest/v1/")) return handleRest(request, response, path);
  if (path.startsWith("/api/")) return handleApi(request, response, path);
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

async function handleApi(request, response, path) {
  const auth = request.headers.authorization || "";
  const role = roleForToken(auth);
  const record = { path, method: request.method, auth };
  requests.push(record);
  if (!role) return sendJson(response, 401, { ok: false, error: { code: "AUTH_REQUIRED" } });

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
    return sendJson(response, role === "staff" && path === "/api/tasks" ? 403 : 200, {
      ok: role !== "staff" || path !== "/api/tasks",
      tasks: [],
      page: 1,
      pageSize: 100,
      total: 0,
    });
  }
  if (path === "/api/work-chat/bootstrap") {
    return sendJson(response, 200, {
      ok: true,
      currentUser: { userId: profiles[role].user_id, displayName: profiles[role].display_name, role },
      channels: [{ id: "83000000-0000-4000-8000-000000000100", channelKey: "general", channelType: "STANDARD", name: "GENERAL" }],
      orderThreads: [],
      activeUsers: [],
      unreadByChannel: {},
      globalUnreadCount: 0,
      unreadMentionCount: 0,
      mentionMessages: [],
      defaultChannelId: "83000000-0000-4000-8000-000000000100",
    });
  }
  if (/^\/api\/work-chat\/channels\/[^/]+\/(messages|read)$/.test(path)) {
    return sendJson(response, 200, { ok: true, messages: [], read: true });
  }
  if (/^\/api\/inquiries\/[^/]+\/artwork$/.test(path)) {
    return sendJson(response, 404, { ok: false, error: "no artwork uploaded" });
  }

  const productionMatch = path.match(/^\/api\/production\/([^/]+)$/);
  if (productionMatch) {
    const id = decodeURIComponent(productionMatch[1]);
    const row = rows.find((item) => item.id === id);
    if (!row) return sendJson(response, 404, { ok: false, error: { code: "PRODUCTION_JOB_NOT_FOUND" } });
    record.id = id;
    if (request.method === "GET") {
      if (failJobId === id) {
        failJobId = "";
        return sendJson(response, 500, { ok: false, error: { message: "Unable to load production details." } });
      }
      await wait(id === ids.embroidery ? 350 : 90);
      return sendJson(response, 200, { ok: true, job: productionDetail(row, role) });
    }
    const body = await readBody(request);
    record.body = body;
    if (body.expectedCurrentStage !== canonicalStage(row.production_stage)) {
      return sendJson(response, 409, { ok: false, error: { code: "PRODUCTION_STALE", message: "This job was updated by another user. Refresh and try again." } });
    }
    const assignedStaff = row.assigned_user_id === staffId;
    if (role === "staff" && (!assignedStaff || ["assign_production_staff", "set_production_blocker", "clear_production_blocker"].includes(body.action))) {
      return sendJson(response, 403, { ok: false, error: { code: "PRODUCTION_WRITE_FORBIDDEN" } });
    }
    if (body.action === "assign_production_staff") {
      row.assigned_user_id = body.assignedUserId || null;
      row.assigned_staff = body.assignedUserId ? "Synthetic Staff" : null;
    } else if (body.action === "set_production_blocker") {
      row.blocked_reason = body.blockerReason;
    } else if (body.action === "clear_production_blocker") {
      row.blocked_reason = null;
    } else if (body.action === "update_production_note") {
      row.production_note = body.productionNote;
    } else if (body.action === "advance_production_stage") {
      if (body.nextStage !== nextStage(row)) {
        return sendJson(response, 400, { ok: false, error: { code: "INVALID_PRODUCTION_TRANSITION" } });
      }
      row.production_stage = body.nextStage;
    }
    revision += 1;
    row.production_updated_at = `2026-07-30T04:${String(revision).padStart(2, "0")}:00Z`;
    return sendJson(response, 200, { ok: true, job: productionDetail(row, role) });
  }

  const orderMatch = path.match(/^\/api\/orders\/([^/]+)$/);
  if (orderMatch) {
    const row = rows.find((item) => item.id === decodeURIComponent(orderMatch[1]));
    return row
      ? sendJson(response, 200, { ok: true, order: orderDetail(row) })
      : sendJson(response, 404, { ok: false, error: { code: "ORDER_NOT_FOUND" } });
  }
  if (/^\/api\/inquiries\/[^/]+\/customer-actions$/.test(path)) {
    return sendJson(response, 200, { ok: true, paymentEvents: [] });
  }
  return sendJson(response, 200, { ok: true });
}

function productionDetail(row, role) {
  const stage = canonicalStage(row.production_stage);
  const checks = [
    ["confirmed-order", "TRRY order confirmed", row.status === "won"],
    ["approved-quotation", "Quote approved", row.quote_status === "approved"],
    ["product", "Product/service complete", Boolean(row.product || row.product_desc)],
    ["quantity", "Quantity complete", Number.parseFloat(row.quantity) > 0],
    ["due-date", "Due date set", Boolean(row.due_date)],
    ["artwork", "Artwork approved", row.artwork_status === "approved"],
    ["production-staff", "Staff assigned", Boolean(row.assigned_user_id)],
    ["blocker", "No blocker", !row.blocked_reason],
  ].map(([key, label, complete]) => ({ key, label, complete }));
  const ready = checks.every((check) => check.complete);
  const next = nextStage(row);
  const manager = role !== "staff";
  const assigned = role === "staff" && row.assigned_user_id === staffId;
  const mutable = ["queued", "printing", "embroidery", "screen_printing", "in_production", "qc"].includes(stage);
  return {
    id: row.id,
    reference: row.id,
    customerName: row.customer_name,
    service: row.product,
    productDescription: row.product_desc || row.product,
    quantity: row.size_breakdown || row.quantity,
    dueDate: row.due_date,
    owner: "Synthetic Owner",
    assignedStaff: row.assigned_user_id ? "Synthetic Staff" : "Not set",
    fulfillmentMethod: row.fulfillment_method,
    paymentStatus: "PAY AT SHOP PENDING",
    quotedAmount: row.quoted_amount,
    artworkStatus: row.artwork_status,
    artworkAvailable: true,
    nextAction: row.next_action,
    storedStage: row.production_stage,
    stage,
    stageLabel: stageLabel(stage),
    validNextStage: next,
    validNextStageLabel: next ? stageLabel(next) : "",
    stageActionLabel: actionLabel(stage, next),
    stageActionExplanation: next ? "Perform only the next valid production step." : "",
    productionNote: row.production_note || "",
    blockerReason: row.blocked_reason || "",
    productionUpdatedAt: row.production_updated_at,
    readiness: { ready, checks, missing: checks.filter((check) => !check.complete).map((check) => check.label) },
    activity: row.artwork_approved_at ? [{ label: "ARTWORK APPROVED", actor: "", createdAt: row.artwork_approved_at, note: "" }] : [],
    permissions: {
      canAssign: manager && mutable,
      canSetBlocker: manager && mutable && !row.blocked_reason,
      canClearBlocker: manager && mutable && Boolean(row.blocked_reason),
      canUpdateNote: mutable && (manager || assigned),
      canAdvance: Boolean(next && !row.blocked_reason && (manager || assigned) && (stage !== "queued" || ready)),
      isAssignedStaff: assigned,
      completedReadOnly: stage === "completed",
    },
  };
}

function orderDetail(row) {
  const readiness = productionDetail(row, "owner").readiness;
  return {
    id: row.id,
    reference: row.id,
    sourceInquiryReference: row.id,
    status: "won",
    statusLabel: "CONFIRMED ORDER",
    customerName: row.customer_name,
    company: "Synthetic QA",
    contact: "Synthetic contact",
    source: "QA",
    channel: "synthetic",
    createdAt: row.created_at,
    confirmedAt: null,
    nextAction: row.next_action,
    productDescription: row.product_desc,
    service: row.product,
    quantity: row.quantity,
    sizeBreakdown: row.size_breakdown,
    quotedAmount: row.quoted_amount,
    amountDue: row.quoted_amount,
    dueDate: row.due_date,
    fulfillmentMethod: row.fulfillment_method,
    owner: "Synthetic Owner",
    assignedStaff: row.assigned_user_id ? "Synthetic Staff" : "Not set",
    quoteStatus: row.quote_status,
    artworkStatus: row.artwork_status,
    artworkAvailable: true,
    paymentStatus: row.payment_status,
    productionStage: row.production_stage,
    productionNote: row.production_note,
    productionUpdatedAt: row.production_updated_at,
    blockerReason: row.blocked_reason || "",
    readiness,
    paymentEvents: [],
    activity: [],
  };
}

function jobRow(id, customerName, overrides = {}) {
  return {
    id,
    customer_name: customerName,
    company: "Synthetic QA",
    contact: "Synthetic contact",
    source: "QA",
    channel: "synthetic",
    product: "Screen Printing",
    product_desc: "Synthetic QA shirt",
    quantity: "12",
    size_breakdown: "",
    status: "won",
    next_action: "Prepare production handoff",
    due_date: "2026-08-10",
    fulfillment_method: "pickup",
    quoted_amount: 2400,
    quote_status: "approved",
    artwork_status: "approved",
    artwork_url: `${id}/synthetic-artwork.png`,
    artwork_approved_at: "2026-07-30T01:15:00Z",
    payment_status: "pay_at_shop",
    payment_type: "shop",
    owner_user_id: ownerId,
    assigned_user_id: staffId,
    assigned_staff: "Synthetic Staff",
    production_stage: "queued",
    production_note: "Synthetic production note",
    production_updated_at: "2026-07-30T03:00:00Z",
    blocked_reason: null,
    created_at: "2026-07-30T00:00:00Z",
    updated_at: "2026-07-30T03:00:00Z",
    ...overrides,
  };
}

function canonicalStage(value) {
  if (value === "qc_finishing") return "qc";
  if (value === "ready_for_fulfillment") return "ready";
  return value || "queued";
}

function nextStage(row) {
  const stage = canonicalStage(row.production_stage);
  if (stage === "queued") {
    const service = String(row.product || "").toLowerCase();
    if (service.includes("dtf")) return "printing";
    if (service.includes("embroider")) return "embroidery";
    if (service.includes("screen")) return "screen_printing";
    return "";
  }
  if (["printing", "embroidery", "screen_printing", "in_production"].includes(stage)) return "qc";
  if (stage === "qc") return "ready";
  if (stage === "ready") return "completed";
  return "";
}

function stageLabel(stage) {
  return {
    queued: "QUEUED",
    printing: "DTF PRINTING",
    embroidery: "EMBROIDERY",
    screen_printing: "SCREEN PRINTING",
    in_production: "IN PRODUCTION",
    qc: "QUALITY CHECK",
    ready: "READY",
    completed: "COMPLETED",
  }[stage] || "QUEUED";
}

function actionLabel(stage, next) {
  if (stage === "queued" && next === "printing") return "START DTF PRINTING";
  if (stage === "queued" && next === "embroidery") return "START EMBROIDERY";
  if (stage === "queued" && next === "screen_printing") return "START SCREEN PRINTING";
  if (["printing", "embroidery", "screen_printing", "in_production"].includes(stage)) return "MOVE TO QUALITY CHECK";
  if (stage === "qc") return "MARK READY";
  if (stage === "ready") return "COMPLETE JOB";
  return "";
}

function profile(userId, displayName, role) {
  return { id: `profile-${role}`, user_id: userId, display_name: displayName, role, is_active: true };
}

function roleForToken(authorization = "") {
  return Object.entries(tokens).find(([, token]) => authorization === `Bearer ${token}`)?.[0] || "";
}

function rowSelector(id) {
  return `.mvp-table-row[data-mvp-open="production"][data-mvp-id="${id}"]`;
}

function mobileSelector(id) {
  return `.mvp-production-mobile-card[data-mvp-id="${id}"]`;
}

function drawerHas(value) {
  return `document.querySelector('.mvp-production-detail-drawer')?.innerText.includes(${JSON.stringify(value)}) === true`;
}

function patchRequests() {
  return requests.filter((entry) => entry.method === "PATCH" && entry.path.startsWith("/api/production/"));
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
    const drawer = document.querySelector('.mvp-production-detail-drawer');
    const rect = drawer.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      width: rect.width,
      pageOverflow: document.scrollingElement.scrollWidth > innerWidth + 1,
      drawerOverflow: drawer.scrollWidth > drawer.clientWidth + 1,
    };
  })()`);
  assert.ok(geometry.width <= expectedMax + 1);
  if (viewportWidth === 390) assert.ok(Math.abs(geometry.width - viewportWidth) <= 1);
  assert.ok(geometry.left >= -1 && geometry.right <= viewportWidth + 1);
  assert.equal(geometry.pageOverflow, false);
  assert.equal(geometry.drawerOverflow, false);
}

async function captureQaScreenshot(cdp, page, name) {
  const outputDir = String(process.env.PRODUCTION_DRAWER_SCREENSHOT_DIR || "").trim();
  if (!outputDir) return;
  await mkdir(outputDir, { recursive: true });
  const { data } = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  }, page.sessionId);
  await writeFile(join(outputDir, `${name}.png`), Buffer.from(data, "base64"));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
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
  const session = {
    access_token: tokens[role],
    refresh_token: "",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: profiles[role].user_id, email: `synthetic-${role}.invalid` },
  };
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `localStorage.setItem("trry_admin_supabase_auth_session_v1", ${JSON.stringify(JSON.stringify(session))});`,
  }, page.sessionId);
}

async function navigate(cdp, page, target) {
  await cdp.send("Page.navigate", { url: target }, page.sessionId);
  await wait(900);
}

async function click(cdp, page, selector, idle = 450) {
  assert.equal(await evalValue(cdp, page, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    element.click();
    return true;
  })()`), true, `selector missing: ${selector}`);
  await wait(idle);
}

async function setValue(cdp, page, selector, value) {
  assert.equal(await evalValue(cdp, page, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    element.value = ${JSON.stringify(value)};
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`), true);
  await wait(350);
}

async function press(cdp, page, key) {
  const keyCode = key === "Escape" ? 27 : 9;
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key,
    code: key,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  }, page.sessionId);
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code: key,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  }, page.sessionId);
  await wait(350);
}

async function waitForSelector(cdp, page, selector, timeout = 8000) {
  return waitFor(cdp, page, `document.querySelector(${JSON.stringify(selector)}) !== null`, `selector ${selector}`, timeout);
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Browser evaluation failed.");
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
