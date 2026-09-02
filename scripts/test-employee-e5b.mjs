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
const catalogService = fs.readFileSync("src/services/adminCatalog.js", "utf8");
const packageJson = fs.readFileSync("package.json", "utf8");

assert.equal(EFFECTIVE_ACCESS_MODULES.has("master_catalog"), true, "Master Catalog must use the canonical effective-access evaluator.");
assert.equal(EFFECTIVE_ACCESS_MODULES.has("calendar"), true, "Calendar effective access must remain enabled.");
assert.equal(EFFECTIVE_ACCESS_MODULES.has("workboard"), true, "Workboard effective access must remain enabled.");
assert.equal(EFFECTIVE_ACCESS_MODULES.has("inventory"), true, "Inventory temporary enforcement is owned by E5G and must remain available after E5B.");
assert.equal(EFFECTIVE_ACCESS_MODULES.has("purchasing"), false, "Purchasing temporary enforcement must remain out of scope.");
assert.equal(EFFECTIVE_ACCESS_MODULES.has("people_access"), false, "People & Access temporary enforcement must remain out of scope.");
assert.equal(hasPermanentModuleAccess({ role: "owner" }, "master_catalog"), true, "Owner permanent Master Catalog access must be preserved.");
assert.equal(hasPermanentModuleAccess({ role: "admin" }, "master_catalog"), true, "Admin permanent Master Catalog access must be preserved.");
assert.equal(hasPermanentModuleAccess({ role: "staff" }, "master_catalog"), false, "Staff Master Catalog entry must depend on temporary grant authority.");

const staff = { id: "staff-row", userId: "staff-auth", role: "staff" };
const owner = { id: "owner-row", userId: "owner-auth", role: "owner" };
const now = new Date("2026-08-26T06:00:00.000Z");
const catalogClient = grantClient([{ module_code: "master_catalog", starts_at: "2026-08-26T05:00:00.000Z", expires_at: "2026-08-26T16:00:00.000Z", revoked_at: null }]);
const calendarClient = grantClient([{ module_code: "calendar", starts_at: "2026-08-26T05:00:00.000Z", expires_at: "2026-08-26T16:00:00.000Z", revoked_at: null }]);
const workboardClient = grantClient([{ module_code: "workboard", starts_at: "2026-08-26T05:00:00.000Z", expires_at: "2026-08-26T16:00:00.000Z", revoked_at: null }]);
const revokedClient = grantClient([{ module_code: "master_catalog", starts_at: "2026-08-26T05:00:00.000Z", expires_at: "2026-08-26T16:00:00.000Z", revoked_at: "2026-08-26T06:00:00.000Z" }]);
const expiredClient = grantClient([{ module_code: "master_catalog", starts_at: "2026-08-25T05:00:00.000Z", expires_at: "2026-08-26T05:59:00.000Z", revoked_at: null }]);

assert.deepEqual(await getEffectiveModuleAccess(catalogClient, owner, "master_catalog", now), { module: "master_catalog", allowed: true, source: "permanent", expiresAt: null }, "Permanent Master Catalog access must not depend on grants.");
assert.equal((await getEffectiveModuleAccess(catalogClient, staff, "master_catalog", now)).source, "temporary", "Active Master Catalog grant must allow Staff.");
assert.equal((await getEffectiveModuleAccess(grantClient([]), staff, "master_catalog", now)).allowed, false, "No grant must deny Staff Master Catalog effective access.");
assert.equal((await getEffectiveModuleAccess(calendarClient, staff, "master_catalog", now)).allowed, false, "Calendar-only grant must not unlock Master Catalog.");
assert.equal((await getEffectiveModuleAccess(workboardClient, staff, "master_catalog", now)).allowed, false, "Workboard-only grant must not unlock Master Catalog.");
assert.equal((await getEffectiveModuleAccess(revokedClient, staff, "master_catalog", now)).allowed, false, "Revoked Master Catalog grant must not unlock Master Catalog.");
assert.equal((await getEffectiveModuleAccess(expiredClient, staff, "master_catalog", now)).allowed, false, "Expired Master Catalog grant must not unlock Master Catalog.");

assert.ok(effectiveApi.includes("getAuthorizedAdmin") && effectiveApi.includes("getEffectiveModuleAccess"), "Effective access endpoint must remain server-authenticated.");
assert.ok(effectiveService.includes("getMasterCatalogEffectiveAccess") && !effectiveService.includes("localStorage"), "Browser must use server access for Master Catalog and not localStorage authority.");
assert.ok(main.includes("masterCatalogEffectiveAccess") && main.includes("getMasterCatalogEffectiveAccess"), "Master Catalog route/nav must consume effective access state.");
assert.match(main, /function canViewMasterCatalogRoute\(\)[\s\S]*\["owner", "admin"\]\.includes\(adminUser\?\.role\)[\s\S]*masterCatalogEffectiveAccess\.module === "master_catalog"/, "Master Catalog route must allow Owner/Admin or active master_catalog access.");
assert.ok(main.includes('if (path === "/catalog" && !canViewMasterCatalogRoute()) return defaultRoutePath;'), "Direct Master Catalog URL must be route-guarded.");
assert.ok(main.includes('if (routePath === "/catalog" && !canViewMasterCatalogRoute()) return defaultRoutePath;'), "Master Catalog navigation must be route-guarded.");
assert.ok(main.includes("function canWriteCatalogProducts()") && main.includes('return ["owner", "admin"].includes(adminUser?.role);'), "Catalog write controls must remain Owner/Admin only.");
assert.equal(main.includes("canWriteCatalogProducts() || masterCatalogEffectiveAccess"), false, "Temporary Master Catalog access must not be used as write authority.");
assert.ok(catalogService.includes("readSupabaseTableWithAuth") && catalogService.includes("updateAdminProduct"), "Catalog read/write services must remain authenticated Supabase-backed services.");
assert.ok(packageJson.includes('"test:employee-e5b"') && packageJson.includes('"test:employee-e5b-runtime"'), "package.json must expose E5B tests.");

function grantClient(rows) {
  return {
    from(table) {
      assert.equal(table, "employee_temporary_access_grants");
      const query = {
        rows,
        select() { return query; },
        eq(column, value) {
          query.rows = query.rows.filter((row) => row[column] === value || (column === "employee_id" && value === staff.id));
          return query;
        },
        lte(column, value) {
          query.rows = query.rows.filter((row) => new Date(row[column]).getTime() <= new Date(value).getTime());
          return query;
        },
        gt(column, value) {
          query.rows = query.rows.filter((row) => new Date(row[column]).getTime() > new Date(value).getTime());
          return query;
        },
        is(column, value) {
          query.rows = query.rows.filter((row) => row[column] === value);
          return query;
        },
        order() { return query; },
        limit() {
          return Promise.resolve({ data: query.rows.slice(0, 1), error: null });
        },
      };
      return query;
    },
  };
}

console.log("PASS: Employee E5B temporary Master Catalog access enforcement");
