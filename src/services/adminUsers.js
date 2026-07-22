import { readSupabaseTableWithAuth } from "../lib/supabaseClient.js";

// Database schema, RLS policies, and initial admin setup
// must be managed directly in Supabase.
export const ADMIN_USERS_SQL = null;

const allowedRoles = new Set([
  "owner",
  "admin",
  "staff",
]);

export async function getApprovedAdminUser(session) {
  if (!session?.user?.id || !session?.access_token) {
    return null;
  }

  const rows = await readAdminUserRows(session);
  const adminUser = rows[0] ?? null;
  const role = normalizeRole(adminUser?.role);

  if (
    !adminUser ||
    adminUser.is_active === false ||
    !allowedRoles.has(role)
  ) {
    return null;
  }

  return {
    id: adminUser.id,
    userId: adminUser.user_id,
    email:
      adminUser.email ||
      session.user.email ||
      "TRRY Admin",
    displayName: adminUser.display_name || "",
    role,
  };
}

async function readAdminUserRows(session) {
  try {
    return await readSupabaseTableWithAuth(
      "admin_users",
      {
        select: "id,user_id,email,display_name,role,is_active",
        user_id: `eq.${session.user.id}`,
        limit: "1",
      },
      session.access_token
    );
  } catch (error) {
    if (!isMissingAdminProfileColumn(error)) throw error;
    return readSupabaseTableWithAuth(
      "admin_users",
      {
        select: "id,user_id,email,role",
        user_id: `eq.${session.user.id}`,
        limit: "1",
      },
      session.access_token
    );
  }
}

function isMissingAdminProfileColumn(error) {
  return /display_name|is_active|42703|schema cache|could not find/i.test(String(error?.message || error || ""));
}

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}
