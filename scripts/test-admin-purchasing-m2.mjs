import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CREATE_PURCHASE_ORDER_RPC,
  MARK_PURCHASE_ORDER_ORDERED_RPC,
  PO_NUMBER_PREVIEW,
  PURCHASE_ORDERS_TABLE,
  PURCHASE_ORDER_LINES_TABLE,
  canWritePurchaseOrdersForRole,
  createEmptyPurchaseOrderDraft,
  getPurchaseOrderTotals,
  isEligiblePurchaseVariant,
  createPurchaseOrder,
  markPurchaseOrderOrdered,
  validatePurchaseOrderDraft,
} from "../src/services/adminPurchasing.js";

const main = await readFile("src/main.js", "utf8");
const styles = await readFile("src/styles.css", "utf8");
const service = await readFile("src/services/adminPurchasing.js", "utf8");
const migration = await readFile("supabase/migrations/202608240002_add_purchase_orders_m2.sql", "utf8");
const localDev = await readFile("scripts/local-dev.mjs", "utf8");
const supplierTest = await readFile("scripts/test-admin-suppliers-m1.mjs", "utf8");
const inventoryTest = await readFile("scripts/test-admin-inventory-p0.mjs", "utf8");

function readFunctionSource(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} function missing`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} function did not close`);
}

assert.ok(main.includes('"/catalog/purchasing": "Catalog"'), "Purchasing route must be registered");
assert.ok(localDev.includes('"/catalog/purchasing"'), "Local dev must serve direct Purchasing route");
assert.ok(main.includes('path: "/catalog/purchasing", icon: "shopping-cart", activePaths: ["/catalog/purchasing"]'), "Purchasing nav must be enabled");
assert.ok(main.includes("renderPurchasingPage"), "Purchasing page renderer missing");
assert.ok(main.includes("renderPurchaseOrderListPage"), "PO list renderer missing");
assert.ok(main.includes("renderPurchaseOrderDrawer"), "Create PO drawer missing");
assert.ok(main.includes("renderPurchaseOrderDetailPage"), "PO detail renderer missing");
assert.ok(main.includes("data-receiving-history-parked") && main.includes("data-receive-stock-parked"), "Receiving must be visibly parked");
assert.ok(main.includes("Supplier Ref") && main.includes("Shipping / Freight") && main.includes("Internal Note"), "Drawer fields missing");
assert.ok(main.includes("Product / Variant") && main.includes("data-po-line-search") && main.includes('role="combobox"') && main.includes('role="listbox"'), "Product/variant search picker missing");
assert.equal(main.includes("data-po-line-field=\"variantId\""), false, "Create PO item picker must not render the legacy full variant select");
assert.ok(main.includes("getPurchaseVariantSearchResults") && main.includes("slice(0, limit)"), "Product/variant search must be capped in memory");
assert.ok(main.includes("data-po-select-variant") && main.includes("data-po-selected-variant") && main.includes("data-po-change-variant"), "Product/variant selection controls missing");
assert.ok(main.includes("ArrowDown") && main.includes("ArrowUp") && main.includes("Enter") && main.includes("Escape"), "Product/variant picker keyboard controls missing");
assert.ok(main.includes("data-po-items-subtotal") && main.includes("data-po-total") && main.includes("data-po-line-total") && main.includes("refreshPurchaseOrderTotalsInPlace"), "PO totals must refresh in place");
assert.ok(main.includes("Save Draft") && main.includes("Create & Mark Ordered"), "PO save actions missing");
assert.ok(main.includes('savePurchaseOrder("DRAFT")') || main.includes('data-po-save-status="DRAFT"'), "Draft save action missing");
assert.ok(main.includes("markPurchaseOrderOrdered"), "Ordered save action missing");
assert.ok(main.includes("data-purchase-order-mark-ordered") && main.includes("MARK ORDERED"), "Draft detail Mark Ordered action missing");
assert.ok(main.includes('order.status === "DRAFT"'), "Mark Ordered action must disappear outside Draft status");
assert.ok(main.includes("canWritePurchaseOrdersForRole(adminUser?.role) && order.status === \"DRAFT\""), "Mark Ordered action must be Owner/Admin gated");
assert.ok(main.includes("PO does not change On Hand. Inventory increases only when an authorized user confirms Receive Stock."), "PO inventory boundary copy missing");

const updateDraftSource = readFunctionSource(main, "updatePurchaseDraftField");
const updateLineSource = readFunctionSource(main, "updatePurchaseLineField");
const searchSource = readFunctionSource(main, "getPurchaseVariantSearchResults");
const selectSource = readFunctionSource(main, "selectPurchaseVariantInPlace");
assert.equal(updateDraftSource.includes("render()"), false, "Create PO draft field edits must not full render per keystroke");
assert.equal(updateLineSource.includes("render()"), false, "Create PO line field edits must not full render per keystroke");
assert.equal(/fetch|supabase|executeSupabaseRpcWithAuth|getAdminCatalogProducts|rpc/i.test(searchSource), false, "Product search must stay in memory and avoid Supabase per keystroke");
for (const token of ["productName", "sku", "variantLabel", "color", "size"]) {
  assert.ok(searchSource.includes(token), `Product search must match ${token}`);
}
assert.ok(selectSource.includes('setPurchaseLineField(index, "variantId", variantId)'), "Variant selection must reuse one line instead of adding duplicates");
assert.ok(selectSource.includes("shouldUseSelectedCost"), "Variant selection must preserve manually entered unit cost");
assert.ok(selectSource.includes("data-po-line-sku") && selectSource.includes("refreshPurchaseOrderTotalsInPlace"), "Variant selection must update SKU and totals in place");

for (const header of ["PO Number", "Supplier", "Ordered", "Expected", "Items", "Total Cost", "Receiving", "Status", "Action"]) {
  assert.ok(main.includes(`<th>${header}</th>`), `PO list table header missing: ${header}`);
}

for (const header of ["Product / SKU", "Ordered", "Received", "Remaining", "Unit Cost", "Line Total", "Last Receipt", "Status", "Action"]) {
  assert.ok(main.includes(`<th>${header}</th>`), `PO detail table header missing: ${header}`);
}

assert.equal(PURCHASE_ORDERS_TABLE, "purchase_orders", "PO service must use canonical purchase_orders table");
assert.equal(PURCHASE_ORDER_LINES_TABLE, "purchase_order_lines", "PO service must use canonical purchase_order_lines table");
assert.equal(CREATE_PURCHASE_ORDER_RPC, "create_purchase_order", "Create PO RPC name changed");
assert.equal(MARK_PURCHASE_ORDER_ORDERED_RPC, "mark_purchase_order_ordered", "Mark Ordered RPC name changed");
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
assert.ok(service.includes("MARK_PURCHASE_ORDER_ORDERED_RPC") && service.includes("p_purchase_order_id"), "Mark Ordered RPC payload missing");
assert.equal(service.includes("return createPurchaseOrder(draft, \"ORDERED\""), false, "Mark Ordered must not create a duplicate ordered PO");
assert.equal(service.includes("return createPurchaseOrder(purchaseOrderId"), false, "Existing Draft -> Ordered must not use createPurchaseOrder");
assert.ok(service.includes("receivedQuantity: 0"), "M2 received quantity must be zero");
assert.ok(service.includes("remainingQuantity: orderedQuantity"), "M2 remaining quantity must equal ordered quantity");
assert.ok(service.includes("lineCount: mappedLines.length"), "Mapped PO must expose lineCount as SKU count");
assert.ok(service.includes("orderedUnits: mappedLines.reduce"), "Mapped PO must expose orderedUnits separately");
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
assert.ok(migration.includes("public.mark_purchase_order_ordered"), "Mark Ordered RPC missing");
assert.ok(migration.includes("v_status not in ('DRAFT','ORDERED')"), "M2 RPC must reject receiving statuses");
assert.ok(migration.includes("constraint purchase_orders_status_check check (status in ('DRAFT','ORDERED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED'))"), "Canonical PO lifecycle constraint must include M3 statuses");
assert.ok(migration.includes("constraint purchase_orders_m2_status_check check (status in ('DRAFT','ORDERED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED'))"), "M2 status check must not block future receiving statuses");
assert.ok(migration.includes("set search_path = ''"), "Security definer functions must use a fixed empty search_path");
assert.ok(migration.includes("public.purchase_orders%rowtype") && migration.includes("public.purchase_order_lines%rowtype"), "RPC row types must be fully qualified");
assert.ok(migration.includes("revoke execute on function public.create_purchase_order(uuid,date,text,numeric,text,text,jsonb) from public"), "Create PO RPC must revoke PUBLIC execute");
assert.ok(migration.includes("revoke execute on function public.create_purchase_order(uuid,date,text,numeric,text,text,jsonb) from anon"), "Create PO RPC must revoke anon execute");
assert.ok(migration.includes("revoke execute on function public.mark_purchase_order_ordered(uuid) from public"), "Mark Ordered RPC must revoke PUBLIC execute");
assert.ok(migration.includes("revoke execute on function public.mark_purchase_order_ordered(uuid) from anon"), "Mark Ordered RPC must revoke anon execute");
assert.ok(migration.includes("grant execute on function public.mark_purchase_order_ordered(uuid) to authenticated"), "Mark Ordered RPC must grant authenticated execute");
assert.ok(migration.includes("for update") && migration.includes("set status = 'ORDERED'") && migration.includes("ordered_at = now()"), "Mark Ordered must atomically lock and update the same PO");
const markOrderedSql = migration.slice(migration.indexOf("create or replace function public.mark_purchase_order_ordered"));
assert.equal(markOrderedSql.includes("insert into public.purchase_orders"), false, "Mark Ordered must not insert a duplicate PO header");
assert.equal(markOrderedSql.includes("insert into public.purchase_order_lines"), false, "Mark Ordered must not duplicate PO lines");
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

globalThis.window = {
  TRRY_ADMIN_ENV: {
    VITE_SUPABASE_URL: "https://example.supabase.co",
    VITE_SUPABASE_ANON_KEY: "anon-key",
    VITE_USE_SUPABASE_DATA: "true",
  },
};

const createdLineIds = ["line-a", "line-b", "line-c"];
const rpcRequests = [];
globalThis.fetch = async (url, options = {}) => {
  const body = JSON.parse(options.body || "{}");
  rpcRequests.push({ url, body });
  const isMarkOrdered = String(url).endsWith(`/rpc/${MARK_PURCHASE_ORDER_ORDERED_RPC}`);
  const status = isMarkOrdered ? "ORDERED" : body.p_status;
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        purchase_order: {
          id: "po-a",
          po_number: "PO-2026-0001",
          supplier_id: "supplier-a",
          status,
          order_date: "2026-08-24",
          expected_date: "2026-08-31",
          freight_cost: 10,
          ordered_at: status === "ORDERED" ? "2026-08-24T01:02:03.000Z" : null,
        },
        supplier: { id: "supplier-a", name: "Supplier A", supplier_reference: "SUP-A" },
        lines: [
          { id: createdLineIds[0], purchase_order_id: "po-a", product_id: "prod-a", variant_id: "var-a", product_name_snapshot: "Shirt", sku_snapshot: "SKU-A", ordered_quantity: 40, unit_cost: 1, created_at: "2026-08-24T00:00:01Z" },
          { id: createdLineIds[1], purchase_order_id: "po-a", product_id: "prod-b", variant_id: "var-b", product_name_snapshot: "Cap", sku_snapshot: "SKU-B", ordered_quantity: 30, unit_cost: 2, created_at: "2026-08-24T00:00:02Z" },
          { id: createdLineIds[2], purchase_order_id: "po-a", product_id: "prod-c", variant_id: "var-c", product_name_snapshot: "Bag", sku_snapshot: "SKU-C", ordered_quantity: 50, unit_cost: 3, created_at: "2026-08-24T00:00:03Z" },
        ],
      });
    },
  };
};

const threeLineDraft = {
  supplierId: "supplier-a",
  expectedDate: "2026-08-31",
  supplierReference: "SUP-PO-A",
  freightCost: 10,
  lines: [
    { productId: "prod-a", variantId: "var-a", orderedQuantity: 40, unitCost: 1 },
    { productId: "prod-b", variantId: "var-b", orderedQuantity: 30, unitCost: 2 },
    { productId: "prod-c", variantId: "var-c", orderedQuantity: 50, unitCost: 3 },
  ],
};

const draftA = await createPurchaseOrder(threeLineDraft, "DRAFT", { access_token: "owner-token" });
assert.equal(draftA.id, "po-a", "Draft identity A must be created");
assert.equal(draftA.poNumber, "PO-2026-0001", "Draft PO number must map");
assert.equal(draftA.lineCount, 3, "lineCount must count SKUs");
assert.equal(draftA.orderedUnits, 120, "orderedUnits must sum quantities");
assert.equal(draftA.lines.length, 3, "Draft must have three lines");
assert.deepEqual(draftA.lines.map((line) => line.id), createdLineIds, "Draft line IDs must map");

const orderedA = await markPurchaseOrderOrdered(draftA.id, { access_token: "owner-token" });
assert.equal(orderedA.id, draftA.id, "Existing Draft -> Ordered must keep identity A");
assert.equal(orderedA.poNumber, draftA.poNumber, "Existing Draft -> Ordered must keep PO number");
assert.equal(orderedA.status, "ORDERED", "Existing Draft must transition to ORDERED");
assert.ok(orderedA.orderedAt, "ordered_at must be set");
assert.equal(orderedA.lineCount, 3, "Ordered lineCount must remain SKU count");
assert.equal(orderedA.orderedUnits, 120, "Ordered orderedUnits must remain total units");
assert.equal(orderedA.lines.length, draftA.lines.length, "Existing Draft -> Ordered must not duplicate lines");
assert.deepEqual(orderedA.lines.map((line) => line.id), draftA.lines.map((line) => line.id), "Existing Draft -> Ordered must keep line IDs");

assert.ok(rpcRequests[0].url.endsWith(`/rpc/${CREATE_PURCHASE_ORDER_RPC}`), "Draft save must call create_purchase_order");
assert.equal(rpcRequests[0].body.p_status, "DRAFT", "Draft save must pass DRAFT status");
assert.ok(Array.isArray(rpcRequests[0].body.p_lines) && rpcRequests[0].body.p_lines.length === 3, "Create PO must send three lines");
assert.ok(rpcRequests[1].url.endsWith(`/rpc/${MARK_PURCHASE_ORDER_ORDERED_RPC}`), "Existing Draft -> Ordered must call mark_purchase_order_ordered");
assert.deepEqual(rpcRequests[1].body, { p_purchase_order_id: "po-a" }, "Mark Ordered must send only the existing PO id");

process.stdout.write("PASS Admin Purchase Orders M2 route, UI, service, RLS, validation, and inventory boundary contracts\n");
