import { readSupabaseTableWithAuth } from "../lib/supabaseClient.js";

// Database schema, RLS policies, and initial admin setup
// must be managed directly in Supabase.
export const ADMIN_USERS_SQL = null;

const allowedRoles = new Set([
  "admin",
  "staff",
  "viewer",
]);

export async function getApprovedAdminUser(session) {
  if (!session?.user?.id || !session?.access_token) {
    return null;
  }

  const rows = await readSupabaseTableWithAuth(
    "admin_users",
    {
      select: "id,user_id,email,role",
      user_id: `eq.${session.user.id}`,
      limit: "1",
    },
    session.access_token
  );

  const adminUser = rows[0] ?? null;

  if (
    !adminUser ||
    !allowedRoles.has(adminUser.role)
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
    role: adminUser.role,
  };
}