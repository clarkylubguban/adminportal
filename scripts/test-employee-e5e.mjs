import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const effectiveAccess = read("api/_lib/effectiveAccess.js");
const adminEffectiveAccess = read("src/services/adminEffectiveAccess.js");
const main = read("src/main.js");
const workflowApi = read("api/inquiries/[id]/workflow.js");
const paymentApi = read("api/inquiries/[id]/payment-confirmations.js");
const customerActionsApi = read("api/inquiries/[id]/customer-actions.js");
const assignmentApi = read("api/inquiries/[id]/assignment.js");
const migration = read("supabase/migrations/20260826062747_employee_e5e_production_temp_access.sql");
const packageJson = JSON.parse(read("package.json"));

assert.match(effectiveAccess, /EFFECTIVE_ACCESS_MODULES = new Set\(\[[^\]]*"production"/s, "production must be in the canonical effective-access module set");
assert.match(effectiveAccess, /\["production", new Set\(\["owner", "admin"\]\)\]/, "production permanent access must remain Owner/Admin only");
assert.match(effectiveAccess, /moduleCode === "production"\) return "Production"/, "production label must be canonical");

assert.match(adminEffectiveAccess, /getProductionEffectiveAccess\(session\)/, "frontend Production effective-access service missing");
assert.match(adminEffectiveAccess, /getEffectiveModuleAccess\(session, "production"\)/, "frontend Production service must call canonical endpoint");

assert.match(main, /getProductionEffectiveAccess/, "Production effective-access import missing");
assert.match(main, /productionEffectiveAccess = \{ module: "production"/, "Production effective-access state missing");
assert.match(main, /function canViewProductionRoute\(\)/, "Production route gate missing");
assert.match(main, /productionEffectiveAccess\.allowed === true && productionEffectiveAccess\.module === "production"/, "Production Staff gate must require active production module");
assert.match(main, /path === "\/production" && !canViewProductionRoute\(\)/, "direct /production route must be protected");
assert.match(main, /routePath === "\/production" && !canViewProductionRoute\(\)/, "programmatic /production navigation must be protected");
assert.equal((main.match(/\.\.\.\(canViewProductionRoute\(\) \? \[\{ label: "Production"/g) || []).length, 2, "desktop and mobile Production nav must be gated");
assert.equal(main.split(/\r?\n/).some((line) => line.includes("productionEffectiveAccess") && line.includes("localStorage")), false, "Production access must not trust localStorage");

assert.match(migration, /has_active_employee_temporary_access\('production'\)/g, "Production RLS must use active temp production grants");
assert.match(migration, /assigned_user_id = \(select auth\.uid\(\)\)/, "Production Staff RLS read must stay assigned-user scoped");
assert.match(migration, /status = 'won'/, "Production Staff RLS read must stay on confirmed order workflow rows");
assert.match(migration, /on public\.ops_inquiries[\s\S]*for select[\s\S]*has_active_employee_temporary_access\('production'\)/, "ops_inquiries select policy must include assigned temp production reads");
assert.match(migration, /on public\.orders[\s\S]*for select[\s\S]*has_active_employee_temporary_access\('production'\)/, "orders select policy must include linked production order reads");
assert.doesNotMatch(migration, /for update[\s\S]*has_active_employee_temporary_access\('production'\)/, "Production temp grant must not create broad update policy");
assert.doesNotMatch(migration, /for insert[\s\S]*has_active_employee_temporary_access\('production'\)/, "Production temp grant must not create insert policy");

assert.match(workflowApi, /getEffectiveModuleAccess\(supabase, adminUser, "production"\)/, "workflow API must consult canonical production effective access");
assert.match(workflowApi, /enforceTemporaryProductionBoundary/, "workflow API must enforce temp production record/action boundary");
assert.match(workflowApi, /STAFF_PRODUCTION_ACTIONS = new Set\(\["save_production", "start_production"\]\)/, "temporary Production Staff action set must stay narrow");
assert.match(workflowApi, /action === "release_production"[\s\S]*requireEffectiveModuleAccess\(supabase, adminUser, "inquiries"\)/, "release to Production must remain outside production temp authority");
assert.match(workflowApi, /assigned_user_id[\s\S]*adminUser\.userId/, "temporary Production Staff must stay assigned-record scoped");
for (const field of ["assignedUserId", "assignedStaff", "blockedReason", "dueDate"]) {
  assert.match(workflowApi, new RegExp(`"${field}"`), `${field} must be treated as manager-only for temp Production Staff`);
}

assert.match(paymentApi, /const WRITE_ROLES = new Set\(\["owner", "admin"\]\)/, "payment confirmation must remain Owner/Admin only");
assert.match(customerActionsApi, /requireEffectiveModuleAccess\(supabase, adminUser, "inquiries"\)/, "customer/fulfillment actions must remain gated by Inquiries");
assert.match(assignmentApi, /requireEffectiveModuleAccess\(supabase, caller, "inquiries"\)/, "assignment API must remain gated by Inquiries");

assert.equal(EFFECTIVE_ACCESS_MODULES_HAS(effectiveAccess, "inventory"), true, "Inventory temporary enforcement is owned by E5G and must remain available after E5E");
assert.equal(EFFECTIVE_ACCESS_MODULES_HAS(effectiveAccess, "pos_sales"), true, "POS Sales temporary authority is owned by E5I.3 and must remain available after E5E");
for (const forbidden of ["pricing_discounts", "people_access"]) {
  assert.equal(EFFECTIVE_ACCESS_MODULES_HAS(effectiveAccess, forbidden), false, `${forbidden} must not be added to canonical effective access in E5E`);
}

assert.equal(packageJson.scripts["test:employee-e5e"], "node scripts/test-employee-e5e.mjs", "E5E source test script missing");
assert.equal(packageJson.scripts["test:employee-e5e-runtime"], "node scripts/test-employee-e5e-runtime.mjs", "E5E runtime test script missing");

console.log("PASS: Employee E5E source enforcement checks");

function EFFECTIVE_ACCESS_MODULES_HAS(source, moduleCode) {
  const match = source.match(/EFFECTIVE_ACCESS_MODULES = new Set\(\[([^\]]+)\]\)/s);
  return Boolean(match && match[1].includes(`"${moduleCode}"`));
}

function read(path) {
  return readFileSync(path, "utf8");
}
