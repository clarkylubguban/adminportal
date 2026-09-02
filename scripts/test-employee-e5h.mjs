import assert from "node:assert/strict";
import fs from "node:fs";

const effectiveAccess = read("api/_lib/effectiveAccess.js");
const frontendAccess = read("src/services/adminEffectiveAccess.js");
const main = read("src/main.js");
const purchasingService = read("src/services/adminPurchasing.js");
const supplierService = read("src/services/adminSuppliers.js");
const inventoryService = read("src/services/adminInventory.js");
const migration = read("supabase/migrations/20260827052000_employee_e5h_purchasing_suppliers_temp_access.sql");
const packageJson = JSON.parse(read("package.json"));

assert.match(effectiveAccess, /"purchasing_suppliers"/, "canonical effective access must register purchasing_suppliers");
assert.match(effectiveAccess, /\["purchasing_suppliers", new Set\(\["owner", "admin"\]\)\]/, "Owner/Admin permanent Purchasing access must be preserved");
assert.match(effectiveAccess, /Purchasing & Suppliers/, "effective access label must include Purchasing & Suppliers");

assert.match(frontendAccess, /getPurchasingSuppliersEffectiveAccess/, "frontend effective-access service must expose Purchasing & Suppliers");
assert.match(frontendAccess, /getEffectiveModuleAccess\(session, "purchasing_suppliers"\)/, "frontend service must request purchasing_suppliers exactly");

assert.match(main, /purchasingSuppliersEffectiveAccess/, "main UI must track Purchasing & Suppliers effective access");
assert.match(main, /getPurchasingSuppliersEffectiveAccess/, "main UI must load Purchasing & Suppliers effective access");
assert.match(main, /function canViewPurchasingSuppliersRoute\(\)[\s\S]*purchasingSuppliersEffectiveAccess\.allowed === true[\s\S]*purchasingSuppliersEffectiveAccess\.module === "purchasing_suppliers"/, "Purchasing/Suppliers route must use server-backed effective access for Staff");
assert.match(main, /path === "\/catalog\/purchasing" \|\| path === "\/catalog\/suppliers"[\s\S]*!canViewPurchasingSuppliersRoute\(\)/, "direct Purchasing/Suppliers routes must be protected");
assert.match(main, /routePath === "\/catalog\/purchasing" \|\| routePath === "\/catalog\/suppliers"[\s\S]*!canViewPurchasingSuppliersRoute\(\)/, "Purchasing/Suppliers navigation normalization must be protected");
assert.match(main, /\.\.\.\(canViewPurchasingSuppliersRoute\(\) \? \[/, "Purchasing/Suppliers sidebar items must be conditional");

assert.match(purchasingService, /readSupabaseTableWithAuth\(PURCHASE_ORDERS_TABLE/, "PO read must use canonical purchase_orders table");
assert.match(purchasingService, /readSupabaseTableWithAuth\(PURCHASE_ORDER_LINES_TABLE/, "PO detail read must use canonical purchase_order_lines table");
assert.match(purchasingService, /readSupabaseTableWithAuth\("suppliers"/, "PO read must include supplier read path");
assert.match(purchasingService, /executeSupabaseRpcWithAuth\(\s*CREATE_PURCHASE_ORDER_RPC/, "Create PO must remain RPC mediated");
assert.match(purchasingService, /executeSupabaseRpcWithAuth\(\s*MARK_PURCHASE_ORDER_ORDERED_RPC/, "Mark Ordered must remain RPC mediated");
assert.match(purchasingService, /executeSupabaseRpcWithAuth\(\s*RECEIVE_PURCHASE_ORDER_RPC/, "Receive Purchase must remain RPC mediated");
assert.match(purchasingService, /canWritePurchaseOrdersForRole\(role\)[\s\S]*\["owner", "admin"\]/, "PO writes must remain Owner/Admin-only in source");
assert.match(purchasingService, /canReceivePurchaseOrdersForRole\(role\)[\s\S]*return canWritePurchaseOrdersForRole\(role\)/, "Purchase receiving must delegate to Owner/Admin-only write authority");

assert.match(supplierService, /readSupabaseTableWithAuth\(\s*SUPPLIERS_TABLE/, "Supplier read must use canonical suppliers table");
assert.match(supplierService, /createSupabaseRowWithAuth\(\s*SUPPLIERS_TABLE/, "Supplier create path must remain explicit table write");
assert.match(supplierService, /updateSupabaseRowsWithAuth\(\s*SUPPLIERS_TABLE/, "Supplier update path must remain explicit table write");
assert.match(supplierService, /canWriteSuppliersForRole\(role\)[\s\S]*\["owner", "admin"\]/, "Supplier writes must remain Owner/Admin-only in source");

assert.match(inventoryService, /canReceiveInventoryForRole\(role\)[\s\S]*\["owner", "admin"\]/, "Inventory receiving must remain independently Owner/Admin-only");

for (const table of ["suppliers", "purchase_orders", "purchase_order_lines", "purchase_order_receipts", "purchase_order_receipt_lines"]) {
  assert.match(migration, new RegExp(`${table}[\\s\\S]*for select[\\s\\S]*has_active_employee_temporary_access\\('purchasing_suppliers'\\)`, "i"), `${table} must have purchasing_suppliers temp read policy`);
}
assert.match(migration, /public\.is_active_admin_user\(array\['owner','admin'\]\)/, "RLS must preserve Owner/Admin permanent access");
assert.doesNotMatch(migration, /for update[\s\S]*has_active_employee_temporary_access\('purchasing_suppliers'\)|for insert[\s\S]*has_active_employee_temporary_access\('purchasing_suppliers'\)|for delete[\s\S]*has_active_employee_temporary_access\('purchasing_suppliers'\)/i, "Temporary Purchasing must not satisfy write/delete policies");
assert.doesNotMatch(migration, /pos_sales|pricing_discounts|people_access|my_tasks/i, "E5H migration must not enable unrelated temporary modules");

assert.equal(packageJson.scripts["test:employee-e5h"], "node scripts/test-employee-e5h.mjs", "package script test:employee-e5h missing");
assert.equal(packageJson.scripts["test:employee-e5h-runtime"], "node scripts/test-employee-e5h-runtime.mjs", "package script test:employee-e5h-runtime missing");

console.log("PASS Employee E5H source contract: canonical Purchasing/Suppliers access, direct route guard, read-only RLS, and write boundary isolation");

function read(path) {
  return fs.readFileSync(path, "utf8");
}
