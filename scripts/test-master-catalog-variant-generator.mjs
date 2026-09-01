import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const main = readFileSync(join(root, "src", "main.js"), "utf8");
const styles = readFileSync(join(root, "src", "styles.css"), "utf8");

assert.ok(main.includes('const catalogVariantSizeOptions = ["S", "M", "L", "XL", "XXL"];'), "approved size options must be present");
assert.ok(main.includes('const catalogVariantColorOptions = ["Black", "White"];'), "approved color options must be present");
assert.ok(main.includes("function renderCatalogVariantGenerator"), "variant generator renderer missing");
assert.ok(main.includes('data-catalog-variant-generator="'), "variant generator checkbox hook missing");
assert.ok(main.includes("updateCatalogVariantGeneratorSelection"), "variant generator event handler missing");
assert.ok(main.includes("buildCatalogVariantMatrixDraft"), "matrix draft builder missing");
assert.ok(main.includes('data-catalog-generate-variants'), "single Generate Variants action missing");
assert.ok(main.includes("generateCatalogVariantsFromSelection"), "explicit generation handler missing");
assert.ok(main.includes("Variants generated in draft. Review prices, then use Save Changes once."), "single-save guidance missing");
assert.equal(/<button[^>]+data-catalog-add-variant/.test(main), false, "Add Variant button must not be rendered");
assert.equal(/<button[^>]+data-catalog-save-existing-variant/.test(main), false, "row-level Save buttons must not be rendered");
assert.equal(/data-catalog-existing-variant-field="(?:color|size)"/.test(main), false, "generated color and size identity must be locked in rows");
assert.ok(main.includes('data-catalog-existing-variant-field="sellingPrice"'), "generated variant price must remain editable");
assert.ok(main.includes('data-catalog-delete-variant='), "variant removal control must remain available");

assert.ok(main.includes("colors.flatMap((color) => sizes.map((size) =>"), "matrix must group generated rows by color, then size");
assert.ok(main.includes("...(existing || {})"), "matrix rebuild must preserve existing variant identity fields");
assert.ok(main.includes("sellingPrice: existing?.sellingPrice ?? draft.startingPrice ?? 0"), "matrix rebuild must preserve existing per-variant selling price");
assert.ok(main.includes("unitCost: existing?.unitCost ?? draft.unitCost ?? 0"), "matrix rebuild must preserve existing per-variant unit cost");
assert.equal(/getCatalogDraftVariantRows[\s\S]+?supplied\.map[\s\S]+?\.slice\(0,\s*6\)/.test(main), false, "supplied variant rows must not be capped at 6");
assert.equal(/return \(colors\.length[\s\S]+?\.slice\(0,\s*6\)/.test(main), false, "generated matrix rows must not be capped at 6");
assert.ok(styles.includes(".catalog-variant-generator"), "generator styles missing");
assert.ok(styles.includes(".catalog-variant-option.selected"), "selected generator option styles missing");

const sizes = ["S", "M", "L", "XL", "XXL"];
const colors = ["Black", "White"];
const combinations = colors.flatMap((color) => sizes.map((size) => `${color} / ${size}`));
assert.deepEqual(combinations, [
  "Black / S",
  "Black / M",
  "Black / L",
  "Black / XL",
  "Black / XXL",
  "White / S",
  "White / M",
  "White / L",
  "White / XL",
  "White / XXL",
], "approved generated combination order changed");

console.log(JSON.stringify({ result: "master_catalog_variant_generator_ok", combinations: combinations.length }, null, 2));
