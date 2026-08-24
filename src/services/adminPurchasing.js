import {
  executeSupabaseRpcWithAuth,
  isSupabaseReady,
  readSupabaseTableWithAuth,
} from "../lib/supabaseClient.js";

export const PURCHASE_ORDERS_TABLE = "purchase_orders";
export const PURCHASE_ORDER_LINES_TABLE = "purchase_order_lines";
export const PURCHASE_ORDER_RECEIPTS_TABLE = "purchase_order_receipts";
export const PURCHASE_ORDER_RECEIPT_LINES_TABLE = "purchase_order_receipt_lines";
export const CREATE_PURCHASE_ORDER_RPC = "create_purchase_order";
export const MARK_PURCHASE_ORDER_ORDERED_RPC = "mark_purchase_order_ordered";
export const RECEIVE_PURCHASE_ORDER_RPC = "receive_purchase_order";
export const PO_NUMBER_PREVIEW = "Auto-generated on save";
export const PURCHASE_ORDER_STATUSES = ["DRAFT", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"];
export const M2_WRITABLE_PURCHASE_ORDER_STATUSES = ["DRAFT", "ORDERED"];
export const M3_RECEIVABLE_PURCHASE_ORDER_STATUSES = ["ORDERED", "PARTIALLY_RECEIVED"];

export async function getPurchaseOrders(authSession) {
  if (!isSupabaseReady()) return { purchaseOrders: [], status: "empty", source: "local", error: null };

  try {
    const accessToken = getAccessToken(authSession);
    const [orderRows, lineRows, supplierRows] = await Promise.all([
      readSupabaseTableWithAuth(PURCHASE_ORDERS_TABLE, { select: "*", archived_at: "is.null", order: "created_at.desc" }, accessToken),
      readSupabaseTableWithAuth(PURCHASE_ORDER_LINES_TABLE, { select: "*", order: "created_at.asc" }, accessToken),
      readSupabaseTableWithAuth("suppliers", { select: "id,supplier_reference,name,active,archived_at" }, accessToken),
    ]);
    const { receiptRows, receiptLineRows } = await readOptionalReceivingRows(accessToken);
    const suppliersById = new Map((Array.isArray(supplierRows) ? supplierRows : []).map((supplier) => [supplier.id, supplier]));
    const rawReceiptLinesByReceiptId = groupBy(Array.isArray(receiptLineRows) ? receiptLineRows : [], "receipt_id");
    const receiptLinesByPurchaseOrderLineId = groupBy(Array.isArray(receiptLineRows) ? receiptLineRows : [], "purchase_order_line_id");
    const mappedReceipts = (Array.isArray(receiptRows) ? receiptRows : []).map((row) => mapPurchaseOrderReceiptRow(row, rawReceiptLinesByReceiptId.get(row.id) ?? []));
    const receiptsByOrderId = groupBy(mappedReceipts, "purchaseOrderId");
    const linesByOrderId = groupBy(Array.isArray(lineRows) ? lineRows : [], "purchase_order_id");
    const purchaseOrders = (Array.isArray(orderRows) ? orderRows : []).map((row) => mapPurchaseOrderRow(
      row,
      suppliersById.get(row.supplier_id),
      linesByOrderId.get(row.id) ?? [],
      receiptsByOrderId.get(row.id) ?? [],
      receiptLinesByPurchaseOrderLineId
    ));
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

export async function getPurchaseOrderReceivingHistory(authSession) {
  const result = await getPurchaseOrders(authSession);
  const receipts = result.purchaseOrders
    .flatMap((order) => (order.receipts ?? []).map((receipt) => ({
      ...receipt,
      poNumber: order.poNumber,
      supplierId: order.supplierId,
      supplierName: order.supplierName,
      supplierReference: order.supplierReference,
    })))
    .sort((a, b) => String(b.receivedAt || "").localeCompare(String(a.receivedAt || "")));
  return { receipts, status: result.status, source: result.source, error: result.error };
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

export async function markPurchaseOrderOrdered(purchaseOrderId, authSession) {
  const normalizedId = String(purchaseOrderId || "").trim();
  if (!normalizedId) throw new Error("Purchase order is required.");

  const response = await executeSupabaseRpcWithAuth(
    MARK_PURCHASE_ORDER_ORDERED_RPC,
    { p_purchase_order_id: normalizedId },
    getAccessToken(authSession)
  );
  return mapPurchaseOrderRpcResponse(response);
}

export async function receivePurchaseOrder(payload, authSession) {
  const normalized = normalizePurchaseOrderReceiptPayload(payload);
  if (!normalized.purchaseOrderId) throw new Error("Purchase order is required.");
  if (!normalized.locationId) throw new Error("Inventory location is required.");
  if (!normalized.idempotencyKey) throw new Error("Receive idempotency key is missing.");
  if (!normalized.lines.length) throw new Error("Enter a receive quantity for at least one PO line.");
  for (const [index, line] of normalized.lines.entries()) {
    if (!line.purchaseOrderLineId) throw new Error(`Line ${index + 1}: purchase order line is required.`);
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new Error(`Line ${index + 1}: receive quantity must be a positive whole number.`);
  }

  const response = await executeSupabaseRpcWithAuth(
    RECEIVE_PURCHASE_ORDER_RPC,
    {
      p_purchase_order_id: normalized.purchaseOrderId,
      p_location_id: normalized.locationId,
      p_lines: normalized.lines.map((line) => ({
        purchase_order_line_id: line.purchaseOrderLineId,
        quantity: line.quantity,
      })),
      p_idempotency_key: normalized.idempotencyKey,
      p_reference: normalized.reference || null,
      p_note: normalized.note || null,
    },
    getAccessToken(authSession)
  );
  return mapPurchaseOrderRpcResponse(response);
}

export function canWritePurchaseOrdersForRole(role) {
  return ["owner", "admin"].includes(String(role || "").trim().toLowerCase());
}

export function canReceivePurchaseOrdersForRole(role) {
  return canWritePurchaseOrdersForRole(role);
}

export function createPurchaseOrderReceiptIdempotencyKey(prefix = "po-receive") {
  const randomPart = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `admin-purchasing-${prefix}-${randomPart}`;
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

export function normalizePurchaseOrderReceiptPayload(payload = {}) {
  return {
    purchaseOrderId: String(payload.purchaseOrderId ?? "").trim(),
    locationId: String(payload.locationId ?? "").trim(),
    idempotencyKey: String(payload.idempotencyKey ?? "").trim(),
    reference: String(payload.reference ?? "").trim(),
    note: String(payload.note ?? "").trim(),
    lines: (Array.isArray(payload.lines) ? payload.lines : [])
      .map((line) => ({
        purchaseOrderLineId: String(line.purchaseOrderLineId ?? line.lineId ?? "").trim(),
        quantity: toInteger(line.quantity),
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

export function validatePurchaseOrderReceipt(order = {}, payload = {}) {
  const normalized = normalizePurchaseOrderReceiptPayload(payload);
  if (!order?.id || normalized.purchaseOrderId !== order.id) return "Purchase order is required.";
  if (!M3_RECEIVABLE_PURCHASE_ORDER_STATUSES.includes(String(order.status || "").toUpperCase())) return "Only Ordered or Partially Received purchase orders can receive stock.";
  if (!normalized.locationId) return "Inventory location is required.";
  if (!normalized.lines.length) return "Enter a receive quantity for at least one PO line.";
  const orderLineById = new Map((order.lines ?? []).map((line) => [line.id, line]));
  for (const [index, line] of normalized.lines.entries()) {
    const label = `Line ${index + 1}`;
    const orderLine = orderLineById.get(line.purchaseOrderLineId);
    if (!orderLine) return `${label}: purchase order line is invalid.`;
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) return `${label}: receive quantity must be a positive whole number.`;
    const remainingQuantity = Number(orderLine.remainingQuantity ?? Math.max(Number(orderLine.orderedQuantity || 0) - Number(orderLine.receivedQuantity || 0), 0));
    if (line.quantity > remainingQuantity) return `${label}: receive quantity cannot exceed ${remainingQuantity} remaining.`;
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

async function readOptionalReceivingRows(accessToken) {
  try {
    const [receiptRows, receiptLineRows] = await Promise.all([
      readSupabaseTableWithAuth(PURCHASE_ORDER_RECEIPTS_TABLE, { select: "*", order: "received_at.desc" }, accessToken),
      readSupabaseTableWithAuth(PURCHASE_ORDER_RECEIPT_LINES_TABLE, { select: "*", order: "received_at.asc" }, accessToken),
    ]);
    return {
      receiptRows: Array.isArray(receiptRows) ? receiptRows : [],
      receiptLineRows: Array.isArray(receiptLineRows) ? receiptLineRows : [],
    };
  } catch (error) {
    if (!isM3ReceivingSchemaUnavailable(error)) throw error;
    return { receiptRows: [], receiptLineRows: [] };
  }
}

function isM3ReceivingSchemaUnavailable(error) {
  return /purchase_order_receipts|purchase_order_receipt_lines|42P01|schema cache|could not find|does not exist/i.test(String(error?.message || error || ""));
}

function mapPurchaseOrderRpcResponse(response) {
  const payload = Array.isArray(response) ? response[0] : response;
  if (!payload) return null;
  const row = payload.purchase_order ?? payload.order ?? payload;
  const supplier = payload.supplier ?? null;
  const lines = payload.lines ?? [];
  const receipt = payload.receipt ? mapPurchaseOrderReceiptRow(payload.receipt, payload.receipt_lines ?? []) : null;
  const receiptLineRowsByPoLineId = groupBy(payload.receipt_lines ?? [], "purchase_order_line_id");
  return mapPurchaseOrderRow(row, supplier, lines, receipt ? [receipt] : [], receiptLineRowsByPoLineId);
}

function mapPurchaseOrderRow(row, supplier, lines = [], receipts = [], receiptLinesByPurchaseOrderLineId = new Map()) {
  const mappedLines = lines.map((line) => mapPurchaseOrderLineRow(line, receiptLinesByPurchaseOrderLineId.get(line.id) ?? []));
  const itemSubtotal = mappedLines.reduce((sum, line) => sum + line.lineTotal, 0);
  const freightCost = Number(row.freight_cost ?? row.freightCost ?? 0);
  const orderedUnits = mappedLines.reduce((sum, line) => sum + line.orderedQuantity, 0);
  const receivedUnits = mappedLines.reduce((sum, line) => sum + line.receivedQuantity, 0);
  const remainingUnits = Math.max(orderedUnits - receivedUnits, 0);
  const sortedReceipts = [...receipts].sort((a, b) => String(b.receivedAt || "").localeCompare(String(a.receivedAt || "")));
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
    receipts: sortedReceipts,
    itemSubtotal,
    totalCost: itemSubtotal + freightCost,
    lineCount: mappedLines.length,
    orderedUnits: mappedLines.reduce((sum, line) => sum + line.orderedQuantity, 0),
    receivedUnits,
    remainingUnits,
    receivingPercent: orderedUnits > 0 ? Math.round((receivedUnits / orderedUnits) * 100) : 0,
    receiptCount: sortedReceipts.length,
    lastReceiptAt: sortedReceipts[0]?.receivedAt || mappedLines.map((line) => line.lastReceivedAt).filter(Boolean).sort().at(-1) || "",
  };
}

function mapPurchaseOrderLineRow(row, receiptLineRows = []) {
  const orderedQuantity = Number(row.ordered_quantity ?? row.orderedQuantity ?? 0);
  const unitCost = Number(row.unit_cost ?? row.unitCost ?? 0);
  const receiptQuantity = (Array.isArray(receiptLineRows) ? receiptLineRows : []).reduce((sum, item) => sum + Number(item.quantity ?? item.received_quantity ?? 0), 0);
  // Preserve the M2 zero-receipt defaults for unmigrated/new PO lines while M3 overlays persisted receipt quantities.
  const m2ReceiptDefaults = { receivedQuantity: 0, remainingQuantity: orderedQuantity };
  const receivedQuantity = Math.min(orderedQuantity, Number(row.received_quantity ?? row.receivedQuantity ?? receiptQuantity ?? m2ReceiptDefaults.receivedQuantity));
  const remainingQuantity = receivedQuantity <= 0 ? m2ReceiptDefaults.remainingQuantity : Math.max(orderedQuantity - receivedQuantity, 0);
  const lastReceiptFromRows = (Array.isArray(receiptLineRows) ? receiptLineRows : [])
    .map((item) => item.received_at ?? item.receivedAt ?? "")
    .filter(Boolean)
    .sort()
    .at(-1) || "";
  return {
    id: row.id,
    purchaseOrderId: row.purchase_order_id ?? row.purchaseOrderId ?? "",
    productId: row.product_id ?? row.productId ?? "",
    variantId: row.variant_id ?? row.variantId ?? "",
    productName: row.product_name_snapshot ?? row.productName ?? "",
    sku: row.sku_snapshot ?? row.sku ?? "",
    variantLabel: row.variant_label_snapshot ?? row.variantLabel ?? "",
    orderedQuantity,
    receivedQuantity,
    remainingQuantity,
    unitCost,
    lineTotal: orderedQuantity * unitCost,
    lastReceivedAt: row.last_received_at ?? row.lastReceivedAt ?? lastReceiptFromRows,
    status: receivedQuantity <= 0 ? "AWAITING_RECEIPT" : remainingQuantity <= 0 ? "RECEIVED" : "PARTIALLY_RECEIVED",
  };
}

function mapPurchaseOrderReceiptRow(row, lines = []) {
  return {
    id: row.id,
    receiptNumber: row.receipt_number ?? row.receiptNumber ?? "",
    purchaseOrderId: row.purchase_order_id ?? row.purchaseOrderId ?? "",
    locationId: row.location_id ?? row.locationId ?? "",
    reference: row.reference ?? row.source_reference ?? "",
    note: row.note ?? row.reason ?? "",
    idempotencyKey: row.idempotency_key ?? row.idempotencyKey ?? "",
    receivedAt: row.received_at ?? row.receivedAt ?? row.created_at ?? "",
    receivedByUserId: row.received_by_user_id ?? row.receivedByUserId ?? "",
    lines: (Array.isArray(lines) ? lines : []).map((line) => ({
      id: line.id,
      receiptId: line.receipt_id ?? line.receiptId ?? "",
      purchaseOrderLineId: line.purchase_order_line_id ?? line.purchaseOrderLineId ?? "",
      variantId: line.variant_id ?? line.variantId ?? "",
      quantity: Number(line.quantity ?? line.received_quantity ?? 0),
      unitCost: Number(line.unit_cost ?? line.unitCost ?? 0),
      receivedAt: line.received_at ?? line.receivedAt ?? row.received_at ?? "",
    })),
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
