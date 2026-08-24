import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CREATE_PURCHASE_ORDER_RPC,
  PO_NUMBER_PREVIEW,
  PURCHASE_ORDERS_TABLE,
  PURCHASE_ORDER_LINES_TABLE,
  canWritePurchaseOrdersForRole,
  createEmptyPurchaseOrderDraft,
  getPurchaseOrderTotals,
  isEligiblePurchaseVariant,
  validatePurchaseOrderDraft,
} from "../src/services/adminPurchasing.js";

const main = await readFile("src/main.js", "utf8");
const styles = await readFile("src/styles.css", "utf8");
const service = await readFile("src/services/adminPurchasing.js", "utf8");
const migration = await readFile("supabase/migrations/202608240002_add_purchase_orders_m2.sql", "utf8");
const localDev = await readFile("scripts/local-dev.mjs", "utf8");
const supplierTest = await readFile("scripts/test-admin-suppliers-m1.mjs", "utf8");
const inventoryTest = await readFile("scripts/test-admin-inventory-p0.mjs", "utf8");

assert.ok(main.includes('"/catalog/purchasing": "Catalog"'), "Purchasing route must be registered");
assert.ok(localDev.includes('"/catalog/purchasing"'), "Local dev must serve direct Purchasing route");
assert.ok(main.includes('path: "/catalog/purchasing", icon: "shopping-cart", activePaths: ["/catalog/purchasing"]'), "Purchasing nav must be enabled");
assert.ok(main.includes("renderPurchasingPage"), "Purchasing page renderer missing");
assert.ok(main.includes("renderPurchaseOrderListPage"), "PO list renderer missing");
assert.ok(main.includes("renderPurchaseOrderDrawer"), "Create PO drawer missing");
assert.ok(main.includes("renderPurchaseOrderDetailPage"), "PO detail renderer missing");
assert.ok(main.includes("data-receiving-history-parked") && main.includes("data-receive-stock-parked"), "Receiving must be visibly parked");
assert.ok(main.includes("Supplier Ref") && main.includes("Shipping / Freight") && main.includes("Internal Note"), "Drawer fields missing");
assert.ok(main.includes("Product / Variant") && main.includes("data-po-line-field=\"variantId\""), "Product/variant picker missing");
assert.ok(main.includes("Save Draft") && main.includes("Create & Mark Ordered"), "PO save actions missing");
assert.ok(main.includes('savePurchaseOrder("DRAFT")') || main.includes('data-po-save-status="DRAFT"'), "Draft save action missing");
assert.ok(main.includes("markPurchaseOrderOrdered"), "Ordered save action missing");
assert.ok(main.includes("PO does not change On Hand. Inventory increases only when an authorized user confirms Receive Stock."), "PO inventory boundary copy missing");

for (const header of ["PO Number", "Supplier", "Ordered", "Expected", "Items", "Total Cost", "Receiving", "Status", "Action"]) {
  assert.ok(main.includes(`<th>${header}</th>`), `PO list table header missing: ${header}`);
}

for (const header of ["Product / SKU", "Ordered", "Received", "Remaining", "Unit Cost", "Line Total", "Last Receipt", "Status", "Action"]) {
  assert.ok(main.includes(`<th>${header}</th>`), `PO detail table header missing: ${header}`);
}

assert.equal(PURCHASE_ORDERS_TABLE, "purchase_orders", "PO service must use canonical purchase_orders table");
assert.equal(PURCHASE_ORDER_LINES_TABLE, "purchase_order_lines", "PO service must use canonical purchase_order_lines table");
assert.equal(CREATE_PURCHASE_ORDER_RPC, "create_purchase_order", "Create PO RPC name changed");
assert.equal(PO_NUMBER_PREVIEW, "Auto-generated on save", "PO number preview changed");
assert.equal(canWritePurchaseOrdersForRole("owner"), true, "Owner can write POs");
assert.equal(canWritePurchaseOrdersForRole("admin"), true, "Admin can write POs");
assert.equal(canWritePurchaseOrdersForRole("staff"), false, "Staff must be read-only for POs");
assert.equal(canWritePurchaseOrdersForRole("viewer"), false, "Viewer must not write POs");

const blankDraft = createEmptyPurchaseOrderDraft();
assert.equal(validatePurchaseOrderDraft(blankDraft), "Active supplier is required.", "Supplier validation missing");
assert.equal(validatePurchaseOrderDraft({ supplierId: "sup-1", freightCost: -1, lines: [] }), "Freight cost cannot be negative.", "Freight validation missing");
assert.equal(validatePurchaseOrderDraft({ supplierId: "sup-1", freightCost: 0, lines: [] }), "Add at least one order line.", "Line count validation missing");
assert.equal(validatePurchaseOrderDraft({ supplierId: "sup-1", freightCost: 0, lines: [{ productId: "", variantId: "", orderedQuantity: 1, unitCost: 0 }] }), "Line 1: choose a product variant.", "Variant validation missing");
assert.equal(validatePurchaseOrderDraft({ supplierId: "sup-1", freightCost: 0, lines: [{ productId: "prod-1", variantId: "var-1", orderedQuantity: 0, unitCost: 0 }] }), "Line 1: quantity must be a positive whole number.", "Quantity validation missing");
assert.equal(validatePurchaseOrderDraft({ supplierId: "sup-1", freightCost: 0, lines: [{ productId: "prod-1", variantId: "var-1", orderedQuantity: 1, unitCost: -1 }] }), "Line 1: unit cost cannot be negative.", "Unit cost validation missing");
assert.deepEqual(getPurchaseOrderTotals({ freightCost: 25, lines: [{ orderedQuantity: 2, unitCost: 50 }] }), { itemsSubtotal: 100, freightCost: 25, totalCost: 125, itemCount: 2 }, "PO totals changed");
assert.equal(isEligiblePurchaseVariant({ status: "published", productType: "PHYSICAL" }, { sku: "TEE-M" }), true, "Active physical SKU variant should be eligible");
assert.equal(isEligiblePurchaseVariant({ status: "archived", productType: "PHYSICAL" }, { sku: "TEE-M" }), false, "Archived product should be ineligible");
assert.equal(isEligiblePurchaseVariant({ status: "published", productType: "SERVICE" }, { sku: "SVC" }), false, "Service product should be ineligible");
assert.equal(isEligiblePurchaseVariant({ status: "published", productType: "PHYSICAL" }, { sku: "" }), false, "Variant SKU is required");

assert.ok(service.includes("executeSupabaseRpcWithAuth") && service.includes("p_status") && service.includes("p_lines"), "Create PO RPC payload missing");
assert.ok(service.includes("receivedQuantity: 0"), "M2 received quantity must be zero");
assert.ok(service.includes("remainingQuantity: orderedQuantity"), "M2 remaining quantity must equal ordered quantity");
assert.equal(service.includes("receiveAdminInventoryStock"), false, "PO service must not call inventory receive");
assert.equal(service.includes("receive_inventory"), false, "PO service must not reference receive_inventory");
assert.equal(service.includes("INVENTORY_RECEIVE_RPC"), false, "PO service must not import inventory receive RPC");
assert.equal(service.includes("stock_movements"), false, "PO service must not touch stock movements");
assert.equal(service.includes("inventory_balances"), false, "PO service must not touch inventory balances");

assert.ok(migration.includes("purchase_order_number_sequence"), "PO number sequence missing");
assert.ok(migration.includes("'PO-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.purchase_order_number_sequence')::text, 4, '0')"), "PO number generation contract missing");
assert.ok(migration.includes("po_number ~ '^PO-[0-9]{4}-[0-9]{4,}$'"), "PO number format constraint missing");
assert.ok(migration.includes("create table if not exists public.purchase_orders"), "PO table missing");
assert.ok(migration.includes("create table if not exists public.purchase_order_lines"), "PO lines table missing");
assert.ok(migration.includes("public.create_purchase_order"), "Create PO RPC missing");
assert.ok(migration.includes("v_status not in ('DRAFT','ORDERED')"), "M2 RPC must reject receiving statuses");
assert.ok(migration.includes("public.is_active_admin_user(array['owner','admin'])"), "Owner/Admin write policy missing");
assert.ok(migration.includes("array['owner','admin','staff']"), "Owner/Admin/Staff read policy missing");
assert.equal(migration.includes("stock_movements"), false, "PO migration must not write stock movements");
assert.equal(migration.includes("inventory_balances"), false, "PO migration must not write inventory balances");
assert.equal(migration.includes("receive_inventory"), false, "PO migration must not call receive_inventory");

for (const cssToken of [
  ".purchase-order-drawer.catalog-drawer",
  "width: min(520px, 100vw)",
  "min-height: 142px",
  ".purchase-order-table",
  ".po-detail-table",
  ".po-line-grid",
  ".po-cost-summary",
  "grid-template-columns: 1fr !important",
]) {
  assert.ok(styles.includes(cssToken), `Purchasing responsive/style contract missing: ${cssToken}`);
}

assert.ok(supplierTest.includes("Purchasing nav must be enabled"), "Supplier regression must accept M2 purchasing nav");
assert.ok(inventoryTest.includes("Purchasing nav must be enabled"), "Inventory regression must accept M2 purchasing nav");

process.stdout.write("PASS Admin Purchase Orders M2 route, UI, service, RLS, validation, and inventory boundary contracts\n");
