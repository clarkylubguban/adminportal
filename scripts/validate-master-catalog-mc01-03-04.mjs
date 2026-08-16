import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const main = readFileSync(join(root, "src", "main.js"), "utf8");
const styles = readFileSync(join(root, "src", "styles.css"), "utf8");
const service = readFileSync(join(root, "src", "services", "adminCatalog.js"), "utf8");

const checks = [
  ["Catalog parent is a toggle, not a route link", main.includes("data-catalog-nav-toggle") && main.includes("aria-expanded") && main.includes("aria-controls=\"catalog-subnav\"")],
  ["Catalog children are hidden when collapsed", main.includes("catalog-subnav\" id=\"catalog-subnav\"") && main.includes("${isCatalogExpanded ? \"\" : \"hidden\"}") && styles.includes(".catalog-subnav[hidden]")],
  ["Catalog auto-expands on Catalog routes", main.includes('routePath === "/catalog" || routePath === "/catalog/brands" || routePath === "/catalog/categories"') && main.includes("const isCatalogExpanded = isCatalogRoute || isCatalogNavExpanded")],
  ["Catalog route changes collapse the group outside Catalog", main.includes("if (routeOnly !== \"/catalog\" && routeOnly !== \"/catalog/brands\" && routeOnly !== \"/catalog/categories\")") && main.includes("isCatalogNavExpanded = false")],
  ["Only Catalog children get primary selected state", main.includes("catalog-nav-toggle ${isCatalogRoute ? \"section-active\" : \"\"}") && styles.includes(".catalog-nav-toggle.section-active") && styles.includes(".catalog-subnav-link.active")],
  ["Readiness has four required checks and summary", main.includes("requirements complete") && main.includes("At least one product image") && !main.includes("Production information\", ready")],
  ["Readiness can focus relevant sections", main.includes("data-catalog-readiness-target") && main.includes("function focusCatalogEditorSection") && main.includes("catalog-section-product-identity")],
  ["Readiness SVGs are constrained", styles.includes(".catalog-readiness-icon svg") && styles.includes("height: 18px !important") && styles.includes("width: 18px !important")],
  ["Categories table uses desktop-fit columns", main.includes("category-main-cell") && main.includes("category-action-cell") && styles.includes(".category-table .category-main-cell")],
  ["Categories table avoids desktop overflow and allows narrow overflow", styles.includes(".catalog-table-card:has(.category-table)") && styles.includes("overflow-x: hidden !important") && styles.includes("@media (max-width: 860px)") && styles.includes("overflow-x: auto !important")],
  ["Long category values keep accessible titles", main.includes("category-code-cell") && main.includes("title=\"${escapeHtml(category.code)}\"") && main.includes("title=\"${escapeHtml(parent?.name || \"Root\")}\"")],
  ["Six-image maximum remains unchanged", main.includes("const CATALOG_PRODUCT_IMAGE_LIMIT = 6") && main.includes("Maximum ${CATALOG_PRODUCT_IMAGE_LIMIT} images")],
  ["Canonical binding is active and legacy writes are absent", main.includes("createAdminProduct(baseProduct, adminAuthSession)") && main.includes("updateAdminProduct(draft.id, baseProduct, adminAuthSession)") && service.includes("PRODUCT_IMAGES_TABLE") && !main.includes("createAdminCatalogProduct(") && !main.includes("updateAdminCatalogProduct(")],
  ["MC-02 controls are present", main.includes("catalog-primary-badge") && main.includes("data-catalog-image-drag") && main.includes("data-catalog-move-image")],
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
