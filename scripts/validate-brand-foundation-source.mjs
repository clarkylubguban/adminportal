import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const main = readFileSync(join(root, "src", "main.js"), "utf8");
const service = readFileSync(join(root, "src", "services", "adminCatalog.js"), "utf8");
const localDev = readFileSync(join(root, "scripts", "local-dev.mjs"), "utf8");
const productInfoStart = main.indexOf("function renderCatalogEditorProductInformation");
const productInfoEnd = main.indexOf("function renderCatalogEditorImages");
const productInfo = main.slice(productInfoStart, productInfoEnd);
const brandFieldIndex = productInfo.indexOf('renderCatalogField("brandId", "Brand"');
const productTypeFieldIndex = productInfo.indexOf('renderCatalogField("productType", "Product Type"');
const duplicateBody = service.slice(service.indexOf("export async function duplicateAdminProduct"), service.indexOf("async function getAdminProductById"));

const checks = [
  ["Brands route is registered", main.includes('"/catalog/brands": "Catalog"') && localDev.includes('"/catalog/brands"')],
  ["Sidebar order includes parked supply items", main.includes('{ label: "Products", path: "/catalog" }') && main.includes('{ label: "Brands", path: "/catalog/brands" }') && main.includes('{ label: "Categories", path: "/catalog/categories" }') && main.includes('{ label: "Suppliers", path: "/catalog/suppliers", disabled: true }') && main.includes('{ label: "Purchasing", path: "/catalog/purchasing", disabled: true }') && main.includes('{ label: "Inventory", path: "/catalog/inventory", disabled: true }')],
  ["Brands page and drawer exist", main.includes("function renderCatalogBrandsPage") && main.includes("function renderBrandDrawer") && main.includes("BRAND DIRECTORY")],
  ["Owner/Admin Brand mutation controls exist", main.includes("function canManageBrands") && main.includes('return ["owner", "admin"].includes(adminUser?.role);') && main.includes("data-brand-add") && main.includes("data-brand-archive")],
  ["Staff/Viewer read-only Brand notice exists", main.includes("Viewer access: Brands are read-only.")],
  ["Brand service reads and writes canonical brands table", service.includes('export const BRANDS_TABLE = "brands"') && service.includes("getAdminBrands") && service.includes("createAdminBrand") && service.includes("updateAdminBrand")],
  ["Product service writes brand_id", service.includes("brand_id: product.brandId || product.brand_id || null")],
  ["Product reads include Brand metadata", service.includes("brandById.get(row.brand_id)") && service.includes("brandName: brand?.name") && service.includes("brandCode: brand?.brand_code")],
  ["Product editor has required Brand selector before Product Type", brandFieldIndex > -1 && brandFieldIndex < productTypeFieldIndex],
  ["Only active Brands are selectable", main.includes("function getCatalogEditorActiveBrands") && main.includes('brand.status === "active" || brand.id === draft.brandId')],
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
