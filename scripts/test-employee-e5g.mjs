import assert from "node:assert/strict";
import fs from "node:fs";

const effectiveAccess = read("api/_lib/effectiveAccess.js");
const frontendAccess = read("src/services/adminEffectiveAccess.js");
const main = read("src/main.js");
const inventoryService = read("src/services/adminInventory.js");
const purchasingService = read("src/services/adminPurchasing.js");
const barcodeUi = read("src/barcodeM4.js");
const migration = read("supabase/migrations/20260827024500_employee_e5g_inventory_temp_access.sql");
const packageJson = JSON.parse(read("package.json"));

assert.match(effectiveAccess, /"inventory"/, "canonical effective access must register inventory");
assert.match(effectiveAccess, /\["inventory", new Set\(\["owner", "admin"\]\)\]/, "Owner/Admin permanent Inventory access must be preserved");
assert.match(effectiveAccess, /Inventory/, "effective access label must include Inventory");

assert.match(frontendAccess, /getInventoryEffectiveAccess/, "frontend effective-access service must expose inventory");
assert.match(frontendAccess, /getEffectiveModuleAccess\(session, "inventory"\)/, "frontend service must request inventory exactly");

assert.match(main, /inventoryEffectiveAccess/, "main UI must track inventory effective access");
assert.match(main, /getInventoryEffectiveAccess/, "main UI must load inventory effective access");
assert.match(main, /function canViewInventoryRoute\(\)[\s\S]*inventoryEffectiveAccess\.allowed === true[\s\S]*inventoryEffectiveAccess\.module === "inventory"/, "Inventory route must use server-backed effective access for Staff");
assert.match(main, /path === "\/catalog\/inventory" && !canViewInventoryRoute\(\)/, "direct Inventory route must be protected");
assert.match(main, /routePath === "\/catalog\/inventory" && !canViewInventoryRoute\(\)/, "Inventory navigation normalization must be protected");
assert.match(main, /\.\.\.\(canViewInventoryRoute\(\) \? \[\{ label: "Inventory", path: "\/catalog\/inventory"/, "Inventory sidebar item must be conditional");

assert.match(inventoryService, /readSupabaseTableWithAuth\(INVENTORY_BALANCES_TABLE/, "Inventory read must use canonical balances table");
assert.match(inventoryService, /readSupabaseTableWithAuth\(STOCK_MOVEMENTS_TABLE/, "Inventory read must use canonical movement table");
assert.match(inventoryService, /executeSupabaseSchemaRpcWithAuth\(INVENTORY_RECEIVE_RPC_SCHEMA, INVENTORY_RECEIVE_RPC/, "Receive Stock must remain schema-aware RPC mediated");
assert.match(inventoryService, /canReceiveInventoryForRole\(role\)[\s\S]*\["owner", "admin"\]/, "Receive Stock must remain Owner/Admin-only in source");
assert.doesNotMatch(inventoryService, /updateSupabaseRowsWithAuth\(\s*INVENTORY_BALANCES_TABLE|createSupabaseRowWithAuth\(\s*STOCK_MOVEMENTS_TABLE/, "Inventory service must not add direct balance or movement writes");

assert.match(purchasingService, /canWritePurchaseOrdersForRole\(role\)[\s\S]*\["owner", "admin"\]/, "Purchase writing must remain Owner/Admin-only");
assert.match(purchasingService, /canReceivePurchaseOrdersForRole\(role\)[\s\S]*return canWritePurchaseOrdersForRole\(role\)/, "Purchase receiving must delegate to Owner/Admin-only write authority");
assert.doesNotMatch(barcodeUi, /receiveAdminInventoryStock|receive_inventory|stock_movements|inventory_balances/i, "Barcode UI must not gain inventory write authority");

assert.match(migration, /has_active_employee_temporary_access\(''inventory''\)/, "RLS must recognize active inventory grants");
assert.match(migration, /public\.is_active_admin_user\(array\[''owner'',''admin''\]\)/, "RLS must preserve Owner/Admin permanent access");
assert.match(migration, /inventory_locations[\s\S]*for select/, "Inventory locations must be read-only temp gated");
assert.match(migration, /inventory_balances[\s\S]*for select/, "Inventory balances must be read-only temp gated");
assert.match(migration, /stock_movements[\s\S]*for select/, "Stock movements must be read-only temp gated");
assert.doesNotMatch(migration, /for update[\s\S]*has_active_employee_temporary_access\(''inventory''\)|for insert[\s\S]*has_active_employee_temporary_access\(''inventory''\)|for delete[\s\S]*has_active_employee_temporary_access\(''inventory''\)/i, "Temporary inventory must not satisfy write/delete policies");
assert.doesNotMatch(migration, /receive_purchase_order|pos_sales|pricing|people_access|my_tasks/i, "E5G migration must not enable unrelated temporary modules");

assert.equal(packageJson.scripts["test:employee-e5g"], "node scripts/test-employee-e5g.mjs", "package script test:employee-e5g missing");
assert.equal(packageJson.scripts["test:employee-e5g-runtime"], "node scripts/test-employee-e5g-runtime.mjs", "package script test:employee-e5g-runtime missing");

console.log("PASS Employee E5G source contract: canonical inventory access, route guard, read-only Inventory boundary, and unrelated module isolation");

function read(path) {
  return fs.readFileSync(path, "utf8");
}
