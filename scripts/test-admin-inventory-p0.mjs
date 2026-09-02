import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  INVENTORY_RECEIVE_RPC,
  INVENTORY_RECEIVE_RPC_LABEL,
  INVENTORY_RECEIVE_RPC_SCHEMA,
  canReceiveInventoryForRole,
  createInventoryIdempotencyKey,
  receiveAdminInventoryStock,
} from "../src/services/adminInventory.js";

const main = await readFile("src/main.js", "utf8");
const service = await readFile("src/services/adminInventory.js", "utf8");
const styles = await readFile("src/styles.css", "utf8");
const localDev = await readFile("scripts/local-dev.mjs", "utf8");
const stockTableStart = main.indexOf("function renderInventoryStockTable");
const stockTableEnd = main.indexOf("function renderInventoryMovementTable");
assert.ok(stockTableStart > -1 && stockTableEnd > stockTableStart, "Inventory stock table renderer missing");
const stockTable = main.slice(stockTableStart, stockTableEnd);
const movementTableStart = main.indexOf("function renderInventoryMovementTable");
const movementTableEnd = main.indexOf("function renderInventoryReceiveDrawer");
assert.ok(movementTableStart > -1 && movementTableEnd > movementTableStart, "Inventory movement table renderer missing");
const movementTable = main.slice(movementTableStart, movementTableEnd);

assert.ok(main.includes('"/catalog/inventory": "Catalog"'), "Inventory route must be registered under Catalog");
assert.ok(localDev.includes('"/catalog/inventory"'), "Local dev server must serve direct Inventory route");
assert.ok(main.includes('path: "/catalog/inventory", icon: "boxes", activePaths: ["/catalog/inventory"]'), "Inventory nav must be enabled");
assert.ok(main.includes('path: "/catalog/suppliers", icon: "truck", activePaths: ["/catalog/suppliers"]'), "Suppliers must be enabled for Supplier Master M1");
assert.ok(main.includes('path: "/catalog/purchasing", icon: "shopping-cart", activePaths: ["/catalog/purchasing"]'), "Purchasing nav must be enabled for Purchase Orders M2");

for (const table of ["products", "product_variants", "brands", "product_categories", "inventory_locations", "inventory_balances", "stock_movements"]) {
  assert.ok(service.includes(`"${table}"`), `canonical table missing: ${table}`);
}

assert.equal(INVENTORY_RECEIVE_RPC_SCHEMA, "trry_api", "Receive RPC schema changed");
assert.equal(INVENTORY_RECEIVE_RPC, "receive_inventory", "Receive RPC function changed");
assert.equal(INVENTORY_RECEIVE_RPC_LABEL, "trry_api.receive_inventory", "Receive RPC label changed");
assert.equal(service.includes('executeSupabaseRpcWithAuth(INVENTORY_RECEIVE_RPC'), false, "Receive Stock must not use dotted public RPC routing");
assert.ok(service.includes("executeSupabaseSchemaRpcWithAuth(INVENTORY_RECEIVE_RPC_SCHEMA, INVENTORY_RECEIVE_RPC"), "Receive Stock must call the schema-aware RPC helper");
for (const key of ["p_location_id", "p_variant_id", "p_quantity", "p_idempotency_key", "p_source_reference", "p_reason"]) {
  assert.ok(service.includes(key), `Receive RPC payload missing ${key}`);
}

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
let rpcRequest = null;
globalThis.window = {
  TRRY_ADMIN_ENV: {
    VITE_USE_SUPABASE_DATA: "true",
    VITE_SUPABASE_URL: "https://wcgtwfctpnwgpglywvvx.supabase.co",
    VITE_SUPABASE_ANON_KEY: "test-anon-key",
  },
};
globalThis.fetch = async (url, options) => {
  rpcRequest = { url: String(url), options };
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify([{ ok: true }]),
  };
};

const receivePayload = {
  locationId: "6e8b2ba6-f2e1-4630-a92f-392281c767a2",
  variantId: "47dd86de-7576-4166-b918-c8bad144f6b9",
  quantity: 2,
  idempotencyKey: "admin-inventory-receive-schema-routing-test",
  sourceReference: "M9G.3-QA",
  reason: "schema routing test",
};
await receiveAdminInventoryStock(receivePayload, { access_token: "owner-admin-token" });
globalThis.fetch = originalFetch;
globalThis.window = originalWindow;

assert.ok(rpcRequest, "Receive RPC request was not sent");
assert.ok(rpcRequest.url.endsWith("/rest/v1/rpc/receive_inventory"), "Receive RPC must call the undotted function path");
assert.equal(rpcRequest.url.includes("trry_api.receive_inventory"), false, "Receive RPC path must not use dotted schema/function name");
assert.equal(rpcRequest.options.headers["Content-Profile"], "trry_api", "Receive RPC must route through trry_api schema");
assert.equal(rpcRequest.options.headers["Accept-Profile"], "trry_api", "Receive RPC must accept trry_api schema responses");
assert.deepEqual(JSON.parse(rpcRequest.options.body), {
  p_location_id: receivePayload.locationId,
  p_variant_id: receivePayload.variantId,
  p_quantity: receivePayload.quantity,
  p_idempotency_key: receivePayload.idempotencyKey,
  p_source_reference: receivePayload.sourceReference,
  p_reason: receivePayload.reason,
}, "Receive RPC payload changed");

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
assert.equal(main.includes("?? getVisibleInventoryRows()[0]"), false, "Global Receive Stock must not default to the first visible inventory row");
assert.ok(main.includes('mode: row ? "row" : "global"'), "Receive Stock must distinguish global and row-level entry routes");
assert.ok(main.includes('data-inventory-receive-field="rowId"'), "Global Receive Stock product/variant/SKU selector missing");
assert.ok(main.includes("Select product, variant, or SKU..."), "Global Receive Stock selector placeholder missing");
assert.ok(main.includes("Select a product variant before entering the received quantity."), "Global Receive Stock empty-selection guidance missing");

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

for (const header of ["Date / Time", "Product / SKU", "Type", "Qty Change", "Balance After", "Source", "Reference", "Reason / Note", "Done By"]) {
  assert.ok(movementTable.includes(`>${header}</th>`), `Inventory movement table header missing: ${header}`);
}

for (const removedHeader of ["Location", "Before"]) {
  assert.equal(movementTable.includes(`>${removedHeader}</th>`), false, `Removed inventory movement table header still present: ${removedHeader}`);
}

assert.equal(movementTable.includes('data-mobile-label="Location"'), false, "Inventory movement Location primary cell still present");
assert.equal(movementTable.includes('data-mobile-label="Before"'), false, "Inventory movement Before primary cell still present");
assert.ok(movementTable.includes("movement-product-stack"), "Inventory movement product/SKU stack missing");
assert.ok(movementTable.includes("formatMovementQuantityDelta(row.quantityDelta)"), "Inventory movement Qty Change must omit pcs suffix");
assert.ok(styles.includes(".movement-product-col"), "Inventory movement Product / SKU width missing");
assert.ok(styles.includes(".movement-reason-col"), "Inventory movement Reason / Note width missing");
assert.ok(styles.includes(".movement-reference-col"), "Inventory movement Reference width missing");
assert.ok(styles.includes(".inventory-movement-table .status-pill"), "Inventory movement type chip readability rule missing");

process.stdout.write("PASS Admin Inventory P0 route, canonical bindings, RPC payload, permissions, idempotency, and M2 purchasing boundary\n");
