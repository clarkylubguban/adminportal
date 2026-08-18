import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const main = readFileSync(join(root, "src", "main.js"), "utf8");
const styles = readFileSync(join(root, "src", "styles.css"), "utf8");
const service = readFileSync(join(root, "src", "services", "adminCatalog.js"), "utf8");
const localDev = readFileSync(join(root, "scripts", "local-dev.mjs"), "utf8");
const sidebarStart = main.indexOf("function renderSidebar");
const sidebarEnd = main.indexOf("function getAdminDisplayName");
const sidebar = main.slice(sidebarStart, sidebarEnd);
const supplyOrder = ["Products", "Brands", "Categories", "Suppliers", "Purchasing", "Inventory"].map((label) => sidebar.indexOf(`label: "${label}"`));

const checks = [
  ["Catalog Brands and Categories routes are registered", main.includes('"/catalog/brands": "Catalog"') && main.includes('"/catalog/categories": "Catalog"') && localDev.includes('"/catalog/brands"') && localDev.includes('"/catalog/categories"')],
  ["Master Catalog sidebar subtree is direct and always visible", sidebar.includes("CATALOG &amp; SUPPLY") && sidebar.includes("catalog-supply-nav") && supplyOrder.every((index) => index > -1) && supplyOrder.every((index, position) => position === 0 || index > supplyOrder[position - 1]) && !sidebar.includes("data-catalog-nav-toggle")],
  ["Products route stays on full-page editor flow", main.includes("function getCatalogProductEditorRoute") && main.includes('getRoutePath() !== "/catalog"') && main.includes("/catalog?product=new")],
  ["Standalone Categories page exists", main.includes("function renderCatalogCategoriesPage") && main.includes("Active Categories") && main.includes("Root Categories") && main.includes("Assigned Products")],
  ["Categories use canonical Admin Catalog service", main.includes("getAdminProductCategories") && main.includes("productCategories") && !main.includes("retail_categories") && !main.includes("retailCategory")],
  ["Category filters include product type, hierarchy, and status", main.includes("categoryProductTypeFilter") && main.includes("categoryHierarchyFilter") && main.includes("categoryStatusFilter")],
  ["Product Quick Control is preserved", main.includes("function renderCatalogProductQuickControl") && main.includes("Catalog Health") && main.includes("Copy SKU") && main.includes("Full Edit Product")],
  ["Update Price uses canonical product update", main.includes("function updateCatalogQuickPrice") && main.includes("updateAdminProduct(productId") && main.includes("data-catalog-quick-selling-price")],
  ["Update Image uses canonical product image persistence", main.includes("function updateCatalogQuickImage") && main.includes("uploadCatalogImage(file, product, adminAuthSession)") && main.includes("images: nextImages")],
  ["Duplicate uses canonical duplicate service", main.includes("function duplicateCatalogProduct") && main.includes("duplicateAdminProduct(product, adminAuthSession)")],
  ["Product drawer was not restored", !main.includes("function renderCatalogDrawer") && !main.includes("openCatalogDrawer(") && !main.includes("data-catalog-close-drawer")],
  ["Six-image maximum remains explicit", main.includes("const CATALOG_PRODUCT_IMAGE_LIMIT = 6") && main.includes("Maximum ${CATALOG_PRODUCT_IMAGE_LIMIT} images")],
  ["New/Edit Category drawer carries T3.1 rules", main.includes("MASTER CATALOG TAXONOMY") && main.includes("Product Type is locked while products or child categories exist") && main.includes("Parent options are active, non-archived, same Product Type, and cycle-safe")],
  ["Product Type dependency and locks remain enforced", main.includes("disabled || !draft.productType") && main.includes("locksProductType") && main.includes("Only categories with the same product type are available.")],
  ["Owner/Admin writes and Staff read-only remain", main.includes("function canManageProductCategories") && main.includes("function canWriteCatalogProducts") && main.includes('return ["owner", "admin"].includes(adminUser?.role);')],
  ["Quick Control and drawer styles exist", styles.includes(".catalog-product-quick-control") && styles.includes(".category-drawer") && styles.includes("width: min(520px, 100vw)")],
  ["Active catalog product writes avoid legacy table", !service.includes("createAdminCatalogProduct") && !service.includes("updateAdminCatalogProduct") && service.includes("LEGACY_CATALOG_PRODUCTS_TABLE") && service.includes("getLegacyCatalogProductsReadOnly")],
];

const failures = checks.filter(([, passed]) => !passed);

if (failures.length) {
  console.error("Master Catalog subtree and quick-control validation failed:");
  for (const [label] of failures) {
    console.error(`- ${label}`);
  }
  process.exit(1);
}

console.log("Master Catalog subtree and quick-control validation passed.");
