import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { calculateCode128Checksum, encodeCode128B, getCode128Pattern, renderCode128Svg } from "../src/shared/code128.js";
import { createBarcodeScanner, normalizeBarcode } from "../src/shared/barcodeScanner.js";
import {
  canManageBarcodesForRole,
  canPrintBarcodesForRole,
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
assert.ok(service.includes("LOOKUP_VARIANT_BY_BARCODE_RPC_SCHEMA = \"trry_api\""), "lookup service must call trry_api schema");
assert.ok(service.includes("normalizeBarcode"), "service normalization missing");
assert.ok(service.includes("return payload ? mapLookupPayload(payload) : null"), "lookup must return one variant or null");

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

assert.ok(barcodeUi.includes("Barcode & Labels"), "Master Catalog action missing");
assert.ok(barcodeUi.includes("Generate Missing"), "Generate Missing action missing");
assert.ok(barcodeUi.includes("Print Selected"), "Print Selected action missing");
assert.ok(barcodeUi.includes("XPrinter XP-236B"), "XP-236B printer profile missing");
assert.ok(barcodeUi.includes("40 x 30 mm"), "40x30 default preset missing");
assert.ok(barcodeUi.includes("50 x 30 mm") && barcodeUi.includes("50 x 25 mm"), "additional label presets missing");
assert.ok(barcodeUi.includes("window.open") && barcodeUi.includes(".print()"), "browser print path missing");
assert.ok(barcodeUi.includes("page-break-after: always"), "one print document must create physical labels");
assert.ok(barcodeUi.includes("Generate, assign, scan, print, and reprint never change inventory."), "stock boundary copy missing");
assert.equal(/receiveAdminInventoryStock|receive_inventory|stock_movements|inventory_balances/i.test(barcodeUi), false, "label printing must not call inventory writes");
assert.ok(barcodeCss.includes(".m4-inventory-highlight"), "inventory scan highlight CSS missing");

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
