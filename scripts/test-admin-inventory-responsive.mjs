import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile("src/main.js", "utf8");
const styles = await readFile("src/styles.css", "utf8");
const localDev = await readFile("scripts/local-dev.mjs", "utf8");

const stockTableStart = main.indexOf("function renderInventoryStockTable");
const stockTableEnd = main.indexOf("function renderInventoryMovementTable");
assert.ok(stockTableStart > -1 && stockTableEnd > stockTableStart, "Inventory stock table renderer missing");
const stockTable = main.slice(stockTableStart, stockTableEnd);

const drawerStart = main.indexOf("function renderInventoryReceiveDrawer");
const drawerEnd = main.indexOf("function renderInventoryReadonlyFact");
assert.ok(drawerStart > -1 && drawerEnd > drawerStart, "Inventory receive drawer renderer missing");
const drawer = main.slice(drawerStart, drawerEnd);

assert.ok(main.includes('if (path === "/catalog/inventory" && !canViewInventoryRoute()) return defaultRoutePath;'), "Inventory direct route guard missing");
assert.ok(main.includes('if (routePath === "/catalog/inventory" && !canViewInventoryRoute()) return defaultRoutePath;'), "Inventory navigation guard missing");
assert.ok(main.includes('path: "/catalog/inventory", icon: "boxes", activePaths: ["/catalog/inventory"]'), "Inventory nav route contract changed");
assert.ok(localDev.includes("VITE_LOCAL_TASK_QA_ROLE") && localDev.includes("VITE_LOCAL_TASK_QA_USER_ID"), "Local dev QA role passthrough missing for guarded responsive smoke");

for (const header of ["Product / Variant", "SKU", "On Hand", "Reorder", "Incoming", "Stock", "Last Cost", "Stock Value", "Action"]) {
  assert.ok(stockTable.includes(`<th>${header}</th>`), `Inventory stock table header missing: ${header}`);
}

for (const token of [
  ".inventory-page",
  ".inventory-table-card",
  ".inventory-table th",
  ".inventory-table td",
  ".inventory-product-col",
  ".inventory-sku-col",
  ".inventory-on-hand-col",
  ".inventory-incoming-col",
  ".inventory-stock-col",
  ".inventory-action-col",
  ".inventory-receive-drawer",
  ".inventory-readonly-grid",
  ".inventory-movement-table",
  ".movement-product-col",
  ".movement-reference-col",
  ".movement-reason-col",
  "@media (max-width: 760px)",
]) {
  assert.ok(styles.includes(token), `Inventory responsive CSS missing: ${token}`);
}

assert.ok(/\.inventory-product-col\s*\{\s*width:\s*28%;\s*\}/.test(styles), "Product / Variant must keep final 28% table width");
assert.ok(/\.inventory-sku-col\s*\{\s*width:\s*16%;\s*\}/.test(styles), "SKU must keep final 16% table width");
assert.ok(/\.inventory-incoming-col\s*\{\s*width:\s*8%;\s*\}/.test(styles), "Incoming must keep enough width for its header");
assert.ok(/\.inventory-table th,\s*\.inventory-table td\s*\{\s*overflow:\s*visible;/.test(styles), "Inventory cells must not clip stock chips or headers");
assert.ok(styles.includes("min-width: max-content"), "Inventory stock chip must keep full label readable");
assert.ok(drawer.includes("Only Owner and Admin can receive stock."), "Receive drawer must show read-only Staff boundary");
assert.ok(drawer.includes("inventory-readonly-grid"), "Receive drawer must keep compact readonly facts");

process.stdout.write("PASS Admin Inventory responsive contract: guarded route, table widths, mobile CSS, and drawer layout\n");
