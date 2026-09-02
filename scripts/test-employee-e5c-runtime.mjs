import assert from "node:assert/strict";
import { execFileSync, execSync, spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const runId = `e5c-${Date.now()}`;
const password = `Local-${runId}-Pass123!`;
const appPort = 7450 + Math.floor(Math.random() * 300);
const status = getLocalSupabaseStatus();
globalThis.window = {
  TRRY_ADMIN_ENV: {
    VITE_SUPABASE_URL: status.API_URL,
    VITE_SUPABASE_ANON_KEY: status.ANON_KEY,
    VITE_USE_SUPABASE_DATA: "true",
  },
};
const { getOpsBoardInquiries } = await import("../src/services/opsBoard.js");
const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(status.API_URL, status.ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let server;
let qaRows = [];
let cleanupRevokerId = "";
let inquiryIds = [];

try {
  verifySchema();
  const identities = await createQaIdentities();
  qaRows = Object.values(identities).map((item) => item.profile);
  cleanupRevokerId = identities.owner.profile.id;
  inquiryIds = await seedInquiries(identities);

  await seedGrant(identities.inquiriesStaff.profile.id, "inquiries", identities.owner.profile.id);
  await seedGrant(identities.calendarStaff.profile.id, "calendar", identities.owner.profile.id);
  await seedGrant(identities.workboardStaff.profile.id, "workboard", identities.owner.profile.id);
  await seedGrant(identities.catalogStaff.profile.id, "master_catalog", identities.owner.profile.id);
  await seedGrant(identities.revokedStaff.profile.id, "inquiries", identities.owner.profile.id, { revoked: true });
  await seedGrant(identities.expiredStaff.profile.id, "inquiries", identities.owner.profile.id, { expired: true });

  server = await startLocalDevServer();

  const ownerSession = await signIn(identities.owner.email);
  const adminSession = await signIn(identities.admin.email);
  const noGrantSession = await signIn(identities.noGrantStaff.email);
  const inquiriesSession = await signIn(identities.inquiriesStaff.email);
  const calendarSession = await signIn(identities.calendarStaff.email);
  const workboardSession = await signIn(identities.workboardStaff.email);
  const catalogSession = await signIn(identities.catalogStaff.email);
  const revokedSession = await signIn(identities.revokedStaff.email);
  const expiredSession = await signIn(identities.expiredStaff.email);

  await expectEffective("", "inquiries", 401, undefined, "Unauthenticated effective Inquiries access must be blocked.");
  await expectEffective(ownerSession.access_token, "inquiries", 200, { allowed: true, source: "permanent" }, "Owner permanent Inquiries access must remain allowed.");
  await expectEffective(adminSession.access_token, "inquiries", 200, { allowed: true, source: "permanent" }, "Admin permanent Inquiries access must remain allowed.");
  await expectEffective(noGrantSession.access_token, "inquiries", 200, { allowed: false, source: "none" }, "Staff without grant must not receive Inquiries effective access.");
  await expectEffective(inquiriesSession.access_token, "inquiries", 200, { allowed: true, source: "temporary" }, "Active Inquiries grant must allow Staff.");
  await expectEffective(calendarSession.access_token, "inquiries", 200, { allowed: false, source: "none" }, "Calendar-only grant must not unlock Inquiries.");
  await expectEffective(workboardSession.access_token, "inquiries", 200, { allowed: false, source: "none" }, "Workboard-only grant must not unlock Inquiries.");
  await expectEffective(catalogSession.access_token, "inquiries", 200, { allowed: false, source: "none" }, "Master Catalog-only grant must not unlock Inquiries.");
  await expectEffective(revokedSession.access_token, "inquiries", 200, { allowed: false, source: "none" }, "Revoked Inquiries grant must not unlock Inquiries.");
  await expectEffective(expiredSession.access_token, "inquiries", 200, { allowed: false, source: "none" }, "Expired Inquiries grant must not unlock Inquiries.");
  await expectEffective(inquiriesSession.access_token, "calendar", 200, { allowed: false, source: "none" }, "Inquiries grant must not unlock Calendar.");
  await expectEffective(inquiriesSession.access_token, "workboard", 200, { allowed: false, source: "none" }, "Inquiries grant must not unlock Workboard.");
  await expectEffective(inquiriesSession.access_token, "master_catalog", 200, { allowed: false, source: "none" }, "Inquiries grant must not unlock Master Catalog.");

  const forged = await effectiveRequest(noGrantSession.access_token, "inquiries", { "X-TRRY-Temp-Access": "inquiries" });
  assert.equal(forged.status, 200, "Forged client Inquiries state must not break the authenticated API.");
  assert.equal(forged.body.access?.allowed, false, "Forged client Inquiries state must be denied server-side.");

  const noGrantRows = await readInquiryRows(noGrantSession.access_token);
  assert.equal(noGrantRows.error, null, "No-grant Staff direct read should be safely filtered by RLS, not error.");
  assert.equal(noGrantRows.data.length, 0, "No-grant Staff must not read local QA inquiries through direct Supabase REST.");

  const activeRows = await readInquiryRows(inquiriesSession.access_token);
  assert.equal(activeRows.error, null, "Temporary Inquiries Staff direct read must not error.");
  assert.ok(hasId(activeRows.data, inquiryIds[0]) && hasId(activeRows.data, inquiryIds[1]), "Existing Staff Inquiries policy is broad; temporary Staff must see both Staff A and Staff B local QA inquiries.");

  const ownerRows = await readInquiryRows(ownerSession.access_token);
  assert.ok(hasId(ownerRows.data, inquiryIds[0]) && hasId(ownerRows.data, inquiryIds[1]), "Owner visibility must remain broad.");
  const adminRows = await readInquiryRows(adminSession.access_token);
  assert.ok(hasId(adminRows.data, inquiryIds[0]) && hasId(adminRows.data, inquiryIds[1]), "Admin visibility must remain broad.");

  const catalogResult = await getOpsBoardInquiries([], inquiriesSession);
  assert.equal(catalogResult.error, null, "Temporary Inquiries Staff app read must not return an error.");
  assert.ok(catalogResult.inquiries.some((item) => item.id === inquiryIds[0]) && catalogResult.inquiries.some((item) => item.id === inquiryIds[1]), "App read must preserve existing broad Staff Inquiries record scope.");

  await expectAssignment("", inquiryIds[0], 401, "Unauthenticated assignment API must be blocked.");
  await expectAssignment(noGrantSession.access_token, inquiryIds[0], 403, "No-grant Staff assignment API must be denied at module gate.");
  await expectAssignment(calendarSession.access_token, inquiryIds[0], 403, "Calendar-only Staff assignment API must be denied at module gate.");
  await expectAssignment(inquiriesSession.access_token, inquiryIds[0], 200, "Temporary Inquiries Staff must retain existing Staff follow-up action scope.");

  const ownerArtwork = await customerAction(ownerSession.access_token, inquiryIds[0], { action: "approve_artwork" });
  assert.equal(ownerArtwork.status, 200, "Owner artwork approval must remain allowed.");
  const staffArtwork = await customerAction(inquiriesSession.access_token, inquiryIds[1], { action: "approve_artwork" });
  assert.equal(staffArtwork.status, 400, "Temporary Inquiries Staff must not gain Owner/Admin artwork approval.");
  assert.match(String(staffArtwork.body.error || ""), /owner or admin/i, "Staff artwork denial must cite Owner/Admin access.");

  const noGrantWorkflow = await workflowAction(noGrantSession.access_token, inquiryIds[0], { action: "save_production", productionNote: "blocked" });
  assert.equal(noGrantWorkflow.status, 403, "No-grant Staff workflow API must be denied at module gate.");

  assert.equal(await readAdminRole(identities.inquiriesStaff.profile.id), "staff", "Staff role must remain staff after Inquiries grant.");
  await revokeAllActiveQaGrants(identities.owner.profile.id);
  assert.equal(await readActiveQaGrantCount(), 0, "No active E5C QA grants should remain after cleanup.");
  const afterRevoke = await readInquiryRows(inquiriesSession.access_token);
  assert.equal(afterRevoke.data.length, 0, "Revoked Inquiries grant must deny subsequent direct read.");
  const afterRevokeEffective = await effectiveRequest(inquiriesSession.access_token, "inquiries");
  assert.equal(afterRevokeEffective.body.access?.allowed, false, "Revoked Inquiries grant must deny subsequent effective access.");
  assert.equal(await readAdminRole(identities.inquiriesStaff.profile.id), "staff", "Staff role must remain staff after revoke.");

  console.log("PASS: Employee E5C local runtime verification");
  console.log(`EVIDENCE: inquiries module gate ok; direct RLS no-grant denied; temp staff broad existing inquiry scope preserved; staff follow-up allowed; owner/admin artwork boundary preserved; calendar/workboard/catalog isolation ok; qaRun=${runId}`);
} finally {
  if (qaRows.length && cleanupRevokerId) await revokeAllActiveQaGrants(cleanupRevokerId).catch(() => {});
  await cleanupInquiries().catch(() => {});
  if (server) server.kill();
}

function getLocalSupabaseStatus() {
  const output = execSync("npx --yes supabase status -o json", { encoding: "utf8" });
  const jsonStart = output.indexOf("{");
  if (jsonStart < 0) throw new Error("Unable to read local Supabase status JSON.");
  return JSON.parse(output.slice(jsonStart));
}

function verifySchema() {
  assert.equal(sqlValue("select exists (select 1 from information_schema.tables where table_schema='public' and table_name='employee_temporary_access_grants')"), "t", "Temporary access table must exist.");
  assert.equal(sqlValue("select exists (select 1 from information_schema.tables where table_schema='public' and table_name='ops_inquiries')"), "t", "Ops inquiries table must exist.");
  assert.equal(sqlValue("select exists (select 1 from pg_proc where proname='has_active_employee_temporary_access')"), "t", "E5C temporary access RLS helper must exist locally.");
}

async function createQaIdentities() {
  const specs = {
    owner: ["owner", true],
    admin: ["admin", true],
    noGrantStaff: ["staff", true],
    inquiriesStaff: ["staff", true],
    calendarStaff: ["staff", true],
    workboardStaff: ["staff", true],
    catalogStaff: ["staff", true],
    revokedStaff: ["staff", true],
    expiredStaff: ["staff", true],
    staffA: ["staff", true],
    staffB: ["staff", true],
  };
  const identities = {};
  for (const [key, [role, active]] of Object.entries(specs)) {
    const email = `${runId}-${key}@local.test`;
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: `E5C ${key}`, trry_admin_role: role },
    });
    assert.ifError(createError);
    const { data: profile, error: profileError } = await service
      .from("admin_users")
      .insert({
        user_id: created.user.id,
        email,
        display_name: `E5C ${key}`,
        role,
        is_active: active,
      })
      .select("id,user_id,email,role,is_active")
      .single();
    assert.ifError(profileError);
    identities[key] = { email, authUser: created.user, profile };
  }
  return identities;
}

async function seedInquiries(identities) {
  const rows = [
    inquiryRow("A", identities.staffA.profile),
    inquiryRow("B", identities.staffB.profile),
  ];
  const { data, error } = await service.from("ops_inquiries").insert(rows).select("id");
  assert.ifError(error);
  return data.map((row) => row.id);
}

function inquiryRow(label, staffProfile) {
  return {
    id: `E5C-${label}-${String(Date.now()).slice(-8)}`,
    customer_name: `E5C Customer ${label} ${runId}`,
    contact: `local-${label}@example.test`,
    company: `E5C Company ${label}`,
    source: "LOCAL_QA",
    product: "Inquiry QA",
    product_desc: "Harmless local E5C inquiry record",
    quantity: "12 pcs",
    priority: "normal",
    status: "new",
    next_action: "Prepare quotation",
    due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    follow_up_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    owner_id: `E5C ${label}`,
    owner_user_id: staffProfile.user_id,
    assigned_staff: `E5C ${label}`,
    assigned_user_id: staffProfile.user_id,
    quoted_amount: 1200,
    amount_due: 1200,
    quote_status: "approved",
    quote_approved_at: new Date(Date.now() - 60_000).toISOString(),
    artwork_status: "submitted",
    payment_status: "not_required",
    payment_history: [],
  };
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
    reason: `E5C runtime ${moduleCode} ${runId}`,
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
  return { status: response.status, body: await response.json().catch(() => ({ })) };
}

async function readInquiryRows(token) {
  const { data, error } = await createUserClient(token)
    .from("ops_inquiries")
    .select("id,customer_name,owner_user_id,assigned_user_id")
    .in("id", inquiryIds)
    .order("id", { ascending: true });
  return { data: data || [], error };
}

async function expectAssignment(token, inquiryId, expectedStatus, message) {
  const response = await fetch(`http://127.0.0.1:${appPort}/api/inquiries/${encodeURIComponent(inquiryId)}/assignment`, {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ followUpDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) }),
  });
  assert.equal(response.status, expectedStatus, message);
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
  return { status: response.status, body: await response.json().catch(() => ({ })) };
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
  return { status: response.status, body: await response.json().catch(() => ({ })) };
}

function hasId(rows, id) {
  return (rows || []).some((row) => row.id === id);
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

async function cleanupInquiries() {
  if (!inquiryIds.length) return;
  await service.from("ops_inquiries").delete().in("id", inquiryIds);
}

function sqlValue(sql) {
  return execFileSync("docker", ["exec", "supabase_db_Admin_portal", "psql", "-U", "postgres", "-d", "postgres", "-tAc", sql], { encoding: "utf8" }).trim();
}
