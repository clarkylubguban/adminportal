import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const main = readFileSync(join(root, "src", "main.js"), "utf8");
const styles = readFileSync(join(root, "src", "styles.css"), "utf8");
const service = readFileSync(join(root, "src", "services", "adminCatalog.js"), "utf8");
const localDev = readFileSync(join(root, "scripts", "local-dev.mjs"), "utf8");
const productInfoStart = main.indexOf("function renderCatalogEditorProductInformation");
const productInfoEnd = main.indexOf("function renderCatalogEditorImages");
const productInfo = main.slice(productInfoStart, productInfoEnd);
const sidebarStart = main.indexOf("function renderSidebar");
const sidebarEnd = main.indexOf("function getAdminDisplayName");
const sidebar = main.slice(sidebarStart, sidebarEnd);
const brandRowStart = main.indexOf("function renderBrandRow");
const brandRowEnd = main.indexOf("function renderBrandDrawer");
const brandRow = main.slice(brandRowStart, brandRowEnd);
const brandDrawerStart = main.indexOf("function renderBrandDrawer");
const brandDrawerEnd = main.indexOf("function renderCategoryEmptyState");
const brandDrawer = main.slice(brandDrawerStart, brandDrawerEnd);
const catalogPageStart = main.indexOf("function renderCatalogPage");
const catalogPageEnd = main.indexOf("function renderCatalogCategoriesPage");
const catalogPage = main.slice(catalogPageStart, catalogPageEnd);
const brandFieldIndex = productInfo.indexOf('renderCatalogField("brandId", "Brand"');
const productTypeFieldIndex = productInfo.indexOf('renderCatalogField("productType", "Product Type"');
const productSearchIndex = catalogPage.indexOf('id="product-search"');
const productBrandFilterIndex = catalogPage.indexOf('id="catalog-brand-filter"');
const productCategoryFilterIndex = catalogPage.indexOf('id="catalog-category-filter"');
const productTypeFilterIndex = catalogPage.indexOf('id="catalog-product-type-filter"');
const productStatusFilterIndex = catalogPage.indexOf('id="catalog-status-filter"');
const productFeaturedFilterIndex = catalogPage.indexOf('id="catalog-featured-filter"');
const productResetIndex = catalogPage.indexOf("data-catalog-reset-filters");
const duplicateBody = service.slice(service.indexOf("export async function duplicateAdminProduct"), service.indexOf("async function getAdminProductById"));
const supplyOrder = ["Products", "Brands", "Categories", "Suppliers", "Purchasing", "Inventory"].map((label) => sidebar.indexOf(`label: "${label}"`));

const checks = [
  ["Brands route is registered", main.includes('"/catalog/brands": "Catalog"') && localDev.includes('"/catalog/brands"')],
  ["Catalog & Supply sidebar section exists", sidebar.includes("CATALOG &amp; SUPPLY") && sidebar.includes("catalog-supply-nav") && styles.includes(".sidebar-section-label")],
  ["Visible Catalog parent/collapse row is removed", !sidebar.includes("data-catalog-nav-toggle") && !sidebar.includes("catalog-nav-chevron") && !main.includes("isCatalogNavExpanded")],
  ["Sidebar order includes parked supply items", supplyOrder.every((index) => index > -1) && supplyOrder.every((index, position) => position === 0 || index > supplyOrder[position - 1])],
  ["Catalog children are regular weight when inactive", styles.includes(".catalog-supply-link .nav-label") && styles.includes("font-weight: 500") && styles.includes(".sidebar a.active .nav-label") && styles.includes("font-weight: 650")],
  ["Parked supply modules stay disabled", sidebar.includes('{ label: "Suppliers", path: "/catalog/suppliers", icon: "truck", disabled: true }') && sidebar.includes('{ label: "Purchasing", path: "/catalog/purchasing", icon: "shopping-cart", disabled: true }') && sidebar.includes('{ label: "Inventory", path: "/catalog/inventory", icon: "boxes", disabled: true }') && sidebar.includes('class="catalog-supply-link disabled"') && sidebar.includes("<span") && sidebar.includes('aria-disabled="true"')],
  ["Catalog active route mapping is explicit", sidebar.includes('activePaths: ["/catalog"]') && sidebar.includes('activePaths: ["/catalog/brands"]') && sidebar.includes('activePaths: ["/catalog/categories"]')],
  ["Brands page and drawer exist", main.includes("function renderCatalogBrandsPage") && main.includes("function renderBrandDrawer") && main.includes("BRAND DIRECTORY")],
  ["Brand table renders primary/secondary text separately", brandRow.includes("brand-row-stack") && brandRow.includes("Code: ${escapeHtml(brand.brandCode)}") && brandRow.includes("formatOwnershipType(brand.ownershipType))} owner")],
  ["Null website slug avoids Admin only", brandRow.includes('brand.websiteSlug || "Not published"') && !brandRow.includes("Admin only")],
  ["Owner/Admin Brand mutation controls exist", main.includes("function canManageBrands") && main.includes('return ["owner", "admin"].includes(adminUser?.role);') && main.includes("data-brand-add") && main.includes("data-brand-archive")],
  ["Staff/Viewer read-only Brand notice exists", main.includes("Viewer access: Brands are read-only.")],
  ["Brand service reads and writes canonical brands table", service.includes('export const BRANDS_TABLE = "brands"') && service.includes("getAdminBrands") && service.includes("createAdminBrand") && service.includes("updateAdminBrand")],
  ["Product service writes brand_id", service.includes("brand_id: product.brandId || product.brand_id || null")],
  ["Product reads include Brand metadata", service.includes("brandById.get(row.brand_id)") && service.includes("brandName: brand?.name") && service.includes("brandCode: brand?.brand_code")],
  ["Product editor has required Brand selector before Product Type", brandFieldIndex > -1 && brandFieldIndex < productTypeFieldIndex],
  ["Products channel tabs are parked from main UI", !catalogPage.includes("catalog-tabs") && !catalogPage.includes("data-catalog-tab")],
  ["Products filters are Brand-first after search", [productSearchIndex, productBrandFilterIndex, productCategoryFilterIndex, productTypeFilterIndex, productStatusFilterIndex, productFeaturedFilterIndex, productResetIndex].every((index) => index > -1) && productSearchIndex < productBrandFilterIndex && productBrandFilterIndex < productCategoryFilterIndex && productCategoryFilterIndex < productTypeFilterIndex && productTypeFilterIndex < productStatusFilterIndex && productStatusFilterIndex < productFeaturedFilterIndex && productFeaturedFilterIndex < productResetIndex],
  ["Products Brand filter drives visible product dataset", main.includes("let catalogBrandFilter = \"all\"") && main.includes("const matchesBrand = catalogBrandFilter === \"all\" || item.brandId === catalogBrandFilter") && main.includes("getCatalogBrandOptions") && main.includes('id="catalog-brand-filter"')],
  ["Products summary uses same effective dataset as table", catalogPage.includes("const visibleProducts = getVisibleCatalogProducts()") && catalogPage.includes("getCatalogProductSummaryCards(visibleProducts)") && main.includes("function getCatalogProductSummaryCards(effectiveProducts = getVisibleCatalogProducts())") && main.includes("effectiveProducts.filter((item) => getCatalogProductHealthChecks(item).some((check) => !check.ready))")],
  ["Products Product Type narrows Category filter", main.includes('catalogProductTypeFilter === "all" || (item.productType || inferCatalogProductType(item) || "") === catalogProductTypeFilter') && main.includes("category.productType !== catalogProductTypeFilter")],
  ["Only active Brands are selectable", main.includes("function getCatalogEditorActiveBrands") && main.includes('brand.status === "active" || brand.id === draft.brandId')],
  ["Existing Brand Code is readonly and new Brand Code remains editable", brandDrawer.includes('{ readonly: isEdit, locked: isEdit }') && brandDrawer.includes('isEdit ? "Stable and immutable after creation."') && styles.includes("input.locked-field[readonly]")],
  ["Save Changes has dirty-state guard", brandDrawer.includes("const isDirty = !isEdit || isBrandDraftDirty(selectedBrand, normalizedDraft)") && brandDrawer.includes("const canSave = canWrite && !isSaving && isDirty && !validateBrand(normalizedDraft)") && main.includes("function isBrandDraftDirty")],
  ["Product save blocks missing Brand", main.includes('if (!draft.brandId) return "Brand is required."') && main.includes("Only active Brands can be assigned to products.")],
  ["Product list and summary show Brand", main.includes("<th>Brand</th>") && main.includes('renderCatalogDetailRow("Brand"')],
  ["Product duplication retains Brand and clears identities", duplicateBody.includes("...product") && duplicateBody.includes("masterProductId: \"\"") && duplicateBody.includes("masterVariantId: \"\"") && duplicateBody.includes("globalSku: \"\"")],
  ["Quick Control has no Brand mutation", main.includes("function renderCatalogProductQuickControl") && !main.slice(main.indexOf("function renderCatalogProductQuickControl"), main.indexOf("function getCatalogProductHealthChecks")).includes("brandId")],
];

const failures = checks.filter(([, passed]) => !passed);

if (failures.length) {
  console.error("Brand Foundation source validation failed:");
  for (const [label] of failures) console.error(`- ${label}`);
  process.exit(1);
}

console.log("Brand Foundation source validation passed.");
