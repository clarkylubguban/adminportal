import { getAuthorizedAdmin, getBearerToken, readJsonBody, sendJson } from "../../_lib/adminAccess.js";
import { createServerSupabaseClient } from "../../_lib/supabaseServer.js";

const WRITE_ROLES = new Set(["owner", "admin", "staff"]);
const OUTCOMES = new Set(["no_response", "customer_considering", "customer_replied_action_needed"]);
const DATE_REQUIRED_OUTCOMES = new Set(["no_response", "customer_considering"]);
const INQUIRY_SELECT = "id,status,quote_status,odoo_so,follow_up_date,updated_at";
const EVENT_SELECT = "id,inquiry_id,outcome,note,next_follow_up_date,created_by_user_id,created_at";

export default async function handler(request, response) {
  const inquiryReference = getInquiryReference(request);
  if (!/^[A-Z0-9][A-Z0-9_-]{2,79}$/.test(inquiryReference)) return sendJson(response, 400, { ok: false, error: "invalid inquiry reference" });
  if (!["GET", "POST"].includes(request.method)) return sendJson(response, 405, { ok: false, error: "method not allowed" });

  const token = getBearerToken(request);
  if (!token) return sendJson(response, 401, { ok: false, error: "admin session required" });

  try {
    const supabase = createServerSupabaseClient();
    const caller = await getAuthorizedAdmin(supabase, token);
    if (!caller) return sendJson(response, 401, { ok: false, error: "admin session required" });
    if (!WRITE_ROLES.has(caller.role)) return sendJson(response, 403, { ok: false, error: "follow-up access is restricted" });

    if (request.method === "GET") {
      const events = await listEvents(supabase, inquiryReference);
      return sendJson(response, 200, { ok: true, events });
    }

    const body = await readJsonBody(request);
    const outcome = normalizeOutcome(body.outcome);
    const note = cleanText(body.note, 2000);
    const nextFollowUpDate = normalizeDate(body.nextFollowUpDate);

    if (!OUTCOMES.has(outcome)) return sendJson(response, 400, { ok: false, error: "select a follow-up result" });
    if (!note) return sendJson(response, 400, { ok: false, error: "follow-up note is required" });
    if (DATE_REQUIRED_OUTCOMES.has(outcome) && !nextFollowUpDate) return sendJson(response, 400, { ok: false, error: "new follow-up date is required for this result" });

    const { data: inquiry, error: lookupError } = await supabase
      .from("ops_inquiries")
      .select(INQUIRY_SELECT)
      .eq("id", inquiryReference)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!inquiry) return sendJson(response, 404, { ok: false, error: "inquiry not found" });
    if (!canRecordFollowUp(inquiry)) return sendJson(response, 400, { ok: false, error: "follow-up recording is closed for this inquiry" });

    const now = new Date().toISOString();
    const { data: event, error: insertError } = await supabase
      .from("inquiry_follow_up_events")
      .insert({
        inquiry_id: inquiryReference,
        outcome,
        note,
        next_follow_up_date: nextFollowUpDate,
        created_by_user_id: caller.userId,
      })
      .select(EVENT_SELECT)
      .single();
    if (insertError) throw insertError;

    const { data: updated, error: updateError } = await supabase
      .from("ops_inquiries")
      .update({ follow_up_date: nextFollowUpDate || null, updated_at: now })
      .eq("id", inquiryReference)
      .select(INQUIRY_SELECT)
      .single();
    if (updateError) throw updateError;

    const savedEvent = toClientEvent(event, caller);
    const events = await listEvents(supabase, inquiryReference, { [savedEvent.createdByUserId]: caller });
    return sendJson(response, 200, {
      ok: true,
      event: savedEvent,
      events,
      inquiry: {
        id: updated.id,
        followUpDate: normalizeDate(updated.follow_up_date),
        updatedAt: updated.updated_at,
      },
    });
  } catch (error) {
    console.error("Follow-up event update failed.", { message: error?.message, code: error?.code });
    const schemaMissing = /inquiry_follow_up_events|schema cache|could not find|42p01/i.test(String(error?.message || ""));
    return sendJson(response, schemaMissing ? 503 : 500, { ok: false, error: schemaMissing ? "follow-up event table is not ready" : "follow-up update failed" });
  }
}

async function listEvents(supabase, inquiryReference, knownUsers = {}) {
  const { data, error } = await supabase
    .from("inquiry_follow_up_events")
    .select(EVENT_SELECT)
    .eq("inquiry_id", inquiryReference)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const userIds = [...new Set((data || []).map((event) => event.created_by_user_id).filter(Boolean))];
  const users = await loadAdminUsers(supabase, userIds, knownUsers);
  return (data || []).map((event) => toClientEvent(event, users[event.created_by_user_id]));
}

async function loadAdminUsers(supabase, userIds, knownUsers = {}) {
  const users = { ...knownUsers };
  const missing = userIds.filter((id) => !users[id]);
  if (!missing.length) return users;
  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id,email,display_name,role")
    .in("user_id", missing);
  if (error) throw error;
  for (const row of data || []) users[row.user_id] = { userId: row.user_id, email: row.email, displayName: row.display_name, role: row.role };
  return users;
}

function toClientEvent(row, adminUser = null) {
  const staffName = adminUser?.displayName || adminUser?.email || "Staff";
  return {
    id: row.id,
    inquiryId: row.inquiry_id,
    outcome: row.outcome,
    note: row.note,
    nextFollowUpDate: normalizeDate(row.next_follow_up_date),
    createdByUserId: row.created_by_user_id,
    createdByName: staffName,
    createdAt: row.created_at,
  };
}

function canRecordFollowUp(inquiry) {
  const status = normalizeKey(inquiry.status);
  if (["lost", "cancelled", "canceled", "won"].includes(status)) return false;
  if (String(inquiry.odoo_so || "").trim()) return false;
  return true;
}

function getInquiryReference(request) {
  const queryId = Array.isArray(request.query?.id) ? request.query.id[0] : request.query?.id;
  if (queryId) return String(queryId).trim().toUpperCase();
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const match = url.pathname.match(/^\/api\/inquiries\/([^/]+)\/follow-ups\/?$/);
  return match ? decodeURIComponent(match[1]).trim().toUpperCase() : "";
}

function normalizeOutcome(value) {
  return normalizeKey(value);
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizeDate(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

function cleanText(value, max) {
  return String(value ?? "").trim().slice(0, max);
}