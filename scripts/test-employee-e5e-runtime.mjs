import assert from "node:assert/strict";
import { execFileSync, execSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const runId = `e5e-${Date.now()}`;
const password = `Local-${runId}-Pass123!`;
const appPort = 8050 + Math.floor(Math.random() * 300);
const inquiryA = `E5E-A-${String(Date.now()).slice(-8)}`;
const inquiryB = `E5E-B-${String(Date.now()).slice(-8)}`;
const orderA = `TRRY-ORD-E5EA${String(Date.now()).slice(-4)}`;
const orderB = `TRRY-ORD-E5EB${String(Date.now()).slice(-4)}`;
const status = getLocalSupabaseStatus();

const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(status.API_URL, status.ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let server;
let identities = {};
let qaRows = [];
let cleanupRevokerId = "";

try {
  applyMigration("supabase/migrations/20260826031500_employee_e5d_orders_temp_access.sql");
  applyMigration("supabase/migrations/20260826062747_employee_e5e_production_temp_access.sql");
  verifySchemaAndPolicies();

  identities = await createQaIdentities();
  qaRows = Object.values(identities).map((item) => item.profile);
  cleanupRevokerId = identities.owner.profile.id;
  await seedProductionFixture(inquiryA, orderA, identities.productionStaff.profile.user_id);
  await seedProductionFixture(inquiryB, orderB, identities.staffB.profile.user_id);

  await seedGrant(identities.productionStaff.profile.id, "production", identities.owner.profile.id);
  await seedGrant(identities.ordersStaff.profile.id, "orders", identities.owner.profile.id);
  await seedGrant(identities.inquiriesStaff.profile.id, "inquiries", identities.owner.profile.id);
  await seedGrant(identities.calendarStaff.profile.id, "calendar", identities.owner.profile.id);
  await seedGrant(identities.workboardStaff.profile.id, "workboard", identities.owner.profile.id);
  await seedGrant(identities.catalogStaff.profile.id, "master_catalog", identities.owner.profile.id);
  await seedGrant(identities.inventoryStaff.profile.id, "inventory", identities.owner.profile.id);
  await seedGrant(identities.revokedStaff.profile.id, "production", identities.owner.profile.id, { revoked: true });
  await seedGrant(identities.expiredStaff.profile.id, "production", identities.owner.profile.id, { expired: true });

  server = await startLocalDevServer();

  const ownerSession = await signIn(identities.owner.email);
  const adminSession = await signIn(identities.admin.email);
  const noGrantSession = await signIn(identities.noGrantStaff.email);
  const productionSession = await signIn(identities.productionStaff.email);
  const staffBSession = await signIn(identities.staffB.email);
  const ordersSession = await signIn(identities.ordersStaff.email);
  const inquiriesSession = await signIn(identities.inquiriesStaff.email);
  const calendarSession = await signIn(identities.calendarStaff.email);
  const workboardSession = await signIn(identities.workboardStaff.email);
  const catalogSession = await signIn(identities.catalogStaff.email);
  const inventorySession = await signIn(identities.inventoryStaff.email);
  const revokedSession = await signIn(identities.revokedStaff.email);
  const expiredSession = await signIn(identities.expiredStaff.email);

  await expectEffective("", "production", 401, undefined, "Unauthenticated effective Production access must be blocked.");
  await expectEffective(ownerSession.access_token, "production", 200, { allowed: true, source: "permanent" }, "Owner Production access must remain permanent.");
  await expectEffective(adminSession.access_token, "production", 200, { allowed: true, source: "permanent" }, "Admin Production access must remain permanent.");
  await expectEffective(noGrantSession.access_token, "production", 200, { allowed: false, source: "none" }, "Staff without Production grant must be denied.");
  await expectEffective(productionSession.access_token, "production", 200, { allowed: true, source: "temporary" }, "Active Production grant must allow Staff module entry.");
  await expectEffective(ordersSession.access_token, "production", 200, { allowed: false, source: "none" }, "Orders grant must not unlock Production.");
  await expectEffective(inquiriesSession.access_token, "production", 200, { allowed: false, source: "none" }, "Inquiries grant must not unlock Production.");
  await expectEffective(calendarSession.access_token, "production", 200, { allowed: false, source: "none" }, "Calendar grant must not unlock Production.");
  await expectEffective(workboardSession.access_token, "production", 200, { allowed: false, source: "none" }, "Workboard grant must not unlock Production.");
  await expectEffective(catalogSession.access_token, "production", 200, { allowed: false, source: "none" }, "Master Catalog grant must not unlock Production.");
  await expectEffective(inventorySession.access_token, "production", 200, { allowed: false, source: "none" }, "Inventory grant must not unlock Production.");
  await expectEffective(revokedSession.access_token, "production", 200, { allowed: false, source: "none" }, "Revoked Production grant must be denied.");
  await expectEffective(expiredSession.access_token, "production", 200, { allowed: false, source: "none" }, "Expired Production grant must be denied.");
  await expectEffective(productionSession.access_token, "orders", 200, { allowed: false, source: "none" }, "Production grant must not unlock Orders module access.");

  const forged = await effectiveRequest(noGrantSession.access_token, "production", { "X-TRRY-Temp-Access": "production" });
  assert.equal(forged.status, 200, "Forged client Production state must not break authenticated API.");
  assert.equal(forged.body.access?.allowed, false, "Forged client Production state must be denied server-side.");

  await expectProductionRead(ownerSession.access_token, { a: true, b: true }, "Owner Production read must see both QA jobs.");
  await expectProductionRead(adminSession.access_token, { a: true, b: true }, "Admin Production read must see both QA jobs.");
  await expectProductionRead(noGrantSession.access_token, { a: false, b: false }, "No-grant Staff Production read must be denied.");
  await expectProductionRead(productionSession.access_token, { a: true, b: false }, "Production Staff must only see assigned job.");
  await expectProductionRead(staffBSession.access_token, { a: false, b: false }, "Staff B without grant must not see assigned job.");
  await expectProductionRead(ordersSession.access_token, { a: false, b: false }, "Orders grant must not read Production jobs.");
  await expectProductionRead(revokedSession.access_token, { a: false, b: false }, "Revoked Production grant must not read Production jobs.");
  await expectProductionRead(expiredSession.access_token, { a: false, b: false }, "Expired Production grant must not read Production jobs.");
  await expectLinkedOrderRead(productionSession.access_token, { a: true, b: false }, "Production Staff may read only linked assigned Production order.");

  const start = await workflowAction(productionSession.access_token, inquiryA, { action: "start_production" });
  assert.equal(start.status, 200, "Temporary Production Staff must retain assigned start action.");
  let afterStart = await readInquirySnapshot(inquiryA);
  assert.equal(afterStart.production_stage, "printing", "Assigned Production start must move queued job to station.");
  assert.ok(afterStart.production_started_at, "Assigned Production start must persist start timestamp.");

  const note = await workflowAction(productionSession.access_token, inquiryA, { action: "save_production", productionNote: "E5E assigned staff production note." });
  assert.equal(note.status, 200, "Temporary Production Staff must save own production note.");
  afterStart = await readInquirySnapshot(inquiryA);
  assert.equal(afterStart.production_note, "E5E assigned staff production note.", "Assigned Production note must persist.");

  await expectDeniedNoChange("Staff A direct access to Staff B job", inquiryB, () => workflowAction(productionSession.access_token, inquiryB, { action: "start_production" }), [403, 404]);
  await expectDeniedNoChange("Direct ops_inquiries UPDATE", inquiryA, () => directInquiryUpdate(productionSession.access_token, inquiryA, { production_note: "direct forbidden" }));
  await expectDeniedNoChange("Direct Orders UPDATE", inquiryA, () => directOrderUpdate(productionSession.access_token, inquiryA, { status: "released" }));
  await expectDeniedNoChange("Manager reassignment", inquiryA, () => workflowAction(productionSession.access_token, inquiryA, { action: "save_production", assignedUserId: identities.staffB.profile.user_id }));
  await expectDeniedNoChange("Release to Production", inquiryA, () => workflowAction(productionSession.access_token, inquiryA, { action: "release_production" }));
  await expectDeniedNoChange("Unauthorized QC advance", inquiryA, () => workflowAction(productionSession.access_token, inquiryA, { action: "advance_production", productionStage: "qc" }));
  await expectDeniedNoChange("Unauthorized completion", inquiryA, () => workflowAction(productionSession.access_token, inquiryA, { action: "advance_production", productionStage: "completed" }));
  await expectDeniedNoChange("Fulfillment mutation", inquiryA, () => customerAction(productionSession.access_token, inquiryA));
  await expectDeniedNoChange("Payment mutation", inquiryA, () => paymentConfirmation(productionSession.access_token, inquiryA));
  await expectDeniedNoChange("Assignment API mutation", inquiryA, () => assignmentAction(productionSession.access_token, inquiryA));

  assert.equal(await readAdminRole(identities.productionStaff.profile.id), "staff", "Staff role must remain staff after Production grant.");

  await revokeAllActiveQaGrants(identities.owner.profile.id);
  assert.equal(await readActiveQaGrantCount(), 0, "No active E5E QA grants should remain after cleanup.");
  await expectEffective(productionSession.access_token, "production", 200, { allowed: false, source: "none" }, "Revoked active Production grant must deny effective access.");
  await expectProductionRead(productionSession.access_token, { a: false, b: false }, "Revoked active Production grant must deny subsequent Production read.");
  assert.equal(await readAdminRole(identities.productionStaff.profile.id), "staff", "Staff role must remain staff after revoke.");

  console.log("PASS: Employee E5E local runtime verification");
  console.log(`EVIDENCE: production module gate ok; assigned Staff read/start/note ok; Staff B job hidden; reassignment/release/QC/completion/fulfillment/payment/orders mutations denied with before=after; owner/admin reads preserved; qaRun=${runId}`);
} finally {
  if (qaRows.length && cleanupRevokerId) await revokeAllActiveQaGrants(cleanupRevokerId).catch(() => {});
  await cleanupFixture().catch(() => {});
  if (server) server.kill();
}

function getLocalSupabaseStatus() {
  const output = execSync("npx --yes supabase status -o json", { encoding: "utf8" });
  const jsonStart = output.indexOf("{");
  if (jsonStart < 0) throw new Error("Unable to read local Supabase status JSON.");
  return JSON.parse(output.slice(jsonStart));
}

function applyMigration(path) {
  const sql = readFileSync(path, "utf8");
  execFileSync("docker", ["exec", "-i", "supabase_db_Admin_portal", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { input: sql });
}

function verifySchemaAndPolicies() {
  assert.equal(sqlValue("select exists (select 1 from information_schema.tables where table_schema='public' and table_name='employee_temporary_access_grants')"), "t", "Temporary access table must exist.");
  assert.equal(sqlValue("select exists (select 1 from information_schema.tables where table_schema='public' and table_name='ops_inquiries')"), "t", "Ops inquiries table must exist.");
  assert.equal(sqlValue("select exists (select 1 from information_schema.tables where table_schema='public' and table_name='orders')"), "t", "Orders table must exist.");
  assert.equal(sqlValue("select count(*) from pg_policies where schemaname='public' and tablename='ops_inquiries' and policyname='Owners admins temp inquiries and assigned production can read ops inquiries' and qual like '%production%' and qual like '%assigned_user_id%'"), "1", "Production read policy must be assigned scoped.");
  assert.equal(sqlValue("select count(*) from pg_policies where schemaname='public' and tablename='ops_inquiries' and cmd='UPDATE' and with_check like '%production%'"), "0", "Production grant must not create ops_inquiries update policy.");
  assert.equal(sqlValue("select count(*) from pg_policies where schemaname='public' and tablename='orders' and policyname='Active owners and admins can update orders' and with_check like '%owner%' and with_check like '%admin%'"), "1", "Orders update policy must remain Owner/Admin only.");
}

async function createQaIdentities() {
  const specs = {
    owner: ["owner", true],
    admin: ["admin", true],
    noGrantStaff: ["staff", true],
    productionStaff: ["staff", true],
    staffB: ["staff", true],
    ordersStaff: ["staff", true],
    inquiriesStaff: ["staff", true],
    calendarStaff: ["staff", true],
    workboardStaff: ["staff", true],
    catalogStaff: ["staff", true],
    inventoryStaff: ["staff", true],
    revokedStaff: ["staff", true],
    expiredStaff: ["staff", true],
  };
  const result = {};
  for (const [key, [role, active]] of Object.entries(specs)) {
    const email = `${runId}-${key}@local.test`;
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: `E5E ${key}`, trry_admin_role: role },
    });
    assert.ifError(createError);
    const { data: profile, error: profileError } = await service
      .from("admin_users")
      .insert({
        user_id: created.user.id,
        email,
        display_name: `E5E ${key}`,
        role,
        is_active: active,
      })
      .select("id,user_id,email,role,is_active")
      .single();
    assert.ifError(profileError);
    result[key] = { email, authUser: created.user, profile };
  }
  return result;
}

async function seedProductionFixture(inquiryId, orderReference, assignedUserId) {
  const now = Date.now();
  const quoteApprovedAt = new Date(now - 60_000).toISOString();
  const dueDate = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const inquiry = {
    id: inquiryId,
    customer_name: `E5E Customer ${inquiryId}`,
    contact: `${inquiryId.toLowerCase()}@example.test`,
    company: `E5E Company ${runId}`,
    source: "LOCAL_QA",
    product: "DTF",
    product_desc: "Harmless local E5E production record",
    quantity: "24 pcs",
    priority: "normal",
    status: "won",
    next_action: "Production QA",
    due_date: dueDate,
    owner_id: "E5E Owner",
    owner_user_id: identities.owner.profile.user_id,
    assigned_staff: `E5E Staff ${assignedUserId.slice(0, 6)}`,
    assigned_user_id: assignedUserId,
    quoted_amount: 2400,
    amount_due: 0,
    quote_status: "approved",
    quote_approved_at: quoteApprovedAt,
    artwork_status: "approved",
    artwork_approved_at: quoteApprovedAt,
    payment_status: "paid",
    payment_verified_amount: 2400,
    payment_confirmed_amount: 2400,
    payment_confirmed_at: quoteApprovedAt,
    payment_history: [],
    production_stage: "queued",
    production_updated_at: quoteApprovedAt,
    fulfillment_method: "delivery",
  };
  const { error: inquiryError } = await service.from("ops_inquiries").insert(inquiry);
  assert.ifError(inquiryError);

  const { error: orderError } = await service.from("orders").insert({
    order_reference: orderReference,
    source_inquiry_id: inquiryId,
    status: "released",
    quoted_amount: 2400,
    amount_due: 0,
    quote_breakdown: "E5E local QA only",
    quote_note: "initial",
    quote_valid_until: new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    quote_approved_at: quoteApprovedAt,
    customer_name: inquiry.customer_name,
    customer_contact: inquiry.contact,
    product: inquiry.product,
    product_desc: inquiry.product_desc,
    quantity: inquiry.quantity,
    fulfillment_method: inquiry.fulfillment_method,
    due_date: dueDate,
  });
  assert.ifError(orderError);
}

async function seedGrant(employeeId, moduleCode, grantedBy, { revoked = false, expired = false } = {}) {
  const now = Date.now();
  const startsAt = new Date(now - (expired ? 48 : 1) * 60 * 60 * 1000).toISOString();
  const expiresAt = new Date(now + (expired ? -24 : 8) * 60 * 60 * 1000).toISOString();
  const { error } = await service.from("employee_temporary_access_grants").insert({
    employee_id: employeeId,
    module_code: moduleCode,
    granted_by: grantedBy,
    starts_at: startsAt,
    expires_at: expiresAt,
    reason: `E5E runtime ${moduleCode} ${runId}`,
    revoked_at: revoked ? new Date(now - 10 * 60 * 1000).toISOString() : null,
    revoked_by: revoked ? grantedBy : null,
  });
  assert.ifError(error);
}

async function signIn(email) {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  assert.ifError(error);
  return data.session;
}

function createUserClient(accessToken) {
  return createClient(status.API_URL, status.ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

async function startLocalDevServer() {
  const child = spawn(process.platform === "win32" ? "node.exe" : "node", ["scripts/local-dev.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(appPort),
      SUPABASE_URL: status.API_URL,
      VITE_SUPABASE_URL: status.API_URL,
      VITE_SUPABASE_ANON_KEY: status.ANON_KEY,
      VITE_USE_SUPABASE_DATA: "true",
      VITE_ENABLE_TASK_DOMAIN: "true",
      VITE_ENABLE_WORKBOARD: "true",
      VITE_ENABLE_CALENDAR: "true",
      SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk.toString(); });
  child.stderr.on("data", (chunk) => { logs += chunk.toString(); });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${appPort}/src/env.js`);
      if (response.ok) return child;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (child.exitCode !== null) throw new Error(`local dev server exited early: ${logs}`);
  }
  child.kill();
  throw new Error(`Timed out waiting for local dev server: ${logs}`);
}

async function expectEffective(token, moduleCode, statusCode, expected, message) {
  const response = await effectiveRequest(token, moduleCode);
  assert.equal(response.status, statusCode, message);
  if (expected) {
    assert.equal(response.body.access?.allowed, expected.allowed, message);
    assert.equal(response.body.access?.source, expected.source, message);
    assert.equal(response.body.access?.module, moduleCode, message);
  }
}

async function effectiveRequest(token, moduleCode, extraHeaders = {}) {
  const response = await fetch(`http://127.0.0.1:${appPort}/api/admin-users/effective-access?module=${encodeURIComponent(moduleCode)}`, {
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function expectProductionRead(token, expected, message) {
  const { data, error } = await createUserClient(token)
    .from("ops_inquiries")
    .select("id,assigned_user_id,production_stage,production_started_at,production_note")
    .in("id", [inquiryA, inquiryB])
    .order("id");
  assert.equal(error, null, message);
  const ids = new Set((data || []).map((row) => row.id));
  assert.equal(ids.has(inquiryA), expected.a, `${message} Staff A job visibility`);
  assert.equal(ids.has(inquiryB), expected.b, `${message} Staff B job visibility`);
}

async function expectLinkedOrderRead(token, expected, message) {
  const { data, error } = await createUserClient(token)
    .from("orders")
    .select("order_reference,source_inquiry_id,status")
    .in("source_inquiry_id", [inquiryA, inquiryB])
    .order("source_inquiry_id");
  assert.equal(error, null, message);
  const ids = new Set((data || []).map((row) => row.source_inquiry_id));
  assert.equal(ids.has(inquiryA), expected.a, `${message} Staff A linked order visibility`);
  assert.equal(ids.has(inquiryB), expected.b, `${message} Staff B linked order visibility`);
}

async function workflowAction(token, inquiryId, body) {
  const response = await fetch(`http://127.0.0.1:${appPort}/api/inquiries/${encodeURIComponent(inquiryId)}/workflow`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})), denied: response.status >= 400 };
}

async function paymentConfirmation(token, inquiryId) {
  const response = await fetch(`http://127.0.0.1:${appPort}/api/inquiries/${encodeURIComponent(inquiryId)}/payment-confirmations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amountReceived: 1, paymentSource: "cash", idempotencyKey: `e5e-pay-${Date.now()}` }),
  });
  return { status: response.status, denied: response.status === 403 };
}

async function customerAction(token, inquiryId) {
  const response = await fetch(`http://127.0.0.1:${appPort}/api/inquiries/${encodeURIComponent(inquiryId)}/customer-actions`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "mark_ready_for_pickup" }),
  });
  return { status: response.status, denied: response.status === 403 };
}

async function assignmentAction(token, inquiryId) {
  const response = await fetch(`http://127.0.0.1:${appPort}/api/inquiries/${encodeURIComponent(inquiryId)}/assignment`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ownerUserId: identities.admin.profile.user_id }),
  });
  return { status: response.status, denied: response.status === 403 };
}

async function directOrderUpdate(token, inquiryId, patch) {
  const { data, error } = await createUserClient(token)
    .from("orders")
    .update(patch)
    .eq("source_inquiry_id", inquiryId)
    .select("id");
  return { denied: Boolean(error) || (data || []).length === 0 };
}

async function directInquiryUpdate(token, inquiryId, patch) {
  const { data, error } = await createUserClient(token)
    .from("ops_inquiries")
    .update(patch)
    .eq("id", inquiryId)
    .select("id");
  return { denied: Boolean(error) || (data || []).length === 0 };
}

async function expectDeniedNoChange(label, inquiryId, action, allowedStatuses = [403]) {
  const before = await readIntegritySnapshot(inquiryId);
  const result = await action();
  assert.ok(result.denied, `${label} must be denied.`);
  if (result.status) assert.ok(allowedStatuses.includes(result.status), `${label} returned unexpected status ${result.status}.`);
  const after = await readIntegritySnapshot(inquiryId);
  assert.deepEqual(after, before, `${label} must not partially mutate Production, Order, payment, fulfillment, assignment, QC, or completion data.`);
}

async function readIntegritySnapshot(inquiryId) {
  const { data: order, error: orderError } = await service
    .from("orders")
    .select("order_reference,source_inquiry_id,status,quoted_amount,amount_due,quote_note,fulfillment_method,updated_at")
    .eq("source_inquiry_id", inquiryId)
    .single();
  assert.ifError(orderError);
  const { data: inquiry, error: inquiryError } = await service
    .from("ops_inquiries")
    .select("id,status,quoted_amount,amount_due,payment_status,payment_confirmed_amount,payment_verified_amount,payment_confirmed_at,payment_confirmed_by,production_stage,production_started_at,production_started_by,production_note,tracking_substatus,assigned_staff,assigned_user_id,blocked_reason,qc_started_at,qc_started_by,qc_note,qc_completed_at,qc_completed_by,production_completed_at,production_completed_by,updated_at")
    .eq("id", inquiryId)
    .single();
  assert.ifError(inquiryError);
  return { order: normalizeSnapshot(order), inquiry: normalizeSnapshot(inquiry) };
}

async function readInquirySnapshot(inquiryId) {
  const { data, error } = await service
    .from("ops_inquiries")
    .select("production_stage,production_started_at,production_note")
    .eq("id", inquiryId)
    .single();
  assert.ifError(error);
  return data;
}

function normalizeSnapshot(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === undefined ? null : value]));
}

async function readAdminRole(id) {
  const { data, error } = await service.from("admin_users").select("role").eq("id", id).single();
  assert.ifError(error);
  return data.role;
}

async function revokeAllActiveQaGrants(revokerId) {
  const ids = qaRows.map((row) => row.id);
  if (!ids.length) return;
  const { error } = await service
    .from("employee_temporary_access_grants")
    .update({ revoked_at: new Date().toISOString(), revoked_by: revokerId })
    .in("employee_id", ids)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());
  assert.ifError(error);
}

async function readActiveQaGrantCount() {
  const ids = qaRows.map((row) => row.id);
  if (!ids.length) return 0;
  const { count, error } = await service
    .from("employee_temporary_access_grants")
    .select("id", { count: "exact", head: true })
    .in("employee_id", ids)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());
  assert.ifError(error);
  return count || 0;
}

async function cleanupFixture() {
  await service.from("orders").delete().in("source_inquiry_id", [inquiryA, inquiryB]);
  await service.from("ops_inquiries").delete().in("id", [inquiryA, inquiryB]);
}

function sqlValue(sql) {
  return execFileSync("docker", ["exec", "supabase_db_Admin_portal", "psql", "-U", "postgres", "-d", "postgres", "-tAc", sql], { encoding: "utf8" }).trim();
}
