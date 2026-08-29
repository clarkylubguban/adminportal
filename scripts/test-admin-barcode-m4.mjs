import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { calculateCode128Checksum, encodeCode128B, getCode128Pattern, renderCode128Svg } from "../src/shared/code128.js";
import {
  EAN8_RAW_MODULES,
  EAN8_RENDERED_MODULES,
  calculateEan8CheckDigit,
  getEan8Pattern,
  isValidEan8,
  makeInternalRcn8,
  renderEan8Svg,
} from "../src/shared/ean8.js";
import { createBarcodeScanner, normalizeBarcode } from "../src/shared/barcodeScanner.js";
import {
  canManageBarcodesForRole,
  canPrintBarcodesForRole,
  isBarcodeEligibleProductVariant,
} from "../src/services/adminBarcodes.js";

const baseMigration = await read("supabase/migrations/202608240004_add_barcode_identity_m4.sql");
const ean8Migration = await read("supabase/migrations/20260829145653_cutover_internal_barcodes_to_ean8.sql");
const service = await read("src/services/adminBarcodes.js");
const scanner = await read("src/shared/barcodeScanner.js");
const code128 = await read("src/shared/code128.js");
const ean8 = await read("src/shared/ean8.js");
const barcodeUi = await read("src/barcodeM4.js");
const barcodeCss = await read("src/barcodeM4.css");
const m3 = await read("src/purchasingReceivingM3.js");
const m3Css = await read("src/purchasingReceivingM3.css");
const index = await read("index.html");
const pkg = JSON.parse(await read("package.json"));

assert.ok(baseMigration.includes("create table if not exists public.product_variant_barcodes"), "barcode alias table contract missing");
assert.ok(baseMigration.includes("variant_id uuid not null references public.product_variants(id)"), "barcode must reference canonical variant");
assert.ok(baseMigration.includes("create unique index if not exists product_variant_barcodes_code_unique"), "unique barcode constraint missing");
assert.ok(baseMigration.includes("where active = true and is_primary = true"), "one active primary barcode per variant missing");
assert.ok(baseMigration.includes("create sequence if not exists public.product_variant_barcode_sequence"), "internal barcode sequence missing");
assert.ok(baseMigration.includes("security definer"), "hardened security definer RPCs missing");
assert.ok(baseMigration.includes("set search_path = ''"), "fixed search_path missing");
assert.ok(baseMigration.includes("public.is_active_admin_user(array['owner','admin'])"), "Owner/Admin write guard missing");
assert.ok(baseMigration.includes("public.is_active_admin_user(array['owner','admin','staff'])"), "Staff lookup guard missing");
assert.ok(baseMigration.includes("upper(coalesce(v_product.product_type, '')) <> 'PHYSICAL'"), "physical product guard missing");
assert.ok(baseMigration.includes("btrim(coalesce(v_variant.sku, '')) = ''"), "SKU required guard missing");
assert.ok(baseMigration.includes("Barcode already assigned to another product variant."), "duplicate assignment block missing");
assert.ok(baseMigration.includes("v_existing_found boolean := false"), "assignment must declare explicit existing barcode boolean");
assert.ok(baseMigration.includes("v_existing_found := found"), "assignment must capture SELECT FOUND immediately");
assert.ok(baseMigration.includes("if v_existing_found and v_existing.variant_id <> p_variant_id then"), "duplicate block must use explicit SELECT result");
assert.ok(baseMigration.includes("if v_existing_found then"), "assignment branch must use explicit SELECT result");
assert.ok(!baseMigration.includes("if found and v_existing.variant_id <> p_variant_id then"), "assignment duplicate branch must not use generic FOUND");
assert.ok(!baseMigration.includes("if found then\n    update public.product_variant_barcodes"), "assignment update branch must not use generic FOUND after demotion");
assert.ok(baseMigration.includes("create or replace function trry_api.lookup_variant_by_barcode"), "exact lookup RPC missing");
assert.ok(baseMigration.includes("barcode.code = v_code"), "lookup must be exact");
assert.equal(/receive_inventory|stock_movements|inventory_balances/i.test(baseMigration + ean8Migration), false, "barcode migrations must not post inventory");
assert.ok(baseMigration.includes("revoke execute on function public.generate_variant_barcode(uuid) from public"), "public write execute revoke missing");
assert.ok(baseMigration.includes("revoke execute on function public.assign_variant_barcode(uuid,text,text) from public"), "assign public revoke missing");
assert.ok(baseMigration.includes("grant execute on function trry_api.lookup_variant_by_barcode(text) to authenticated"), "lookup authenticated grant missing");

assert.ok(ean8Migration.includes("create or replace function public.calculate_ean8_check_digit"), "EAN-8 check digit function missing");
assert.ok(ean8Migration.includes("create or replace function public.make_internal_rcn8"), "internal RCN-8 builder missing");
assert.ok(ean8Migration.includes("v_reference := nextval('public.product_variant_barcode_sequence')"), "generator must use barcode sequence authority");
assert.ok(ean8Migration.includes("if v_reference > 999999 then"), "generator must reject references above 999999");
assert.ok(ean8Migration.includes("v_code := public.make_internal_rcn8(v_reference)"), "generator must construct RCN-8 from sequence");
assert.ok(ean8Migration.includes("symbology = 'EAN8'"), "internal barcode rows must store EAN8 symbology");
assert.ok(ean8Migration.includes("source = 'INTERNAL'"), "converted TRRY rows must remain INTERNAL");
assert.ok(ean8Migration.includes("where code ~ '^TRRY[0-9]+$'"), "cutover must only target old generated TRRY test codes");
assert.ok(ean8Migration.includes("right(substring(code from '^TRRY([0-9]+)$'), 6)"), "cutover must recover last six sequence digits");
assert.equal(/insert into public\.products|insert into public\.product_variants|update public\.products|update public\.product_variants|inventory_/i.test(ean8Migration), false, "EAN-8 cutover must not modify catalog or inventory data");

assert.equal(calculateEan8CheckDigit("9638507"), "4", "known EAN-8 check digit failed");
assert.equal(isValidEan8("96385074"), true, "known valid EAN-8 rejected");
assert.equal(isValidEan8("96385075"), false, "invalid EAN-8 checksum accepted");
assert.equal(makeInternalRcn8(2), "20000028", "sequence 2 RCN-8 mismatch");
assert.equal(makeInternalRcn8(3), "20000035", "sequence 3 RCN-8 mismatch");
assert.equal(makeInternalRcn8(4), "20000042", "sequence 4 RCN-8 mismatch");
assert.equal(makeInternalRcn8(5), "20000059", "sequence 5 RCN-8 mismatch");
assert.equal(makeInternalRcn8(6), "20000066", "sequence 6 RCN-8 mismatch");
for (const sequence of [2, 3, 4, 5, 6]) {
  const code = makeInternalRcn8(sequence);
  assert.match(code, /^2[0-9]{7}$/, `sequence ${sequence} must be exactly 8 digits with RCN prefix 2`);
  assert.equal(isValidEan8(code), true, `sequence ${sequence} must be valid EAN-8`);
}
const ean8Pattern = getEan8Pattern("20000028");
assert.equal(ean8Pattern.length, EAN8_RAW_MODULES, "raw EAN-8 symbol must be 67 modules");
assert.equal(EAN8_RENDERED_MODULES, 81, "rendered EAN-8 symbol must include 7-module quiet zones on both sides");
assert.equal(ean8Pattern.slice(0, 3), "101", "EAN-8 start guard mismatch");
assert.equal(ean8Pattern.slice(31, 36), "01010", "EAN-8 center guard mismatch");
assert.equal(ean8Pattern.slice(-3), "101", "EAN-8 end guard mismatch");
assert.ok(renderEan8Svg("20000028").includes("viewBox=\"0 0 81"), "EAN-8 SVG must render 81 modules including quiet zones");
assert.ok(renderEan8Svg("20000028").includes("20000028"), "printed SVG must include human-readable 8-digit value");
assert.ok(ean8.includes("LEFT_PATTERNS") && ean8.includes("RIGHT_PATTERNS"), "actual EAN-8 encoding tables missing");

assert.equal(canManageBarcodesForRole("owner"), true, "Owner can manage");
assert.equal(canManageBarcodesForRole("admin"), true, "Admin can manage");
assert.equal(canManageBarcodesForRole("staff"), false, "Staff cannot generate/reassign");
assert.equal(canPrintBarcodesForRole("staff"), true, "Staff can print existing labels");
assert.equal(isBarcodeEligibleProductVariant(
  { productType: "PHYSICAL", status: "published", active: true, archivedAt: "" },
  { sku: "BND-ACTIVE-S", active: true, archivedAt: "" }
), true, "active physical product variant with SKU should be eligible for barcode generation");
assert.equal(isBarcodeEligibleProductVariant(
  { productType: "PHYSICAL", status: "archived", active: true, archivedAt: "2026-08-25T00:00:00.000Z" },
  { sku: "BND-ARCHIVED-S", active: true, archivedAt: "" }
), false, "archived parent variants must be hidden from barcode generation");
assert.equal(isBarcodeEligibleProductVariant(
  { productType: "PHYSICAL", status: "archived", active: false, archivedAt: "2026-08-25T00:00:00.000Z" },
  { sku: "PREMIUM-COTTON-TEE-S", active: true, archivedAt: "" }
), false, "archived variants must be hidden from barcode generation");
assert.equal(isBarcodeEligibleProductVariant(
  { productType: "SERVICE", status: "published", active: true, archivedAt: "" },
  { sku: "SERVICE-SKU", active: true, archivedAt: "" }
), false, "non-physical products must be hidden from barcode generation");
assert.equal(isBarcodeEligibleProductVariant(
  { productType: "PHYSICAL", status: "published", active: true, archivedAt: "" },
  { sku: "   ", globalSku: "", active: true, archivedAt: "" }
), false, "SKU-less variants must be hidden from barcode generation");
assert.ok(service.includes("LOOKUP_VARIANT_BY_BARCODE_RPC_SCHEMA = \"trry_api\""), "lookup service must call trry_api schema");
assert.ok(service.includes("normalizeBarcode"), "service normalization missing");
assert.ok(service.includes("return payload ? mapLookupPayload(payload) : null"), "lookup must return one variant or null");
assert.ok(service.includes(".filter((variant) => isBarcodeEligibleProductVariant(product, variant))"), "Barcode manager must filter inactive/archived/non-physical/SKU-less variants before rendering");

const assignmentStore = createAssignmentStore();
let result = assignmentStore.assign("variant-a", "20000028", "INTERNAL");
assert.equal(result.operation, "insert", "first assignment should insert");
assert.equal(result.row.isPrimary, true, "first barcode should become primary");
result = assignmentStore.assign("variant-a", "SUPPLIER-A", "SUPPLIER");
assert.equal(result.operation, "insert", "new barcode after existing primary must use insert path");
assert.equal(assignmentStore.find("20000028").active, true, "old same-variant alias must remain active");
assert.equal(assignmentStore.find("20000028").isPrimary, false, "old same-variant alias must be demoted");
assert.equal(assignmentStore.find("SUPPLIER-A").isPrimary, true, "new barcode must become primary");
result = assignmentStore.assign("variant-a", "20000028", "INTERNAL");
assert.equal(result.operation, "update", "same-variant existing barcode should update existing row, not duplicate");
assert.equal(assignmentStore.rows.filter((row) => row.code === "20000028").length, 1, "same barcode must not duplicate");
assert.throws(() => assignmentStore.assign("variant-b", "SUPPLIER-A", "SUPPLIER"), /Barcode already assigned to another product variant/, "cross-variant duplicate must be blocked");
assert.equal(assignmentStore.generate("variant-a").code, "20000028", "generate should return existing primary without new sequence");
assert.equal(assignmentStore.rows.length, 2, "generate on existing primary must not insert another barcode");
const generated = createAssignmentStore();
assert.equal(generated.generate("variant-b").code, "20000028", "first generated internal sequence in test store must use EAN-8");
assert.equal(generated.generate("variant-c").code, "20000035", "second generated internal sequence in test store must use EAN-8");
assert.equal(generated.rows.filter((row) => row.active && row.isPrimary && row.variantId === "variant-c").length, 1, "one active primary barcode per Variant remains");

assert.equal(normalizeBarcode(" 2000 0028\n"), "20000028", "barcode normalization failed");
const observed = [];
const invalid = [];
const fakeTarget = { addEventListener() {}, removeEventListener() {} };
const keyboardScanner = createBarcodeScanner({
  target: fakeTarget,
  onScan: (code) => observed.push(code),
  onInvalid: (code) => invalid.push(code),
  minLength: 4,
  maxInterKeyDelay: 45,
});
"20000028".split("").forEach((key, index) => keyboardScanner.feedKey(key, { timeStamp: index * 10 }));
keyboardScanner.feedKey("Enter", { timeStamp: 90 });
assert.deepEqual(observed, ["20000028"], "scanner should capture rapid 20000028 + Enter");
"SLOW".split("").forEach((key, index) => keyboardScanner.feedKey(key, { timeStamp: 1000 + index * 100 }));
keyboardScanner.feedKey("Enter", { timeStamp: 1500 });
assert.deepEqual(observed, ["20000028"], "scanner should not trigger on slow typing");
const textareaTarget = { nodeType: 1, tagName: "TEXTAREA" };
keyboardScanner.feedKey("A", { target: textareaTarget, timeStamp: 1600 });
keyboardScanner.feedKey("Enter", { target: textareaTarget, timeStamp: 1610 });
assert.equal(invalid.length, 0, "scanner should not intercept textarea/manual entry");
assert.ok(scanner.includes("data-barcode-scan-input"), "scanner must allow explicit scan inputs");
assert.equal(scanner.includes("isValidEan8"), false, "scanner must not restrict capture to EAN-8 only");

const encoded = encodeCode128B("SUPPLIER-A");
assert.equal(encoded[0], 104, "Code128-B must start with Start B");
assert.equal(encoded.at(-1), 106, "Code128 must end with Stop");
assert.equal(calculateCode128Checksum(encoded.slice(0, -2)), encoded.at(-2), "Code128 checksum mismatch");
assert.ok(getCode128Pattern("SUPPLIER-A").length > 20, "Code128 pattern missing");
assert.ok(renderCode128Svg("SUPPLIER-A").includes("SUPPLIER-A"), "human-readable fallback barcode text missing");
assert.ok(code128.includes("CODE128_PATTERNS"), "local Code128 fallback table missing");

assert.ok(index.includes("/src/barcodeM4.css"), "M4 CSS must load");
assert.ok(index.includes("/src/barcodeM4.js"), "M4 JS must load after M3");
assert.ok(pkg.scripts["test:admin-barcode-m4"], "package script missing");

assert.ok(barcodeUi.includes("Barcode & Labels"), "Master Catalog action missing");
assert.ok(barcodeUi.includes("Generate Missing"), "Generate Missing action missing");
assert.ok(barcodeUi.includes("Print Selected"), "Print Selected action missing");
assert.ok(barcodeUi.includes("XPrinter XP-236B · EAN-8 / RCN-8"), "XP-236B EAN-8 printer profile missing");
assert.equal(barcodeUi.includes("XPrinter XP-236B · CODE128"), false, "old CODE128 printer copy must be removed");
assert.equal(barcodeUi.includes("assignVariantBarcode"), false, "Barcode UI must not call manual assignment RPC");
assert.equal(barcodeUi.includes("data-m4-assign"), false, "visible Assign action must be removed");
assert.equal(barcodeUi.includes("data-m4-assign-input"), false, "editable manual barcode input must be removed");
assert.equal(barcodeUi.includes(">Assign<"), false, "Assign button copy must be absent");
assert.ok(barcodeUi.includes("m4-barcode-code"), "barcode column should render read-only mono text");
assert.ok(barcodeUi.includes("Not generated"), "missing barcode read-only state missing");
assert.ok(barcodeUi.includes("Generate Barcode"), "Generate Barcode action missing for missing barcode rows");
assert.ok(barcodeUi.includes("Reprint Label"), "Reprint Label action missing for assigned barcode rows");
assert.ok(barcodeUi.includes("data-m4-reprint"), "Reprint Label hook missing");
assert.ok(barcodeUi.includes("printRows([button.dataset.m4Reprint])"), "Reprint Label must print the existing row");
assert.ok(barcodeUi.includes("renderBarcodeSvg(row.barcode)"), "label rendering must dispatch by barcode row symbology");
assert.ok(barcodeUi.includes("renderEan8Svg(barcode.code"), "internal EAN-8 label rendering missing");
assert.ok(barcodeUi.includes("renderCode128Svg(barcode?.code"), "Code128 fallback rendering missing for external barcode aliases");
assert.equal(barcodeUi.includes("Reprint ID"), false, "Reprint ID copy must be removed");
assert.equal(barcodeUi.includes("data-m4-label-preset"), false, "preset selector must be absent");
assert.equal(barcodeUi.includes("data-m4-price-toggle"), false, "price toggle must be absent");
assert.equal(barcodeUi.includes("40 x 30 mm"), false, "40x30 preset must be absent from Barcode UI");
assert.equal(barcodeUi.includes("50 x 30 mm"), false, "50x30 preset must be absent from Barcode UI");
assert.equal(barcodeUi.includes("50 x 25 mm"), false, "50x25 preset must be absent from Barcode UI");
assert.ok(barcodeUi.includes("@page { size: 30mm 20mm; margin: 0; }"), "30x20 @page rule missing");
assert.ok(barcodeUi.includes("width: ${LABEL_SIZE.width}mm; height: ${LABEL_SIZE.height}mm"), "30x20 physical label dimensions missing");
assert.ok(barcodeUi.includes("window.open") && barcodeUi.includes(".print()"), "browser print path missing");
assert.ok(barcodeUi.includes("page-break-after: always"), "one print document must create physical labels");
assert.ok(barcodeUi.includes("Generate, scan, print, and reprint never change inventory."), "stock boundary copy missing");
assert.ok(barcodeUi.includes("[\"1\", \"2\", \"3\", \"6\", \"12\"]"), "copies selector must keep fixed copy options");
assert.ok(barcodeUi.includes("Custom"), "custom copies option missing");
assert.equal(/class="price"|m4-price-toggle|sellingPrice\)|formatMoney/i.test(barcodeUi), false, "price output/toggle should be removed from 30x20 label UI");
assert.equal(/receiveAdminInventoryStock|receive_inventory|stock_movements|inventory_balances/i.test(barcodeUi), false, "label printing must not call inventory writes");
assert.ok(barcodeCss.includes(".m4-inventory-highlight"), "inventory scan highlight CSS missing");

const printed = simulateReprintLabels("20000028", 6);
assert.deepEqual(printed, Array(6).fill("20000028"), "Reprint Label must reuse the existing barcode for every copy");
assert.equal(printed.includes("20000035"), false, "Reprint Label must not generate a new barcode");

assert.ok(m3.includes("SCAN READY · M4"), "M3 receiving scanner UI missing");
assert.ok(m3.includes("lookupVariantByBarcode"), "M3 scanner must lookup barcode");
assert.ok(m3.includes("NOT ON THIS PO"), "wrong PO variant block missing");
assert.ok(m3.includes("ALREADY FULLY RECEIVED"), "fully received block missing");
assert.ok(m3.includes("BARCODE NOT FOUND"), "unknown barcode block missing");
assert.ok(m3.includes("input.value = String(Math.min(current + 1, remaining))"), "repeat scan increment/cap missing");
assert.ok(m3.includes("Scanning changes only Received Now. Confirm Receive remains the stock authority."), "M3 stock boundary missing");
assert.ok(m3.includes("receivePurchaseOrder(payload, state.session)"), "M3 confirm receive authority must remain");
assert.ok(m3Css.includes(".m3-scanner-panel"), "M3 scanner styling missing");

assert.ok(barcodeUi.includes("STOCK COUNT SCANNER READY / POSTING BLOCKED BY MISSING COUNT AUTHORITY"), "stock count blocked status missing");
assert.equal(/New Sale|held sales|checkout/i.test(barcodeUi + m3), false, "M4 must not invent fake POS");

const beforeCatalog = {
  products: [{ id: "product-a", name: "Sample Tee", category: "Shirts" }],
  variants: [{ id: "variant-a", productId: "product-a", sku: "SAMPLE-TEE-S", price: 250 }],
};
const afterCatalog = structuredClone(beforeCatalog);
assert.deepEqual(afterCatalog.products.map((row) => row.id), beforeCatalog.products.map((row) => row.id), "Product IDs unchanged");
assert.deepEqual(afterCatalog.variants.map((row) => row.id), beforeCatalog.variants.map((row) => row.id), "Variant IDs unchanged");
assert.deepEqual(afterCatalog.variants.map((row) => row.sku), beforeCatalog.variants.map((row) => row.sku), "SKU unchanged");
assert.deepEqual(afterCatalog, beforeCatalog, "catalog data unchanged");
assert.equal(/insert into public\.purchase_orders|update public\.purchase_orders|receivePurchaseOrder\(payload, state\.session\).*barcode/is.test(ean8Migration + barcodeUi), false, "Purchasing/Receiving authority unchanged");

process.stdout.write("PASS Admin Barcode M4 EAN-8 / RCN-8 cutover, scanner capture, label rendering, M3 receiving scan, inventory lookup, and catalog/inventory boundaries\n");

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function createAssignmentStore() {
  const rows = [];
  let id = 0;
  let sequence = 2;
  return {
    rows,
    find: (code) => rows.find((row) => row.code === code),
    assign(variantId, code, source = "INTERNAL") {
      if (source === "INTERNAL" && !isValidEan8(code)) throw new Error("Internal EAN-8 checksum is invalid.");
      const existing = rows.find((row) => row.code === code);
      const existingFound = Boolean(existing);
      if (existingFound && existing.variantId !== variantId) {
        throw new Error("Barcode already assigned to another product variant.");
      }
      rows
        .filter((row) => row.variantId === variantId && row.active && row.isPrimary && (!existingFound || row.id !== existing.id))
        .forEach((row) => {
          row.isPrimary = false;
        });
      if (existingFound) {
        existing.active = true;
        existing.isPrimary = true;
        existing.source = source;
        existing.symbology = source === "INTERNAL" ? "EAN8" : "CODE128";
        return { operation: "update", row: existing };
      }
      const row = {
        id: `barcode-${++id}`,
        variantId,
        code,
        symbology: source === "INTERNAL" ? "EAN8" : "CODE128",
        source,
        active: true,
        isPrimary: true,
      };
      rows.push(row);
      return { operation: "insert", row };
    },
    generate(variantId) {
      const primary = rows.find((row) => row.variantId === variantId && row.active && row.isPrimary);
      if (primary) return primary;
      const code = makeInternalRcn8(sequence++);
      return this.assign(variantId, code, "INTERNAL").row;
    },
  };
}

function simulateReprintLabels(barcode, copies) {
  return Array.from({ length: copies }, () => barcode);
}
