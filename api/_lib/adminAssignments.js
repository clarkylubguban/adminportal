const ASSIGNMENT_ROLES = ["owner", "admin", "staff"];
const ROLE_RANK = new Map(ASSIGNMENT_ROLES.map((role, index) => [role, index]));

export async function listAssignmentUsers(supabase, caller = null, { moduleKey = "" } = {}) {
  let { data, error } = await supabase
    .from("admin_users")
    .select("id,user_id,email,display_name,role,access_role_key,is_active,is_test")
    .eq("is_active", true)
    .or("is_test.is.null,is_test.eq.false")
    .in("role", ASSIGNMENT_ROLES);

  if (isMissingColumnError(error, "access_role_key")) {
    ({ data, error } = await supabase
      .from("admin_users")
      .select("id,user_id,email,display_name,role,is_active,is_test")
      .eq("is_active", true)
      .or("is_test.is.null,is_test.eq.false")
      .in("role", ASSIGNMENT_ROLES));
  }
  if (error) throw error;

  let users = (data || [])
    .map(toAssignmentUser)
    .filter((user) => canAssignToUser(caller, user));

  const normalizedModule = normalizeKey(moduleKey);
  if (normalizedModule) {
    const accessByRole = await getModuleAccessByRole(supabase, normalizedModule);
    const temporaryAccess = await getTemporaryModuleAccess(supabase, normalizedModule, users.map((user) => user.userId));
    users = users.filter((user) => accessByRole.get(user.accessRoleKey) === true || temporaryAccess.has(user.userId));
  }

  return users.sort(compareAssignmentUsers);
}

export async function validateAssignmentUser(supabase, userId, caller = null, { moduleKey = "" } = {}) {
  const normalized = normalizeUuid(userId);
  if (!normalized) return null;

  let { data, error } = await supabase
    .from("admin_users")
    .select("id,user_id,email,display_name,role,access_role_key,is_active,is_test")
    .eq("user_id", normalized)
    .eq("is_active", true)
    .or("is_test.is.null,is_test.eq.false")
    .in("role", ASSIGNMENT_ROLES)
    .maybeSingle();

  if (isMissingColumnError(error, "access_role_key")) {
    ({ data, error } = await supabase
      .from("admin_users")
      .select("id,user_id,email,display_name,role,is_active,is_test")
      .eq("user_id", normalized)
      .eq("is_active", true)
      .or("is_test.is.null,is_test.eq.false")
      .in("role", ASSIGNMENT_ROLES)
      .maybeSingle());
  }
  if (error) throw error;
  if (!data?.user_id) return null;
  const user = toAssignmentUser(data);
  if (!canAssignToUser(caller, user)) return null;
  const normalizedModule = normalizeKey(moduleKey);
  if (!normalizedModule) return user;
  const accessByRole = await getModuleAccessByRole(supabase, normalizedModule);
  if (accessByRole.get(user.accessRoleKey) === true) return user;
  const temporaryAccess = await getTemporaryModuleAccess(supabase, normalizedModule, [user.userId]);
  return temporaryAccess.has(user.userId) ? user : null;
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
    accessRoleKey: normalizeKey(row.access_role_key || legacyRoleToAccessRole(role)),
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

function legacyRoleToAccessRole(role) {
  switch (normalizeRole(role)) {
    case "owner":
      return "owner_admin";
    case "admin":
      return "admin_operations";
    case "staff":
      return "cashier_front_desk";
    default:
      return "";
  }
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

async function getModuleAccessByRole(supabase, moduleKey) {
  const { data, error } = await supabase
    .from("admin_role_module_permissions")
    .select("role_key,can_access")
    .eq("module_key", moduleKey);
  if (error) throw error;
  return new Map((data || []).map((row) => [normalizeKey(row.role_key), row.can_access === true]));
}

async function getTemporaryModuleAccess(supabase, moduleKey, userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Set();

  const { data, error } = await supabase
    .from("admin_temporary_module_access")
    .select("user_id,module_key,expires_at,revoked_at")
    .eq("module_key", moduleKey)
    .in("user_id", ids)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());

  if (isMissingRelationError(error)) return new Set();
  if (error) throw error;
  return new Set((data || []).map((row) => row.user_id).filter(Boolean));
}

function isMissingColumnError(error, columnName) {
  if (!error) return false;
  return error.code === "42703" || String(error.message || "").includes(columnName);
}

function isMissingRelationError(error) {
  return error?.code === "42P01" || /does not exist|schema cache/i.test(String(error?.message || ""));
}
