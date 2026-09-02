import assert from "node:assert/strict";
import { execFileSync, execSync, spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const runId = `e31-${Date.now()}`;
const password = `Local-${runId}-Pass123!`;
const appPort = 16500 + Math.floor(Math.random() * 300);
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

try {
  verifySchema();
  const identities = await createQaIdentities();
  qaRows = Object.values(identities).map((item) => item.profile);
  cleanupRevokerId = identities.owner.profile.id;
  server = await startLocalDevServer();

  const ownerSession = await signIn(identities.owner.email);
  const adminSession = await signIn(identities.admin.email);
  const staffSession = await signIn(identities.staff.email);

  const unauth = await apiRequest("", "POST", { employee_id: identities.staff.profile.id, module_codes: ["calendar"] });
  assert.equal(unauth.status, 401, "Unauthenticated grant must be blocked.");

  const staffGrant = await apiRequest(staffSession.access_token, "POST", { employee_id: identities.staff.profile.id, module_codes: ["calendar"] });
  assert.equal(staffGrant.status, 403, "Staff authorizer must be blocked.");

  const forgedExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const ownerGrant = await apiRequest(ownerSession.access_token, "POST", {
    employee_id: identities.staff.profile.id,
    module_codes: ["calendar"],
    reason: `E3.1 owner grant ${runId}`,
    expires_at: forgedExpiry,
  });
  assert.equal(ownerGrant.status, 201, "Owner safe grant should succeed.");

  let calendarRows = await readGrantRows(identities.staff.profile.id, "calendar");
  assert.equal(calendarRows.length, 1, "Owner grant should create one calendar row.");
  assert.equal(calendarRows[0].granted_by, identities.owner.profile.id, "Grant must be attributed to Owner.");
  assert.equal(calendarRows[0].revoked_at, null, "New grant must be active.");
  assert.notEqual(calendarRows[0].expires_at, forgedExpiry, "Client expiry must not control canonical expiry.");
  assert.equal(toIso(calendarRows[0].expires_at), expectedManilaExpiry(calendarRows[0].starts_at), "Grant must expire at next Asia/Manila midnight.");
  assert.equal((await readAdminRole(identities.staff.profile.id)), "staff", "Permanent role must remain staff after grant.");

  const duplicate = await apiRequest(ownerSession.access_token, "POST", {
    employee_id: identities.staff.profile.id,
    module_codes: ["calendar"],
    reason: `E3.1 duplicate ${runId}`,
  });
  assert.equal(duplicate.status, 201, "Duplicate grant request may be idempotent.");
  calendarRows = await readGrantRows(identities.staff.profile.id, "calendar");
  assert.equal(calendarRows.filter(isActiveRow).length, 1, "Duplicate active employee/module grant must be prevented.");

  const multi = await apiRequest(ownerSession.access_token, "POST", {
    employee_id: identities.staff.profile.id,
    module_codes: ["calendar", "workboard"],
    reason: `E3.1 multi ${runId}`,
  });
  assert.equal(multi.status, 201, "Multi-module grant should succeed.");
  let read = await apiRequest(ownerSession.access_token, "GET");
  assert.equal(read.status, 200, `Read API should succeed for Owner. Body: ${JSON.stringify(read.body)}`);
  const activeForStaff = read.body.grants.filter((grant) => grant.employeeId === identities.staff.profile.id);
  assert.deepEqual(new Set(activeForStaff.map((grant) => grant.moduleCode)), new Set(["calendar", "workboard"]), "Read API active modules must match DB truth.");
  assert.equal(new Set(activeForStaff.map((grant) => grant.moduleCode)).size, 2, "Read API active count must be two modules.");
  assert.equal((await readAdminRole(identities.staff.profile.id)), "staff", "Permanent role must remain staff after multi-module grant.");

  await expectBlocked(ownerSession, identities.inactiveStaff.profile.id, ["calendar"], 400, "Inactive target must be blocked.");
  await expectBlocked(ownerSession, identities.owner.profile.id, ["calendar"], 400, "Owner target/self-grant must be blocked.");
  await expectBlocked(ownerSession, identities.admin.profile.id, ["calendar"], 400, "Admin target must be blocked.");
  await expectBlocked(ownerSession, "00000000-0000-4000-8000-000000000000", ["calendar"], 404, "Nonexistent target must be blocked.");
  await expectBlocked(ownerSession, identities.staff.profile.id, ["super_admin"], 400, "Invalid module must be blocked.");

  const ownerPeopleAccess = await apiRequest(ownerSession.access_token, "POST", {
    employee_id: identities.staff.profile.id,
    module_codes: ["people_access"],
    reason: `E3.1 protected owner ${runId}`,
  });
  assert.equal(ownerPeopleAccess.status, 400, "Owner must not grant People & Access temporary access.");

  const ownerPricing = await apiRequest(ownerSession.access_token, "POST", {
    employee_id: identities.staff.profile.id,
    module_codes: ["pricing_discounts"],
    reason: `E3.1 protected pricing ${runId}`,
  });
  assert.equal(ownerPricing.status, 400, "Owner must not grant parked Pricing & Discounts temporary access.");

  const adminProtected = await apiRequest(adminSession.access_token, "POST", {
    employee_id: identities.staff.profile.id,
    module_codes: ["pricing_discounts"],
    reason: `E3.1 protected admin ${runId}`,
  });
  assert.equal(adminProtected.status, 400, "Admin must not grant protected modules.");

  const adminSafe = await apiRequest(adminSession.access_token, "POST", {
    employee_id: identities.staff.profile.id,
    module_codes: ["inquiries"],
    reason: `E3.1 admin safe ${runId}`,
  });
  assert.equal(adminSafe.status, 201, "Admin should grant safe modules to Staff within management boundary.");

  const revokedGrant = await apiRequest(ownerSession.access_token, "POST", {
    employee_id: identities.revokeStaff.profile.id,
    module_codes: ["inventory"],
    reason: `E3.1 revoke setup ${runId}`,
  });
  assert.equal(revokedGrant.status, 201, "Revoke setup grant should succeed.");
  const revoke = await apiRequest(ownerSession.access_token, "PATCH", { employee_id: identities.revokeStaff.profile.id });
  assert.equal(revoke.status, 200, "Revoke endpoint should succeed.");
  const revokedRows = await readGrantRows(identities.revokeStaff.profile.id, "inventory", { includeRevoked: true });
  assert.equal(revokedRows.length, 1, "Revoked row must be preserved historically.");
  assert.ok(revokedRows[0].revoked_at, "revoked_at must be populated.");
  assert.equal(revokedRows[0].revoked_by, identities.owner.profile.id, "revoked_by must be authenticated Owner.");
  read = await apiRequest(ownerSession.access_token, "GET");
  assert.equal(read.body.grants.some((grant) => grant.employeeId === identities.revokeStaff.profile.id && grant.moduleCode === "inventory"), false, "Revoked grant must be excluded from active read API.");
  assert.equal((await readAdminActive(identities.revokeStaff.profile.id)), true, "Employee must remain active after revoke.");
  assert.equal((await readAdminRole(identities.revokeStaff.profile.id)), "staff", "Permanent role must remain staff after revoke.");

  const expiredStarts = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const expiredEnds = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { error: expiredError } = await service.from("employee_temporary_access_grants").insert({
    employee_id: identities.expiredStaff.profile.id,
    module_code: "orders",
    granted_by: identities.owner.profile.id,
    starts_at: expiredStarts,
    expires_at: expiredEnds,
    reason: `E3.1 expired harness ${runId}`,
  });
  assert.ifError(expiredError);
  read = await apiRequest(ownerSession.access_token, "GET");
  assert.equal(read.body.grants.some((grant) => grant.employeeId === identities.expiredStaff.profile.id && grant.moduleCode === "orders"), false, "Expired grant must be excluded from active read API.");
  const expiredRows = await readGrantRows(identities.expiredStaff.profile.id, "orders", { includeExpired: true });
  assert.equal(expiredRows.length, 1, "Expired historical row must remain queryable.");

  await revokeAllActiveQaGrants(identities.owner.profile.id);
  const activeRemaining = await readActiveQaGrantCount();
  assert.equal(activeRemaining, 0, "No active E3.1 QA grants should remain after cleanup.");

  console.log("PASS: Employee E3.1 local runtime verification");
  console.log(`EVIDENCE: schema ok; owner/admin/staff auth ok; grant/duplicate/multi/revoke/expired/read cleanup ok; qaRun=${runId}`);
} finally {
  if (qaRows.length && cleanupRevokerId) {
    await revokeAllActiveQaGrants(cleanupRevokerId).catch(() => {});
  }
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
  const columns = sqlRows("select column_name from information_schema.columns where table_schema='public' and table_name='employee_temporary_access_grants' order by ordinal_position");
  assert.deepEqual(columns, ["id", "employee_id", "module_code", "granted_by", "starts_at", "expires_at", "reason", "revoked_at", "revoked_by", "created_at"], "Temporary access columns must match migration.");
  const indexes = sqlRows("select indexname from pg_indexes where schemaname='public' and tablename='employee_temporary_access_grants' order by indexname");
  for (const name of ["employee_temp_access_active_day_unique", "employee_temp_access_employee_idx", "employee_temp_access_expires_idx", "employee_temp_access_module_idx", "employee_temp_access_revoked_idx", "employee_temporary_access_grants_pkey"]) {
    assert.ok(indexes.includes(name), `Missing expected index ${name}.`);
  }
  const fks = sqlRows("select rc.delete_rule from information_schema.referential_constraints rc join information_schema.table_constraints tc on rc.constraint_name=tc.constraint_name and rc.constraint_schema=tc.constraint_schema where tc.table_schema='public' and tc.table_name='employee_temporary_access_grants' order by rc.delete_rule");
  assert.ok(fks.includes("RESTRICT"), "Employee/grant author foreign keys should use RESTRICT.");
  assert.ok(fks.includes("SET NULL"), "Revoker foreign key should use SET NULL.");
  assert.equal(fks.includes("CASCADE"), false, "Temporary access history must not cascade delete.");
}

async function createQaIdentities() {
  const specs = {
    owner: ["owner", true],
    admin: ["admin", true],
    staff: ["staff", true],
    inactiveStaff: ["staff", false],
    revokeStaff: ["staff", true],
    expiredStaff: ["staff", true],
  };
  const identities = {};
  for (const [key, [role, active]] of Object.entries(specs)) {
    const email = `${runId}-${key}@local.test`;
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: `E31 ${key}`, trry_admin_role: role },
    });
    assert.ifError(createError);
    const { data: profile, error: profileError } = await service
      .from("admin_users")
      .insert({
        user_id: created.user.id,
        email,
        display_name: `E31 ${key}`,
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
      const envResponse = await fetch(`http://127.0.0.1:${appPort}/src/env.js`);
      const apiResponse = await fetch(`http://127.0.0.1:${appPort}/api/admin-users/temporary-access`);
      if (envResponse.ok && apiResponse.status === 401) return child;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (child.exitCode !== null) throw new Error(`local dev server exited early: ${logs}`);
  }
  child.kill();
  throw new Error(`Timed out waiting for local dev server: ${logs}`);
}

async function apiRequest(token, method, body) {
  const response = await fetch(`http://127.0.0.1:${appPort}/api/admin-users/temporary-access`, {
    method,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text, contentType: response.headers.get("content-type") || "" }; }
  return { status: response.status, body: payload };
}

async function expectBlocked(session, employeeId, moduleCodes, expectedStatus, message) {
  const response = await apiRequest(session.access_token, "POST", { employee_id: employeeId, module_codes: moduleCodes });
  assert.equal(response.status, expectedStatus, message);
}

async function readGrantRows(employeeId, moduleCode, { includeRevoked = false, includeExpired = false } = {}) {
  let query = service
    .from("employee_temporary_access_grants")
    .select("*")
    .eq("employee_id", employeeId)
    .eq("module_code", moduleCode);
  if (!includeRevoked) query = query.is("revoked_at", null);
  if (!includeExpired) query = query.gt("expires_at", new Date().toISOString());
  const { data, error } = await query;
  assert.ifError(error);
  return data || [];
}

async function readAdminRole(id) {
  const { data, error } = await service.from("admin_users").select("role").eq("id", id).single();
  assert.ifError(error);
  return data.role;
}

async function readAdminActive(id) {
  const { data, error } = await service.from("admin_users").select("is_active").eq("id", id).single();
  assert.ifError(error);
  return data.is_active !== false;
}

async function revokeAllActiveQaGrants(revokerId) {
  const ids = qaRows.map((row) => row.id);
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
  const { count, error } = await service
    .from("employee_temporary_access_grants")
    .select("id", { count: "exact", head: true })
    .in("employee_id", ids)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());
  assert.ifError(error);
  return count || 0;
}

function isActiveRow(row) {
  const now = Date.now();
  return !row.revoked_at && new Date(row.starts_at).getTime() <= now && now < new Date(row.expires_at).getTime();
}

function expectedManilaExpiry(startsAt) {
  const date = new Date(startsAt);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day") + 1, -8, 0, 0, 0)).toISOString();
}

function toIso(value) {
  return new Date(value).toISOString();
}

function sqlValue(sql) {
  return execFileSync("docker", ["exec", "supabase_db_Admin_portal", "psql", "-U", "postgres", "-d", "postgres", "-tAc", sql], { encoding: "utf8" }).trim();
}

function sqlRows(sql) {
  return sqlValue(sql).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
