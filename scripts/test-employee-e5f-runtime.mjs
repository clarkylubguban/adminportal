import assert from "node:assert/strict";
import { execFileSync, execSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const runId = `e5f-${Date.now()}`;
const password = `Local-${runId}-Pass123!`;
const appPort = 8350 + Math.floor(Math.random() * 300);
const inquiryA = `E5F-A-${String(Date.now()).slice(-8)}`;
const inquiryB = `E5F-B-${String(Date.now()).slice(-8)}`;
const artworkPathA = `${inquiryA}/customer-art.png`;
const artworkPathB = `${inquiryB}/customer-art.png`;
const proofPathA = `${inquiryA}/proofs/final-proof.png`;
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
  applyMigration("supabase/migrations/20260827011526_employee_e5f_design_artwork_temp_access.sql");
  verifySchemaAndPolicies();

  identities = await createQaIdentities();
  qaRows = Object.values(identities).map((item) => item.profile);
  cleanupRevokerId = identities.owner.profile.id;
  await seedArtworkFixture(inquiryA, identities.designStaff.profile.user_id, artworkPathA);
  await seedArtworkFixture(inquiryB, identities.staffB.profile.user_id, artworkPathB);
  await seedStorageObject(artworkPathA);
  await seedStorageObject(artworkPathB);
  await seedStorageObject(proofPathA);

  await seedGrant(identities.designStaff.profile.id, "design_artwork", identities.owner.profile.id);
  await seedGrant(identities.inquiriesStaff.profile.id, "inquiries", identities.owner.profile.id);
  await seedGrant(identities.ordersStaff.profile.id, "orders", identities.owner.profile.id);
  await seedGrant(identities.productionStaff.profile.id, "production", identities.owner.profile.id);
  await seedGrant(identities.calendarStaff.profile.id, "calendar", identities.owner.profile.id);
  await seedGrant(identities.workboardStaff.profile.id, "workboard", identities.owner.profile.id);
  await seedGrant(identities.catalogStaff.profile.id, "master_catalog", identities.owner.profile.id);
  await seedGrant(identities.revokedStaff.profile.id, "design_artwork", identities.owner.profile.id, { revoked: true });
  await seedGrant(identities.expiredStaff.profile.id, "design_artwork", identities.owner.profile.id, { expired: true });

  server = await startLocalDevServer();

  const ownerSession = await signIn(identities.owner.email);
  const adminSession = await signIn(identities.admin.email);
  const noGrantSession = await signIn(identities.noGrantStaff.email);
  const designSession = await signIn(identities.designStaff.email);
  const staffBSession = await signIn(identities.staffB.email);
  const inquiriesSession = await signIn(identities.inquiriesStaff.email);
  const ordersSession = await signIn(identities.ordersStaff.email);
  const productionSession = await signIn(identities.productionStaff.email);
  const calendarSession = await signIn(identities.calendarStaff.email);
  const workboardSession = await signIn(identities.workboardStaff.email);
  const catalogSession = await signIn(identities.catalogStaff.email);
  const revokedSession = await signIn(identities.revokedStaff.email);
  const expiredSession = await signIn(identities.expiredStaff.email);

  await expectEffective("", "design_artwork", 401, undefined, "Unauthenticated effective Design & Artwork access must be blocked.");
  await expectEffective(ownerSession.access_token, "design_artwork", 200, { allowed: true, source: "permanent" }, "Owner Design & Artwork access must remain permanent.");
  await expectEffective(adminSession.access_token, "design_artwork", 200, { allowed: true, source: "permanent" }, "Admin Design & Artwork access must remain permanent.");
  await expectEffective(noGrantSession.access_token, "design_artwork", 200, { allowed: false, source: "none" }, "Staff without Design & Artwork grant must be denied.");
  await expectEffective(designSession.access_token, "design_artwork", 200, { allowed: true, source: "temporary" }, "Active design_artwork grant must allow Staff artwork entry.");
  await expectEffective(inquiriesSession.access_token, "design_artwork", 200, { allowed: false, source: "none" }, "Inquiries grant must not unlock Design & Artwork.");
  await expectEffective(ordersSession.access_token, "design_artwork", 200, { allowed: false, source: "none" }, "Orders grant must not unlock Design & Artwork.");
  await expectEffective(productionSession.access_token, "design_artwork", 200, { allowed: false, source: "none" }, "Production grant must not unlock Design & Artwork.");
  await expectEffective(calendarSession.access_token, "design_artwork", 200, { allowed: false, source: "none" }, "Calendar grant must not unlock Design & Artwork.");
  await expectEffective(workboardSession.access_token, "design_artwork", 200, { allowed: false, source: "none" }, "Workboard grant must not unlock Design & Artwork.");
  await expectEffective(catalogSession.access_token, "design_artwork", 200, { allowed: false, source: "none" }, "Master Catalog grant must not unlock Design & Artwork.");
  await expectEffective(revokedSession.access_token, "design_artwork", 200, { allowed: false, source: "none" }, "Revoked design_artwork grant must be denied.");
  await expectEffective(expiredSession.access_token, "design_artwork", 200, { allowed: false, source: "none" }, "Expired design_artwork grant must be denied.");
  await expectEffective(designSession.access_token, "inquiries", 200, { allowed: false, source: "none" }, "Design & Artwork grant must not unlock full Inquiries module access.");
  await expectEffective(designSession.access_token, "orders", 200, { allowed: false, source: "none" }, "Design & Artwork grant must not unlock Orders.");
  await expectEffective(designSession.access_token, "production", 200, { allowed: false, source: "none" }, "Design & Artwork grant must not unlock Production.");

  const forged = await effectiveRequest(noGrantSession.access_token, "design_artwork", { "X-TRRY-Temp-Access": "design_artwork" });
  assert.equal(forged.status, 200, "Forged client design_artwork state must not break authenticated API.");
  assert.equal(forged.body.access?.allowed, false, "Forged client design_artwork state must be denied server-side.");

  await expectArtworkRead(ownerSession.access_token, { a: true, b: true }, "Owner artwork read must see both QA rows.");
  await expectArtworkRead(adminSession.access_token, { a: true, b: true }, "Admin artwork read must see both QA rows.");
  await expectArtworkRead(noGrantSession.access_token, { a: false, b: false }, "No-grant Staff artwork read must be denied.");
  await expectArtworkRead(designSession.access_token, { a: true, b: false }, "Design Staff must only see assigned artwork row.");
  await expectArtworkRead(staffBSession.access_token, { a: false, b: false }, "Assigned Staff B without design grant must not see artwork row.");
  await expectArtworkRead(revokedSession.access_token, { a: false, b: false }, "Revoked design_artwork grant must not read artwork rows.");
  await expectArtworkRead(expiredSession.access_token, { a: false, b: false }, "Expired design_artwork grant must not read artwork rows.");

  const artworkFile = await artworkRequest(designSession.access_token, inquiryA);
  assert.equal(artworkFile.status, 200, "Temporary Design Staff must receive a signed URL for assigned customer artwork.");
  assert.ok(/^https?:\/\//.test(String(artworkFile.body.signedUrl || "")), "Artwork API must return a signed URL.");
  const otherArtworkFile = await artworkRequest(designSession.access_token, inquiryB);
  assert.equal(otherArtworkFile.status, 404, "Temporary Design Staff must not receive another Staff member's artwork.");
  const customerArtwork = await customerAsset(designSession.access_token, inquiryA, "customer-artwork");
  assert.equal(customerArtwork.status, 200, "Temporary Design Staff may open assigned customer artwork through customer-action asset path.");
  const paymentProof = await customerAsset(designSession.access_token, inquiryA, "payment-proof");
  assert.equal(paymentProof.status, 403, "Temporary Design Staff must not open payment proof assets.");

  const permitted = await customerAction(designSession.access_token, inquiryA, { action: "mark_artwork_under_review" });
  assert.equal(permitted.status, 200, "Temporary Design Staff must perform existing assigned artwork review action.");
  let snapshot = await readInquirySnapshot(inquiryA);
  assert.equal(snapshot.artwork_status, "under_review", "Permitted artwork review action must persist.");

  await expectDeniedNoChange("Artwork approval", inquiryA, () => customerAction(designSession.access_token, inquiryA, { action: "approve_artwork" }));
  await expectDeniedNoChange("Artwork destructive reset", inquiryA, () => customerAction(designSession.access_token, inquiryA, { action: "request_new_artwork" }));
  await expectDeniedNoChange("Staff A direct access to Staff B artwork", inquiryB, () => customerAction(designSession.access_token, inquiryB, { action: "mark_artwork_under_review" }), [403, 404]);
  await expectDeniedNoChange("Direct ops_inquiries UPDATE", inquiryA, () => directInquiryUpdate(designSession.access_token, inquiryA, { artwork_status: "approved" }));
  await expectDeniedNoChange("Quote mutation", inquiryA, () => customerAction(designSession.access_token, inquiryA, { action: "publish_quote", quotedAmount: 100, amountDue: 100 }));
  await expectDeniedNoChange("Payment mutation", inquiryA, () => customerAction(designSession.access_token, inquiryA, { action: "require_payment", amountDue: 100, paymentInstructions: "Local QA" }));
  await expectDeniedNoChange("Production mutation", inquiryA, () => workflowAction(designSession.access_token, inquiryA, { action: "save_production", productionNote: "blocked" }));
  await expectDeniedNoChange("Orders/payment confirmation mutation", inquiryA, () => paymentConfirmation(designSession.access_token, inquiryA));
  await expectDeniedNoChange("Assignment mutation", inquiryA, () => assignmentAction(designSession.access_token, inquiryA));

  const ownerApproval = await customerAction(ownerSession.access_token, inquiryA, { action: "approve_artwork" });
  assert.equal(ownerApproval.status, 200, "Owner artwork approval must remain allowed.");
  snapshot = await readInquirySnapshot(inquiryA);
  assert.equal(snapshot.artwork_status, "approved", "Owner artwork approval must persist.");
  await expectDeniedNoChange("Approved/final artwork override", inquiryA, () => customerAction(designSession.access_token, inquiryA, { action: "mark_artwork_usable" }));

  assert.equal(await readAdminRole(identities.designStaff.profile.id), "staff", "Staff role must remain staff after Design & Artwork grant.");

  await revokeAllActiveQaGrants(identities.owner.profile.id);
  assert.equal(await readActiveQaGrantCount(), 0, "No active E5F QA grants should remain after cleanup.");
  await expectEffective(designSession.access_token, "design_artwork", 200, { allowed: false, source: "none" }, "Revoked active Design & Artwork grant must deny effective access.");
  await expectArtworkRead(designSession.access_token, { a: false, b: false }, "Revoked active Design & Artwork grant must deny subsequent artwork read.");
  assert.equal(await readAdminRole(identities.designStaff.profile.id), "staff", "Staff role must remain staff after revoke.");

  console.log("PASS: Employee E5F local runtime verification");
  console.log(`EVIDENCE: design_artwork module gate ok; assigned artwork read/signed URL/review action ok; Staff B artwork hidden; approval/destructive/quote/payment/production/orders/assignment mutations denied with before=after; owner/admin preserved; qaRun=${runId}`);
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
  assert.equal(sqlValue("select count(*) from pg_policies where schemaname='public' and tablename='ops_inquiries' and cmd='SELECT' and qual like '%design_artwork%' and qual like '%assigned_user_id%'"), "1", "Design & Artwork read policy must be assigned scoped.");
  assert.equal(sqlValue("select count(*) from pg_policies where schemaname='public' and tablename='ops_inquiries' and cmd='UPDATE' and coalesce(with_check,'') like '%design_artwork%'"), "0", "Design & Artwork grant must not create ops_inquiries update policy.");
  assert.equal(sqlValue("select count(*) from pg_policies where schemaname='storage' and tablename='objects' and (coalesce(qual,'') like '%design_artwork%' or coalesce(with_check,'') like '%design_artwork%')"), "0", "Design & Artwork grant must not open direct storage object policies.");
}

async function createQaIdentities() {
  const specs = {
    owner: ["owner", true],
    admin: ["admin", true],
    noGrantStaff: ["staff", true],
    designStaff: ["staff", true],
    staffB: ["staff", true],
    inquiriesStaff: ["staff", true],
    ordersStaff: ["staff", true],
    productionStaff: ["staff", true],
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
      user_metadata: { display_name: `E5F ${key}`, trry_admin_role: role },
    });
    assert.ifError(createError);
    const { data: profile, error: profileError } = await service
      .from("admin_users")
      .insert({
        user_id: created.user.id,
        email,
        display_name: `E5F ${key}`,
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

async function seedArtworkFixture(inquiryId, assignedUserId, artworkPath) {
  const now = Date.now();
  const quoteApprovedAt = new Date(now - 60_000).toISOString();
  const dueDate = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { error } = await service.from("ops_inquiries").insert({
    id: inquiryId,
    customer_name: `E5F Customer ${inquiryId}`,
    contact: `${inquiryId.toLowerCase()}@example.test`,
    company: `E5F Company ${runId}`,
    source: "LOCAL_QA",
    product: "DTF",
    product_desc: "Harmless local E5F artwork record",
    quantity: "24 pcs",
    priority: "normal",
    status: "sent",
    next_action: "Artwork QA",
    due_date: dueDate,
    owner_id: "E5F Owner",
    owner_user_id: identities.owner.profile.user_id,
    assigned_staff: `E5F Staff ${assignedUserId.slice(0, 6)}`,
    assigned_user_id: assignedUserId,
    quoted_amount: 2400,
    amount_due: 2400,
    quote_status: "approved",
    quote_approved_at: quoteApprovedAt,
    artwork_status: "submitted",
    artwork_url: artworkPath,
    payment_status: "not_required",
    payment_history: [],
    fulfillment_method: "delivery",
  });
  assert.ifError(error);
}

async function seedStorageObject(path) {
  const { error } = await service.storage
    .from("inquiry-artworks")
    .upload(path, Buffer.from(`local ${runId} ${path}`), {
      contentType: "image/png",
      upsert: true,
    });
  assert.ifError(error);
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
    reason: `E5F runtime ${moduleCode} ${runId}`,
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

async function expectArtworkRead(token, expected, message) {
  const { data, error } = await createUserClient(token)
    .from("ops_inquiries")
    .select("id,assigned_user_id,artwork_status,artwork_url")
    .in("id", [inquiryA, inquiryB])
    .order("id");
  assert.equal(error, null, message);
  const ids = new Set((data || []).map((row) => row.id));
  assert.equal(ids.has(inquiryA), expected.a, `${message} Staff A artwork visibility`);
  assert.equal(ids.has(inquiryB), expected.b, `${message} Staff B artwork visibility`);
}

async function artworkRequest(token, inquiryId) {
  const response = await fetch(`http://127.0.0.1:${appPort}/api/inquiries/${encodeURIComponent(inquiryId)}/artwork`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  return { status: response.status, body: await response.json().catch(() => ({})), denied: response.status >= 400 };
}

async function customerAsset(token, inquiryId, asset) {
  const response = await fetch(`http://127.0.0.1:${appPort}/api/inquiries/${encodeURIComponent(inquiryId)}/customer-actions?asset=${encodeURIComponent(asset)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  return { status: response.status, body: await response.json().catch(() => ({})), denied: response.status >= 400 };
}

async function customerAction(token, inquiryId, body) {
  const response = await fetch(`http://127.0.0.1:${appPort}/api/inquiries/${encodeURIComponent(inquiryId)}/customer-actions`, {
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
  return { status: response.status, denied: response.status === 403 };
}

async function paymentConfirmation(token, inquiryId) {
  const response = await fetch(`http://127.0.0.1:${appPort}/api/inquiries/${encodeURIComponent(inquiryId)}/payment-confirmations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amountReceived: 1, paymentSource: "cash", idempotencyKey: `e5f-pay-${Date.now()}` }),
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
  assert.deepEqual(after, before, `${label} must not partially mutate artwork, assignment, inquiry, production, order, payment, or final asset data.`);
}

async function readIntegritySnapshot(inquiryId) {
  const { data, error } = await service
    .from("ops_inquiries")
    .select("id,status,quote_status,quoted_amount,amount_due,due_date,artwork_status,artwork_url,artwork_approved_at,artwork_revision_request,payment_status,payment_confirmed_amount,payment_verified_amount,payment_confirmed_at,payment_verified_by,production_stage,production_note,tracking_substatus,assigned_staff,assigned_user_id,blocked_reason,updated_at")
    .eq("id", inquiryId)
    .single();
  assert.ifError(error);
  return normalizeSnapshot(data);
}

async function readInquirySnapshot(inquiryId) {
  const { data, error } = await service
    .from("ops_inquiries")
    .select("artwork_status,artwork_url,artwork_approved_at,artwork_revision_request,assigned_user_id")
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
  await service.storage.from("inquiry-artworks").remove([artworkPathA, artworkPathB, proofPathA]);
  await service.from("ops_inquiries").delete().in("id", [inquiryA, inquiryB]);
}

function sqlValue(sql) {
  return execFileSync("docker", ["exec", "supabase_db_Admin_portal", "psql", "-U", "postgres", "-d", "postgres", "-tAc", sql], { encoding: "utf8" }).trim();
}
