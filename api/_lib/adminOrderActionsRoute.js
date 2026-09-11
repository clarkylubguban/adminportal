import { getAuthorizedAdmin, getBearerToken, readJsonBody, sendJson } from "./adminAccess.js";
import { createServerSupabaseClient, createServerSupabaseUserClient } from "./supabaseServer.js";

const WRITE_ROLES = new Set(["owner", "admin"]);

export default async function adminOrderActionsHandler(request, response, dependencies = {}) {
  if (request.method !== "POST") return sendJson(response, 405, { ok: false, error: "method not allowed" });

  const orderId = getOrderId(request);
  if (!uuid(orderId)) return sendJson(response, 400, { ok: false, error: "invalid order id" });

  const token = getBearerToken(request);
  if (!token) return sendJson(response, 401, { ok: false, error: "admin session required" });

  try {
    const identityClient = dependencies.identityClient || createServerSupabaseClient();
    const caller = dependencies.caller || await getAuthorizedAdmin(identityClient, token);
    if (!caller) return sendJson(response, 401, { ok: false, error: "admin session required" });
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
    console.error("Admin Order action failed.", { message: error?.message, code: error?.code });
    return sendJson(response, 500, { ok: false, error: "order action failed" });
  }
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
