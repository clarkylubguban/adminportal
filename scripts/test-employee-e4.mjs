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
const effectiveHelper = fs.readFileSync("api/_lib/effectiveAccess.js", "utf8");
const taskApi = fs.readFileSync("api/_lib/taskApi.js", "utf8");
const taskRoutes = fs.readFileSync("api/_lib/taskRouteHandlers.js", "utf8");
const taskService = fs.readFileSync("api/_lib/taskService.js", "utf8");
const localDev = fs.readFileSync("scripts/local-dev.mjs", "utf8");
const packageJson = fs.readFileSync("package.json", "utf8");

assert.equal(EFFECTIVE_ACCESS_MODULES.has("calendar"), true, "Calendar must remain in the effective-access pilot set.");
assert.equal(hasPermanentModuleAccess({ role: "owner" }, "calendar"), true, "Owner permanent Calendar access must be preserved.");
assert.equal(hasPermanentModuleAccess({ role: "admin" }, "calendar"), true, "Admin permanent Calendar access must be preserved.");
assert.equal(hasPermanentModuleAccess({ role: "staff" }, "calendar"), false, "Staff Calendar access must require temporary grant authority.");

const staff = { id: "staff-row", userId: "staff-auth", role: "staff" };
const owner = { id: "owner-row", userId: "owner-auth", role: "owner" };
const now = new Date("2026-08-25T06:00:00.000Z");
const activeClient = grantClient([{ module_code: "calendar", starts_at: "2026-08-25T05:00:00.000Z", expires_at: "2026-08-25T16:00:00.000Z", revoked_at: null }]);
const wrongModuleClient = grantClient([{ module_code: "inventory", starts_at: "2026-08-25T05:00:00.000Z", expires_at: "2026-08-25T16:00:00.000Z", revoked_at: null }]);
const revokedClient = grantClient([{ module_code: "calendar", starts_at: "2026-08-25T05:00:00.000Z", expires_at: "2026-08-25T16:00:00.000Z", revoked_at: "2026-08-25T06:00:00.000Z" }]);
const expiredClient = grantClient([{ module_code: "calendar", starts_at: "2026-08-24T05:00:00.000Z", expires_at: "2026-08-25T05:59:00.000Z", revoked_at: null }]);

assert.deepEqual(await getEffectiveModuleAccess(activeClient, owner, "calendar", now), { module: "calendar", allowed: true, source: "permanent", expiresAt: null }, "Permanent access must not depend on grants.");
assert.equal((await getEffectiveModuleAccess(activeClient, staff, "calendar", now)).source, "temporary", "Active Calendar grant must allow Staff.");
assert.equal((await getEffectiveModuleAccess(grantClient([]), staff, "calendar", now)).allowed, false, "No Calendar grant must block Staff.");
assert.equal((await getEffectiveModuleAccess(wrongModuleClient, staff, "calendar", now)).allowed, false, "Wrong-module grant must not unlock Calendar.");
assert.equal((await getEffectiveModuleAccess(revokedClient, staff, "calendar", now)).allowed, false, "Revoked Calendar grant must not unlock Calendar.");
assert.equal((await getEffectiveModuleAccess(expiredClient, staff, "calendar", now)).allowed, false, "Expired Calendar grant must not unlock Calendar.");
assert.equal((await getEffectiveModuleAccess(activeClient, staff, "inventory", now)).allowed, false, "E4 must not enforce or expose non-Calendar modules.");

assert.ok(effectiveApi.includes("getAuthorizedAdmin") && effectiveApi.includes("getEffectiveModuleAccess"), "Effective access endpoint must be server-authenticated.");
assert.ok(effectiveService.includes("getCalendarEffectiveAccess") && effectiveService.includes("module=${encodeURIComponent(moduleCode)}"), "Browser must ask server for effective Calendar access.");
assert.ok(taskApi.includes(".select(\"id,user_id,role,is_active\")"), "Task auth actor must include admin_users.id for grant lookup.");
assert.ok(taskRoutes.includes("requireEffectiveModuleAccess") && taskRoutes.includes("\"calendar\""), "Calendar API must use canonical effective access gate.");
assert.match(taskRoutes, /handleTaskCalendar[\s\S]*methods: \["GET"\][\s\S]*requireEffectiveModuleAccess[\s\S]*listCalendarEvents/, "Calendar API must remain a read-only GET behind effective access.");
assert.ok(/admin-users\\\/effective-access/.test(localDev) && localDev.includes("admin-users/[...path].js"), "Local dev route must expose effective access endpoint.");
assert.ok(main.includes("calendarEffectiveAccess") && main.includes("getCalendarEffectiveAccess"), "Calendar nav/route must use effective access state.");
assert.match(main, /function canViewCalendarRoute\(\)[\s\S]*?\["owner", "admin"\]\.includes\(adminUser\?\.role\)[\s\S]*?calendarEffectiveAccess\.allowed === true/, "Staff Calendar UI access must require an effective-access grant.");
assert.ok(main.includes("canViewProductionRoute"), "Production temporary enforcement is owned by E5E and must remain available after E4.");
assert.ok(main.includes("canViewInventoryRoute"), "Inventory temporary enforcement is owned by E5G and must remain available after E4.");
assert.ok(packageJson.includes('"test:employee-e4"'), "package.json must expose E4 test.");

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

console.log("PASS: Employee E4 Calendar effective access enforcement");
