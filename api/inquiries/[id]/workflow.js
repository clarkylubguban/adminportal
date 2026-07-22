import { buildOpsWorkflowUpdates } from "../../_lib/opsWorkflow.js";
import { createServerSupabaseClient } from "../../_lib/supabaseServer.js";

const WRITE_ROLES = new Set(["owner", "admin", "staff"]);
const WORKFLOW_SELECT = [
  "id", "status", "next_action", "odoo_so", "product", "product_desc", "quantity", "due_date",
  "quote_status", "quoted_amount", "amount_due", "artwork_status", "payment_status",
  "assigned_staff", "production_stage", "production_note", "production_updated_at", "blocked_reason",
].join(",");

export default async function handler(request, response) {
  const inquiryReference = getInquiryReference(request);
  if (!/^[A-Z0-9][A-Z0-9_-]{2,79}$/.test(inquiryReference)) return sendJson(response, 400, { ok: false, error: "invalid inquiry reference" });
  if (request.method !== "PATCH") return sendJson(response, 405, { ok: false, error: "method not allowed" });

  const token = getBearerToken(request);
  if (!token) return sendJson(response, 401, { ok: false, error: "admin session required" });

  try {
    const supabase = createServerSupabaseClient();
    const adminUser = await getAuthorizedAdmin(supabase, token);
    if (!adminUser) return sendJson(response, 401, { ok: false, error: "admin session required" });
    if (!WRITE_ROLES.has(adminUser.role)) return sendJson(response, 403, { ok: false, error: "write access required" });

    const body = await readJsonBody(request);
    const { data: inquiry, error: lookupError } = await supabase.from("ops_inquiries").select(WORKFLOW_SELECT).eq("id", inquiryReference).maybeSingle();
    if (lookupError) throw lookupError;
    if (!inquiry) return sendJson(response, 404, { ok: false, error: "inquiry not found" });

    const now = new Date().toISOString();
    const result = buildOpsWorkflowUpdates(String(body.action || ""), body, inquiry, now);
    if (!result.ok) return sendJson(response, 400, { ok: false, error: result.error });

    const { data: updated, error: updateError } = await supabase
      .from("ops_inquiries")
      .update({ ...result.updates, updated_at: now })
      .eq("id", inquiryReference)
      .select(WORKFLOW_SELECT)
      .single();
    if (updateError) throw updateError;

    sendJson(response, 200, { ok: true, inquiry: toClientInquiry(updated) });
  } catch (error) {
    console.error("Admin workflow update failed.", { message: error?.message, code: error?.code });
    const schemaMissing = /production_stage|assigned_staff|blocked_reason|schema cache|could not find/i.test(String(error?.message || ""));
    sendJson(response, schemaMissing ? 503 : 500, { ok: false, error: schemaMissing ? "workflow fields are not ready" : "workflow update failed" });
  }
}

async function getAuthorizedAdmin(supabase, token) {
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) return null;

  const adminUser = await readAdminUser(supabase, userData.user.id);
  return normalizeAdminUser(adminUser);
}

async function readAdminUser(supabase, userId) {
  const query = (select) => supabase
    .from("admin_users")
    .select(select)
    .eq("user_id", userId)
    .maybeSingle();

  const { data, error } = await query("id,role,is_active");
  if (!error) return data;
  if (!isMissingAdminProfileColumn(error)) throw error;

  const fallback = await query("id,role");
  if (fallback.error) throw fallback.error;
  return fallback.data;
}

function normalizeAdminUser(adminUser) {
  if (!adminUser || adminUser.is_active === false) return null;
  const role = String(adminUser.role || "").trim().toLowerCase();
  return { ...adminUser, role };
}

function isMissingAdminProfileColumn(error) {
  return /is_active|42703|schema cache|could not find/i.test(String(error?.message || error || ""));
}

function toClientInquiry(row) {
  return {
    id: row.id,
    status: row.status,
    next: row.next_action,
    odooSO: row.odoo_so,
    assignedStaff: row.assigned_staff,
    productionStage: row.production_stage,
    productionNote: row.production_note,
    productionUpdatedAt: row.production_updated_at,
    blockedReason: row.blocked_reason,
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
  const match = url.pathname.match(/^\/api\/inquiries\/([^/]+)\/workflow\/?$/);
  return match ? decodeURIComponent(match[1]).trim().toUpperCase() : "";
}

function getBearerToken(request) {
  return String(request.headers.authorization || request.headers.Authorization || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}

function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

