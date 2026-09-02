import assert from "node:assert/strict";
import fs from "node:fs";
import {
  PROTECTED_TEMPORARY_ACCESS_MODULES,
  TEMPORARY_ACCESS_MODULES,
  UNAVAILABLE_TEMPORARY_ACCESS_MODULES,
  assertTemporaryAccessTarget,
  getManilaBusinessDayWindow,
  isGrantActive,
  normalizeModuleCodes,
  validateModuleCodes,
} from "../api/_lib/employeeTemporaryAccess.js";

const main = fs.readFileSync("src/main.js", "utf8");
const css = fs.readFileSync("src/employeeE1.css", "utf8");
const service = fs.readFileSync("src/services/adminEmployeeTemporaryAccess.js", "utf8");
const api = fs.readFileSync("api/_lib/adminUsersTemporaryAccessRoute.js", "utf8");
const helper = fs.readFileSync("api/_lib/employeeTemporaryAccess.js", "utf8");
const migration = fs.readFileSync("supabase/migrations/202608250001_add_employee_temporary_access_grants.sql", "utf8");
const packageJson = fs.readFileSync("package.json", "utf8");
const localDev = fs.readFileSync("scripts/local-dev.mjs", "utf8");

assert.equal(TEMPORARY_ACCESS_MODULES.length, 12, "Approved module allowlist must have 12 codes.");
assert.deepEqual(normalizeModuleCodes(["inventory", "inventory", "orders"]), ["inventory", "orders"], "Module normalization must dedupe.");
assert.equal(validateModuleCodes(["inventory"], { role: "admin" }).ok, true, "Admin may grant non-protected modules.");
assert.equal(validateModuleCodes(["people_access"], { role: "admin" }).ok, false, "Admin must not grant protected modules.");
assert.equal(validateModuleCodes(["people_access"], { role: "owner" }).ok, false, "Owner must not grant parked People & Access temporary access.");
assert.equal(validateModuleCodes(["pricing_discounts"], { role: "owner" }).ok, false, "Owner must not grant parked Pricing & Discounts temporary access.");
assert.equal(validateModuleCodes(["unknown"], { role: "owner" }).ok, false, "Unknown module must be blocked.");
assert.equal(PROTECTED_TEMPORARY_ACCESS_MODULES.has("pricing_discounts"), true, "Pricing protected module missing.");
assert.equal(PROTECTED_TEMPORARY_ACCESS_MODULES.has("people_access"), true, "People Access protected module missing.");
assert.equal(UNAVAILABLE_TEMPORARY_ACCESS_MODULES.has("pricing_discounts"), true, "Pricing must be marked unavailable for temporary access.");
assert.equal(UNAVAILABLE_TEMPORARY_ACCESS_MODULES.has("people_access"), true, "People Access must be marked unavailable for temporary access.");

const manilaWindow = getManilaBusinessDayWindow(new Date("2026-08-25T02:30:00.000Z"));
assert.equal(manilaWindow.startsAt, "2026-08-25T02:30:00.000Z", "Server start time must come from server now.");
assert.equal(manilaWindow.expiresAt, "2026-08-25T16:00:00.000Z", "Expiry must be next Asia/Manila midnight in UTC.");
assert.equal(isGrantActive({ starts_at: "2026-08-25T02:30:00.000Z", expires_at: "2026-08-25T16:00:00.000Z", revoked_at: null }, new Date("2026-08-25T15:59:59.000Z")), true, "Grant should be active before expiry.");
assert.equal(isGrantActive({ starts_at: "2026-08-25T02:30:00.000Z", expires_at: "2026-08-25T16:00:00.000Z", revoked_at: null }, new Date("2026-08-25T16:00:00.000Z")), false, "Grant should be inactive at expiry.");
assert.equal(isGrantActive({ starts_at: "2026-08-25T02:30:00.000Z", expires_at: "2026-08-25T16:00:00.000Z", revoked_at: "2026-08-25T10:00:00.000Z" }, new Date("2026-08-25T12:00:00.000Z")), false, "Revoked grant must be inactive.");

const owner = { id: "owner-row", userId: "owner-auth", role: "owner" };
const admin = { id: "admin-row", userId: "admin-auth", role: "admin" };
const staff = { id: "staff-row", user_id: "staff-auth", role: "staff", is_active: true };
assert.equal(assertTemporaryAccessTarget(owner, staff), "", "Owner should manage active staff target.");
assert.equal(assertTemporaryAccessTarget(admin, staff), "", "Admin should manage active staff target.");
assert.match(assertTemporaryAccessTarget(admin, { ...staff, id: "admin-target", role: "admin" }), /staff/, "Admin target must be staff.");
assert.match(assertTemporaryAccessTarget(admin, { ...staff, is_active: false }), /active/, "Inactive target must be blocked.");
assert.match(assertTemporaryAccessTarget(admin, { ...staff, user_id: "admin-auth" }), /own account/, "Self-grant must be blocked.");

assert.match(migration, /create table if not exists public\.employee_temporary_access_grants/, "Migration must create temp access table.");
for (const field of ["id uuid primary key", "employee_id uuid not null", "module_code text not null", "granted_by uuid not null", "starts_at timestamptz not null", "expires_at timestamptz not null", "reason text", "revoked_at timestamptz", "revoked_by uuid", "created_at timestamptz not null"]) {
  assert.ok(migration.includes(field), `Migration missing field: ${field}`);
}
assert.match(migration, /employee_id uuid not null references public\.admin_users\(id\) on delete restrict/, "Employee FK must reference canonical admin_users.");
assert.match(migration, /granted_by uuid not null references public\.admin_users\(id\) on delete restrict/, "Grant author FK must reference canonical admin_users.");
assert.match(migration, /revoked_by uuid references public\.admin_users\(id\) on delete set null/, "Revoker FK must reference canonical admin_users.");
assert.ok(migration.includes("revoked_at is null"), "Active duplicate guard must preserve revoked historical rows.");
assert.ok(!migration.includes("on delete cascade"), "Migration must not casually cascade-delete historical grants.");
assert.ok(!migration.match(/create table .*public\.employees/), "No duplicate employee table is allowed.");

assert.ok(api.includes("getAuthorizedAdmin") && helper.includes("canManageTarget"), "API must reuse canonical auth/manage helpers.");
assert.ok(api.includes("getManilaBusinessDayWindow(now)") && !api.includes("body.expires_at") && !api.includes("body.expiresAt"), "Server must calculate expiry and reject client expiry control.");
assert.ok(api.includes(".insert(rows)") && api.includes("activeCodes") && api.includes("missingCodes"), "Grant API must avoid duplicate active grants.");
assert.ok(api.includes(".update({ revoked_at: now, revoked_by: caller.id })"), "Revoke must set server revoked_at and revoker.");
assert.ok(!api.includes(".delete()"), "Revoke must not delete grant rows.");
assert.ok(!api.includes(".from(\"admin_users\")\n    .update") && !api.includes("updates.role"), "Temporary grant API must not change permanent roles.");

assert.ok(service.includes("/api/admin-users/temporary-access"), "Browser service must use server API boundary.");
assert.ok(!service.includes("readSupabaseTable") && !service.includes("writeSupabaseTable"), "Browser must not directly mutate Supabase temporary grants.");
assert.ok(main.includes("Authorize for Today") && main.includes("employee-temp-access-form"), "Authorize for Today modal missing.");
assert.ok(main.includes("employeeTemporaryAccessModules.map") && main.includes("SELECTED"), "Module multi-select and selection count missing.");
assert.ok(service.includes("Not available yet") && service.includes("Not available for temporary access"), "Protected unavailable module helper copy missing.");
assert.ok(main.includes("item.unavailableReason") && main.includes("is-unavailable") && main.includes("disabled"), "Unavailable protected modules must render disabled.");
assert.ok(main.includes("Expires today · 11:59 PM") && main.includes("Permanent role stays unchanged"), "Expiry copy missing.");
assert.ok(main.includes("TEMP ·") && main.includes("REVOKE NOW"), "TEMP badge or Revoke Now missing.");
assert.ok(main.includes("data-staff-edit") && main.includes("data-staff-disable") && main.includes("data-staff-activate"), "E2 lifecycle controls must remain.");
assert.ok(css.includes(".employee-temp-modal") && css.includes(".employee-temp-banner"), "Temporary access UI CSS missing.");
assert.ok(/admin-users\\\/temporary-access/.test(localDev) && localDev.includes("admin-users/[...path].js"), "Local dev API route missing.");
assert.ok(packageJson.includes('"test:employee-e3"'), "package.json must expose E3 test.");

for (const forbidden of ["Attendance", "Payroll", "temporary permission gates", "canViewPosRoute"]) {
  assert.equal(main.includes(forbidden), false, `Out-of-scope implementation changed or appeared: ${forbidden}`);
}

console.log("PASS: Employee E3 temporary access guard");
