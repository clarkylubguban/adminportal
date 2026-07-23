import { assignmentLabel, normalizeUuid, validateAssignmentUser } from "../../_lib/adminAssignments.js";
import { getAuthorizedAdmin, getBearerToken, readJsonBody, sendJson } from "../../_lib/adminAccess.js";
import { createServerSupabaseClient } from "../../_lib/supabaseServer.js";

const WRITE_ROLES = new Set(["owner", "admin", "staff"]);
const SELECT_FIELDS = "id,owner_id,owner_user_id,follow_up_date,updated_at";

export default async function handler(request, response) {
  const inquiryReference = getInquiryReference(request);
  if (!/^[A-Z0-9][A-Z0-9_-]{2,79}$/.test(inquiryReference)) return sendJson(response, 400, { ok: false, error: "invalid inquiry reference" });
  if (request.method !== "PATCH") return sendJson(response, 405, { ok: false, error: "method not allowed" });

  const token = getBearerToken(request);
  if (!token) return sendJson(response, 401, { ok: false, error: "admin session required" });

  try {
    const supabase = createServerSupabaseClient();
    const caller = await getAuthorizedAdmin(supabase, token);
    if (!caller) return sendJson(response, 401, { ok: false, error: "admin session required" });
    if (!WRITE_ROLES.has(caller.role)) return sendJson(response, 403, { ok: false, error: "assignment update is restricted" });

    const body = await readJsonBody(request);
    const updates = { updated_at: new Date().toISOString() };

    if (Object.prototype.hasOwnProperty.call(body, "ownerUserId")) {
      if (body.ownerUserId === null || body.ownerUserId === "") {
        updates.owner_user_id = null;
        updates.owner_id = null;
      } else {
        const target = await validateAssignmentUser(supabase, body.ownerUserId);
        if (!target) return sendJson(response, 400, { ok: false, error: "assigned owner is unavailable" });
        updates.owner_user_id = target.userId;
        updates.owner_id = assignmentLabel(target) || null;
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, "followUpDate")) {
      updates.follow_up_date = normalizeDate(body.followUpDate);
    }

    const { data, error } = await supabase
      .from("ops_inquiries")
      .update(updates)
      .eq("id", inquiryReference)
      .select(SELECT_FIELDS)
      .single();

    if (error) throw error;
    return sendJson(response, 200, { ok: true, inquiry: toClientInquiry(data) });
  } catch (error) {
    console.error("Assignment update failed.", { message: error?.message, code: error?.code });
    return sendJson(response, 500, { ok: false, error: "assignment update failed" });
  }
}

function toClientInquiry(row) {
  return {
    id: row.id,
    owner: row.owner_id,
    ownerId: row.owner_id,
    ownerUserId: row.owner_user_id,
    followUpDate: normalizeDate(row.follow_up_date),
    updatedAt: row.updated_at,
  };
}

function normalizeDate(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

function getInquiryReference(request) {
  const queryId = Array.isArray(request.query?.id) ? request.query.id[0] : request.query?.id;
  if (queryId) return String(queryId).trim().toUpperCase();
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const match = url.pathname.match(/^\/api\/inquiries\/([^/]+)\/assignment\/?$/);
  return match ? decodeURIComponent(match[1]).trim().toUpperCase() : "";
}
