import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SUPPLIER_REFERENCE_PREFIX,
  SUPPLIERS_TABLE,
  canWriteSuppliersForRole,
  getSupplierReferencePreview,
  validateSupplierDraft,
} from "../src/services/adminSuppliers.js";
import {
  INVENTORY_RECEIVE_RPC,
  INVENTORY_RECEIVE_RPC_LABEL,
  INVENTORY_RECEIVE_RPC_SCHEMA,
} from "../src/services/adminInventory.js";

const main = await readFile("src/main.js", "utf8");
const styles = await readFile("src/styles.css", "utf8");
const service = await readFile("src/services/adminSuppliers.js", "utf8");
const inventoryService = await readFile("src/services/adminInventory.js", "utf8");
const migration = await readFile("supabase/migrations/202608240001_add_supplier_master_m1.sql", "utf8");
const localDev = await readFile("scripts/local-dev.mjs", "utf8");

assert.ok(main.includes('"/catalog/suppliers": "Catalog"'), "Suppliers route must be registered under Catalog");
assert.ok(localDev.includes('"/catalog/suppliers"'), "Local dev server must serve direct Suppliers route");
assert.ok(main.includes('path: "/catalog/suppliers", icon: "truck", activePaths: ["/catalog/suppliers"]'), "Suppliers nav must be enabled");
assert.ok(main.includes('path: "/catalog/purchasing", icon: "shopping-cart", activePaths: ["/catalog/purchasing"]'), "Purchasing nav must be enabled for Purchase Orders M2");

assert.equal(SUPPLIERS_TABLE, "suppliers", "Supplier service must use canonical suppliers table");
assert.ok(service.includes('export const SUPPLIERS_TABLE = "suppliers"'), "Supplier table constant missing");
assert.ok(service.includes("readSupabaseTableWithAuth") && service.includes("createSupabaseRowWithAuth") && service.includes("updateSupabaseRowsWithAuth"), "Supplier service must own canonical CRUD");
assert.equal(canWriteSuppliersForRole("owner"), true, "Owner can write suppliers");
assert.equal(canWriteSuppliersForRole("admin"), true, "Admin can write suppliers");
assert.equal(canWriteSuppliersForRole("staff"), false, "Staff must be read-only for suppliers");
assert.equal(canWriteSuppliersForRole("viewer"), false, "Viewer must not write suppliers");

assert.equal(service.includes("receiveAdminInventoryStock"), false, "Supplier service must not call inventory receive");
assert.equal(service.includes("receive_inventory"), false, "Supplier service must not reference receive_inventory");
assert.equal(main.includes("receiveAdminInventoryStock({"), true, "Existing inventory receive UI must remain");
assert.equal(INVENTORY_RECEIVE_RPC_SCHEMA, "trry_api", "Inventory receive RPC schema changed");
assert.equal(INVENTORY_RECEIVE_RPC, "receive_inventory", "Inventory receive RPC changed");
assert.equal(INVENTORY_RECEIVE_RPC_LABEL, "trry_api.receive_inventory", "Inventory receive RPC label changed");
assert.ok(inventoryService.includes("executeSupabaseSchemaRpcWithAuth(INVENTORY_RECEIVE_RPC_SCHEMA, INVENTORY_RECEIVE_RPC"), "Inventory receive RPC routing changed");

for (const field of [
  "Supplier Reference",
  "Supplier Name",
  "Supply Type",
  "Country / Region",
  "Contact Person",
  "Phone",
  "Email",
  "Address / Location",
  "Currency",
  "Payment Terms",
  "Lead Time",
  "Internal Notes",
]) {
  assert.ok(main.includes(field), `Add Supplier drawer field missing: ${field}`);
}

assert.ok(main.includes("function renderSupplierDetail"), "Supplier Detail drawer renderer missing");
assert.ok(main.includes("Edit Supplier"), "Edit Supplier action missing");
assert.ok(main.includes("data-supplier-create-po-hook"), "CREATE PO M2 hook missing");
assert.ok(main.includes("canWritePurchaseOrdersForRole(adminUser?.role) ? \"\" : \"disabled\""), "CREATE PO must be enabled only for Owner/Admin");
assert.ok(main.includes("Supplier records create no stock movement. Inventory changes only through confirmed receiving."), "Approved supplier boundary copy missing");

for (const header of ["Supplier Ref", "Supplier", "Open POs", "Open PO Value", "Last Purchase", "Last Receipt", "Notes", "Status", "Action"]) {
  assert.ok(main.includes(`<th>${header}</th>`), `Supplier table header missing: ${header}`);
}
assert.ok(main.includes("<td data-mobile-label=\"Open POs\">0</td>"), "M1 Open POs must be zero");
assert.ok(main.includes("<td data-mobile-label=\"Open PO Value\">₱0</td>"), "M1 Open PO Value must be zero");
assert.ok(main.includes("<td data-mobile-label=\"Last Purchase\">—</td>"), "M1 Last Purchase must be dash");
assert.ok(main.includes("<td data-mobile-label=\"Last Receipt\">—</td>"), "M1 Last Receipt must be dash");

assert.equal(SUPPLIER_REFERENCE_PREFIX, "SUP", "Supplier reference prefix changed");
assert.equal(getSupplierReferencePreview(), "Auto-generated on save", "Reference preview copy changed");
assert.ok(migration.includes("supplier_reference_sequence"), "Supplier reference sequence missing");
assert.ok(migration.includes("'SUP-' || lpad(nextval('public.supplier_reference_sequence')::text, 4, '0')"), "Supplier reference generation contract missing");
assert.ok(migration.includes("supplier_reference ~ '^SUP-[0-9]{4,}$'"), "Supplier reference format constraint missing");

assert.ok(migration.includes("create table if not exists public.suppliers"), "Suppliers migration table missing");
assert.ok(migration.includes("lead_time_days integer"), "Lead time column missing");
assert.ok(migration.includes("check (lead_time_days is null or lead_time_days >= 0)"), "Lead time nonnegative constraint missing");
assert.ok(migration.includes("for select") && migration.includes("array['owner','admin','staff']"), "Owner/Admin/Staff read policy missing");
assert.ok(migration.includes("for insert") && migration.includes("array['owner','admin']"), "Owner/Admin insert policy missing");
assert.ok(migration.includes("for update") && migration.includes("array['owner','admin']"), "Owner/Admin update policy missing");

assert.equal(validateSupplierDraft({ name: "", currency: "PHP" }), "Supplier Name is required.", "Name validation missing");
assert.equal(validateSupplierDraft({ name: "Metro", currency: "" }), "Currency is required.", "Currency validation missing");
assert.equal(validateSupplierDraft({ name: "Metro", currency: "PHP", leadTimeDays: "-1" }), "Lead Time must be zero or a positive whole number.", "Lead time validation missing");
assert.equal(validateSupplierDraft({ name: "Metro", currency: "PHP", leadTimeDays: "0" }), "", "Zero lead time should be valid");

for (const cssToken of [
  ".supplier-drawer.catalog-drawer",
  "width: min(520px, 100vw)",
  "min-height: 142px",
  "min-height: 62px",
  ".supplier-field-row",
  "grid-template-columns: 1fr",
  "body.catalog-drawer-open .mobile-bottom-nav",
]) {
  assert.ok(styles.includes(cssToken), `Supplier responsive/style contract missing: ${cssToken}`);
}

process.stdout.write("PASS Admin Supplier Master M1 route, UI, service, RLS, reference, responsive, and inventory boundary contracts\n");
