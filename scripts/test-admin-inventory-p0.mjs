import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  INVENTORY_RECEIVE_RPC,
  canReceiveInventoryForRole,
  createInventoryIdempotencyKey,
} from "../src/services/adminInventory.js";

const main = await readFile("src/main.js", "utf8");
const service = await readFile("src/services/adminInventory.js", "utf8");
const styles = await readFile("src/styles.css", "utf8");
const localDev = await readFile("scripts/local-dev.mjs", "utf8");
const stockTableStart = main.indexOf("function renderInventoryStockTable");
const stockTableEnd = main.indexOf("function renderInventoryMovementTable");
assert.ok(stockTableStart > -1 && stockTableEnd > stockTableStart, "Inventory stock table renderer missing");
const stockTable = main.slice(stockTableStart, stockTableEnd);

assert.ok(main.includes('"/catalog/inventory": "Catalog"'), "Inventory route must be registered under Catalog");
assert.ok(localDev.includes('"/catalog/inventory"'), "Local dev server must serve direct Inventory route");
assert.ok(main.includes('path: "/catalog/inventory", icon: "boxes", activePaths: ["/catalog/inventory"]'), "Inventory nav must be enabled");
assert.ok(main.includes('path: "/catalog/suppliers", icon: "truck", disabled: true'), "Suppliers must remain parked");
assert.ok(main.includes('path: "/catalog/purchasing", icon: "shopping-cart", disabled: true'), "Purchasing must remain parked");

for (const table of ["products", "product_variants", "brands", "product_categories", "inventory_locations", "inventory_balances", "stock_movements"]) {
  assert.ok(service.includes(`"${table}"`), `canonical table missing: ${table}`);
}

assert.equal(INVENTORY_RECEIVE_RPC, "trry_api.receive_inventory", "Receive RPC name changed");
for (const key of ["p_location_id", "p_variant_id", "p_quantity", "p_idempotency_key", "p_source_reference", "p_reason"]) {
  assert.ok(service.includes(key), `Receive RPC payload missing ${key}`);
}

assert.equal(canReceiveInventoryForRole("owner"), true, "Owner must receive");
assert.equal(canReceiveInventoryForRole("admin"), true, "Admin must receive");
assert.equal(canReceiveInventoryForRole("staff"), false, "Staff must not receive");
assert.equal(canReceiveInventoryForRole("cashier"), false, "Cashier must not receive");

const keyA = createInventoryIdempotencyKey();
const keyB = createInventoryIdempotencyKey();
assert.ok(keyA.startsWith("admin-inventory-receive-"), "Inventory idempotency key prefix missing");
assert.notEqual(keyA, keyB, "Inventory idempotency key must be unique per operation");
assert.ok(main.includes('inventoryReceiveDrawer.status === "saving"'), "Receive submit must have saving state");
assert.ok(main.includes('if (inventoryReceiveDrawer.status === "saving") return;'), "Double-submit guard missing");
assert.ok(main.includes("Quantity must be a positive whole number."), "Positive integer validation missing");

assert.equal(/createSupabaseRowWithAuth\(\s*INVENTORY_BALANCES_TABLE/.test(service), false, "Must not insert inventory_balances");
assert.equal(/updateSupabaseRowsWithAuth\(\s*INVENTORY_BALANCES_TABLE/.test(service), false, "Must not update inventory_balances");
assert.equal(/createSupabaseRowWithAuth\(\s*STOCK_MOVEMENTS_TABLE/.test(service), false, "Must not insert stock_movements manually");
assert.ok(service.includes("PRODUCTION_SUPABASE_PROJECT_REF"), "Production project write gate missing");
assert.ok(service.includes("wcgtwfctpnwgpglywvvx"), "Canonical production Supabase ref missing");

for (const sample of ["TEE-PC-BLK-M", "PO-2026-0048", "sample stock", "mock balances", "placeholder location"]) {
  assert.equal(service.includes(sample), false, `Service must not contain mock/sample inventory: ${sample}`);
}

assert.ok(main.includes("Stock Movements"), "Stock Movement History UI missing");
assert.ok(main.includes("Movements are append-only operational records"), "Audit rule missing");
assert.ok(main.includes("On Hand is never edited directly"), "Stock rule missing");
assert.ok(styles.includes(".inventory-page"), "Inventory responsive styles missing");

for (const header of ["Product / Variant", "SKU", "On Hand", "Reorder", "Incoming", "Stock", "Last Cost", "Stock Value", "Action"]) {
  assert.ok(stockTable.includes(`<th>${header}</th>`), `Inventory stock table header missing: ${header}`);
}

for (const removedHeader of ["Location", "Reserved", "Sellable"]) {
  assert.equal(stockTable.includes(`<th>${removedHeader}</th>`), false, `Removed inventory stock table header still present: ${removedHeader}`);
}

assert.ok(stockTable.includes("inventory-on-hand-cell"), "On Hand cell must own sellable/reserved secondary context");
assert.ok(stockTable.includes("Sellable:") && stockTable.includes("Reserved:"), "Reserved and Sellable must be secondary On Hand context");
assert.ok(styles.includes(".inventory-product-col"), "Inventory Product / Variant column width missing");
assert.ok(styles.includes(".inventory-stock-col"), "Inventory Stock column width missing");
assert.ok(styles.includes("min-width: max-content"), "Inventory stock chip must keep full label readable");
assert.ok(/\.inventory-product-col\s*\{\s*width:\s*28%;\s*\}/.test(styles), "Product / Variant must keep final 28% table width");
assert.ok(/\.inventory-sku-col\s*\{\s*width:\s*16%;\s*\}/.test(styles), "SKU must keep final 16% table width");
assert.ok(/\.inventory-incoming-col\s*\{\s*width:\s*8%;\s*\}/.test(styles), "Incoming must keep enough width for its header");
assert.ok(/\.inventory-table th,\s*\.inventory-table td\s*\{\s*overflow:\s*visible;/.test(styles), "Inventory cells must not clip stock chips or headers");
assert.ok(styles.includes(".app-shell.admin-saas-shell .inventory-receive-drawer header"), "Inventory receive drawer spacing override missing");
assert.ok(styles.includes("padding: 16px 22px 14px !important"), "Inventory receive drawer header must be vertically tighter");
assert.ok(styles.includes(".app-shell.admin-saas-shell .inventory-receive-drawer .catalog-form"), "Inventory receive drawer form spacing override missing");

process.stdout.write("PASS Admin Inventory P0 route, canonical bindings, RPC payload, permissions, idempotency, and parked purchasing\n");
