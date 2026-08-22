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

process.stdout.write("PASS Admin Inventory P0 route, canonical bindings, RPC payload, permissions, idempotency, and parked purchasing\n");
