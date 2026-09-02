import assert from "node:assert/strict";
import { execFileSync, execSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const runId = `e5d-${Date.now()}`;
const password = `Local-${runId}-Pass123!`;
const appPort = 7750 + Math.floor(Math.random() * 300);
const inquiryId = `E5D-${String(Date.now()).slice(-8)}`;
const orderReference = `TRRY-ORD-${String(Date.now()).slice(-8).padStart(8, "0")}`;
const status = getLocalSupabaseStatus();

globalThis.window = {
  TRRY_ADMIN_ENV: {
    VITE_SUPABASE_URL: status.API_URL,
    VITE_SUPABASE_ANON_KEY: status.ANON_KEY,
    VITE_USE_SUPABASE_DATA: "true",
  },
};

const { getNativeOrderRows } = await import("../src/services/orderCompatibility.js");
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
  applyE5dMigration();
  verifySchemaAndPolicies();
  identities = await createQaIdentities();
  qaRows = Object.values(identities).map((item) => item.profile);
  cleanupRevokerId = identities.owner.profile.id;
  await seedOrderFixture();

  await seedGrant(identities.ordersStaff.profile.id, "orders", identities.owner.profile.id);
  await seedGrant(identities.inquiriesStaff.profile.id, "inquiries", identities.owner.profile.id);
  await seedGrant(identities.calendarStaff.profile.id, "calendar", identities.owner.profile.id);
  await seedGrant(identities.workboardStaff.profile.id, "workboard", identities.owner.profile.id);
  await seedGrant(identities.catalogStaff.profile.id, "master_catalog", identities.owner.profile.id);
  await seedGrant(identities.revokedStaff.profile.id, "orders", identities.owner.profile.id, { revoked: true });
  await seedGrant(identities.expiredStaff.profile.id, "orders", identities.owner.profile.id, { expired: true });

  server = await startLocalDevServer();

  const ownerSession = await signIn(identities.owner.email);
  const adminSession = await signIn(identities.admin.email);
  const noGrantSession = await signIn(identities.noGrantStaff.email);
  const ordersSession = await signIn(identities.ordersStaff.email);
  const inquiriesSession = await signIn(identities.inquiriesStaff.email);
  const calendarSession = await signIn(identities.calendarStaff.email);
  const workboardSession = await signIn(identities.workboardStaff.email);
  const catalogSession = await signIn(identities.catalogStaff.email);
  const revokedSession = await signIn(identities.revokedStaff.email);
  const expiredSession = await signIn(identities.expiredStaff.email);

  await expectEffective("", "orders", 401, undefined, "Unauthenticated effective Orders access must be blocked.");
  await expectEffective(ownerSession.access_token, "orders", 200, { allowed: true, source: "permanent" }, "Owner permanent Orders access must remain allowed.");
  await expectEffective(adminSession.access_token, "orders", 200, { allowed: true, source: "permanent" }, "Admin permanent Orders access must remain allowed.");
  await expectEffective(noGrantSession.access_token, "orders", 200, { allowed: false, source: "none" }, "Staff without Orders grant must be denied.");
  await expectEffective(ordersSession.access_token, "orders", 200, { allowed: true, source: "temporary" }, "Active Orders grant must allow Staff read.");
  await expectEffective(inquiriesSession.access_token, "orders", 200, { allowed: false, source: "none" }, "Inquiries-only grant must not unlock Orders.");
  await expectEffective(calendarSession.access_token, "orders", 200, { allowed: false, source: "none" }, "Calendar-only grant must not unlock Orders.");
  await expectEffective(workboardSession.access_token, "orders", 200, { allowed: false, source: "none" }, "Workboard-only grant must not unlock Orders.");
  await expectEffective(catalogSession.access_token, "orders", 200, { allowed: false, source: "none" }, "Master Catalog-only grant must not unlock Orders.");
  await expectEffective(revokedSession.access_token, "orders", 200, { allowed: false, source: "none" }, "Revoked Orders grant must be denied.");
  await expectEffective(expiredSession.access_token, "orders", 200, { allowed: false, source: "none" }, "Expired Orders grant must be denied.");

  const forged = await effectiveRequest(noGrantSession.access_token, "orders", { "X-TRRY-Temp-Access": "orders" });
  assert.equal(forged.status, 200, "Forged client Orders state must not break authenticated API.");
  assert.equal(forged.body.access?.allowed, false, "Forged client Orders state must be denied server-side.");

  await expectOrderRead(ownerSession.access_token, true, "Owner Orders read must be preserved.");
  await expectOrderRead(adminSession.access_token, true, "Admin Orders read must be preserved.");
  await expectOrderRead(noGrantSession.access_token, false, "No-grant Staff direct Orders read must be denied by RLS.");
  await expectOrderRead(ordersSession.access_token, true, "Temporary Orders Staff direct Orders read must be allowed.");
  await expectOrderRead(inquiriesSession.access_token, false, "Wrong-module Staff direct Orders read must be denied.");
  await expectOrderRead(revokedSession.access_token, false, "Revoked Orders grant must deny direct Orders read.");
  await expectOrderRead(expiredSession.access_token, false, "Expired Orders grant must deny direct Orders read.");

  const appRead = await getNativeOrderRows(ordersSession);
  assert.equal(appRead.error, null, "Temporary Orders Staff app read must not return an error.");
  assert.ok(appRead.rows.some((row) => row.order_reference === orderReference), "Temporary Orders Staff app read must include the QA native Order.");

  await expectOwnerAdminWrite(ownerSession.access_token, "Owner legitimate Orders write must be preserved.");
  await expectOwnerAdminWrite(adminSession.access_token, "Admin legitimate Orders write must be preserved.");

  await expectDeniedNoChange("Staff direct Orders UPDATE", () => directOrderUpdate(ordersSession.access_token, { quote_note: "forbidden staff note" }));
  await expectDeniedNoChange("Confirm Payment", () => paymentConfirmation(ordersSession.access_token));
  await expectDeniedNoChange("Release to Production", () => workflowAction(ordersSession.access_token, { action: "release_production" }));
  await expectDeniedNoChange("Fulfillment mutation", () => directInquiryUpdate(ordersSession.access_token, { tracking_substatus: "ready_for_pickup" }));
  await expectDeniedNoChange("Assignment mutation", () => assignmentAction(ordersSession.access_token));
  await expectDeniedNoChange("Destructive/status mutation", () => directOrderUpdate(ordersSession.access_token, { status: "released" }));
  await expectDeniedNoChange("Create Order", () => createOrderFromInquiry(ordersSession.access_token));
  await expectDeniedNoChange("Pricing/discount mutation", () => directInquiryUpdate(ordersSession.access_token, { quoted_amount: 1, amount_due: 1 }));

  assert.equal(await readAdminRole(identities.ordersStaff.profile.id), "staff", "Staff role must remain staff after Orders grant.");

  await revokeAllActiveQaGrants(identities.owner.profile.id);
  assert.equal(await readActiveQaGrantCount(), 0, "No active E5D QA grants should remain after cleanup.");
  await expectEffective(ordersSession.access_token, "orders", 200, { allowed: false, source: "none" }, "Revoked active Orders grant must deny effective access.");
  await expectOrderRead(ordersSession.access_token, false, "Revoked active Orders grant must deny subsequent direct Orders read.");
  assert.equal(await readAdminRole(identities.ordersStaff.profile.id), "staff", "Staff role must remain staff after revoke.");

  console.log("PASS: Employee E5D local runtime verification");
  console.log(`EVIDENCE: orders module gate ok; temp Staff read-only verified; direct Orders UPDATE denied; payment/release/fulfillment/assignment/status/create/pricing mutations denied with before=after; owner/admin reads+writes preserved; qaRun=${runId}`);
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

function applyE5dMigration() {
  const sql = readFileSync("supabase/migrations/20260826031500_employee_e5d_orders_temp_access.sql", "utf8");
  execFileSync("docker", ["exec", "-i", "supabase_db_Admin_portal", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { input: sql });
}

function verifySchemaAndPolicies() {
  assert.equal(sqlValue("select exists (select 1 from information_schema.tables where table_schema='public' and table_name='employee_temporary_access_grants')"), "t", "Temporary access table must exist.");
  assert.equal(sqlValue("select exists (select 1 from information_schema.tables where table_schema='public' and table_name='orders')"), "t", "Orders table must exist.");
  assert.equal(sqlValue("select exists (select 1 from information_schema.tables where table_schema='public' and table_name='ops_inquiries')"), "t", "Ops inquiries table must exist.");
  assert.equal(sqlValue("select exists (select 1 from pg_proc where proname='has_active_employee_temporary_access')"), "t", "Temporary access RLS helper must exist locally.");
  assert.equal(sqlValue("select count(*) from pg_policies where schemaname='public' and tablename='orders' and policyname='Active owners and admins can update orders' and with_check like '%owner%' and with_check like '%admin%'"), "1", "Orders update policy must be Owner/Admin only.");
  assert.equal(sqlValue("select count(*) from pg_policies where schemaname='public' and tablename='orders' and policyname like '%staff%update%'"), "0", "Broad Staff Orders update policy must be removed.");
}

async function createQaIdentities() {
  const specs = {
    owner: ["owner", true],
    admin: ["admin", true],
    noGrantStaff: ["staff", true],
    ordersStaff: ["staff", true],
    inquiriesStaff: ["staff", true],
    calendarStaff: ["staff", true],
    workboardStaff: ["staff", true],
    catalogStaff: ["staff", true],
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
      user_metadata: { display_name: `E5D ${key}`, trry_admin_role: role },
    });
    assert.ifError(createError);
    const { data: profile, error: profileError } = await service
      .from("admin_users")
      .insert({
        user_id: created.user.id,
        email,
        display_name: `E5D ${key}`,
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

async function seedOrderFixture() {
  const quoteApprovedAt = new Date(Date.now() - 60_000).toISOString();
  const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const inquiry = {
    id: inquiryId,
    customer_name: `E5D Customer ${runId}`,
    contact: "e5d-customer@example.test",
    company: `E5D Company ${runId}`,
    source: "LOCAL_QA",
    product: "Orders QA",
    product_desc: "Harmless local E5D order record",
    quantity: "24 pcs",
    priority: "normal",
    status: "won",
    next_action: "Read-only orders validation",
    due_date: dueDate,
    owner_id: "E5D Owner",
    owner_user_id: identities.owner.profile.user_id,
    assigned_staff: "E5D Staff",
    assigned_user_id: identities.ordersStaff.profile.user_id,
    quoted_amount: 2400,
    amount_due: 2400,
    quote_status: "approved",
    quote_approved_at: quoteApprovedAt,
    artwork_status: "approved",
    payment_status: "required",
    payment_method: "online",
    payment_type: "full",
    payment_selected_amount: 2400,
    payment_history: [],
    production_stage: "queued",
    fulfillment_method: "delivery",
  };
  const { error: inquiryError } = await service.from("ops_inquiries").insert(inquiry);
  assert.ifError(inquiryError);

  const { error: orderError } = await service.from("orders").insert({
    order_reference: orderReference,
    source_inquiry_id: inquiryId,
    status: "awaiting_payment",
    quoted_amount: 2400,
    amount_due: 2400,
    quote_breakdown: "E5D local QA only",
    quote_note: "initial",
    quote_valid_until: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
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
    reason: `E5D runtime ${moduleCode} ${runId}`,
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

async function expectOrderRead(token, shouldSee, message) {
  const { data, error } = await createUserClient(token)
    .from("orders")
    .select("id,order_reference,source_inquiry_id,status,quote_note")
    .eq("source_inquiry_id", inquiryId);
  assert.equal(error, null, message);
  assert.equal((data || []).some((row) => row.order_reference === orderReference), shouldSee, message);
}

async function expectOwnerAdminWrite(token, message) {
  const note = `owner-admin-write-${Date.now()}`;
  const { data, error } = await createUserClient(token)
    .from("orders")
    .update({ quote_note: note })
    .eq("source_inquiry_id", inquiryId)
    .select("quote_note");
  assert.equal(error, null, message);
  assert.equal(data?.[0]?.quote_note, note, message);
}

async function expectDeniedNoChange(label, action) {
  const before = await readIntegritySnapshot();
  const result = await action();
  assert.ok(result.denied, `${label} must be denied.`);
  const after = await readIntegritySnapshot();
  assert.deepEqual(after, before, `${label} must not partially mutate order or inquiry data.`);
}

async function directOrderUpdate(token, patch) {
  const { data, error } = await createUserClient(token)
    .from("orders")
    .update(patch)
    .eq("source_inquiry_id", inquiryId)
    .select("id");
  return { denied: Boolean(error) || (data || []).length === 0 };
}

async function directInquiryUpdate(token, patch) {
  const { data, error } = await createUserClient(token)
    .from("ops_inquiries")
    .update(patch)
    .eq("id", inquiryId)
    .select("id");
  return { denied: Boolean(error) || (data || []).length === 0 };
}

async function paymentConfirmation(token) {
  const response = await fetch(`http://127.0.0.1:${appPort}/api/inquiries/${encodeURIComponent(inquiryId)}/payment-confirmations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amountReceived: 2400, paymentSource: "cash", idempotencyKey: `e5d-pay-${Date.now()}` }),
  });
  return { denied: response.status === 403 };
}

async function workflowAction(token, body) {
  const response = await fetch(`http://127.0.0.1:${appPort}/api/inquiries/${encodeURIComponent(inquiryId)}/workflow`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { denied: response.status === 403 };
}

async function assignmentAction(token) {
  const response = await fetch(`http://127.0.0.1:${appPort}/api/inquiries/${encodeURIComponent(inquiryId)}/assignment`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ assignedUserId: identities.admin.profile.user_id }),
  });
  return { denied: response.status === 403 };
}

async function createOrderFromInquiry(token) {
  const response = await fetch(`http://127.0.0.1:${appPort}/api/inquiries/${encodeURIComponent(inquiryId)}/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  return { denied: response.status === 403 };
}

async function readIntegritySnapshot() {
  const { data: order, error: orderError } = await service
    .from("orders")
    .select("order_reference,source_inquiry_id,status,quoted_amount,amount_due,quote_note,fulfillment_method,updated_at")
    .eq("source_inquiry_id", inquiryId)
    .single();
  assert.ifError(orderError);
  const { data: inquiry, error: inquiryError } = await service
    .from("ops_inquiries")
    .select("id,status,quoted_amount,amount_due,payment_status,payment_confirmed_amount,payment_verified_amount,payment_confirmed_at,payment_confirmed_by,production_stage,production_started_at,tracking_substatus,assigned_staff,assigned_user_id,blocked_reason,updated_at")
    .eq("id", inquiryId)
    .single();
  assert.ifError(inquiryError);
  return { order: normalizeSnapshot(order), inquiry: normalizeSnapshot(inquiry) };
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
  await service.from("orders").delete().eq("source_inquiry_id", inquiryId);
  await service.from("ops_inquiries").delete().eq("id", inquiryId);
}

function sqlValue(sql) {
  return execFileSync("docker", ["exec", "supabase_db_Admin_portal", "psql", "-U", "postgres", "-d", "postgres", "-tAc", sql], { encoding: "utf8" }).trim();
}
