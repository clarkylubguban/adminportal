import {
  canManageTarget,
  canUseStaffAccess,
  cleanText,
  normalizeRole,
} from "./adminAccess.js";

export const TEMPORARY_ACCESS_MODULES = [
  ["production", "Production"],
  ["design_artwork", "Design & Artwork"],
  ["inventory", "Inventory"],
  ["purchasing_suppliers", "Purchasing / Suppliers"],
  ["pos_sales", "POS / Sales"],
  ["orders", "Orders"],
  ["inquiries", "Inquiries"],
  ["master_catalog", "Master Catalog"],
  ["workboard", "Workboard"],
  ["calendar", "Calendar"],
  ["pricing_discounts", "Pricing & Discounts"],
  ["people_access", "People & Access"],
];

export const PROTECTED_TEMPORARY_ACCESS_MODULES = new Set(["pricing_discounts", "people_access"]);
export const UNAVAILABLE_TEMPORARY_ACCESS_MODULES = new Map([
  ["pricing_discounts", "Pricing & Discounts temporary access is not available yet"],
  ["people_access", "People & Access is not available for temporary access"],
]);

const MODULE_CODE_SET = new Set(TEMPORARY_ACCESS_MODULES.map(([code]) => code));

export function normalizeModuleCodes(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map((item) => cleanText(item, 80)).filter(Boolean))];
}

export function validateModuleCodes(moduleCodes, caller) {
  const codes = normalizeModuleCodes(moduleCodes);
  if (!codes.length) return { ok: false, error: "at least one module is required", codes: [] };
  const invalid = codes.find((code) => !MODULE_CODE_SET.has(code));
  if (invalid) return { ok: false, error: "temporary access module is not permitted", codes: [] };
  const unavailable = codes.find((code) => UNAVAILABLE_TEMPORARY_ACCESS_MODULES.has(code));
  if (unavailable) return { ok: false, error: UNAVAILABLE_TEMPORARY_ACCESS_MODULES.get(unavailable), codes: [] };
  if (caller?.role !== "owner" && codes.some((code) => PROTECTED_TEMPORARY_ACCESS_MODULES.has(code))) {
    return { ok: false, error: "protected temporary access requires owner authority", codes: [] };
  }
  return { ok: true, error: "", codes };
}

export function getManilaBusinessDayWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const expiresAt = new Date(Date.UTC(year, month - 1, day + 1, -8, 0, 0, 0));
  return {
    startsAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

export function isGrantActive(grant, now = new Date()) {
  const current = now.getTime();
  return Boolean(
    grant &&
    !grant.revoked_at &&
    new Date(grant.starts_at).getTime() <= current &&
    current < new Date(grant.expires_at).getTime()
  );
}

export function assertTemporaryAccessTarget(caller, target) {
  if (!canUseStaffAccess(caller)) return "staff access is restricted";
  if (!target) return "employee account not found";
  const role = normalizeRole(target.role);
  if (target.is_active === false) return "temporary access target must be active";
  if (role !== "staff") return "temporary access target must be staff";
  if (target.user_id === caller?.userId || target.id === caller?.id) return "temporary access cannot be granted to your own account";
  if (!canManageTarget(caller, { ...target, role })) return "employee account is not manageable";
  return "";
}

export function summarizeTemporaryAccess(grants, now = new Date()) {
  const active = (grants || []).filter((grant) => isGrantActive(grant, now));
  const moduleCodes = [...new Set(active.map((grant) => grant.module_code).filter(Boolean))];
  const expiresAt = active.map((grant) => grant.expires_at).sort()[0] || null;
  return {
    active,
    moduleCodes,
    moduleCount: moduleCodes.length,
    expiresAt,
  };
}

export function shapeTemporaryGrant(row, usersById = new Map()) {
  const grantedBy = usersById.get(row.granted_by) || null;
  const revokedBy = usersById.get(row.revoked_by) || null;
  return {
    id: row.id,
    employeeId: row.employee_id,
    moduleCode: row.module_code,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    reason: row.reason || "",
    revokedAt: row.revoked_at || null,
    createdAt: row.created_at || null,
    grantedBy: grantedBy ? { id: grantedBy.id, displayName: grantedBy.display_name || "", email: grantedBy.email || "" } : { id: row.granted_by },
    revokedBy: row.revoked_by ? (revokedBy ? { id: revokedBy.id, displayName: revokedBy.display_name || "", email: revokedBy.email || "" } : { id: row.revoked_by }) : null,
  };
}
