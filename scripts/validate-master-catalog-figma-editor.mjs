import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const main = readFileSync(join(root, "src", "main.js"), "utf8");
const styles = readFileSync(join(root, "src", "styles.css"), "utf8");

const checks = [
  ["Product create/edit no longer renders the rejected Catalog drawer", !main.includes("function renderCatalogDrawer") && !main.includes("openCatalogDrawer(") && !main.includes("data-catalog-close-drawer")],
  ["Full-page Product editor exists", main.includes("function renderCatalogProductEditorPage") && main.includes("catalog-product-editor-page") && main.includes("data-catalog-product-editor")],
  ["New Product routed editor state exists", main.includes("/catalog?product=new") && main.includes("mode: \"create\"")],
  ["Edit Product routed editor state exists", main.includes("mode: \"edit\"") && main.includes("data-catalog-edit-product")],
  ["Validation and save-success states exist", main.includes("validateCatalogProductEditor") && main.includes("catalog-editor-toast error") && main.includes("catalog-editor-toast success")],
  ["Six-image limit remains explicit", main.includes("const CATALOG_PRODUCT_IMAGE_LIMIT = 6") && main.includes("Maximum ${CATALOG_PRODUCT_IMAGE_LIMIT} images")],
  ["Product Type and Category compatibility remains", main.includes("renderCatalogProductTypeSelect") && main.includes("renderCatalogCategorySelect") && main.includes("Category must match the selected Product Type")],
  ["New Product requires Product Type before Category", main.includes("productType: \"\"") && main.includes("disabled || !draft.productType")],
  ["Owner/Admin write and Staff read-only behavior remains", main.includes('return ["owner", "admin"].includes(adminUser?.role);')],
  ["Mobile editor exists without a Product drawer", styles.includes(".catalog-editor-mobile-topbar") && styles.includes(".catalog-editor-footer") && styles.includes(".catalog-product-editor-page")],
  ["Other module drawers are preserved", main.includes("renderCategoryDrawer") && main.includes("renderStaffDrawer") && styles.includes(".ops-detail-drawer") && styles.includes(".order-dashboard-drawer")],
];

const failures = checks.filter(([, passed]) => !passed);

if (failures.length) {
  console.error("Master Catalog Figma editor validation failed:");
  for (const [label] of failures) {
    console.error(`- ${label}`);
  }
  process.exit(1);
}

console.log("Master Catalog Figma editor validation passed.");
