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
const opsService = fs.readFileSync("src/services/opsBoard.js", "utf8");
const workflowApi = fs.readFileSync("api/inquiries/[id]/workflow.js", "utf8");
const customerActionsApi = fs.readFileSync("api/inquiries/[id]/customer-actions.js", "utf8");
const assignmentApi = fs.readFileSync("api/inquiries/[id]/assignment.js", "utf8");
const artworkApi = fs.readFileSync("api/inquiries/[id]/artwork.js", "utf8");
const migration = fs.readFileSync("supabase/migrations/20260826022811_employee_e5c_inquiries_temp_access.sql", "utf8");
const localDev = fs.readFileSync("scripts/local-dev.mjs", "utf8");
const packageJson = fs.readFileSync("package.json", "utf8");

assert.equal(EFFECTIVE_ACCESS_MODULES.has("inquiries"), true, "Inquiries must use the canonical effective-access evaluator.");
assert.equal(EFFECTIVE_ACCESS_MODULES.has("calendar"), true, "Calendar effective access must remain enabled.");
assert.equal(EFFECTIVE_ACCESS_MODULES.has("workboard"), true, "Workboard effective access must remain enabled.");
assert.equal(EFFECTIVE_ACCESS_MODULES.has("master_catalog"), true, "Master Catalog effective access must remain enabled.");
assert.equal(EFFECTIVE_ACCESS_MODULES.has("orders"), true, "Orders temporary enforcement is owned by E5D and must remain enabled after E5C.");
assert.equal(EFFECTIVE_ACCESS_MODULES.has("pricing_discounts"), false, "Pricing temporary enforcement must remain out of scope.");
assert.equal(EFFECTIVE_ACCESS_MODULES.has("facebook_inbox"), false, "Facebook Inbox temporary enforcement must remain out of scope.");
assert.equal(hasPermanentModuleAccess({ role: "owner" }, "inquiries"), true, "Owner permanent Inquiries access must be preserved.");
assert.equal(hasPermanentModuleAccess({ role: "admin" }, "inquiries"), true, "Admin permanent Inquiries access must be preserved.");
assert.equal(hasPermanentModuleAccess({ role: "staff" }, "inquiries"), false, "Staff Inquiries entry must depend on temporary grant authority.");

const staff = { id: "staff-row", userId: "staff-auth", role: "staff" };
const owner = { id: "owner-row", userId: "owner-auth", role: "owner" };
const now = new Date("2026-08-26T06:00:00.000Z");
const inquiriesClient = grantClient([{ module_code: "inquiries", starts_at: "2026-08-26T05:00:00.000Z", expires_at: "2026-08-26T16:00:00.000Z", revoked_at: null }]);
const calendarClient = grantClient([{ module_code: "calendar", starts_at: "2026-08-26T05:00:00.000Z", expires_at: "2026-08-26T16:00:00.000Z", revoked_at: null }]);
const workboardClient = grantClient([{ module_code: "workboard", starts_at: "2026-08-26T05:00:00.000Z", expires_at: "2026-08-26T16:00:00.000Z", revoked_at: null }]);
const catalogClient = grantClient([{ module_code: "master_catalog", starts_at: "2026-08-26T05:00:00.000Z", expires_at: "2026-08-26T16:00:00.000Z", revoked_at: null }]);
const revokedClient = grantClient([{ module_code: "inquiries", starts_at: "2026-08-26T05:00:00.000Z", expires_at: "2026-08-26T16:00:00.000Z", revoked_at: "2026-08-26T06:00:00.000Z" }]);
const expiredClient = grantClient([{ module_code: "inquiries", starts_at: "2026-08-25T05:00:00.000Z", expires_at: "2026-08-26T05:59:00.000Z", revoked_at: null }]);

assert.deepEqual(await getEffectiveModuleAccess(inquiriesClient, owner, "inquiries", now), { module: "inquiries", allowed: true, source: "permanent", expiresAt: null }, "Permanent Inquiries access must not depend on grants.");
assert.equal((await getEffectiveModuleAccess(inquiriesClient, staff, "inquiries", now)).source, "temporary", "Active Inquiries grant must allow Staff.");
assert.equal((await getEffectiveModuleAccess(grantClient([]), staff, "inquiries", now)).allowed, false, "No grant must deny Staff Inquiries effective access.");
assert.equal((await getEffectiveModuleAccess(calendarClient, staff, "inquiries", now)).allowed, false, "Calendar-only grant must not unlock Inquiries.");
assert.equal((await getEffectiveModuleAccess(workboardClient, staff, "inquiries", now)).allowed, false, "Workboard-only grant must not unlock Inquiries.");
assert.equal((await getEffectiveModuleAccess(catalogClient, staff, "inquiries", now)).allowed, false, "Master Catalog-only grant must not unlock Inquiries.");
assert.equal((await getEffectiveModuleAccess(revokedClient, staff, "inquiries", now)).allowed, false, "Revoked Inquiries grant must not unlock Inquiries.");
assert.equal((await getEffectiveModuleAccess(expiredClient, staff, "inquiries", now)).allowed, false, "Expired Inquiries grant must not unlock Inquiries.");

assert.ok(effectiveApi.includes("getAuthorizedAdmin") && effectiveApi.includes("getEffectiveModuleAccess"), "Effective access endpoint must remain server-authenticated.");
assert.ok(effectiveService.includes("getInquiriesEffectiveAccess") && !effectiveService.includes("localStorage"), "Browser must use server access for Inquiries and not localStorage authority.");
assert.ok(main.includes("inquiriesEffectiveAccess") && main.includes("getInquiriesEffectiveAccess"), "Inquiries route/nav must consume effective access state.");
assert.match(main, /function canViewInquiriesRoute\(\)[\s\S]*\["owner", "admin"\]\.includes\(adminUser\?\.role\)[\s\S]*inquiriesEffectiveAccess\.module === "inquiries"/, "Inquiries route must allow Owner/Admin or active inquiries access.");
assert.ok(main.includes('if (path === "/inquiries" && !canViewInquiriesRoute()) return defaultRoutePath;'), "Direct Inquiries URL must be route-guarded.");
assert.ok(main.includes('if (routePath === "/inquiries" && !canViewInquiriesRoute()) return defaultRoutePath;'), "Inquiries navigation must be route-guarded.");
assert.ok(opsService.includes('OPS_INQUIRIES_TABLE = "ops_inquiries"') && opsService.includes("readSupabaseTableWithAuth"), "Inquiries read path must remain authenticated Supabase-backed.");
assert.ok(workflowApi.includes('requireEffectiveModuleAccess(supabase, adminUser, "inquiries")'), "Workflow API must enforce Inquiries module access server-side.");
assert.ok(customerActionsApi.includes('requireEffectiveModuleAccess(supabase, adminUser, "inquiries")'), "Customer actions API must enforce Inquiries module access server-side.");
assert.ok(assignmentApi.includes('requireEffectiveModuleAccess(supabase, caller, "inquiries")'), "Assignment API must enforce Inquiries module access server-side.");
assert.ok(
  artworkApi.includes('getEffectiveModuleAccess(supabase, adminUser, "inquiries")')
    && artworkApi.includes('getEffectiveModuleAccess(supabase, adminUser, "design_artwork")')
    && artworkApi.includes('return requireEffectiveModuleAccess(supabase, adminUser, "inquiries")'),
  "Artwork API must enforce Inquiries access, with E5F-owned design_artwork access only for the artwork surface."
);
assert.ok(localDev.includes("\\/assignment\\/?$") && localDev.includes("handleAssignmentRequest"), "Local dev router must expose the protected assignment API.");
assert.ok(migration.includes("has_active_employee_temporary_access") && migration.includes("employee_temporary_access_grants"), "RLS migration must use temporary access grants.");
assert.ok(migration.includes("is_active_admin_user(array['owner','admin'])") && migration.includes("has_active_employee_temporary_access('inquiries')"), "RLS must preserve Owner/Admin permanent access and allow only active Inquiries temp Staff.");
assert.equal(main.includes("canViewOrdersRoute"), true, "Orders temporary enforcement is owned by E5D and must remain enabled after E5C.");
assert.equal(main.includes("pricingEffectiveAccess"), false, "E5C must not add Pricing temporary enforcement.");
assert.equal(main.includes("facebook"), false, "E5C must not touch Facebook Inbox routing in main.js.");
assert.ok(packageJson.includes('"test:employee-e5c"') && packageJson.includes('"test:employee-e5c-runtime"'), "package.json must expose E5C tests.");

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

console.log("PASS: Employee E5C temporary Inquiries access enforcement");
