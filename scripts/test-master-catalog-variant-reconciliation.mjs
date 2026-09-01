import assert from "node:assert/strict";
import {
  buildVariantReconciliationPlan,
  mapVariantToRow,
} from "../src/services/adminCatalog.js";

const product = { productType: "PHYSICAL", startingPrice: 390, unitCost: 120 };

function variant(id, color, size, options = {}) {
  return {
    id,
    product_id: "product-a",
    master_variant_id: options.masterVariantId ?? `MV-${id}`,
    sku: options.sku ?? `SKU-${id}`,
    global_sku: options.globalSku ?? `GSKU-${id}`,
    color,
    size,
    selling_price: options.sellingPrice ?? 390,
    unit_cost: options.unitCost ?? 120,
    variant_type: "STANDARD",
    active: options.active ?? true,
    archived_at: options.archivedAt ?? null,
    archive_reason: options.archiveReason ?? null,
    created_at: options.createdAt ?? `2026-08-29T00:00:0${id.length}.000Z`,
  };
}

function desired(color, size, options = {}) {
  return {
    id: options.id ?? "",
    masterVariantId: options.masterVariantId ?? "",
    sku: options.sku ?? "",
    globalSku: options.globalSku ?? "",
    color,
    size,
    sellingPrice: options.sellingPrice ?? 390,
    unitCost: options.unitCost ?? 120,
    variantType: "STANDARD",
    active: true,
  };
}

function plan(existing, desiredRows) {
  return buildVariantReconciliationPlan(existing, desiredRows);
}

function operationIds(operations) {
  return operations.map((operation) => operation.existing?.id ?? operation.id);
}

const blackS = variant("A", "Black", "S");
const blackM = variant("B", "Black", "M");
const whiteS = variant("C", "White", "S");
const whiteM = variant("D", "White", "M");

{
  const result = plan(
    [blackS, blackM, whiteS, whiteM],
    [
      desired("White", "M"),
      desired(" Black ", "s "),
      desired("white", " S"),
      desired("BLACK", "m"),
    ]
  );
  assert.deepEqual(operationIds(result.updates), ["D", "A", "C", "B"], "reorder must match original combinations");
  assert.equal(result.inserts.length, 0, "reorder must not insert");
  assert.equal(result.archives.length, 0, "reorder must not archive");
}

{
  const existing = ["S", "M", "L", "XL"].flatMap((size) => [
    variant(`B-${size}`, "Black", size),
    variant(`W-${size}`, "White", size),
  ]);
  const desiredRows = ["S", "M", "L", "XL", "XXL"].flatMap((size) => [
    desired("Black", size),
    desired("White", size),
  ]);
  const result = plan(existing, desiredRows);
  assert.equal(result.updates.length, 8, "existing Black and White sizes must remain updates");
  assert.deepEqual(result.inserts.map((item) => `${item.color}/${item.size}`), ["Black/XXL", "White/XXL"], "adding XXL must insert only missing color-size pairs");
  assert.equal(result.archives.length, 0, "adding XXL must not archive");
}

{
  const existing = ["S", "M", "L"].map((size) => variant(`B-${size}`, "Black", size));
  const desiredRows = ["Black", "White"].flatMap((color) => ["S", "M", "L"].map((size) => desired(color, size)));
  const result = plan(existing, desiredRows);
  assert.deepEqual(operationIds(result.updates), ["B-S", "B-M", "B-L"], "existing Black variants must remain matched");
  assert.deepEqual(result.inserts.map((item) => `${item.color}/${item.size}`), ["White/S", "White/M", "White/L"], "new color must insert only its missing combinations");
}

{
  const result = plan([blackM], [desired("Black", "M", { sellingPrice: 420 })]);
  assert.equal(result.updates[0].existing.id, "B", "price update must retain DB ID");
  assert.equal(result.updates[0].existing.sku, "SKU-B", "price update must retain SKU");
  assert.equal(mapVariantToRow(result.updates[0].desired, product, { update: true }).selling_price, 420, "price update must change selling_price");
  assert.equal(result.inserts.length, 0, "price update must not insert");
  assert.equal(result.archives.length, 0, "price update must not archive");
}

assert.throws(
  () => plan([], [desired("Black", "M"), desired("black", " m ")]),
  /Duplicate size and color combination/,
  "duplicate normalized combinations must be rejected"
);

{
  const result = plan([blackS, blackM, whiteS, whiteM], [desired("Black", "S"), desired("Black", "M"), desired("White", "S")]);
  assert.deepEqual(operationIds(result.updates), ["A", "B", "C"], "remaining combinations must stay matched");
  assert.deepEqual(result.archives.map((item) => item.id), ["D"], "only removed White/M must archive");
}

{
  const result = plan([blackS, blackM, whiteS], [desired("White", "S"), desired("Black", "M")]);
  for (const match of result.updates) {
    assert.equal(match.existing.sku.startsWith("SKU-"), true, "matched SKU must remain the persisted SKU");
    assert.equal(match.existing.global_sku.startsWith("GSKU-"), true, "matched global SKU must remain persisted");
    assert.equal(match.existing.master_variant_id.startsWith("MV-"), true, "matched master variant ID must remain persisted");
  }
}

{
  const result = plan([blackM], [desired(" Black ", " m ", { id: "B", sku: "CLIENT-SKU", globalSku: "CLIENT-GSKU", masterVariantId: "MV-B" })]);
  const updateRow = mapVariantToRow(result.updates[0].desired, product, { update: true });
  const insertRow = mapVariantToRow(desired("White", "XL", { sku: "CLIENT-SKU" }), product, { productId: "product-a" });
  assert.equal(result.updates[0].existing.sku, "SKU-B", "client-authored SKU must not replace matched persisted SKU");
  assert.equal("sku" in updateRow, false, "update payload must not include SKU");
  assert.equal("global_sku" in updateRow, false, "update payload must not include global SKU");
  assert.equal("master_variant_id" in updateRow, false, "update payload must not include master variant ID");
  assert.equal("sku" in insertRow, false, "insert payload must not include client SKU");
  assert.equal("global_sku" in insertRow, false, "insert payload must not include client global SKU");
  assert.equal("master_variant_id" in insertRow, false, "insert payload must not include client master variant ID");
}

assert.throws(
  () => plan([blackM], [desired("White", "XL", { id: "B" })]),
  /Variant identity conflict/,
  "existing ID attached to a different combination must be rejected"
);

{
  const archivedBlackM = variant("ARCH-BM", "Black", "M", {
    masterVariantId: "MV-ARCH-BM",
    sku: "SKU-ARCH-BM",
    globalSku: "GSKU-ARCH-BM",
    active: false,
    archivedAt: "2026-08-01T00:00:00.000Z",
    archiveReason: "Removed from Product editor",
  });
  const result = plan([archivedBlackM], [desired(" black ", " m ")]);
  assert.equal(result.reactivations.length, 1, "archived exact combination must reactivate");
  assert.equal(result.reactivations[0].existing.id, "ARCH-BM", "reactivation must preserve original DB ID");
  assert.equal(result.reactivations[0].existing.sku, "SKU-ARCH-BM", "reactivation must preserve original SKU");
  assert.equal(result.inserts.length, 0, "restore must not create second canonical SKU");
}

console.log(JSON.stringify({ result: "master_catalog_variant_reconciliation_ok", scenarios: 10 }, null, 2));
