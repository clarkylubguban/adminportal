import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const main = readFileSync(join(root, "src", "main.js"), "utf8");
const service = readFileSync(join(root, "src", "services", "adminCatalog.js"), "utf8");
const migration = readFileSync(join(root, "supabase", "migrations", "202608140001_canonical_master_catalog_product_cutover.sql"), "utf8");
const styles = readFileSync(join(root, "src", "styles.css"), "utf8");

const checks = [
  ["Product editor no longer uses legacy create/update names", !main.includes("createAdminCatalogProduct(") && !main.includes("updateAdminCatalogProduct(")],
  ["Active service writes canonical products", service.includes("createAdminProduct") && service.includes("updateAdminProduct") && service.includes("MASTER_PRODUCTS_TABLE")],
  ["Legacy catalog_products is read-only compatibility", service.includes("LEGACY_CATALOG_PRODUCTS_TABLE") && service.includes("getLegacyCatalogProductsReadOnly") && !service.includes("createSupabaseRowWithAuth(\n    LEGACY_CATALOG_PRODUCTS_TABLE")],
  ["Product Code is read-only generated state", main.includes("Product Code") && main.includes("Generated on save.") && !main.includes("catalog-slug") && !main.includes("Slug is required")],
  ["No slugification feeds Product Code", !main.includes("slug: slugify(draft") && service.includes("productCode: row.product_code")],
  ["Quick price uses canonical update", main.includes("updateCatalogQuickPrice") && main.includes("updateAdminProduct(productId")],
  ["Quick image uses product_images payload", main.includes("updateCatalogQuickImage") && main.includes("images: nextImages") && service.includes("set_product_images_for_product")],
  ["Duplicate uses canonical duplicate service", main.includes("duplicateAdminProduct(product, adminAuthSession)") && service.includes("duplicateAdminProduct")],
  ["MC-02 primary and drag controls exist", main.includes("catalog-primary-badge") && main.includes("data-catalog-image-drag") && main.includes("data-catalog-move-image") && styles.includes("cursor: grab")],
  ["Six image app cap remains", main.includes("const CATALOG_PRODUCT_IMAGE_LIMIT = 6") && main.includes("images.length >= CATALOG_PRODUCT_IMAGE_LIMIT")],
  ["Database Product identifiers are generated", migration.includes("generate_product_code_candidate") && migration.includes("assign_product_canonical_identity") && migration.includes("PRODUCT_CODE_IMMUTABLE")],
  ["Database Variant identifiers are generated", migration.includes("generate_variant_sku_candidate") && migration.includes("assign_variant_canonical_identity") && migration.includes("GLOBAL_SKU_IMMUTABLE")],
  ["Database image governance is enforced", migration.includes("PRODUCT_IMAGE_LIMIT_EXCEEDED") && migration.includes("product_images_one_active_position_idx") && migration.includes("set_product_images_for_product")],
  ["Storage policy aligns Owner/Admin writes", migration.includes("Owners and admins can upload catalog images") && !migration.includes("Admin and staff can upload catalog images\"\non storage.objects\nfor insert")],
];

const failures = checks.filter(([, passed]) => !passed);

if (failures.length) {
  console.error("Master Catalog canonical Product cutover source validation failed:");
  for (const [label] of failures) console.error(`- ${label}`);
  process.exit(1);
}

console.log("Master Catalog canonical Product cutover source validation passed.");
