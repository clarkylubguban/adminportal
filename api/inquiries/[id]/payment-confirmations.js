import { buildPaymentConfirmationUpdate } from "../../_lib/paymentConfirmation.js";
import { createServerSupabaseClient } from "../../_lib/supabaseServer.js";

const WRITE_ROLES = new Set(["owner", "admin"]);
const PAYMENT_CONFIRMATION_SELECT = [
  "id",
  "quoted_amount",
  "amount_due",
  "quote_status",
  "payment_status",
  "payment_method",
  "payment_type",
  "payment_selected_amount",
  "payment_reference",
  "payment_customer_note",
  "payment_verified_amount",
  "payment_verified_at",
  "payment_verified_by",
  "payment_confirmed_amount",
  "payment_confirmed_at",
  "payment_confirmed_by",
  "payment_internal_note",
  "payment_review_note",
  "payment_rejected_at",
  "payment_history",
].join(",");

export default async function handler(request, response) {
  const inquiryReference = getInquiryReference(request);
  if (!/^[A-Z0-9][A-Z0-9_-]{2,79}$/.test(inquiryReference)) return sendJson(response, 400, { ok: false, error: "invalid inquiry reference" });
  if (request.method !== "POST") return sendJson(response, 405, { ok: false, error: "method not allowed" });

  const token = getBearerToken(request);
  if (!token) return sendJson(response, 401, { ok: false, error: "admin session required" });

  try {
    const supabase = createServerSupabaseClient();
    const adminUser = await getAuthorizedAdmin(supabase, token);
    if (!adminUser) return sendJson(response, 401, { ok: false, error: "admin session required" });
    if (!WRITE_ROLES.has(adminUser.role)) return sendJson(response, 403, { ok: false, error: "owner or admin access required" });

    const body = await readJsonBody(request);
    const { data: inquiry, error: lookupError } = await supabase
      .from("ops_inquiries")
      .select(PAYMENT_CONFIRMATION_SELECT)
      .eq("id", inquiryReference)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!inquiry) return sendJson(response, 404, { ok: false, error: "inquiry not found" });

    const now = new Date().toISOString();
    const result = buildPaymentConfirmationUpdate({ inquiry, body, adminUser, now });
    if (!result.ok) return sendJson(response, 400, { ok: false, error: result.error });
    if (result.idempotent) return sendJson(response, 200, { ok: true, inquiry: toClientInquiry(inquiry), idempotent: true });

    const { data: updated, error: updateError } = await supabase
      .from("ops_inquiries")
      .update({ ...result.updates, updated_at: now })
      .eq("id", inquiryReference)
      .select(PAYMENT_CONFIRMATION_SELECT)
      .single();
    if (updateError) throw updateError;

    return sendJson(response, 200, { ok: true, inquiry: toClientInquiry(updated), idempotent: false });
  } catch (error) {
    console.error("Admin payment confirmation failed.", { message: error?.message, code: error?.code });
    const schemaMissing = /payment_confirmed_by|payment_internal_note|payment_history|payment_confirmed_amount|payment_verified_amount|schema cache|could not find/i.test(String(error?.message || ""));
    return sendJson(response, schemaMissing ? 503 : 500, {
      ok: false,
      error: schemaMissing ? "payment confirmation fields are not ready" : "payment confirmation failed",
    });
  }
}

async function getAuthorizedAdmin(supabase, token) {
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) return null;

  const query = (select) => supabase
    .from("admin_users")
    .select(select)
    .eq("user_id", userData.user.id)
    .maybeSingle();

  const { data, error } = await query("id,user_id,role,is_active");
  if (error && !/is_active|42703|schema cache|could not find/i.test(String(error?.message || ""))) throw error;
  const adminUser = error ? (await query("id,user_id,role")).data : data;
  if (!adminUser || adminUser.is_active === false) return null;
  return { ...adminUser, role: String(adminUser.role || "").trim().toLowerCase() };
}

function toClientInquiry(row) {
  return {
    id: row.id,
    amountDue: numberOrNull(row.amount_due),
    paymentStatus: cleanText(row.payment_status, 80),
    paymentMethod: cleanText(row.payment_method, 80),
    paymentType: cleanText(row.payment_type, 80),
    paymentSelectedAmount: numberOrNull(row.payment_selected_amount),
    paymentReference: cleanText(row.payment_reference, 120),
    paymentVerifiedAmount: numberOrNull(row.payment_verified_amount),
    paymentVerifiedAt: cleanText(row.payment_verified_at, 80),
    paymentVerifiedBy: cleanText(row.payment_verified_by, 80),
    paymentConfirmedAmount: numberOrNull(row.payment_confirmed_amount),
    paymentConfirmedAt: cleanText(row.payment_confirmed_at, 80),
    paymentConfirmedBy: cleanText(row.payment_confirmed_by, 80),
    paymentInternalNote: cleanText(row.payment_internal_note, 1000),
    paymentReviewNote: cleanText(row.payment_review_note, 1000),
    paymentRejectedAt: cleanText(row.payment_rejected_at, 80),
    paymentHistory: Array.isArray(row.payment_history) ? row.payment_history : [],
  };
}

async function readJsonBody(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) return request.body;
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return {}; }
}

function getInquiryReference(request) {
  const queryId = Array.isArray(request.query?.id) ? request.query.id[0] : request.query?.id;
  if (queryId) return String(queryId).trim().toUpperCase();
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const match = url.pathname.match(/^\/api\/inquiries\/([^/]+)\/payment-confirmations\/?$/);
  return match ? decodeURIComponent(match[1]).trim().toUpperCase() : "";
}

function getBearerToken(request) {
  return String(request.headers.authorization || request.headers.Authorization || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}
