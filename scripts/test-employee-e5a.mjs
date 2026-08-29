import assert from "node:assert/strict";
import fs from "node:fs";
import {
  EFFECTIVE_ACCESS_MODULES,
  getEffectiveModuleAccess,
  hasPermanentModuleAccess,
} from "../api/_lib/effectiveAccess.js";

const main = fs.readFileSync("src/main.js", "utf8");
const effectiveService = fs.readFileSync("src/services/adminEffectiveAccess.js", "utf8");
const effectiveApi = fs.readFileSync("api/_lib/adminUsersEffectiveAccessRoute.js", "utf8");
const taskRoutes = fs.readFileSync("api/_lib/taskRouteHandlers.js", "utf8");
const packageJson = fs.readFileSync("package.json", "utf8");

assert.equal(EFFECTIVE_ACCESS_MODULES.has("workboard"), true, "Workboard must use the canonical effective-access evaluator.");
assert.equal(EFFECTIVE_ACCESS_MODULES.has("production"), true, "Production temporary enforcement is owned by E5E and must remain available after E5A.");
assert.equal(EFFECTIVE_ACCESS_MODULES.has("inventory"), true, "Inventory temporary enforcement is owned by E5G and must remain available after E5A.");
assert.equal(EFFECTIVE_ACCESS_MODULES.has("people_access"), false, "People & Access temporary enforcement must remain out of scope.");
assert.equal(hasPermanentModuleAccess({ role: "owner" }, "workboard"), true, "Owner permanent Workboard access must be preserved.");
assert.equal(hasPermanentModuleAccess({ role: "admin" }, "workboard"), true, "Admin permanent Workboard access must be preserved.");
assert.equal(hasPermanentModuleAccess({ role: "staff" }, "workboard"), false, "Staff Workboard access must require temporary grant authority.");

const staff = { id: "staff-row", userId: "staff-auth", role: "staff" };
const owner = { id: "owner-row", userId: "owner-auth", role: "owner" };
const now = new Date("2026-08-25T06:00:00.000Z");
const workboardClient = grantClient([{ module_code: "workboard", starts_at: "2026-08-25T05:00:00.000Z", expires_at: "2026-08-25T16:00:00.000Z", revoked_at: null }]);
const calendarClient = grantClient([{ module_code: "calendar", starts_at: "2026-08-25T05:00:00.000Z", expires_at: "2026-08-25T16:00:00.000Z", revoked_at: null }]);
const inventoryClient = grantClient([{ module_code: "inventory", starts_at: "2026-08-25T05:00:00.000Z", expires_at: "2026-08-25T16:00:00.000Z", revoked_at: null }]);
const revokedClient = grantClient([{ module_code: "workboard", starts_at: "2026-08-25T05:00:00.000Z", expires_at: "2026-08-25T16:00:00.000Z", revoked_at: "2026-08-25T06:00:00.000Z" }]);
const expiredClient = grantClient([{ module_code: "workboard", starts_at: "2026-08-24T05:00:00.000Z", expires_at: "2026-08-25T05:59:00.000Z", revoked_at: null }]);

assert.deepEqual(await getEffectiveModuleAccess(workboardClient, owner, "workboard", now), { module: "workboard", allowed: true, source: "permanent", expiresAt: null }, "Permanent Workboard access must not depend on grants.");
assert.equal((await getEffectiveModuleAccess(workboardClient, staff, "workboard", now)).source, "temporary", "Active Workboard grant must allow Staff.");
assert.equal((await getEffectiveModuleAccess(grantClient([]), staff, "workboard", now)).allowed, false, "No grant must deny Staff Workboard.");
assert.equal((await getEffectiveModuleAccess(calendarClient, staff, "workboard", now)).allowed, false, "Calendar-only grant must not unlock Workboard.");
assert.equal((await getEffectiveModuleAccess(inventoryClient, staff, "workboard", now)).allowed, false, "Inventory grant must not unlock Workboard.");
assert.equal((await getEffectiveModuleAccess(revokedClient, staff, "workboard", now)).allowed, false, "Revoked Workboard grant must not unlock Workboard.");
assert.equal((await getEffectiveModuleAccess(expiredClient, staff, "workboard", now)).allowed, false, "Expired Workboard grant must not unlock Workboard.");

assert.ok(effectiveApi.includes("getAuthorizedAdmin") && effectiveApi.includes("getEffectiveModuleAccess"), "Effective access endpoint must be server-authenticated.");
assert.ok(effectiveService.includes("getWorkboardEffectiveAccess") && !effectiveService.includes("localStorage"), "Browser must use server access for Workboard and not localStorage authority.");
assert.match(taskRoutes, /handleTaskCollection[\s\S]*requireEffectiveModuleAccess\(supabase, context\.actor, "workboard"\)[\s\S]*assignedToCaller: context\.actor\.role === "staff"[\s\S]*requireManager\(context\.actor\)/, "Workboard GET must use module gate plus Staff assigned scope while POST remains manager-only.");
assert.ok(main.includes("workboardEffectiveAccess") && main.includes("getWorkboardEffectiveAccess"), "Workboard route/nav must use effective access state.");
assert.ok(main.includes("canManageWorkboardTasks() ? `<button class=\"ops-gold-button\" data-workboard-create"), "Staff temporary Workboard must not expose Create Task control.");
assert.ok(main.includes("canViewProductionRoute"), "Production temporary enforcement is owned by E5E and must remain available after E5A.");
assert.ok(main.includes("canViewInventoryRoute"), "Inventory temporary enforcement is owned by E5G and must remain available after E5A.");
assert.equal(main.includes("canViewPosRoute"), false, "E5A must not add POS temporary enforcement.");
assert.ok(packageJson.includes('"test:employee-e5a"') && packageJson.includes('"test:employee-e5a-runtime"'), "package.json must expose E5A tests.");

function grantClient(rows) {
  return {
    from(table) {
      assert.equal(table, "employee_temporary_access_grants");
      const query = {
        select() { return query; },
        eq(column, value) {
          query.rows = (query.rows || rows).filter((row) => row[column] === value || (column === "employee_id" && value === staff.id));
          return query;
        },
        lte(column, value) {
          query.rows = (query.rows || rows).filter((row) => new Date(row[column]).getTime() <= new Date(value).getTime());
          return query;
        },
        gt(column, value) {
          query.rows = (query.rows || rows).filter((row) => new Date(row[column]).getTime() > new Date(value).getTime());
          return query;
        },
        is(column, value) {
          query.rows = (query.rows || rows).filter((row) => row[column] === value);
          return query;
        },
        order() { return query; },
        limit() {
          return Promise.resolve({ data: (query.rows || rows).slice(0, 1), error: null });
        },
      };
      return query;
    },
  };
}

console.log("PASS: Employee E5A temporary Workboard access enforcement");
