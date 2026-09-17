import { getAuthorizedAdmin, getBearerToken, readJsonBody, sendJson } from "./adminAccess.js";
import { requireEffectiveModuleAccess } from "./effectiveAccess.js";
import { createServerSupabaseClient, createServerSupabaseUserClient } from "./supabaseServer.js";

const WRITE_ROLES = new Set(["owner", "admin"]);

export default async function adminOrderActionsHandler(request, response, dependencies = {}) {
  if (!["GET", "POST"].includes(request.method)) return sendJson(response, 405, { ok: false, error: "method not allowed" });

  const orderId = getOrderId(request);
  if (!uuid(orderId)) return sendJson(response, 400, { ok: false, error: "invalid order id" });

  const token = getBearerToken(request);
  if (!token) return sendJson(response, 401, { ok: false, error: "admin session required" });

  try {
    const identityClient = dependencies.identityClient || createServerSupabaseClient();
    const caller = dependencies.caller || await getAuthorizedAdmin(identityClient, token);
    if (!caller) return sendJson(response, 401, { ok: false, error: "admin session required" });

    if (request.method === "GET") {
      const access = dependencies.access || await requireEffectiveModuleAccess(identityClient, caller, "orders");
      if (!access.allowed) return sendJson(response, 403, { ok: false, error: "Orders access is restricted." });
      const readDetails = dependencies.readDetails || readCanonicalOrderDetails;
      const order = await readDetails(identityClient, orderId);
      if (!order) return sendJson(response, 404, { ok: false, error: "order not found" });
      return sendJson(response, 200, { ok: true, order });
    }

    if (!WRITE_ROLES.has(String(caller.role || "").toLowerCase())) {
      return sendJson(response, 403, { ok: false, error: "owner or admin access required" });
    }

    const body = await readJsonBody(request);
    const operation = buildOperation(orderId, body);
    if (!operation.ok) return sendJson(response, 400, { ok: false, error: operation.error });

    const actorClient = dependencies.actorClient || createServerSupabaseUserClient(token);
    const { data, error } = await actorClient.schema("trry_api").rpc(operation.functionName, operation.parameters);
    if (error) return sendDatabaseError(response, error);
    return sendJson(response, 200, { ok: true, action: operation.action, transition: data });
  } catch (error) {
    if (error?.status) {
      return sendJson(response, error.status, { ok: false, error: error.message || "order access is restricted" });
    }
    console.error("Admin Order action failed.", { message: error?.message, code: error?.code });
    return sendJson(response, 500, { ok: false, error: "order action failed" });
  }
}

export async function readCanonicalOrderDetails(supabase, orderId) {
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id,source_type,fulfillment_state")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError) throw orderError;
  if (!order) return null;

  const { data: items, error: itemsError } = await supabase
    .from("order_items")
    .select("id,product_id,variant_id,product_code,product_name,sku,size,color,quantity,unit_price,line_total")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (itemsError) throw itemsError;

  return {
    id: order.id,
    sourceType: order.source_type,
    fulfillmentState: order.fulfillment_state,
    items: (items || []).map((item) => ({
      id: item.id,
      productId: item.product_id,
      variantId: item.variant_id,
      productCode: item.product_code,
      productName: item.product_name,
      sku: item.sku,
      size: item.size,
      color: item.color,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      lineTotal: item.line_total,
    })),
  };
}

export function buildOperation(orderId, body = {}) {
  const action = text(body.action, 40).toLowerCase();
  const idempotencyKey = opaque(body.idempotencyKey, 16, 120);
  if (!idempotencyKey) return failure("valid idempotency key is required");

  if (action === "confirm_payment") {
    const amount = Number(body.amountReceived);
    const method = text(body.paymentSource, 40).toLowerCase();
    const reference = text(body.paymentReference, 120);
    const note = text(body.internalNote, 500) || null;
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(Math.round(amount * 100) - amount * 100) > 1e-8) return failure("valid payment amount is required");
    if (!["cash", "gcash", "bank_transfer", "card", "other"].includes(method)) return failure("valid payment source is required");
    if (!reference) return failure("durable payment reference is required");
    return {
      ok: true,
      action,
      functionName: "confirm_stlolab_order_payment_sw3",
      parameters: {
        p_order_id: orderId,
        p_amount: amount,
        p_payment_method: method,
        p_payment_reference: reference,
        p_internal_note: note,
        p_idempotency_key: idempotencyKey,
      },
    };
  }

  const handoverKind = {
    customer_pickup: "CUSTOMER_PICKUP",
    courier_handover: "COURIER_HANDOVER",
  }[action];
  if (!handoverKind) return failure("unsupported order action");
  return {
    ok: true,
    action,
    functionName: "handover_stlolab_order_sw3",
    parameters: {
      p_order_id: orderId,
      p_handover_kind: handoverKind,
      p_idempotency_key: idempotencyKey,
    },
  };
}

function getOrderId(request) {
  const queryId = Array.isArray(request.query?.orderId) ? request.query.orderId[0] : request.query?.orderId;
  if (queryId) return String(queryId).trim().toLowerCase();
  const url = new URL(request.url || "/", `http://${request.headers?.host || "localhost"}`);
  const match = url.pathname.match(/^\/api\/orders\/([^/]+)\/actions\/?$/);
  return match ? decodeURIComponent(match[1]).trim().toLowerCase() : "";
}

function sendDatabaseError(response, error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  if (code === "42501") return sendJson(response, 403, { ok: false, error: "order action is not permitted" });
  if (code === "P0002") return sendJson(response, 404, { ok: false, error: "order not found" });
  if (["22023", "23505", "23514", "55000"].includes(code)) {
    const errorText = message.includes("already") ? "order action was already completed" : "order action conflicts with saved order state";
    return sendJson(response, 409, { ok: false, error: errorText });
  }
  throw error;
}

function text(value, max) { return String(value ?? "").trim().slice(0, max); }
function uuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(String(value || "")); }
function opaque(value, min, max) { const result = text(value, max); return result.length >= min && /^[A-Za-z0-9_-]+$/.test(result) ? result : ""; }
function failure(error) { return { ok: false, error }; }
