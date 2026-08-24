import {
  executeSupabaseRpcWithAuth,
  isSupabaseReady,
  readSupabaseTableWithAuth,
} from "../lib/supabaseClient.js";

export const PURCHASE_ORDERS_TABLE = "purchase_orders";
export const PURCHASE_ORDER_LINES_TABLE = "purchase_order_lines";
export const CREATE_PURCHASE_ORDER_RPC = "create_purchase_order";
export const PO_NUMBER_PREVIEW = "Auto-generated on save";
export const PURCHASE_ORDER_STATUSES = ["DRAFT", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"];
export const M2_WRITABLE_PURCHASE_ORDER_STATUSES = ["DRAFT", "ORDERED"];

export async function getPurchaseOrders(authSession) {
  if (!isSupabaseReady()) return { purchaseOrders: [], status: "empty", source: "local", error: null };

  try {
    const accessToken = getAccessToken(authSession);
    const [orderRows, lineRows, supplierRows] = await Promise.all([
      readSupabaseTableWithAuth(PURCHASE_ORDERS_TABLE, { select: "*", archived_at: "is.null", order: "created_at.desc" }, accessToken),
      readSupabaseTableWithAuth(PURCHASE_ORDER_LINES_TABLE, { select: "*", order: "created_at.asc" }, accessToken),
      readSupabaseTableWithAuth("suppliers", { select: "id,supplier_reference,name,active,archived_at" }, accessToken),
    ]);
    const suppliersById = new Map((Array.isArray(supplierRows) ? supplierRows : []).map((supplier) => [supplier.id, supplier]));
    const linesByOrderId = groupBy(Array.isArray(lineRows) ? lineRows : [], "purchase_order_id");
    const purchaseOrders = (Array.isArray(orderRows) ? orderRows : []).map((row) => mapPurchaseOrderRow(row, suppliersById.get(row.supplier_id), linesByOrderId.get(row.id) ?? []));
    return { purchaseOrders, status: purchaseOrders.length ? "success" : "empty", source: "supabase", error: null };
  } catch (error) {
    console.error("Unable to load Purchase Orders.", error);
    return { purchaseOrders: [], status: "error", source: "supabase", error };
  }
}

export async function getPurchaseOrderDetail(id, authSession) {
  const result = await getPurchaseOrders(authSession);
  return result.purchaseOrders.find((order) => order.id === id) ?? null;
}

export async function createPurchaseOrder(draft, status = "DRAFT", authSession) {
  const normalized = normalizePurchaseOrderDraft({ ...draft, status });
  const error = validatePurchaseOrderDraft(normalized);
  if (error) throw new Error(error);
  if (!M2_WRITABLE_PURCHASE_ORDER_STATUSES.includes(normalized.status)) throw new Error("M2 can only create Draft or Ordered purchase orders.");

  const response = await executeSupabaseRpcWithAuth(
    CREATE_PURCHASE_ORDER_RPC,
    {
      p_supplier_id: normalized.supplierId,
      p_expected_date: normalized.expectedDate || null,
      p_supplier_reference: normalized.supplierReference || null,
      p_freight_cost: normalized.freightCost,
      p_internal_note: normalized.internalNote || null,
      p_status: normalized.status,
      p_lines: normalized.lines.map((line) => ({
        product_id: line.productId,
        variant_id: line.variantId,
        ordered_quantity: line.orderedQuantity,
        unit_cost: line.unitCost,
      })),
    },
    getAccessToken(authSession)
  );
  return mapPurchaseOrderRpcResponse(response);
}

export function markPurchaseOrderOrdered(draft, authSession) {
  return createPurchaseOrder(draft, "ORDERED", authSession);
}

export function canWritePurchaseOrdersForRole(role) {
  return ["owner", "admin"].includes(String(role || "").trim().toLowerCase());
}

export function createEmptyPurchaseOrderDraft(supplierId = "") {
  return {
    supplierId,
    expectedDate: "",
    supplierReference: "",
    freightCost: "0",
    internalNote: "",
    lines: [createEmptyPurchaseOrderLine()],
  };
}

export function createEmptyPurchaseOrderLine() {
  return { productId: "", variantId: "", productName: "", sku: "", variantLabel: "", orderedQuantity: "1", unitCost: "0" };
}

export function normalizePurchaseOrderDraft(draft = {}) {
  return {
    supplierId: String(draft.supplierId ?? "").trim(),
    expectedDate: String(draft.expectedDate ?? "").trim(),
    supplierReference: String(draft.supplierReference ?? "").trim(),
    freightCost: toNumber(draft.freightCost),
    internalNote: String(draft.internalNote ?? "").trim(),
    status: String(draft.status ?? "DRAFT").trim().toUpperCase(),
    lines: (Array.isArray(draft.lines) ? draft.lines : []).map((line) => ({
      productId: String(line.productId ?? "").trim(),
      variantId: String(line.variantId ?? "").trim(),
      productName: String(line.productName ?? "").trim(),
      sku: String(line.sku ?? "").trim(),
      variantLabel: String(line.variantLabel ?? "").trim(),
      orderedQuantity: toInteger(line.orderedQuantity),
      unitCost: toNumber(line.unitCost),
    })),
  };
}

export function validatePurchaseOrderDraft(draft = {}) {
  const normalized = normalizePurchaseOrderDraft(draft);
  if (!normalized.supplierId) return "Active supplier is required.";
  if (normalized.freightCost < 0) return "Freight cost cannot be negative.";
  if (!normalized.lines.length) return "Add at least one order line.";
  for (const [index, line] of normalized.lines.entries()) {
    const label = `Line ${index + 1}`;
    if (!line.productId || !line.variantId) return `${label}: choose a product variant.`;
    if (!Number.isInteger(line.orderedQuantity) || line.orderedQuantity <= 0) return `${label}: quantity must be a positive whole number.`;
    if (!Number.isFinite(line.unitCost) || line.unitCost < 0) return `${label}: unit cost cannot be negative.`;
  }
  return "";
}

export function getPurchaseOrderTotals(draft = {}) {
  const normalized = normalizePurchaseOrderDraft(draft);
  const itemsSubtotal = normalized.lines.reduce((sum, line) => sum + line.orderedQuantity * line.unitCost, 0);
  const totalCost = itemsSubtotal + normalized.freightCost;
  const itemCount = normalized.lines.reduce((sum, line) => sum + line.orderedQuantity, 0);
  return { itemsSubtotal, freightCost: normalized.freightCost, totalCost, itemCount };
}

export function isEligiblePurchaseVariant(product = {}, variant = {}) {
  const status = String(product.status || "").toLowerCase();
  const productType = String(product.productType || "PHYSICAL").toUpperCase();
  return status !== "archived" && productType === "PHYSICAL" && Boolean(String(variant.sku || variant.globalSku || "").trim());
}

function mapPurchaseOrderRpcResponse(response) {
  const payload = Array.isArray(response) ? response[0] : response;
  if (!payload) return null;
  const row = payload.purchase_order ?? payload.order ?? payload;
  const supplier = payload.supplier ?? null;
  const lines = payload.lines ?? [];
  return mapPurchaseOrderRow(row, supplier, lines);
}

function mapPurchaseOrderRow(row, supplier, lines = []) {
  const mappedLines = lines.map(mapPurchaseOrderLineRow);
  const itemSubtotal = mappedLines.reduce((sum, line) => sum + line.lineTotal, 0);
  const freightCost = Number(row.freight_cost ?? row.freightCost ?? 0);
  return {
    id: row.id,
    poNumber: row.po_number ?? row.poNumber ?? "",
    supplierId: row.supplier_id ?? row.supplierId ?? "",
    supplierName: supplier?.name ?? row.supplier_name ?? "",
    supplierReference: supplier?.supplier_reference ?? row.supplier_reference ?? row.supplierReference ?? "",
    status: row.status ?? "DRAFT",
    orderDate: row.order_date ?? row.orderDate ?? "",
    expectedDate: row.expected_date ?? row.expectedDate ?? "",
    supplierReferenceNote: row.supplier_reference ?? row.supplierReferenceNote ?? "",
    freightCost,
    internalNote: row.internal_note ?? row.internalNote ?? "",
    orderedAt: row.ordered_at ?? row.orderedAt ?? "",
    createdAt: row.created_at ?? row.createdAt ?? "",
    updatedAt: row.updated_at ?? row.updatedAt ?? "",
    lines: mappedLines,
    itemSubtotal,
    totalCost: itemSubtotal + freightCost,
    itemCount: mappedLines.reduce((sum, line) => sum + line.orderedQuantity, 0),
  };
}

function mapPurchaseOrderLineRow(row) {
  const orderedQuantity = Number(row.ordered_quantity ?? row.orderedQuantity ?? 0);
  const unitCost = Number(row.unit_cost ?? row.unitCost ?? 0);
  return {
    id: row.id,
    purchaseOrderId: row.purchase_order_id ?? row.purchaseOrderId ?? "",
    productId: row.product_id ?? row.productId ?? "",
    variantId: row.variant_id ?? row.variantId ?? "",
    productName: row.product_name_snapshot ?? row.productName ?? "",
    sku: row.sku_snapshot ?? row.sku ?? "",
    variantLabel: row.variant_label_snapshot ?? row.variantLabel ?? "",
    orderedQuantity,
    receivedQuantity: 0,
    remainingQuantity: orderedQuantity,
    unitCost,
    lineTotal: orderedQuantity * unitCost,
    status: "AWAITING_RECEIPT",
  };
}

function getAccessToken(authSession) {
  const accessToken = typeof authSession === "string" ? authSession : authSession?.access_token;
  if (!accessToken) throw new Error("Supabase auth session is required for Purchase Orders.");
  return accessToken;
}

function toNumber(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function toInteger(value) {
  const number = Number(value ?? 0);
  return Number.isInteger(number) ? number : 0;
}

function groupBy(rows, key) {
  return rows.reduce((groups, row) => {
    const value = row[key];
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
    return groups;
  }, new Map());
}
