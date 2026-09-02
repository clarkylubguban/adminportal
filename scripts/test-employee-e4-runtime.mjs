import assert from "node:assert/strict";
import { execFileSync, execSync, spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const runId = `e4-${Date.now()}`;
const password = `Local-${runId}-Pass123!`;
const appPort = 6520 + Math.floor(Math.random() * 300);
const status = getLocalSupabaseStatus();
const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(status.API_URL, status.ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let server;
let qaRows = [];
let cleanupRevokerId = "";
let originalTaskDomainEnabled = null;

try {
  verifySchema();
  originalTaskDomainEnabled = await setLocalTaskDomainEnabled(true);
  const identities = await createQaIdentities();
  qaRows = Object.values(identities).map((item) => item.profile);
  cleanupRevokerId = identities.owner.profile.id;
  await seedGrant(identities.calendarStaff.profile.id, "calendar", identities.owner.profile.id);
  await seedGrant(identities.inventoryStaff.profile.id, "inventory", identities.owner.profile.id);
  await seedGrant(identities.revokedStaff.profile.id, "calendar", identities.owner.profile.id, { revoked: true });
  await seedGrant(identities.expiredStaff.profile.id, "calendar", identities.owner.profile.id, { expired: true });

  server = await startLocalDevServer();

  const ownerSession = await signIn(identities.owner.email);
  const adminSession = await signIn(identities.admin.email);
  const noGrantSession = await signIn(identities.noGrantStaff.email);
  const calendarSession = await signIn(identities.calendarStaff.email);
  const inventorySession = await signIn(identities.inventoryStaff.email);
  const revokedSession = await signIn(identities.revokedStaff.email);
  const expiredSession = await signIn(identities.expiredStaff.email);

  await expectEffective("", 401, undefined, "Unauthenticated effective access must be blocked.");
  await expectEffective(ownerSession.access_token, 200, { allowed: true, source: "permanent" }, "Owner must keep permanent Calendar access.");
  await expectEffective(adminSession.access_token, 200, { allowed: true, source: "permanent" }, "Admin must keep permanent Calendar access.");
  await expectEffective(noGrantSession.access_token, 200, { allowed: false, source: "none" }, "Staff without grant must not receive effective Calendar access.");
  await expectEffective(calendarSession.access_token, 200, { allowed: true, source: "temporary" }, "Active Calendar temp grant must allow Staff.");
  await expectEffective(inventorySession.access_token, 200, { allowed: false, source: "none" }, "Inventory grant must not unlock Calendar.");
  await expectEffective(revokedSession.access_token, 200, { allowed: false, source: "none" }, "Revoked Calendar grant must not unlock Calendar.");
  await expectEffective(expiredSession.access_token, 200, { allowed: false, source: "none" }, "Expired Calendar grant must not unlock Calendar.");
  const inventoryEffective = await effectiveRequest(calendarSession.access_token, "inventory");
  assert.equal(inventoryEffective.status, 200, "Inventory is a registered later-phase module after E5G.");
  assert.equal(inventoryEffective.body.access?.allowed, false, "Calendar grant must not unlock Inventory.");

  await expectCalendar("", 401, "AUTH_REQUIRED", "Unauthenticated Calendar API must be blocked.");
  await expectCalendar(ownerSession.access_token, 200, undefined, "Owner Calendar API read must remain allowed.");
  await expectCalendar(adminSession.access_token, 200, undefined, "Admin Calendar API read must remain allowed.");
  await expectCalendar(calendarSession.access_token, 200, undefined, "Staff active temporary Calendar grant must allow read API.");
  await expectCalendar(noGrantSession.access_token, 403, "FORBIDDEN", "Staff without grant must be blocked at Calendar API.");
  await expectCalendar(inventorySession.access_token, 403, "FORBIDDEN", "Wrong-module grant must be blocked at Calendar API.");
  await expectCalendar(revokedSession.access_token, 403, "FORBIDDEN", "Revoked grant must be blocked at Calendar API.");
  await expectCalendar(expiredSession.access_token, 403, "FORBIDDEN", "Expired grant must be blocked at Calendar API.");
  const calendarMutation = await fetch(`http://127.0.0.1:${appPort}/api/task-calendar`, {
    method: "POST",
    headers: { Authorization: `Bearer ${calendarSession.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "forged" }),
  });
  assert.equal(calendarMutation.status, 405, "Calendar endpoint must reject mutations even with temporary access.");

  await revokeAllActiveQaGrants(identities.owner.profile.id);
  assert.equal(await readActiveQaGrantCount(), 0, "No active E4 QA grants should remain after cleanup.");

  console.log("PASS: Employee E4 local runtime verification");
  console.log(`EVIDENCE: effective access ok; Calendar API owner/admin/temp-staff ok; no/wrong/revoked/expired denied; mutation denied; qaRun=${runId}`);
} finally {
  if (qaRows.length && cleanupRevokerId) await revokeAllActiveQaGrants(cleanupRevokerId).catch(() => {});
  if (originalTaskDomainEnabled !== null) await setLocalTaskDomainEnabled(originalTaskDomainEnabled).catch(() => {});
  if (server) server.kill();
}

function getLocalSupabaseStatus() {
  const output = execSync("npx --yes supabase status -o json", { encoding: "utf8" });
  const jsonStart = output.indexOf("{");
  if (jsonStart < 0) throw new Error("Unable to read local Supabase status JSON.");
  return JSON.parse(output.slice(jsonStart));
}

function verifySchema() {
  const tableExists = sqlValue("select exists (select 1 from information_schema.tables where table_schema='public' and table_name='employee_temporary_access_grants')");
  assert.equal(tableExists, "t", "Temporary access table must exist.");
  const taskDomainExists = sqlValue("select exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='task_domain_enabled')");
  assert.equal(taskDomainExists, "t", "Task domain feature RPC must exist.");
}

async function setLocalTaskDomainEnabled(enabled) {
  const { data: before, error: beforeError } = await service
    .from("task_feature_flags")
    .select("enabled")
    .eq("feature", "TASK_DOMAIN")
    .single();
  assert.ifError(beforeError);
  const { error } = await service
    .from("task_feature_flags")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("feature", "TASK_DOMAIN");
  assert.ifError(error);
  return before.enabled === true;
}

async function createQaIdentities() {
  const specs = {
    owner: ["owner", true],
    admin: ["admin", true],
    noGrantStaff: ["staff", true],
    calendarStaff: ["staff", true],
    inventoryStaff: ["staff", true],
    revokedStaff: ["staff", true],
    expiredStaff: ["staff", true],
  };
  const identities = {};
  for (const [key, [role, active]] of Object.entries(specs)) {
    const email = `${runId}-${key}@local.test`;
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: `E4 ${key}`, trry_admin_role: role },
    });
    assert.ifError(createError);
    const { data: profile, error: profileError } = await service
      .from("admin_users")
      .insert({
        user_id: created.user.id,
        email,
        display_name: `E4 ${key}`,
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
    reason: `E4 runtime ${moduleCode} ${runId}`,
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

async function expectEffective(token, statusCode, expected, message) {
  const response = await effectiveRequest(token);
  assert.equal(response.status, statusCode, message);
  if (expected) {
    assert.equal(response.body.access?.allowed, expected.allowed, message);
    assert.equal(response.body.access?.source, expected.source, message);
    assert.equal(response.body.access?.module, "calendar", message);
  }
}

async function effectiveRequest(token, moduleCode = "calendar") {
  const response = await fetch(`http://127.0.0.1:${appPort}/api/admin-users/effective-access?module=${encodeURIComponent(moduleCode)}`, {
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function expectCalendar(token, statusCode, errorCode, message) {
  const response = await fetch(`http://127.0.0.1:${appPort}/api/task-calendar?from=2026-08-01&to=2026-08-31`, {
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  assert.equal(response.status, statusCode, message);
  if (errorCode) assert.equal(body.error?.code, errorCode, message);
  if (statusCode === 200) assert.equal(body.ok, true, message);
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

function sqlValue(sql) {
  return execFileSync("docker", ["exec", "supabase_db_Admin_portal", "psql", "-U", "postgres", "-d", "postgres", "-tAc", sql], { encoding: "utf8" }).trim();
}
