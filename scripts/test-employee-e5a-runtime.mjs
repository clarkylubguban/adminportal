import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, execSync, spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const runId = `e5a-${Date.now()}`;
const password = `Local-${runId}-Pass123!`;
const appPort = 6820 + Math.floor(Math.random() * 300);
const status = getLocalSupabaseStatus();
const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(status.API_URL, status.ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let server;
let qaRows = [];
let qaTaskIds = [];
let cleanupRevokerId = "";
let originalTaskDomainEnabled = null;
let taskCodeCounter = 0;

try {
  verifySchema();
  originalTaskDomainEnabled = await setLocalTaskDomainEnabled(true);
  const identities = await createQaIdentities();
  qaRows = Object.values(identities).map((item) => item.profile);
  cleanupRevokerId = identities.owner.profile.id;

  const staffATask = await seedTask("Staff A visible Workboard task", identities.staffA.profile.user_id, identities.owner.profile.user_id);
  const staffBTask = await seedTask("Staff B private Workboard task", identities.staffB.profile.user_id, identities.owner.profile.user_id);
  const staffAActionTask = await seedTask("Staff A action Workboard task", identities.staffA.profile.user_id, identities.owner.profile.user_id);
  qaTaskIds = [staffATask.id, staffBTask.id, staffAActionTask.id];

  await seedGrant(identities.workboardStaff.profile.id, "workboard", identities.owner.profile.id);
  await seedGrant(identities.calendarStaff.profile.id, "calendar", identities.owner.profile.id);
  await seedGrant(identities.inventoryStaff.profile.id, "inventory", identities.owner.profile.id);
  await seedGrant(identities.revokedStaff.profile.id, "workboard", identities.owner.profile.id, { revoked: true });
  await seedGrant(identities.expiredStaff.profile.id, "workboard", identities.owner.profile.id, { expired: true });

  server = await startLocalDevServer();

  const ownerSession = await signIn(identities.owner.email);
  const adminSession = await signIn(identities.admin.email);
  const noGrantSession = await signIn(identities.noGrantStaff.email);
  const workboardSession = await signIn(identities.workboardStaff.email);
  const calendarSession = await signIn(identities.calendarStaff.email);
  const inventorySession = await signIn(identities.inventoryStaff.email);
  const revokedSession = await signIn(identities.revokedStaff.email);
  const expiredSession = await signIn(identities.expiredStaff.email);

  await expectEffective("", "workboard", 401, undefined, "Unauthenticated effective Workboard access must be blocked.");
  await expectEffective(ownerSession.access_token, "workboard", 200, { allowed: true, source: "permanent" }, "Owner permanent Workboard access must remain allowed.");
  await expectEffective(adminSession.access_token, "workboard", 200, { allowed: true, source: "permanent" }, "Admin permanent Workboard access must remain allowed.");
  await expectEffective(noGrantSession.access_token, "workboard", 200, { allowed: false, source: "none" }, "Staff without grant must not receive Workboard access.");
  await expectEffective(workboardSession.access_token, "workboard", 200, { allowed: true, source: "temporary" }, "Active Workboard grant must allow Staff.");
  await expectEffective(calendarSession.access_token, "workboard", 200, { allowed: false, source: "none" }, "Calendar-only grant must not unlock Workboard.");
  await expectEffective(inventorySession.access_token, "workboard", 200, { allowed: false, source: "none" }, "Inventory-only grant must not unlock Workboard.");
  await expectEffective(revokedSession.access_token, "workboard", 200, { allowed: false, source: "none" }, "Revoked Workboard grant must not unlock Workboard.");
  await expectEffective(expiredSession.access_token, "workboard", 200, { allowed: false, source: "none" }, "Expired Workboard grant must not unlock Workboard.");
  await expectEffective(workboardSession.access_token, "calendar", 200, { allowed: false, source: "none" }, "Workboard grant must not unlock Calendar.");

  await expectWorkboardList("", 401, "AUTH_REQUIRED", "Unauthenticated Workboard API must be blocked.");
  await expectWorkboardList(noGrantSession.access_token, 403, "FORBIDDEN", "Staff without grant must be blocked at Workboard API.");
  await expectWorkboardList(calendarSession.access_token, 403, "FORBIDDEN", "Calendar-only grant must be blocked at Workboard API.");
  await expectWorkboardList(inventorySession.access_token, 403, "FORBIDDEN", "Inventory-only grant must be blocked at Workboard API.");
  await expectWorkboardList(revokedSession.access_token, 403, "FORBIDDEN", "Revoked grant must be blocked at Workboard API.");
  await expectWorkboardList(expiredSession.access_token, 403, "FORBIDDEN", "Expired grant must be blocked at Workboard API.");

  const ownerList = await workboardList(ownerSession.access_token);
  assert.equal(ownerList.status, 200, "Owner Workboard list must remain allowed.");
  assert.ok(hasTask(ownerList.body.tasks, staffATask.id) && hasTask(ownerList.body.tasks, staffBTask.id), "Owner must retain broader Workboard visibility.");
  const adminList = await workboardList(adminSession.access_token);
  assert.equal(adminList.status, 200, "Admin Workboard list must remain allowed.");
  assert.ok(hasTask(adminList.body.tasks, staffATask.id) && hasTask(adminList.body.tasks, staffBTask.id), "Admin must retain broader Workboard visibility.");

  const staffList = await workboardList(workboardSession.access_token);
  assert.equal(staffList.status, 200, "Temporary Workboard Staff list must be allowed.");
  assert.ok(hasTask(staffList.body.tasks, staffATask.id), "Staff A must see own assigned task.");
  assert.equal(hasTask(staffList.body.tasks, staffBTask.id), false, "Staff A must not see Staff B task.");
  assert.equal(staffList.body.tasks.some((task) => task.status === "DRAFT"), false, "Temporary Workboard Staff must not see draft tasks.");

  const forged = await fetch(`http://127.0.0.1:${appPort}/api/tasks?temporary=true&module=workboard`, {
    headers: { Authorization: `Bearer ${noGrantSession.access_token}`, "X-TRRY-Temp-Access": "workboard" },
  });
  assert.equal(forged.status, 403, "Forged client Workboard state must be denied server-side.");

  const staffBDetail = await fetch(`http://127.0.0.1:${appPort}/api/tasks/${staffBTask.id}`, {
    headers: { Authorization: `Bearer ${workboardSession.access_token}` },
  });
  assert.equal(staffBDetail.status, 404, "Staff A direct detail request for Staff B task must remain hidden.");

  const start = await taskCommand(workboardSession.access_token, staffAActionTask.id, "start", staffAActionTask.version, {});
  assert.equal(start.status, 200, "Temporary Workboard Staff must retain permitted assigned task action.");
  const assign = await taskCommand(workboardSession.access_token, staffATask.id, "assign", staffATask.version, { assignedUserId: identities.staffB.profile.user_id });
  assert.equal(assign.status, 403, "Temporary Workboard Staff must not gain manager assign action.");
  const create = await createTask(workboardSession.access_token, identities.staffA.profile.user_id, identities.owner.profile.user_id);
  assert.equal(create.status, 403, "Temporary Workboard Staff must not gain create task action.");

  const beforeRole = await readAdminRole(identities.workboardStaff.profile.id);
  assert.equal(beforeRole, "staff", "Staff role must remain staff after Workboard grant.");

  await revokeAllActiveQaGrants(identities.owner.profile.id);
  assert.equal(await readActiveQaGrantCount(), 0, "No active E5A QA grants should remain after cleanup.");
  const afterRevoke = await workboardList(workboardSession.access_token);
  assert.equal(afterRevoke.status, 403, "Revoked Workboard grant must deny subsequent API request.");
  assert.equal(await readAdminRole(identities.workboardStaff.profile.id), "staff", "Staff role must remain staff after revoke.");

  console.log("PASS: Employee E5A local runtime verification");
  console.log(`EVIDENCE: workboard module gate ok; staff assigned isolation ok; staff action boundary ok; owner/admin regression ok; calendar isolation ok; qaRun=${runId}`);
} finally {
  if (qaRows.length && cleanupRevokerId) await revokeAllActiveQaGrants(cleanupRevokerId).catch(() => {});
  if (qaTaskIds.length) await cleanupQaTasks().catch(() => {});
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
  const grantsTable = sqlValue("select exists (select 1 from information_schema.tables where table_schema='public' and table_name='employee_temporary_access_grants')");
  assert.equal(grantsTable, "t", "Temporary access table must exist.");
  const tasksTable = sqlValue("select exists (select 1 from information_schema.tables where table_schema='public' and table_name='tasks')");
  assert.equal(tasksTable, "t", "Tasks table must exist.");
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
    staffA: ["staff", true],
    staffB: ["staff", true],
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
      user_metadata: { display_name: `E5A ${key}`, trry_admin_role: role },
    });
    assert.ifError(createError);
    const { data: profile, error: profileError } = await service
      .from("admin_users")
      .insert({
        user_id: created.user.id,
        email,
        display_name: `E5A ${key}`,
        role,
        is_active: active,
      })
      .select("id,user_id,email,role,is_active")
      .single();
    assert.ifError(profileError);
    identities[key] = { email, authUser: created.user, profile };
  }
  identities.workboardStaff = identities.staffA;
  return identities;
}

async function seedTask(title, assignedUserId, reviewerUserId) {
  const { data, error } = await service
    .from("tasks")
    .insert({
      id: randomUUID(),
      task_code: nextTaskCode(),
      title: `${title} ${runId}`,
      brief: `Harmless local E5A QA task for ${runId}.`,
      source_type: "MANUAL",
      status: "TO_DO",
      priority: "MEDIUM",
      time_tracking_mode: "EXPECTED",
      assigned_user_id: assignedUserId,
      reviewer_user_id: reviewerUserId,
      draft_approval_required: false,
      submission_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("id,version")
    .single();
  assert.ifError(error);
  return data;
}

function nextTaskCode() {
  taskCodeCounter += 1;
  return `TSK-${String(Date.now()).slice(-8)}${String(taskCodeCounter).padStart(2, "0")}`;
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
    reason: `E5A runtime ${moduleCode} ${runId}`,
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

async function effectiveRequest(token, moduleCode) {
  const response = await fetch(`http://127.0.0.1:${appPort}/api/admin-users/effective-access?module=${encodeURIComponent(moduleCode)}`, {
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  return { status: response.status, body: await response.json().catch(() => ({ })) };
}

async function expectWorkboardList(token, statusCode, errorCode, message) {
  const response = await workboardList(token);
  assert.equal(response.status, statusCode, message);
  if (errorCode) assert.equal(response.body.error?.code, errorCode, message);
}

async function workboardList(token) {
  const response = await fetch(`http://127.0.0.1:${appPort}/api/tasks?status=TO_DO&pageSize=100`, {
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  return { status: response.status, body: await response.json().catch(() => ({ })) };
}

async function taskCommand(token, taskId, action, expectedVersion, body) {
  const response = await fetch(`http://127.0.0.1:${appPort}/api/tasks/${taskId}/${action}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": `${runId}-${action}-${taskId}`,
    },
    body: JSON.stringify({ expectedVersion, ...body }),
  });
  return { status: response.status, body: await response.json().catch(() => ({ })) };
}

async function createTask(token, assignedUserId, reviewerUserId) {
  const response = await fetch(`http://127.0.0.1:${appPort}/api/tasks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": `${runId}-create-forbidden`,
    },
    body: JSON.stringify({
      title: `Forbidden staff create ${runId}`,
      brief: "This should not be created.",
      sourceType: "MANUAL",
      priority: "MEDIUM",
      assignedUserId,
      reviewerUserId,
      draftApprovalRequired: false,
      submissionDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      timeTrackingMode: "EXPECTED",
    }),
  });
  return { status: response.status, body: await response.json().catch(() => ({ })) };
}

function hasTask(tasks, id) {
  return (tasks || []).some((task) => task.id === id);
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

async function cleanupQaTasks() {
  await service.from("task_events").delete().in("task_id", qaTaskIds);
  await service.from("task_submissions").delete().in("task_id", qaTaskIds);
  await service.from("task_time_entries").delete().in("task_id", qaTaskIds);
  await service.from("tasks").delete().in("id", qaTaskIds);
}

function sqlValue(sql) {
  return execFileSync("docker", ["exec", "supabase_db_Admin_portal", "psql", "-U", "postgres", "-d", "postgres", "-tAc", sql], { encoding: "utf8" }).trim();
}
