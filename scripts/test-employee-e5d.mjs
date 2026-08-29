import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const effectiveAccess = read("api/_lib/effectiveAccess.js");
const adminEffectiveAccess = read("src/services/adminEffectiveAccess.js");
const main = read("src/main.js");
const migration = read("supabase/migrations/20260826031500_employee_e5d_orders_temp_access.sql");
const paymentApi = read("api/inquiries/[id]/payment-confirmations.js");
const workflowApi = read("api/inquiries/[id]/workflow.js");
const localDev = read("scripts/local-dev.mjs");
const packageJson = JSON.parse(read("package.json"));

assert.match(effectiveAccess, /EFFECTIVE_ACCESS_MODULES = new Set\(\[[^\]]*"orders"/s, "orders must be in the canonical effective-access module set");
assert.match(effectiveAccess, /\["orders", new Set\(\["owner", "admin"\]\)\]/, "orders permanent access must remain Owner/Admin only");
assert.match(effectiveAccess, /moduleCode === "orders"\) return "Orders"/, "orders label must be canonical");

assert.match(adminEffectiveAccess, /getOrdersEffectiveAccess\(session\)/, "frontend Orders effective-access service missing");
assert.match(adminEffectiveAccess, /getEffectiveModuleAccess\(session, "orders"\)/, "frontend Orders service must call canonical endpoint");

assert.match(main, /getOrdersEffectiveAccess/, "Orders effective-access import missing");
assert.match(main, /ordersEffectiveAccess = \{ module: "orders"/, "Orders effective-access state missing");
assert.match(main, /function canViewOrdersRoute\(\)/, "Orders route gate missing");
assert.match(main, /ordersEffectiveAccess\.allowed === true && ordersEffectiveAccess\.module === "orders"/, "Orders Staff gate must require active orders module");
assert.match(main, /path === "\/orders" && !canViewOrdersRoute\(\)/, "direct /orders route must be protected");
assert.match(main, /routePath === "\/orders" && !canViewOrdersRoute\(\)/, "programmatic /orders navigation must be protected");
assert.equal((main.match(/\.\.\.\(canViewOrdersRoute\(\) \? \[\{ label: "Orders"/g) || []).length, 2, "desktop and mobile Orders nav must be gated");
assert.equal(main.split(/\r?\n/).some((line) => line.includes("ordersEffectiveAccess") && line.includes("localStorage")), false, "Orders access must not trust localStorage");

assert.match(migration, /has_active_employee_temporary_access\('orders'\)/g, "Orders RLS read policies must use active temp orders grant");
assert.match(migration, /array\['owner','admin'\]/g, "Orders RLS must preserve Owner/Admin permanent access");
assert.doesNotMatch(migration, /array\['owner','admin','staff'\].*orders/s, "Orders migration must not keep broad Staff write access");
assert.match(migration, /for select[\s\S]*public\.orders[\s\S]*has_active_employee_temporary_access\('orders'\)/, "native orders read policy must include temp orders");
assert.match(migration, /for insert[\s\S]*public\.is_active_admin_user\(array\['owner','admin'\]\)/, "orders insert must be owner/admin only");
assert.match(migration, /for update[\s\S]*public\.is_active_admin_user\(array\['owner','admin'\]\)/, "orders update must be owner/admin only");
for (const table of ["reorder_requests", "request_items", "clients"]) {
  assert.match(migration, new RegExp(`on public\\.${table}[\\s\\S]*has_active_employee_temporary_access\\('orders'\\)`), `${table} read policy must include temp orders`);
}
assert.match(migration, /drop policy if exists "Active admins can read reorder requests"/, "legacy reorder_requests broad read policy must be dropped");
assert.match(migration, /drop policy if exists "Active admins can read request items"/, "legacy request_items broad read policy must be dropped");
assert.match(migration, /drop policy if exists "Active admins can read clients"/, "legacy clients broad read policy must be dropped");
assert.match(effectiveAccess, /"inventory"/, "Inventory temporary enforcement is owned by E5G and must remain available after E5D.");
assert.match(effectiveAccess, /"pos_sales"/, "POS Sales temporary authority is owned by E5I.3 and must remain available after E5D.");
for (const forbidden of ["pricing_discounts", "people_access"]) {
  assert.doesNotMatch(effectiveAccess, new RegExp(`"${forbidden}"`), `${forbidden} must not be added to canonical effective access in E5D`);
}

assert.match(paymentApi, /const WRITE_ROLES = new Set\(\["owner", "admin"\]\)/, "payment confirmation must remain Owner/Admin only");
assert.match(workflowApi, /requireEffectiveModuleAccess\(supabase, adminUser, "inquiries"\)/, "workflow mutations must remain gated by Inquiries, not Orders");
assert.doesNotMatch(workflowApi, /requireEffectiveModuleAccess\(supabase, adminUser, "orders"\)/, "Orders grant must not authorize workflow mutations");
assert.match(localDev, /payment-confirmations/, "local dev runtime must expose payment confirmation API for real E5D denial tests");

assert.equal(packageJson.scripts["test:employee-e5d"], "node scripts/test-employee-e5d.mjs", "E5D source test script missing");
assert.equal(packageJson.scripts["test:employee-e5d-runtime"], "node scripts/test-employee-e5d-runtime.mjs", "E5D runtime test script missing");

console.log("PASS: Employee E5D source enforcement checks");

function read(path) {
  return readFileSync(path, "utf8");
}
