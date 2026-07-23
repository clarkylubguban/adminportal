import { createServerSupabaseClient } from "../_lib/supabaseServer.js";
import {
  allowedCreateRole,
  canUseStaffAccess,
  cleanEmail,
  cleanText,
  findAuthUserByEmail,
  getAuthorizedAdmin,
  getBearerToken,
  isValidEmail,
  listAuthUsersById,
  readJsonBody,
  sanitizeAdminUser,
  sendJson,
} from "../_lib/adminAccess.js";

export default async function handler(request, response) {
  const token = getBearerToken(request);
  if (!token) return sendJson(response, 401, { ok: false, error: "admin session required" });

  try {
    const supabase = createServerSupabaseClient();
    const caller = await getAuthorizedAdmin(supabase, token);
    if (!caller) return sendJson(response, 401, { ok: false, error: "admin session required" });
    if (!canUseStaffAccess(caller)) return sendJson(response, 403, { ok: false, error: "staff access is restricted" });

    if (request.method === "GET") return handleList(request, response, supabase, caller);
    if (request.method === "POST") return handleCreate(request, response, supabase, caller);
    return sendJson(response, 405, { ok: false, error: "method not allowed" });
  } catch (error) {
    console.error("Staff access request failed.", { message: error?.message, code: error?.code, status: error?.status || error?.statusCode });
    return sendJson(response, 500, { ok: false, error: "staff access request failed" });
  }
}

async function handleList(request, response, supabase, caller) {
  let query = supabase
    .from("admin_users")
    .select("id,user_id,email,display_name,role,is_active,created_at,updated_at")
    .in("role", ["owner", "admin", "staff"])
    .order("created_at", { ascending: false });

  if (caller.role === "admin") query = query.eq("role", "staff");

  const { data, error } = await query;
  if (error) throw error;

  const authUsers = await listAuthUsersById(supabase, (data || []).map((row) => row.user_id));
  return sendJson(response, 200, {
    ok: true,
    users: (data || []).map((row) => sanitizeAdminUser(row, authUsers.get(row.user_id))),
    permissions: getClientPermissions(caller),
  });
}

async function handleCreate(request, response, supabase, caller) {
  const body = await readJsonBody(request);
  const displayName = cleanText(body.displayName, 120);
  const email = cleanEmail(body.email);
  const role = allowedCreateRole(caller, body.role);

  if (!displayName) return sendJson(response, 400, { ok: false, error: "display name is required" });
  if (!isValidEmail(email)) return sendJson(response, 400, { ok: false, error: "valid email is required" });
  if (!role) return sendJson(response, 403, { ok: false, error: "role is not permitted" });

  const existingProfile = await supabase.from("admin_users").select("id").ilike("email", email).maybeSingle();
  if (existingProfile.error) throw existingProfile.error;
  if (existingProfile.data) return sendJson(response, 409, { ok: false, error: "email already has admin access" });

  const existingAuth = await findAuthUserByEmail(supabase, email);
  if (existingAuth) return sendJson(response, 409, { ok: false, error: "email already has an auth account" });

  const redirectTo = getInviteRedirectUrl(request);
  const { data: invited, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: { display_name: displayName, trry_admin_role: role },
    redirectTo,
  });

  if (inviteError || !invited?.user?.id) {
    if (invited?.user?.id) await rollbackInvitedAuthUser(supabase, invited.user.id);
    console.error("Staff invite failed.", { message: inviteError?.message, status: inviteError?.status, code: inviteError?.code, redirectTo });
    return sendJson(response, getInviteErrorStatus(inviteError), { ok: false, error: getInviteErrorMessage(inviteError) });
  }

  const now = new Date().toISOString();
  const { data: profile, error: insertError } = await supabase
    .from("admin_users")
    .insert({ user_id: invited.user.id, email, display_name: displayName, role, is_active: true, updated_at: now })
    .select("id,user_id,email,display_name,role,is_active,created_at,updated_at")
    .single();

  if (insertError) {
    await rollbackInvitedAuthUser(supabase, invited.user.id);
    console.error("Staff profile creation failed after invite.", { message: insertError.message, code: insertError.code });
    return sendJson(response, 500, { ok: false, error: "staff profile could not be created; invitation was rolled back" });
  }

  return sendJson(response, 201, {
    ok: true,
    user: sanitizeAdminUser(profile, invited.user),
    inviteSent: true,
  });
}

async function rollbackInvitedAuthUser(supabase, userId) {
  try {
    await supabase.from("admin_users").delete().eq("user_id", userId);
    await supabase.auth.admin.deleteUser(userId);
  } catch (error) {
    console.error("Staff invite rollback failed.", { message: error?.message, userId });
  }
}

function getInviteErrorStatus(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  if (status === 400 || status === 409 || status === 422 || status === 429) return status;
  return 503;
}

function getInviteErrorMessage(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();

  if (code.includes("email_address_invalid") || message.includes("email address") && message.includes("invalid")) {
    return "valid staff email is required";
  }

  if (message.includes("redirect") || message.includes("not allowed")) {
    return "staff invite redirect URL is not allowed";
  }

  if (String(error?.status || "") === "429" || message.includes("rate limit")) {
    return "staff invite rate limit reached; try again later";
  }

  if (code.includes("bad_jwt") || message.includes("invalid jwt") || message.includes("unrecognized jwt")) {
    return "staff invite service is not configured; check the Supabase server key";
  }

  if (message.includes("smtp") || message.includes("provider") || message.includes("sender") || message.includes("send")) {
    return "staff invite email could not be sent; check Supabase email delivery";
  }

  return "staff invite email could not be sent";
}
function getInviteRedirectUrl(request) {
  const configured = String(process.env.ADMIN_INVITE_REDIRECT_URL || "").trim();
  if (configured) return configured;

  const host = request.headers["x-forwarded-host"] || request.headers.host || "admin.trryapparel.com";
  const proto = request.headers["x-forwarded-proto"] || "https";
  const origin = String(host).includes("localhost") ? `http://${host}` : `${proto}://${host}`;
  return `${origin.replace(/\/$/, "")}/set-password`;
}
function getClientPermissions(caller) {
  return {
    role: caller.role,
    canCreateRoles: caller.role === "owner" ? ["admin", "staff"] : caller.role === "admin" ? ["staff"] : [],
  };
}