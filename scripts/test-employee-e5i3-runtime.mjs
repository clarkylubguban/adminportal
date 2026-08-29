import assert from "node:assert/strict";
import { execFileSync, execSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const runId = `e5i3-${Date.now()}`;
const password = `Local-${runId}-Pass123!`;
const appPort = 9200 + Math.floor(Math.random() * 250);
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
  applyMigration("supabase/migrations/202608250001_add_employee_temporary_access_grants.sql");
  applyMigration("supabase/migrations/202608280001_employee_e5i3_pos_sales_temp_access.sql");
  verifyFunctionContract();

  identities = await createQaIdentities();
  qaRows = Object.values(identities).map((item) => item.profile);
  cleanupRevokerId = identities.owner.profile.id;

  await seedGrant(identities.activeStaff.profile.id, "pos_sales", cleanupRevokerId);
  await seedGrant(identities.wrongModuleStaff.profile.id, "inventory", cleanupRevokerId);
  await seedGrant(identities.revokedStaff.profile.id, "pos_sales", cleanupRevokerId, { revoked: true });
  await seedGrant(identities.expiredStaff.profile.id, "pos_sales", cleanupRevokerId, { expired: true });
  await seedGrant(identities.inactiveStaff.profile.id, "pos_sales", cleanupRevokerId);

  server = await startLocalDevServer();

  const ownerSession = await signIn(identities.owner.email);
  const adminSession = await signIn(identities.admin.email);
  const noGrantSession = await signIn(identities.noGrantStaff.email);
  const activeSession = await signIn(identities.activeStaff.email);
  const wrongSession = await signIn(identities.wrongModuleStaff.email);
  const revokedSession = await signIn(identities.revokedStaff.email);
  const expiredSession = await signIn(identities.expiredStaff.email);
  const inactiveSession = await signIn(identities.inactiveStaff.email);

  await expectEffective("", "pos_sales", 401, undefined, "Unauthenticated HTTP POS effective access must be blocked.");
  await expectEffective(ownerSession.access_token, "pos_sales", 200, { allowed: true, source: "permanent" }, "Owner POS access must remain permanent.");
  await expectEffective(adminSession.access_token, "pos_sales", 200, { allowed: true, source: "permanent" }, "Admin POS access must remain permanent.");
  await expectEffective(noGrantSession.access_token, "pos_sales", 200, { allowed: false, source: "none" }, "Staff without POS grant must be denied.");
  await expectEffective(activeSession.access_token, "pos_sales", 200, { allowed: true, source: "temporary" }, "Active pos_sales grant must allow Staff.");
  await expectEffective(wrongSession.access_token, "pos_sales", 200, { allowed: false, source: "none" }, "Wrong-module grant must not unlock POS.");
  await expectEffective(revokedSession.access_token, "pos_sales", 200, { allowed: false, source: "none" }, "Revoked POS grant must be denied.");
  await expectEffective(expiredSession.access_token, "pos_sales", 200, { allowed: false, source: "none" }, "Expired POS grant must be denied.");
  await expectEffective(inactiveSession.access_token, "pos_sales", 401, undefined, "Inactive employee POS grant must be denied by the Admin HTTP boundary.");

  await expectRpc(ownerSession.access_token, { allowed: true, source: "permanent" }, "Owner RPC must return permanent allow.");
  await expectRpc(adminSession.access_token, { allowed: true, source: "permanent" }, "Admin RPC must return permanent allow.");
  await expectRpc(noGrantSession.access_token, { allowed: false, source: "none" }, "No-grant Staff RPC must deny.");
  const activeRpc = await expectRpc(activeSession.access_token, { allowed: true, source: "temporary" }, "Active Staff RPC must allow temporary POS.");
  assert.ok(activeRpc.expires_at, "Temporary RPC allow must include expires_at.");
  assert.ok(activeRpc.grant_id, "Temporary RPC allow must include grant_id trace.");
  await expectRpc(wrongSession.access_token, { allowed: false, source: "none" }, "Wrong-module RPC must deny.");
  await expectRpc(revokedSession.access_token, { allowed: false, source: "none" }, "Revoked RPC must deny.");
  await expectRpc(expiredSession.access_token, { allowed: false, source: "none" }, "Expired RPC must deny.");
  await expectRpc(inactiveSession.access_token, { allowed: false, source: "none" }, "Inactive employee RPC must deny.");

  const unauthenticatedRpc = await anon.rpc("get_pos_sales_effective_access");
  assert.ok(unauthenticatedRpc.error || unauthenticatedRpc.data?.allowed === false, "Unauthenticated RPC must not allow POS access.");

  const forged = await effectiveRequest(noGrantSession.access_token, "pos_sales", {
    "X-TRRY-Employee-Id": identities.owner.profile.id,
    "X-TRRY-Temp-Access": "pos_sales",
  });
  assert.equal(forged.status, 200, "Forged client identity headers must not break authenticated API.");
  assert.equal(forged.body.access?.allowed, false, "Forged client identity must be ignored and denied.");

  await revokeActiveGrant(identities.activeStaff.profile.id);
  await expectEffective(activeSession.access_token, "pos_sales", 200, { allowed: false, source: "none" }, "Revoked active POS grant must deny HTTP effective access.");
  await expectRpc(activeSession.access_token, { allowed: false, source: "none" }, "Revoked active POS grant must deny RPC effective access.");
  assert.equal(await readAdminRole(identities.activeStaff.profile.id), "staff", "Staff role must remain staff after POS grant/revoke.");

  await revokeAllActiveQaGrants(cleanupRevokerId);
  assert.equal(await readActiveQaGrantCount(), 0, "No active E5I.3 QA grants should remain after cleanup.");

  console.log("PASS: Employee E5I.3 local runtime verification");
  console.log(`EVIDENCE: pos_sales effective access ok; owner/admin permanent; Staff active allowed; no/wrong/revoked/expired/inactive/unauthenticated/forged denied; role unchanged; qaRun=${runId}`);
} finally {
  if (qaRows.length && cleanupRevokerId) await revokeAllActiveQaGrants(cleanupRevokerId).catch(() => {});
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

function verifyFunctionContract() {
  assert.equal(sqlValue("select exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_pos_sales_effective_access' and p.pronargs=0)"), "t", "POS effective-access RPC must exist and accept no employee identity argument.");
  assert.equal(sqlValue("select has_function_privilege('anon', 'public.get_pos_sales_effective_access()', 'execute')"), "f", "Anon must not execute POS effective-access RPC.");
  assert.equal(sqlValue("select has_function_privilege('authenticated', 'public.get_pos_sales_effective_access()', 'execute')"), "t", "Authenticated users must be able to execute POS effective-access RPC.");
}

async function createQaIdentities() {
  const specs = {
    owner: ["owner", true],
    admin: ["admin", true],
    noGrantStaff: ["staff", true],
    activeStaff: ["staff", true],
    wrongModuleStaff: ["staff", true],
    revokedStaff: ["staff", true],
    expiredStaff: ["staff", true],
    inactiveStaff: ["staff", false],
  };
  const result = {};
  for (const [key, [role, active]] of Object.entries(specs)) {
    const email = `${runId}-${key}@local.test`;
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: `E5I3 ${key}`, trry_admin_role: role },
    });
    assert.ifError(createError);
    const { data: profile, error: profileError } = await service
      .from("admin_users")
      .insert({
        user_id: created.user.id,
        email,
        display_name: `E5I3 ${key}`,
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
    reason: `E5I.3 runtime ${moduleCode} ${runId}`,
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
    global: { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} },
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

async function expectRpc(token, expected, message) {
  const { data, error } = await createUserClient(token).rpc("get_pos_sales_effective_access");
  assert.equal(error, null, message);
  assert.equal(data?.allowed, expected.allowed, message);
  assert.equal(data?.source, expected.source, message);
  if (!data?.allowed) {
    assert.equal(data?.expires_at, null, message);
    assert.equal(data?.grant_id, null, message);
  }
  return data;
}

async function revokeActiveGrant(employeeId) {
  const { error } = await service
    .from("employee_temporary_access_grants")
    .update({ revoked_at: new Date().toISOString(), revoked_by: cleanupRevokerId })
    .eq("employee_id", employeeId)
    .eq("module_code", "pos_sales")
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());
  assert.ifError(error);
}

async function revokeAllActiveQaGrants(revokerId) {
  const idsToRevoke = qaRows.map((row) => row.id);
  if (!idsToRevoke.length) return;
  const { error } = await service
    .from("employee_temporary_access_grants")
    .update({ revoked_at: new Date().toISOString(), revoked_by: revokerId })
    .in("employee_id", idsToRevoke)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());
  assert.ifError(error);
}

async function readActiveQaGrantCount() {
  const idsToCheck = qaRows.map((row) => row.id);
  if (!idsToCheck.length) return 0;
  const { count, error } = await service
    .from("employee_temporary_access_grants")
    .select("id", { count: "exact", head: true })
    .in("employee_id", idsToCheck)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());
  assert.ifError(error);
  return count || 0;
}

async function readAdminRole(id) {
  const { data, error } = await service.from("admin_users").select("role").eq("id", id).single();
  assert.ifError(error);
  return data.role;
}

function sqlValue(sql) {
  return execFileSync("docker", ["exec", "supabase_db_Admin_portal", "psql", "-U", "postgres", "-d", "postgres", "-tAc", sql], { encoding: "utf8" }).trim();
}
