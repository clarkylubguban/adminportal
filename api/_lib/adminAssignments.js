const ASSIGNMENT_ROLES = ["owner", "admin", "staff"];
const ROLE_RANK = new Map(ASSIGNMENT_ROLES.map((role, index) => [role, index]));

export async function listAssignmentUsers(supabase, caller = null) {
  const { data, error } = await supabase
    .from("admin_users")
    .select("id,user_id,email,display_name,role,is_active,is_test")
    .eq("is_active", true)
    .or("is_test.is.null,is_test.eq.false")
    .in("role", ASSIGNMENT_ROLES);

  if (error) throw error;

  return (data || [])
    .map(toAssignmentUser)
    .filter((user) => canAssignToUser(caller, user))
    .sort(compareAssignmentUsers);
}

export async function validateAssignmentUser(supabase, userId, caller = null) {
  const normalized = normalizeUuid(userId);
  if (!normalized) return null;

  const { data, error } = await supabase
    .from("admin_users")
    .select("id,user_id,email,display_name,role,is_active,is_test")
    .eq("user_id", normalized)
    .eq("is_active", true)
    .or("is_test.is.null,is_test.eq.false")
    .in("role", ASSIGNMENT_ROLES)
    .maybeSingle();

  if (error) throw error;
  if (!data?.user_id) return null;
  const user = toAssignmentUser(data);
  return canAssignToUser(caller, user) ? user : null;
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
    isActive: row.is_active !== false,
    assignmentEligible: row.is_active !== false && row.is_test !== true,
  };
}

function compareAssignmentUsers(a, b) {
  return (ROLE_RANK.get(a.role) ?? 99) - (ROLE_RANK.get(b.role) ?? 99)
    || assignmentLabel(a).localeCompare(assignmentLabel(b), undefined, { sensitivity: "base" })
    || a.email.localeCompare(b.email, undefined, { sensitivity: "base" });
}

function canAssignToUser(caller, target) {
  const callerRole = normalizeRole(caller?.role);
  const targetRole = normalizeRole(target?.role);
  if (target.assignmentEligible === false) return false;
  if (!target?.userId || !ASSIGNMENT_ROLES.includes(targetRole)) return false;
  if (callerRole === "owner") return true;
  if (callerRole === "admin") return targetRole === "staff";
  if (callerRole === "staff") return target.userId === caller?.userId;
  return false;
}

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}
