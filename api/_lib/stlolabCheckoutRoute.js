import { createHash, timingSafeEqual } from "node:crypto";
import { createServerSupabaseClient } from "./supabaseServer.js";

const MAX_BODY_BYTES = 24_000;

export default async function stlolabCheckoutHandler(request, response, action = "create") {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") return send(response, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
  if (!checkoutEnvironmentReady()) return send(response, 503, { ok: false, code: "ORDERS_NOT_OPEN" });
  if (!authorizedGateway(request)) return send(response, 401, { ok: false, code: "STOREFRONT_AUTH_REQUIRED" });

  try {
    const body = await readJson(request);
    const supabase = createServerSupabaseClient().schema("trry_api");
    if (action === "confirmation") {
      const orderId = uuid(body.orderId);
      const token = opaqueToken(body.confirmationToken, 32, 180);
      if (!orderId || !token) return send(response, 400, { ok: false, code: "INVALID_CONFIRMATION_ACCESS" });
      const { data, error } = await supabase.rpc("get_stlolab_order_confirmation_sw3", {
        p_order_id: orderId,
        p_confirmation_token_hash: sha256(token),
      });
      if (error) throw error;
      if (!data) return send(response, 404, { ok: false, code: "ORDER_NOT_FOUND" });
      return send(response, 200, { ok: true, order: data });
    }

    const payload = normalizeCheckout(body);
    const { data, error } = await supabase.rpc("create_stlolab_order_sw3", {
      p_environment: "staging",
      p_idempotency_key: payload.idempotencyKey,
      p_payload_hash: sha256(stableJson(payload.checkout)),
      p_confirmation_token_hash: sha256(payload.confirmationToken),
      p_customer: payload.checkout.customer,
      p_fulfillment: payload.checkout.fulfillment,
      p_lines: payload.checkout.lines,
    });
    if (error) return sendKnownError(response, error);
    return send(response, 201, { ok: true, order: data, confirmationToken: payload.confirmationToken });
  } catch (error) {
    if (error?.statusCode) return send(response, error.statusCode, { ok: false, code: error.code });
    console.error("STLOLAB checkout request failed.", { code: error?.code, message: error?.message });
    return send(response, 500, { ok: false, code: "CHECKOUT_FAILED" });
  }
}

function checkoutEnvironmentReady() {
  return process.env.STLO_CHECKOUT_ENABLED === "true"
    && process.env.STLO_CHECKOUT_ENV === "staging"
    && String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").includes("fszkypwovpdthqfobxrk");
}

function authorizedGateway(request) {
  const expected = String(process.env.STLO_STOREFRONT_GATEWAY_SECRET || "");
  const supplied = String(request.headers?.["x-stlolab-gateway-secret"] || "");
  if (expected.length < 32 || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function normalizeCheckout(body) {
  const idempotencyKey = opaqueToken(body.idempotencyKey, 16, 120, /^[A-Za-z0-9_-]+$/);
  const confirmationToken = opaqueToken(body.confirmationToken, 32, 180);
  if (!idempotencyKey || !confirmationToken) throw bad("INVALID_CHECKOUT_SECURITY");
  const customer = body.customer || {};
  const fullName = text(customer.fullName, 240);
  const mobile = text(customer.mobile, 40);
  const email = text(customer.email, 254).toLowerCase();
  if (!fullName || !mobile || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw bad("INVALID_CUSTOMER_DETAILS");
  const fulfillment = body.fulfillment || {};
  const method = text(fulfillment.method, 20).toLowerCase();
  if (!['pickup', 'delivery'].includes(method)) throw bad("INVALID_FULFILLMENT");
  const address = fulfillment.address || {};
  const lines = Array.isArray(body.lines) ? body.lines.map((line) => ({
    variantId: uuid(line.variantId),
    quantity: Number(line.quantity),
    unitPriceMinor: Number(line.unitPriceMinor),
  })) : [];
  if (!lines.length || lines.length > 20 || lines.some((line) => !line.variantId || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99 || !Number.isSafeInteger(line.unitPriceMinor) || line.unitPriceMinor < 1)) throw bad("INVALID_ORDER_LINES");
  if (new Set(lines.map((line) => line.variantId)).size !== lines.length) throw bad("DUPLICATE_VARIANT_LINES");
  return { idempotencyKey, confirmationToken, checkout: {
    customer: { fullName, mobile, email },
    fulfillment: { method, pickupCode: text(fulfillment.pickupCode, 80), address: {
      line1: text(address.line1, 240), line2: text(address.line2, 240), city: text(address.city, 120),
      province: text(address.province, 120), postalCode: text(address.postalCode, 20), notes: text(address.notes, 500),
    } },
    lines,
  } };
}

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw Object.assign(new Error("body too large"), { statusCode: 413, code: "REQUEST_TOO_LARGE" });
  }
  try { return JSON.parse(raw || "{}"); } catch { throw bad("INVALID_JSON"); }
}

function sendKnownError(response, error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("not enabled") || message.includes("not configured") || message.includes("not accepted")) return send(response, 503, { ok: false, code: "ORDERS_NOT_OPEN" });
  if (message.includes("already used")) return send(response, 409, { ok: false, code: "IDEMPOTENCY_CONFLICT" });
  if (message.includes("unavailable") || String(error?.code) === "22003") return send(response, 409, { ok: false, code: "VARIANT_UNAVAILABLE" });
  if (String(error?.code) === "22023" || String(error?.code) === "23514" || String(error?.code) === "22P02") return send(response, 400, { ok: false, code: "CHECKOUT_REJECTED" });
  throw error;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function text(value, max) { return String(value ?? "").trim().slice(0, max); }
function uuid(value) { const result = text(value, 80).toLowerCase(); return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(result) ? result : ""; }
function opaqueToken(value, min, max, pattern = /^[A-Za-z0-9_-]+$/) { const result = text(value, max); return result.length >= min && pattern.test(result) ? result : ""; }
function bad(code) { return Object.assign(new Error(code), { statusCode: 400, code }); }
function send(response, status, body) { response.statusCode = status; response.setHeader("Content-Type", "application/json; charset=utf-8"); response.end(JSON.stringify(body)); }
