import { createServerSupabaseClient } from "../supabaseServer.js";
import {
  allowedUpdateRole,
  canManageTarget,
  canUseStaffAccess,
  cleanText,
  countActiveOwners,
  getAuthorizedAdmin,
  getBearerToken,
  listAuthUsersById,
  normalizeRole,
  readJsonBody,
  sanitizeAdminUser,
  sendJson,
} from "../adminAccess.js";

export default async function handler(request, response) {
  if (request.method !== "PATCH") return sendJson(response, 405, { ok: false, error: "method not allowed" });

  const token = getBearerToken(request);
  if (!token) return sendJson(response, 401, { ok: false, error: "admin session required" });

  try {
    const supabase = createServerSupabaseClient();
    const caller = await getAuthorizedAdmin(supabase, token);
    if (!caller) return sendJson(response, 401, { ok: false, error: "admin session required" });
    if (!canUseStaffAccess(caller)) return sendJson(response, 403, { ok: false, error: "staff access is restricted" });

    const targetId = getTargetId(request);
    if (!targetId) return sendJson(response, 400, { ok: false, error: "target account is required" });

    const { data: targetRow, error: targetError } = await supabase
      .from("admin_users")
      .select("id,user_id,email,display_name,role,is_active,created_at,updated_at")
      .eq("id", targetId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!targetRow) return sendJson(response, 404, { ok: false, error: "staff account not found" });

    const target = { ...targetRow, role: normalizeRole(targetRow.role) };
    if (!canManageTarget(caller, target)) return sendJson(response, 403, { ok: false, error: "account is not manageable" });

    const body = await readJsonBody(request);
    const action = cleanText(body.action, 40);
    const updates = { updated_at: new Date().toISOString() };

    if (action === "disable") {
      if (target.user_id === caller.userId) return sendJson(response, 403, { ok: false, error: "you cannot disable your own account" });
      if (target.role === "owner" && target.is_active !== false && await countActiveOwners(supabase) <= 1) {
        return sendJson(response, 403, { ok: false, error: "last active owner cannot be disabled" });
      }
      updates.is_active = false;
    } else if (action === "activate") {
      updates.is_active = true;
    } else if (action === "update") {
      const displayName = cleanText(body.displayName, 120);
      if (!displayName) return sendJson(response, 400, { ok: false, error: "display name is required" });
      updates.display_name = displayName;
      if (body.role !== undefined) {
        const nextRole = allowedUpdateRole(caller, target, body.role);
        if (!nextRole) return sendJson(response, 403, { ok: false, error: "role change is not permitted" });
        if (target.role === "owner" && nextRole !== "owner" && target.is_active !== false && await countActiveOwners(supabase) <= 1) {
          return sendJson(response, 403, { ok: false, error: "last active owner cannot be demoted" });
        }
        updates.role = nextRole;
      }
    } else {
      return sendJson(response, 400, { ok: false, error: "invalid staff account action" });
    }

    const { data: updated, error: updateError } = await supabase
      .from("admin_users")
      .update(updates)
      .eq("id", targetId)
      .select("id,user_id,email,display_name,role,is_active,created_at,updated_at")
      .single();
    if (updateError) throw updateError;

    const authUsers = await listAuthUsersById(supabase, [updated.user_id]);
    return sendJson(response, 200, { ok: true, user: sanitizeAdminUser(updated, authUsers.get(updated.user_id)) });
  } catch (error) {
    console.error("Staff account update failed.", { message: error?.message, code: error?.code, status: error?.status || error?.statusCode });
    return sendJson(response, 500, { ok: false, error: "staff account update failed" });
  }
}

function getTargetId(request) {
  const queryId = Array.isArray(request.query?.id) ? request.query.id[0] : request.query?.id;
  if (queryId) return String(queryId).trim();
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const match = url.pathname.match(/^\/api\/admin-users\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]).trim() : "";
}