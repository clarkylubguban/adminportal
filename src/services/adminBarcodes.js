import {
  executeSupabaseRpcWithAuth,
  executeSupabaseSchemaRpcWithAuth,
  isSupabaseReady,
  readSupabaseTableWithAuth,
} from "../lib/supabaseClient.js";
import { getAdminCatalogProducts } from "./adminCatalog.js";
import { normalizeBarcode as normalizeBarcodeCore } from "../shared/barcodeScanner.js";

export const PRODUCT_VARIANT_BARCODES_TABLE = "product_variant_barcodes";
export const GENERATE_VARIANT_BARCODE_RPC = "generate_variant_barcode";
export const ASSIGN_VARIANT_BARCODE_RPC = "assign_variant_barcode";
export const LOOKUP_VARIANT_BY_BARCODE_RPC_SCHEMA = "trry_api";
export const LOOKUP_VARIANT_BY_BARCODE_RPC = "lookup_variant_by_barcode";

export function normalizeBarcode(value) {
  return normalizeBarcodeCore(value);
}

export function canManageBarcodesForRole(role) {
  return ["owner", "admin"].includes(String(role || "").trim().toLowerCase());
}

export function canPrintBarcodesForRole(role) {
  return ["owner", "admin", "staff"].includes(String(role || "").trim().toLowerCase());
}

export function isBarcodeEligibleProductVariant(product = {}, variant = {}) {
  const productType = String(product.productType || "").trim().toUpperCase();
  const sku = String(variant.sku || variant.globalSku || "").trim();
  return (
    product.active !== false &&
    String(product.status || "").trim().toLowerCase() !== "archived" &&
    !product.archivedAt &&
    productType === "PHYSICAL" &&
    variant.active !== false &&
    !variant.archivedAt &&
    Boolean(sku)
  );
}

export async function getVariantBarcodes(authSession) {
  if (!isSupabaseReady()) return { rows: [], status: "empty", source: "local", error: null };
  try {
    const rows = await readSupabaseTableWithAuth(
      PRODUCT_VARIANT_BARCODES_TABLE,
      { select: "*", active: "eq.true", order: "created_at.asc" },
      getAccessToken(authSession)
    );
    return { rows: (rows ?? []).map(mapBarcodeRow), status: rows?.length ? "success" : "empty", source: "supabase", error: null };
  } catch (error) {
    if (isBarcodeSchemaUnavailable(error)) return { rows: [], status: "missing", source: "supabase", error };
    throw error;
  }
}

export async function getBarcodeManagerRows(authSession) {
  const [catalogResult, barcodeResult] = await Promise.all([
    getAdminCatalogProducts(authSession),
    getVariantBarcodes(authSession),
  ]);
  const primaryByVariantId = new Map((barcodeResult.rows ?? []).filter((row) => row.active && row.isPrimary).map((row) => [row.variantId, row]));
  const codeCounts = new Map();
  for (const row of barcodeResult.rows ?? []) {
    if (!row.active) continue;
    codeCounts.set(row.code, (codeCounts.get(row.code) ?? 0) + 1);
  }
  const rows = (catalogResult.products ?? []).flatMap((product) => (product.variants ?? [])
    .filter((variant) => isBarcodeEligibleProductVariant(product, variant))
    .map((variant) => {
    const barcode = primaryByVariantId.get(variant.id) ?? null;
    return {
      id: variant.id,
      variantId: variant.id,
      productId: product.id,
      productName: product.name,
      variantLabel: [variant.color, variant.size].filter(Boolean).join(" / ") || "Default",
      sku: variant.sku || variant.globalSku || "",
      sellingPrice: Number(variant.sellingPrice || product.startingPrice || 0),
      productActive: true,
      variantActive: true,
      physical: true,
      hasSku: true,
      barcode,
      status: barcode && codeCounts.get(barcode.code) > 1 ? "DUPLICATE ERROR" : barcode ? "READY" : "MISSING",
    };
  }));
  return {
    rows,
    products: catalogResult.products ?? [],
    status: barcodeResult.status === "missing" ? "missing" : rows.length ? "success" : "empty",
    source: "supabase",
    error: barcodeResult.error ?? catalogResult.error ?? null,
  };
}

export async function lookupVariantByBarcode(code, authSession) {
  const normalized = normalizeBarcode(code);
  if (!normalized) throw new Error("Barcode is required.");
  const result = await executeSupabaseSchemaRpcWithAuth(
    LOOKUP_VARIANT_BY_BARCODE_RPC_SCHEMA,
    LOOKUP_VARIANT_BY_BARCODE_RPC,
    { p_code: normalized },
    getAccessToken(authSession)
  );
  const payload = Array.isArray(result) ? result[0] : result;
  return payload ? mapLookupPayload(payload) : null;
}

export async function generateVariantBarcode(variantId, authSession) {
  const result = await executeSupabaseRpcWithAuth(
    GENERATE_VARIANT_BARCODE_RPC,
    { p_variant_id: String(variantId || "").trim() },
    getAccessToken(authSession)
  );
  return mapBarcodeRow(Array.isArray(result) ? result[0] : result);
}

export async function assignVariantBarcode(variantId, code, authSession) {
  const result = await executeSupabaseRpcWithAuth(
    ASSIGN_VARIANT_BARCODE_RPC,
    { p_variant_id: String(variantId || "").trim(), p_code: normalizeBarcode(code), p_source: "SUPPLIER" },
    getAccessToken(authSession)
  );
  return mapBarcodeRow(Array.isArray(result) ? result[0] : result);
}

function mapBarcodeRow(row = {}) {
  return {
    id: row.id,
    variantId: row.variant_id ?? row.variantId ?? "",
    code: row.code ?? "",
    symbology: row.symbology ?? "CODE128",
    source: row.source ?? "INTERNAL",
    isPrimary: row.is_primary === true || row.isPrimary === true,
    active: row.active !== false,
    createdAt: row.created_at ?? row.createdAt ?? "",
    updatedAt: row.updated_at ?? row.updatedAt ?? "",
  };
}

function mapLookupPayload(row = {}) {
  return {
    barcodeId: row.barcode_id ?? row.barcodeId ?? "",
    barcode: row.barcode ?? row.code ?? "",
    symbology: row.symbology ?? "CODE128",
    source: row.source ?? "",
    variantId: row.variant_id ?? row.variantId ?? "",
    productId: row.product_id ?? row.productId ?? "",
    productName: row.product_name ?? row.productName ?? "",
    sku: row.sku ?? "",
    color: row.color ?? "",
    size: row.size ?? "",
    variantLabel: [row.color, row.size].filter(Boolean).join(" / ") || row.variant_label || "Default",
    sellingPrice: Number(row.selling_price ?? row.sellingPrice ?? 0),
    productActive: row.product_active !== false && row.productActive !== false,
    variantActive: row.variant_active !== false && row.variantActive !== false,
  };
}

function isBarcodeSchemaUnavailable(error) {
  return /product_variant_barcodes|42P01|schema cache|could not find|does not exist/i.test(String(error?.message || error || ""));
}

function getAccessToken(authSession) {
  const accessToken = typeof authSession === "string" ? authSession : authSession?.access_token;
  if (!accessToken) throw new Error("Supabase auth session is required for Admin Barcodes.");
  return accessToken;
}
