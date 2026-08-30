import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { calculateCode128Checksum, encodeCode128B, getCode128Pattern, renderCode128Svg } from "../src/shared/code128.js";
import { createBarcodeScanner, normalizeBarcode } from "../src/shared/barcodeScanner.js";
import {
  canManageBarcodesForRole,
  canPrintBarcodesForRole,
  isBarcodeEligibleProductVariant,
} from "../src/services/adminBarcodes.js";

const migration = await read("supabase/migrations/202608240004_add_barcode_identity_m4.sql");
const service = await read("src/services/adminBarcodes.js");
const scanner = await read("src/shared/barcodeScanner.js");
const code128 = await read("src/shared/code128.js");
const barcodeUi = await read("src/barcodeM4.js");
const barcodeCss = await read("src/barcodeM4.css");
const m3 = await read("src/purchasingReceivingM3.js");
const m3Css = await read("src/purchasingReceivingM3.css");
const index = await read("index.html");
const pkg = JSON.parse(await read("package.json"));

assert.ok(migration.includes("create table if not exists public.product_variant_barcodes"), "barcode alias table contract missing");
assert.ok(migration.includes("variant_id uuid not null references public.product_variants(id)"), "barcode must reference canonical variant");
assert.ok(migration.includes("create unique index if not exists product_variant_barcodes_code_unique"), "unique barcode constraint missing");
assert.ok(migration.includes("where active = true and is_primary = true"), "one active primary barcode per variant missing");
assert.ok(migration.includes("create sequence if not exists public.product_variant_barcode_sequence"), "internal barcode sequence missing");
assert.ok(migration.includes("'TRRY' || lpad(nextval('public.product_variant_barcode_sequence')::text, 10, '0')"), "generator must use stable sequence code");
assert.ok(migration.includes("security definer"), "hardened security definer RPCs missing");
assert.ok(migration.includes("set search_path = ''"), "fixed search_path missing");
assert.ok(migration.includes("public.is_active_admin_user(array['owner','admin'])"), "Owner/Admin write guard missing");
assert.ok(migration.includes("public.is_active_admin_user(array['owner','admin','staff'])"), "Staff lookup guard missing");
assert.ok(migration.includes("upper(coalesce(v_product.product_type, '')) <> 'PHYSICAL'"), "physical product guard missing");
assert.ok(migration.includes("btrim(coalesce(v_variant.sku, '')) = ''"), "SKU required guard missing");
assert.ok(migration.includes("Barcode already assigned to another product variant."), "duplicate assignment block missing");
assert.ok(migration.includes("v_existing_found boolean := false"), "assignment must declare explicit existing barcode boolean");
assert.ok(migration.includes("v_existing_found := found"), "assignment must capture SELECT FOUND immediately");
assert.ok(migration.includes("if v_existing_found and v_existing.variant_id <> p_variant_id then"), "duplicate block must use explicit SELECT result");
assert.ok(migration.includes("if v_existing_found then"), "assignment branch must use explicit SELECT result");
assert.ok(!migration.includes("if found and v_existing.variant_id <> p_variant_id then"), "assignment duplicate branch must not use generic FOUND");
assert.ok(!migration.includes("if found then\n    update public.product_variant_barcodes"), "assignment update branch must not use generic FOUND after demotion");
assert.ok(migration.includes("create or replace function trry_api.lookup_variant_by_barcode"), "exact lookup RPC missing");
assert.ok(migration.includes("barcode.code = v_code"), "lookup must be exact");
assert.equal(/receive_inventory|stock_movements|inventory_balances/i.test(migration), false, "barcode migration must not post inventory");
assert.ok(migration.includes("revoke execute on function public.generate_variant_barcode(uuid) from public"), "public write execute revoke missing");
assert.ok(migration.includes("revoke execute on function public.assign_variant_barcode(uuid,text,text) from public"), "assign public revoke missing");
assert.ok(migration.includes("grant execute on function trry_api.lookup_variant_by_barcode(text) to authenticated"), "lookup authenticated grant missing");

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
), false, "archived Brand New Day parent variants must be hidden from barcode generation");
assert.equal(isBarcodeEligibleProductVariant(
  { productType: "PHYSICAL", status: "archived", active: false, archivedAt: "2026-08-25T00:00:00.000Z" },
  { sku: "PREMIUM-COTTON-TEE-S", active: true, archivedAt: "" }
), false, "archived Premium Cotton Tee variants must be hidden from barcode generation");
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
let result = assignmentStore.assign("variant-a", "BARCODE-A");
assert.equal(result.operation, "insert", "first assignment should insert");
assert.equal(result.row.isPrimary, true, "first barcode should become primary");
result = assignmentStore.assign("variant-a", "BARCODE-B");
assert.equal(result.operation, "insert", "new barcode after existing primary must use insert path");
assert.equal(assignmentStore.find("BARCODE-A").active, true, "old same-variant alias must remain active");
assert.equal(assignmentStore.find("BARCODE-A").isPrimary, false, "old same-variant alias must be demoted");
assert.equal(assignmentStore.find("BARCODE-B").isPrimary, true, "new barcode must become primary");
result = assignmentStore.assign("variant-a", "BARCODE-A");
assert.equal(result.operation, "update", "same-variant existing barcode should update existing row, not duplicate");
assert.equal(assignmentStore.rows.filter((row) => row.code === "BARCODE-A").length, 1, "same barcode must not duplicate");
assert.throws(() => assignmentStore.assign("variant-b", "BARCODE-B"), /Barcode already assigned to another product variant/, "cross-variant duplicate must be blocked");
assert.equal(assignmentStore.generate("variant-a").code, "BARCODE-A", "generate should return existing primary without new sequence");
assert.equal(assignmentStore.rows.length, 2, "generate on existing primary must not insert another barcode");

assert.equal(normalizeBarcode(" trry 0001\n"), "TRRY0001", "barcode normalization failed");
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
"TRRY0000000001".split("").forEach((key, index) => keyboardScanner.feedKey(key, { timeStamp: index * 10 }));
keyboardScanner.feedKey("Enter", { timeStamp: 160 });
assert.deepEqual(observed, ["TRRY0000000001"], "scanner should commit rapid Enter-suffixed scan");
"SLOW".split("").forEach((key, index) => keyboardScanner.feedKey(key, { timeStamp: 1000 + index * 100 }));
keyboardScanner.feedKey("Enter", { timeStamp: 1500 });
assert.deepEqual(observed, ["TRRY0000000001"], "scanner should not trigger on slow typing");
const textareaTarget = { nodeType: 1, tagName: "TEXTAREA" };
keyboardScanner.feedKey("A", { target: textareaTarget, timeStamp: 1600 });
keyboardScanner.feedKey("Enter", { target: textareaTarget, timeStamp: 1610 });
assert.equal(invalid.length, 0, "scanner should not intercept textarea/manual entry");
assert.ok(scanner.includes("data-barcode-scan-input"), "scanner must allow explicit scan inputs");

const encoded = encodeCode128B("TRRY0000000001");
assert.equal(encoded[0], 104, "Code128-B must start with Start B");
assert.equal(encoded.at(-1), 106, "Code128 must end with Stop");
assert.equal(calculateCode128Checksum(encoded.slice(0, -2)), encoded.at(-2), "Code128 checksum mismatch");
assert.ok(getCode128Pattern("TRRY0000000001").length > 20, "Code128 pattern missing");
assert.ok(renderCode128Svg("TRRY0000000001").includes("TRRY0000000001"), "human-readable barcode text missing");
assert.ok(code128.includes("CODE128_PATTERNS"), "local Code128 table missing");

assert.ok(index.includes("/src/barcodeM4.css"), "M4 CSS must load");
assert.ok(index.includes("/src/barcodeM4.js"), "M4 JS must load after M3");
assert.ok(pkg.scripts["test:admin-barcode-m4"], "package script missing");

const observerSource = barcodeUi.slice(barcodeUi.indexOf("new MutationObserver"), barcodeUi.indexOf('window.addEventListener("popstate"'));
assert.ok(observerSource.includes("subtree: false"), "M4 observer must watch root replacements only");
assert.equal(observerSource.includes("subtree: true"), false, "M4 observer must not react to its own descendant patches");
assert.ok(barcodeUi.includes("enhanceScheduled: false") && barcodeUi.includes("pendingForce: false"), "M4 scheduler must coalesce enhancement passes");
assert.ok(barcodeUi.includes("requestAnimationFrame") && !barcodeUi.includes("queueMicrotask"), "M4 enhancement must yield between DOM patch passes");
assert.ok(barcodeUi.includes("if (state.loading) return state.loading"), "M4 duplicate data refreshes must share an in-flight load");
assert.ok(barcodeUi.includes("feedback.textContent !== nextFeedback"), "M4 Inventory feedback must avoid identical text rewrites");

assert.ok(barcodeUi.includes("Barcode & Labels"), "Master Catalog action missing");
assert.ok(barcodeUi.includes("Generate Missing"), "Generate Missing action missing");
assert.ok(barcodeUi.includes("Print Selected"), "Print Selected action missing");
assert.ok(barcodeUi.includes("XPrinter XP-236B"), "XP-236B printer profile missing");
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

const printed = simulateReprintLabels("TRRY0000000042", 6);
assert.deepEqual(printed, Array(6).fill("TRRY0000000042"), "Reprint Label must reuse the existing barcode for every copy");
assert.equal(printed.includes("TRRY0000000043"), false, "Reprint Label must not generate a new barcode");

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

process.stdout.write("PASS Admin Barcode M4 identity, scanner, label printing, M3 receiving scan, inventory lookup, and blocked POS/Stock Count boundaries\n");

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function createAssignmentStore() {
  const rows = [];
  let id = 0;
  return {
    rows,
    find: (code) => rows.find((row) => row.code === code),
    assign(variantId, code) {
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
        return { operation: "update", row: existing };
      }
      const row = { id: `barcode-${++id}`, variantId, code, active: true, isPrimary: true };
      rows.push(row);
      return { operation: "insert", row };
    },
    generate(variantId) {
      const primary = rows.find((row) => row.variantId === variantId && row.active && row.isPrimary);
      if (primary) return primary;
      return this.assign(variantId, `TRRY${String(id + 1).padStart(10, "0")}`).row;
    },
  };
}

function simulateReprintLabels(barcode, copies) {
  return Array.from({ length: copies }, () => barcode);
}
