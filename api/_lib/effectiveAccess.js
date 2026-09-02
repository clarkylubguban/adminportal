import { cleanText, normalizeRole } from "./adminAccess.js";
import { isGrantActive } from "./employeeTemporaryAccess.js";
import { TaskApiError } from "./taskApi.js";

export const EFFECTIVE_ACCESS_MODULES = new Set(["calendar", "workboard", "master_catalog", "inquiries", "orders", "production", "design_artwork", "inventory", "purchasing_suppliers", "pos_sales"]);

const PERMANENT_MODULE_ROLES = new Map([
  ["calendar", new Set(["owner", "admin"])],
  ["workboard", new Set(["owner", "admin"])],
  ["master_catalog", new Set(["owner", "admin"])],
  ["inquiries", new Set(["owner", "admin"])],
  ["orders", new Set(["owner", "admin"])],
  ["production", new Set(["owner", "admin"])],
  ["design_artwork", new Set(["owner", "admin"])],
  ["inventory", new Set(["owner", "admin"])],
  ["purchasing_suppliers", new Set(["owner", "admin"])],
  ["pos_sales", new Set(["owner", "admin"])],
]);

export function hasPermanentModuleAccess(actor, moduleCode) {
  const module = normalizeEffectiveModule(moduleCode);
  return Boolean(PERMANENT_MODULE_ROLES.get(module)?.has(normalizeRole(actor?.role)));
}

export async function getEffectiveModuleAccess(supabase, actor, moduleCode, now = new Date()) {
  const module = normalizeEffectiveModule(moduleCode);
  if (!EFFECTIVE_ACCESS_MODULES.has(module)) {
    return { module, allowed: false, source: "none", expiresAt: null };
  }

  if (hasPermanentModuleAccess(actor, module)) {
    return { module, allowed: true, source: "permanent", expiresAt: null };
  }

  if (normalizeRole(actor?.role) !== "staff" || !actor?.id) {
    return { module, allowed: false, source: "none", expiresAt: null };
  }

  const { data, error } = await supabase
    .from("employee_temporary_access_grants")
    .select("id,module_code,starts_at,expires_at,revoked_at")
    .eq("employee_id", actor.id)
    .eq("module_code", module)
    .lte("starts_at", now.toISOString())
    .gt("expires_at", now.toISOString())
    .is("revoked_at", null)
    .order("expires_at", { ascending: true })
    .limit(1);

  if (error) throw error;

  const grant = (data || []).find((row) => isGrantActive(row, now));
  return grant
    ? { module, allowed: true, source: "temporary", expiresAt: grant.expires_at }
    : { module, allowed: false, source: "none", expiresAt: null };
}

export async function requireEffectiveModuleAccess(supabase, actor, moduleCode, now = new Date()) {
  const access = await getEffectiveModuleAccess(supabase, actor, moduleCode, now);
  if (!access.allowed) {
    throw new TaskApiError("FORBIDDEN", 403, `${formatModuleLabel(access.module)} access is restricted.`);
  }
  return access;
}

export function normalizeEffectiveModule(value) {
  return cleanText(value, 80).toLowerCase();
}

function formatModuleLabel(moduleCode) {
  if (moduleCode === "calendar") return "Calendar";
  if (moduleCode === "workboard") return "Workboard";
  if (moduleCode === "master_catalog") return "Master Catalog";
  if (moduleCode === "inquiries") return "Inquiries";
  if (moduleCode === "orders") return "Orders";
  if (moduleCode === "production") return "Production";
  if (moduleCode === "design_artwork") return "Design & Artwork";
  if (moduleCode === "inventory") return "Inventory";
  if (moduleCode === "purchasing_suppliers") return "Purchasing & Suppliers";
  if (moduleCode === "pos_sales") return "POS / Sales";
  return "Module";
}
