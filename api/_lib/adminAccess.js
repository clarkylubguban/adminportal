export async function getAuthorizedAdmin(supabase, token) {
  if (!token) return null;

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) return null;

  const { data, error } = await supabase
    .from("admin_users")
    .select("id,user_id,email,display_name,role,is_active")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (error) throw error;
  if (!data || data.is_active === false) return null;

  const role = normalizeRole(data.role);
  if (!new Set(["owner", "admin", "staff"]).has(role)) return null;

  return {
    id: data.id,
    userId: data.user_id,
    email: data.email || userData.user.email || "",
    displayName: data.display_name || "",
    role,
    isActive: data.is_active !== false,
  };
}

export function getBearerToken(request) {
  return String(request.headers.authorization || request.headers.Authorization || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}

export async function readJsonBody(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) return request.body;
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return {}; }
}

export function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export function sanitizeAdminUser(row, authUser = null) {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email || authUser?.email || "",
    displayName: row.display_name || "",
    role: normalizeRole(row.role),
    isActive: row.is_active !== false,
    createdAt: row.created_at || authUser?.created_at || null,
    updatedAt: row.updated_at || null,
    lastSignInAt: authUser?.last_sign_in_at || null,
  };
}

export function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

export function cleanText(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

export function cleanEmail(value) {
  return cleanText(value, 254).toLowerCase();
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

export function canUseStaffAccess(adminUser) {
  return ["owner", "admin"].includes(adminUser?.role);
}

export function canManageTarget(caller, target) {
  if (!caller || !target) return false;
  if (caller.role === "owner") return true;
  if (caller.role === "admin") return target.role === "staff" && target.user_id !== caller.userId;
  return false;
}

export function allowedCreateRole(caller, requestedRole) {
  const role = normalizeRole(requestedRole);
  if (caller?.role === "owner") return ["admin", "staff"].includes(role) ? role : "";
  if (caller?.role === "admin") return role === "staff" ? "staff" : "";
  return "";
}

export function allowedUpdateRole(caller, target, requestedRole) {
  const role = normalizeRole(requestedRole);
  if (!role) return "";
  if (caller?.role === "owner") {
    if (target.role === "owner") return role === "owner" ? "owner" : "";
    return ["admin", "staff"].includes(role) ? role : "";
  }
  if (caller?.role === "admin") return target.role === "staff" && role === "staff" ? "staff" : "";
  return "";
}

export async function countActiveOwners(supabase) {
  const { count, error } = await supabase
    .from("admin_users")
    .select("id", { count: "exact", head: true })
    .eq("role", "owner")
    .eq("is_active", true);
  if (error) throw error;
  return count || 0;
}

export async function listAuthUsersById(supabase, userIds) {
  const ids = new Set(userIds.filter(Boolean));
  const users = new Map();
  if (!ids.size) return users;

  try {
    for (let page = 1; page <= 20 && ids.size; page += 1) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      for (const user of data?.users || []) {
        if (ids.has(user.id)) {
          users.set(user.id, user);
          ids.delete(user.id);
        }
      }
      if ((data?.users || []).length < 1000) break;
    }
  } catch (error) {
    console.error("Staff auth metadata lookup failed.", { message: error?.message, code: error?.code, status: error?.status || error?.statusCode });
  }

  return users;
}

export async function findAuthUserByEmail(supabase, email) {
  const normalized = cleanEmail(email);
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const match = (data?.users || []).find((user) => cleanEmail(user.email) === normalized);
    if (match) return match;
    if ((data?.users || []).length < 1000) break;
  }
  return null;
}