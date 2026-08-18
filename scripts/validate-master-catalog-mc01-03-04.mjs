import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const main = readFileSync(join(root, "src", "main.js"), "utf8");
const styles = readFileSync(join(root, "src", "styles.css"), "utf8");
const service = readFileSync(join(root, "src", "services", "adminCatalog.js"), "utf8");
const sidebarStart = main.indexOf("function renderSidebar");
const sidebarEnd = main.indexOf("function getAdminDisplayName");
const sidebar = main.slice(sidebarStart, sidebarEnd);
const supplyOrder = ["Products", "Brands", "Categories", "Suppliers", "Purchasing", "Inventory"].map((label) => sidebar.indexOf(`label: "${label}"`));

const checks = [
  ["Catalog parent toggle is removed", !sidebar.includes("data-catalog-nav-toggle") && !main.includes("isCatalogNavExpanded")],
  ["Catalog & Supply section is always visible", sidebar.includes("CATALOG &amp; SUPPLY") && sidebar.includes("catalog-supply-nav") && !sidebar.includes("hidden")],
  ["Catalog direct route order is approved", supplyOrder.every((index) => index > -1) && supplyOrder.every((index, position) => position === 0 || index > supplyOrder[position - 1])],
  ["Catalog direct routes get primary selected state", sidebar.includes('activePaths: ["/catalog"]') && sidebar.includes('activePaths: ["/catalog/brands"]') && sidebar.includes('activePaths: ["/catalog/categories"]') && styles.includes(".sidebar a.active") && styles.includes("box-shadow: inset 3px 0 0 var(--trry-lime)")],
  ["Readiness has four required checks and summary", main.includes("requirements complete") && main.includes("At least one product image") && !main.includes("Production information\", ready")],
  ["Readiness can focus relevant sections", main.includes("data-catalog-readiness-target") && main.includes("function focusCatalogEditorSection") && main.includes("catalog-section-product-identity")],
  ["Readiness SVGs are constrained", styles.includes(".catalog-readiness-icon svg") && styles.includes("height: 18px !important") && styles.includes("width: 18px !important")],
  ["Categories table uses desktop-fit columns", main.includes("category-main-cell") && main.includes("category-action-cell") && styles.includes(".category-table .category-main-cell")],
  ["Categories table avoids desktop overflow and allows narrow overflow", styles.includes(".catalog-table-card:has(.category-table)") && styles.includes("overflow-x: hidden !important") && styles.includes("@media (max-width: 860px)") && styles.includes("overflow-x: auto !important")],
  ["Long category values keep accessible titles", main.includes("category-code-cell") && main.includes("title=\"${escapeHtml(category.code)}\"") && main.includes("title=\"${escapeHtml(parent?.name || \"Root\")}\"")],
  ["Six-image maximum remains unchanged", main.includes("const CATALOG_PRODUCT_IMAGE_LIMIT = 6") && main.includes("Maximum ${CATALOG_PRODUCT_IMAGE_LIMIT} images")],
  ["Canonical binding is active and legacy writes are absent", main.includes("createAdminProduct(baseProduct, adminAuthSession)") && main.includes("updateAdminProduct(draft.id, baseProduct, adminAuthSession)") && service.includes("PRODUCT_IMAGES_TABLE") && !main.includes("createAdminCatalogProduct(") && !main.includes("updateAdminCatalogProduct(")],
  ["MC-02 controls are present", main.includes("catalog-primary-badge") && main.includes("data-catalog-image-drag") && main.includes("data-catalog-move-image") && main.includes("data-catalog-set-primary-image")],
];

const failures = checks.filter(([, passed]) => !passed);

if (failures.length) {
  console.error("Master Catalog MC-01/03/04 correction validation failed:");
  for (const [label] of failures) {
    console.error(`- ${label}`);
  }
  process.exit(1);
}

console.log("Master Catalog MC-01/03/04 correction validation passed.");
