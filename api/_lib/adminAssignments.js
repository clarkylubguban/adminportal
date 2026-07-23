const ASSIGNMENT_ROLES = ["owner", "admin", "staff"];
const ROLE_RANK = new Map(ASSIGNMENT_ROLES.map((role, index) => [role, index]));

export async function listAssignmentUsers(supabase) {
  const { data, error } = await supabase
    .from("admin_users")
    .select("id,user_id,email,display_name,role,is_active,is_test")
    .eq("is_active", true)
    .eq("is_test", false)
    .in("role", ASSIGNMENT_ROLES);

  if (error) throw error;

  return (data || [])
    .filter((row) => row.user_id && ASSIGNMENT_ROLES.includes(normalizeRole(row.role)))
    .map(toAssignmentUser)
    .sort(compareAssignmentUsers);
}

export async function validateAssignmentUser(supabase, userId) {
  const normalized = normalizeUuid(userId);
  if (!normalized) return null;

  const { data, error } = await supabase
    .from("admin_users")
    .select("id,user_id,email,display_name,role,is_active,is_test")
    .eq("user_id", normalized)
    .eq("is_active", true)
    .eq("is_test", false)
    .in("role", ASSIGNMENT_ROLES)
    .maybeSingle();

  if (error) throw error;
  if (!data?.user_id) return null;
  return toAssignmentUser(data);
}

export function assignmentLabel(user) {
  return user?.displayName || user?.email || "";
}

export function normalizeUuid(value) {
  const text = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text.toLowerCase()
    : "";
}

function toAssignmentUser(row) {
  const role = normalizeRole(row.role);
  return {
    adminUserId: row.id,
    userId: row.user_id,
    displayName: String(row.display_name || "").trim(),
    email: String(row.email || "").trim(),
    role,
  };
}

function compareAssignmentUsers(a, b) {
  return (ROLE_RANK.get(a.role) ?? 99) - (ROLE_RANK.get(b.role) ?? 99)
    || assignmentLabel(a).localeCompare(assignmentLabel(b), undefined, { sensitivity: "base" })
    || a.email.localeCompare(b.email, undefined, { sensitivity: "base" });
}

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}
