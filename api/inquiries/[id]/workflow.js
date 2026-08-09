import { assignmentLabel, validateAssignmentUser } from "../../_lib/adminAssignments.js";
import { convertInquiryToNativeOrder, NativeOrderError, readNativeOrderBySourceInquiryId } from "../../_lib/nativeOrders.js";
import { buildOpsWorkflowUpdates } from "../../_lib/opsWorkflow.js";
import { createServerSupabaseClient } from "../../_lib/supabaseServer.js";

const WRITE_ROLES = new Set(["owner", "admin", "staff"]);
const WORKFLOW_SELECT = [
  "id", "status", "next_action", "odoo_so", "product", "product_desc", "quantity", "due_date",
  "quote_status", "quoted_amount", "amount_due", "artwork_status", "payment_status",
  "payment_confirmed_amount", "payment_verified_amount",
  "assigned_staff", "assigned_user_id", "production_stage", "production_note", "production_updated_at",
  "production_started_at", "production_started_by", "blocked_reason",
  "qc_started_at", "qc_started_by", "qc_note", "qc_completed_at", "qc_completed_by",
  "production_completed_at", "production_completed_by",
].join(",");

export default async function handler(request, response) {
  return handleWorkflowRequest(request, response);
}

export async function handleWorkflowRequest(request, response, dependencies = {}) {
  const inquiryReference = getInquiryReference(request);
  if (!/^[A-Z0-9][A-Z0-9_-]{2,79}$/.test(inquiryReference)) return sendJson(response, 400, { ok: false, error: "invalid inquiry reference" });
  const nativeOrderRequest = isNativeOrderRequest(request);
  if (nativeOrderRequest && request.method !== "POST") return sendJson(response, 405, { ok: false, error: "method not allowed" });
  if (!nativeOrderRequest && request.method !== "PATCH") return sendJson(response, 405, { ok: false, error: "method not allowed" });

  const token = getBearerToken(request);
  if (!token) return sendJson(response, 401, { ok: false, error: "admin session required" });

  try {
    const supabase = dependencies.supabase || createServerSupabaseClient();
    const adminUser = dependencies.adminUser || await getAuthorizedAdmin(supabase, token);
    if (!adminUser) return sendJson(response, 401, { ok: false, error: "admin session required" });
    if (!WRITE_ROLES.has(adminUser.role)) return sendJson(response, 403, { ok: false, error: "write access required" });

    if (nativeOrderRequest) {
      const result = await convertInquiryToNativeOrder(supabase, inquiryReference);
      return sendJson(response, result.created ? 201 : 200, { ok: true, created: result.created, order: result.order });
    }

    const body = await readJsonBody(request);
    const { data: inquiry, error: lookupError } = await supabase.from("ops_inquiries").select(WORKFLOW_SELECT).eq("id", inquiryReference).maybeSingle();
    if (lookupError) throw lookupError;
    if (!inquiry) return sendJson(response, 404, { ok: false, error: "inquiry not found" });
    const nativeOrder = await readNativeOrderBySourceInquiryId(supabase, inquiryReference);
    const workflowInquiry = nativeOrder
      ? { ...inquiry, nativeOrderAuthority: true, nativeOrderId: nativeOrder.id, nativeOrderReference: nativeOrder.orderReference }
      : inquiry;

    const now = new Date().toISOString();
    const assignmentPatch = await buildAssignmentPatch(supabase, body, workflowInquiry, adminUser);
    if (!assignmentPatch.ok) return sendJson(response, 400, { ok: false, error: assignmentPatch.error });

    const workflowBody = { ...body, assignedStaff: assignmentPatch.assignedStaff, actorUserId: adminUser.userId, productionStartedBy: adminUser.userId };
    const result = buildOpsWorkflowUpdates(String(body.action || ""), workflowBody, workflowInquiry, now);
    if (!result.ok) return sendJson(response, 400, { ok: false, error: result.error });
    if (assignmentPatch.hasAssignment) Object.assign(result.updates, assignmentPatch.updates);
    if (result.noop) return sendJson(response, 200, { ok: true, inquiry: toClientInquiry(inquiry) });

    const { data: updated, error: updateError } = await supabase
      .from("ops_inquiries")
      .update({ ...result.updates, updated_at: now })
      .eq("id", inquiryReference)
      .select(WORKFLOW_SELECT)
      .single();
    if (updateError) throw updateError;

    sendJson(response, 200, { ok: true, inquiry: toClientInquiry(updated) });
  } catch (error) {
    if (error instanceof NativeOrderError) {
      return sendJson(response, error.status, { ok: false, error: error.message, code: error.code });
    }
    console.error("Admin workflow update failed.", { message: error?.message, code: error?.code });
    const schemaMissing = /orders|production_stage|production_started_at|production_started_by|production_completed_at|production_completed_by|qc_started_at|qc_completed_at|qc_note|assigned_staff|assigned_user_id|blocked_reason|schema cache|could not find/i.test(String(error?.message || ""));
    const missingMessage = nativeOrderRequest ? "native orders table is not ready" : "workflow fields are not ready";
    sendJson(response, schemaMissing ? 503 : 500, { ok: false, error: schemaMissing ? missingMessage : "workflow update failed" });
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
    dueDate: row.due_date,
    quoteStatus: row.quote_status,
    artworkStatus: row.artwork_status,
    paymentStatus: row.payment_status,
    paymentConfirmedAmount: numberOrNull(row.payment_confirmed_amount),
    paymentVerifiedAmount: numberOrNull(row.payment_verified_amount),
    assignedStaff: row.assigned_staff,
    assignedUserId: row.assigned_user_id,
    productionStage: row.production_stage,
    productionNote: row.production_note,
    productionUpdatedAt: row.production_updated_at,
    productionStartedAt: row.production_started_at,
    productionStartedBy: row.production_started_by,
    productionCompletedAt: row.production_completed_at,
    productionCompletedBy: row.production_completed_by,
    qcStartedAt: row.qc_started_at,
    qcStartedBy: row.qc_started_by,
    qcNote: row.qc_note,
    qcCompletedAt: row.qc_completed_at,
    qcCompletedBy: row.qc_completed_by,
    blockedReason: row.blocked_reason,
  };
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function buildAssignmentPatch(supabase, body, inquiry, adminUser) {
  const action = String(body.action || "");
  if (!["save_production", "advance_production"].includes(action)) {
    return { ok: true, hasAssignment: false, assignedStaff: body.assignedStaff };
  }

  if (!Object.prototype.hasOwnProperty.call(body, "assignedUserId")) {
    if (Object.prototype.hasOwnProperty.call(body, "assignedStaff") && String(body.assignedStaff || "").trim()) {
      return { ok: false, error: "assigned staff must be selected from active admin users" };
    }
    return { ok: true, hasAssignment: false, assignedStaff: inquiry?.assigned_staff || "" };
  }

  if (body.assignedUserId === null || body.assignedUserId === "") {
    return { ok: true, hasAssignment: true, assignedStaff: "", updates: { assigned_user_id: null } };
  }

  const target = await validateAssignmentUser(supabase, body.assignedUserId, adminUser);
  if (!target) return { ok: false, error: "assigned staff is unavailable" };
  return {
    ok: true,
    hasAssignment: true,
    assignedStaff: assignmentLabel(target),
    updates: { assigned_user_id: target.userId },
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
  const match = url.pathname.match(/^\/api\/inquiries\/([^/]+)\/(?:workflow|orders)\/?$/);
  return match ? decodeURIComponent(match[1]).trim().toUpperCase() : "";
}

function isNativeOrderRequest(request) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  return url.pathname.match(/^\/api\/inquiries\/[^/]+\/orders\/?$/)
    || url.searchParams.get("_nativeOrderAction") === "convert";
}

function getBearerToken(request) {
  return String(request.headers.authorization || request.headers.Authorization || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}

function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}
