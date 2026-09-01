import {
  executeSupabaseSchemaRpcWithAuth,
  getSupabaseConfig,
  isSupabaseReady,
  readSupabaseTableWithAuth,
} from "../lib/supabaseClient.js";

export const INVENTORY_BALANCES_TABLE = "inventory_balances";
export const INVENTORY_LOCATIONS_TABLE = "inventory_locations";
export const STOCK_MOVEMENTS_TABLE = "stock_movements";
export const INVENTORY_RECEIVE_RPC_SCHEMA = "trry_api";
export const INVENTORY_RECEIVE_RPC = "receive_inventory";
export const INVENTORY_RECEIVE_RPC_LABEL = `${INVENTORY_RECEIVE_RPC_SCHEMA}.${INVENTORY_RECEIVE_RPC}`;
export const PRODUCTION_SUPABASE_PROJECT_REF = "wcgtwfctpnwgpglywvvx";

const MASTER_PRODUCTS_TABLE = "products";
const PRODUCT_VARIANTS_TABLE = "product_variants";
const PRODUCT_CATEGORIES_TABLE = "product_categories";
const BRANDS_TABLE = "brands";

export async function getAdminInventory(authSession) {
  if (!isSupabaseReady()) {
    return {
      rows: [],
      locations: [],
      movements: [],
      status: "empty",
      source: "local",
      error: null,
    };
  }

  try {
    const accessToken = getAccessToken(authSession);
    const [products, variants, categories, brands, balances, locations, movements] = await Promise.all([
      readSupabaseTableWithAuth(MASTER_PRODUCTS_TABLE, { select: "*" }, accessToken),
      readSupabaseTableWithAuth(PRODUCT_VARIANTS_TABLE, { select: "*" }, accessToken),
      readSupabaseTableWithAuth(PRODUCT_CATEGORIES_TABLE, { select: "*" }, accessToken),
      readSupabaseTableWithAuth(BRANDS_TABLE, { select: "*" }, accessToken),
      readSupabaseTableWithAuth(INVENTORY_BALANCES_TABLE, { select: "*" }, accessToken),
      readSupabaseTableWithAuth(INVENTORY_LOCATIONS_TABLE, { select: "*" }, accessToken),
      readSupabaseTableWithAuth(STOCK_MOVEMENTS_TABLE, { select: "*", order: "created_at.desc", limit: "100" }, accessToken),
    ]);

    const productById = new Map((products ?? []).map((row) => [row.id, row]));
    const categoryById = new Map((categories ?? []).map((row) => [row.id, row]));
    const brandById = new Map((brands ?? []).map((row) => [row.id, row]));
    const locationRows = normalizeLocations(locations);
    const locationById = new Map(locationRows.map((row) => [row.id, row]));
    const eligibleVariants = (Array.isArray(variants) ? variants : []).filter((variant) => {
      const product = productById.get(variant.product_id);
      return isEligibleInventoryProduct(product) && isEligibleInventoryVariant(variant);
    });
    const balanceByVariantLocation = new Map((Array.isArray(balances) ? balances : []).map((row) => [
      `${row.variant_id || row.product_variant_id || ""}:${row.location_id || row.inventory_location_id || ""}`,
      row,
    ]));

    const effectiveLocations = locationRows.length ? locationRows : [];
    const rows = eligibleVariants.flatMap((variant) => {
      const product = productById.get(variant.product_id);
      return effectiveLocations.map((location) => {
        const balance = balanceByVariantLocation.get(`${variant.id}:${location.id}`) ?? {};
        return mapInventoryRow({ product, variant, balance, location, category: categoryById.get(product.category_id), brand: brandById.get(product.brand_id) });
      });
    });

    const mappedMovements = mapStockMovements(movements, productById, new Map(eligibleVariants.map((row) => [row.id, row])), locationById);

    return {
      rows: rows.sort(sortInventoryRows),
      locations: locationRows,
      movements: mappedMovements,
      status: rows.length || mappedMovements.length || locationRows.length ? "success" : "empty",
      source: "supabase",
      error: null,
    };
  } catch (error) {
    console.error("Unable to load Admin Inventory.", error);
    return {
      rows: [],
      locations: [],
      movements: [],
      status: "error",
      source: "supabase",
      error,
    };
  }
}

export async function receiveAdminInventoryStock(payload, authSession) {
  assertProductionSupabaseProject();
  assertReceivePayload(payload);

  return executeSupabaseSchemaRpcWithAuth(INVENTORY_RECEIVE_RPC_SCHEMA, INVENTORY_RECEIVE_RPC, {
    p_location_id: payload.locationId,
    p_variant_id: payload.variantId,
    p_quantity: payload.quantity,
    p_idempotency_key: payload.idempotencyKey,
    p_source_reference: emptyToNull(payload.sourceReference),
    p_reason: emptyToNull(payload.reason),
  }, getAccessToken(authSession));
}

export function createInventoryIdempotencyKey(prefix = "receive") {
  const randomPart = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `admin-inventory-${prefix}-${randomPart}`;
}

export function canReceiveInventoryForRole(role) {
  return ["owner", "admin"].includes(String(role || "").trim().toLowerCase());
}

export function assertProductionSupabaseProject() {
  const { url } = getSupabaseConfig();
  if (!url.includes(PRODUCTION_SUPABASE_PROJECT_REF)) {
    throw new Error("Inventory writes are only enabled for the canonical production Supabase project.");
  }
}

function assertReceivePayload(payload) {
  if (!payload?.variantId) throw new Error("Select a product variant.");
  if (!payload?.locationId) throw new Error("Select an inventory location.");
  if (!Number.isInteger(payload.quantity) || payload.quantity <= 0) {
    throw new Error("Quantity must be a positive whole number.");
  }
  if (!payload?.idempotencyKey) throw new Error("Receive idempotency key is missing.");
}

function isEligibleInventoryProduct(product) {
  return Boolean(
    product &&
    product.active !== false &&
    !product.archived_at &&
    String(product.product_type || "").toUpperCase() === "PHYSICAL" &&
    product.sellable === true &&
    product.readiness_status === "READY_FOR_SALE"
  );
}

function isEligibleInventoryVariant(variant) {
  return Boolean(
    variant &&
    variant.active !== false &&
    !variant.archived_at &&
    String(variant.sku || "").trim()
  );
}

function normalizeLocations(locations) {
  return (Array.isArray(locations) ? locations : [])
    .filter((row) => row?.active !== false && !row.archived_at)
    .map((row) => ({
      ...row,
      id: row.id,
      name: row.name || row.location_name || row.display_name || row.code || row.id,
      code: row.code || row.location_code || "",
      branchName: row.branch_name || row.branch || row.site_name || "",
      branchCode: row.branch_code || "",
      type: row.location_type || row.type || "",
    }))
    .sort((a, b) => `${a.branchName} ${a.name}`.localeCompare(`${b.branchName} ${b.name}`));
}

function mapInventoryRow({ product, variant, balance, location, category, brand }) {
  const onHand = readNumber(balance, ["on_hand", "on_hand_quantity", "quantity_on_hand", "qty_on_hand"]);
  const reserved = readNumber(balance, ["reserved", "reserved_quantity", "qty_reserved"]);
  const sellable = readNumber(balance, ["sellable", "available", "available_quantity", "qty_available"], onHand - reserved);
  const reorderPoint = readNullableNumber(balance, ["reorder_point", "reorder_quantity", "reorder_level", "minimum_quantity"]);
  const incoming = readNullableNumber(balance, ["incoming", "incoming_quantity", "qty_incoming"]);
  const unitCost = readNullableNumber(variant, ["unit_cost", "last_cost"]) ?? readNullableNumber(balance, ["last_cost", "unit_cost"]);

  return {
    id: `${variant.id}:${location.id}`,
    productId: product.id,
    variantId: variant.id,
    locationId: location.id,
    productName: product.name || "",
    variantLabel: [variant.color, variant.size].filter(Boolean).join(" / ") || variant.master_variant_id || "Default",
    sku: variant.sku || variant.global_sku || "",
    category: category?.name || "",
    brand: brand?.name || product.brand || "",
    locationName: location.name,
    locationCode: location.code,
    branchName: location.branchName,
    onHand,
    reserved,
    sellable,
    reorderPoint,
    incoming,
    unitCost,
    sellingPrice: readNumber(variant, ["selling_price"], 0),
    stockValue: unitCost === null ? null : onHand * unitCost,
    stockState: getStockState(onHand, reorderPoint),
  };
}

function mapStockMovements(movements, productById, variantById, locationById) {
  return (Array.isArray(movements) ? movements : []).map((row) => {
    const variant = variantById.get(row.variant_id || row.product_variant_id);
    const product = productById.get(row.product_id || variant?.product_id);
    const location = locationById.get(row.location_id || row.inventory_location_id);
    const quantityDelta = readNumber(row, ["quantity_delta", "qty_delta", "delta_quantity", "quantity"], 0);
    return {
      id: row.id || `${row.created_at}-${row.variant_id}-${quantityDelta}`,
      createdAt: row.created_at || row.movement_at || row.inserted_at || "",
      productName: product?.name || row.product_name || "",
      variantLabel: variant ? [variant.color, variant.size].filter(Boolean).join(" / ") : row.variant_name || "",
      sku: variant?.sku || row.sku || "",
      locationName: location?.name || row.location_name || "",
      movementType: row.movement_type || row.type || row.reason_code || "",
      quantityDelta,
      balanceBefore: readNullableNumber(row, ["balance_before", "on_hand_before", "quantity_before"]),
      balanceAfter: readNullableNumber(row, ["balance_after", "on_hand_after", "quantity_after"]),
      source: row.source || row.source_type || "",
      reference: row.source_reference || row.reference || row.reference_id || "",
      reason: row.reason || row.note || row.notes || "",
      operator: row.operator_name || row.done_by || row.created_by_name || row.created_by_user_id || "",
    };
  });
}

function getStockState(onHand, reorderPoint) {
  if (onHand <= 0) return "OUT OF STOCK";
  if (reorderPoint > 0 && onHand <= reorderPoint) return "LOW STOCK";
  return "HEALTHY";
}

function sortInventoryRows(a, b) {
  return a.productName.localeCompare(b.productName) || a.variantLabel.localeCompare(b.variantLabel) || a.locationName.localeCompare(b.locationName);
}

function readNumber(row, keys, fallback = 0) {
  const value = readNullableNumber(row, keys);
  return value === null ? fallback : value;
}

function readNullableNumber(row, keys) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== "") {
      const number = Number(row[key]);
      return Number.isFinite(number) ? number : null;
    }
  }
  return null;
}

function getAccessToken(authSession) {
  const accessToken = typeof authSession === "string" ? authSession : authSession?.access_token;
  if (!accessToken) throw new Error("Supabase auth session is required for Admin Inventory.");
  return accessToken;
}

function emptyToNull(value) {
  const next = String(value ?? "").trim();
  return next || null;
}
