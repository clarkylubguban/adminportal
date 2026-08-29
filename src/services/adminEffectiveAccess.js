export async function getCalendarEffectiveAccess(session) {
  return getEffectiveModuleAccess(session, "calendar");
}

export async function getWorkboardEffectiveAccess(session) {
  return getEffectiveModuleAccess(session, "workboard");
}

export async function getMasterCatalogEffectiveAccess(session) {
  return getEffectiveModuleAccess(session, "master_catalog");
}

export async function getInquiriesEffectiveAccess(session) {
  return getEffectiveModuleAccess(session, "inquiries");
}

export async function getOrdersEffectiveAccess(session) {
  return getEffectiveModuleAccess(session, "orders");
}

export async function getProductionEffectiveAccess(session) {
  return getEffectiveModuleAccess(session, "production");
}

export async function getDesignArtworkEffectiveAccess(session) {
  return getEffectiveModuleAccess(session, "design_artwork");
}

export async function getInventoryEffectiveAccess(session) {
  return getEffectiveModuleAccess(session, "inventory");
}

export async function getPurchasingSuppliersEffectiveAccess(session) {
  return getEffectiveModuleAccess(session, "purchasing_suppliers");
}

async function getEffectiveModuleAccess(session, moduleCode) {
  const response = await fetch(`/api/admin-users/effective-access?module=${encodeURIComponent(moduleCode)}`, {
    headers: {
      Authorization: `Bearer ${session?.access_token || ""}`,
      Accept: "application/json",
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    const error = new Error(getEffectiveAccessError(response.status, payload?.error, moduleCode));
    error.status = response.status;
    throw error;
  }
  return payload.access || { module: moduleCode, allowed: false, source: "none", expiresAt: null };
}

function getEffectiveAccessError(status, error, moduleCode) {
  const message = String(error || "");
  if (status === 401) return "Admin session required. Sign in again.";
  if (status === 403) return message || `${formatModuleLabel(moduleCode)} access is restricted.`;
  return message || `Unable to verify ${formatModuleLabel(moduleCode)} access.`;
}

function formatModuleLabel(moduleCode) {
  if (moduleCode === "inquiries") return "Inquiries";
  if (moduleCode === "orders") return "Orders";
  if (moduleCode === "production") return "Production";
  if (moduleCode === "design_artwork") return "Design & Artwork";
  if (moduleCode === "inventory") return "Inventory";
  if (moduleCode === "purchasing_suppliers") return "Purchasing & Suppliers";
  if (moduleCode === "master_catalog") return "Master Catalog";
  if (moduleCode === "workboard") return "Workboard";
  return "Calendar";
}
