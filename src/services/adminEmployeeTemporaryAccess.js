export const employeeTemporaryAccessModules = [
  { code: "production", label: "Production" },
  { code: "design_artwork", label: "Design & Artwork" },
  { code: "inventory", label: "Inventory" },
  { code: "purchasing_suppliers", label: "Purchasing / Suppliers" },
  { code: "pos_sales", label: "POS / Sales" },
  { code: "orders", label: "Orders" },
  { code: "inquiries", label: "Inquiries" },
  { code: "master_catalog", label: "Master Catalog" },
  { code: "workboard", label: "Workboard" },
  { code: "calendar", label: "Calendar" },
  { code: "pricing_discounts", label: "Pricing & Discounts", protected: true, unavailableReason: "Not available yet" },
  { code: "people_access", label: "People & Access", protected: true, unavailableReason: "Not available for temporary access" },
];

export async function getEmployeeTemporaryAccess(session) {
  return temporaryAccessRequest("/api/admin-users/temporary-access", session);
}

export async function grantEmployeeTemporaryAccess(session, { employeeId, moduleCodes, reason }) {
  return temporaryAccessRequest("/api/admin-users/temporary-access", session, {
    method: "POST",
    body: { employee_id: employeeId, module_codes: moduleCodes, reason },
  });
}

export async function revokeEmployeeTemporaryAccess(session, { employeeId }) {
  return temporaryAccessRequest("/api/admin-users/temporary-access", session, {
    method: "PATCH",
    body: { employee_id: employeeId },
  });
}

async function temporaryAccessRequest(path, session, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${session?.access_token || ""}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(getTemporaryAccessError(response.status, payload?.error));
  return payload;
}

function getTemporaryAccessError(status, error) {
  const message = String(error || "");
  const normalized = message.toLowerCase();
  if (status === 401) return "Admin session required. Sign in again.";
  if (status === 403) return message || "You do not have permission to manage temporary access.";
  if (status === 404) return "Employee account was not found.";
  if (normalized.includes("module")) return message || "Choose a permitted module.";
  if (normalized.includes("active")) return "Temporary access requires an active staff employee.";
  if (normalized.includes("staff")) return "Temporary access is available for staff employees only.";
  return message || "Temporary access request failed. Try again.";
}
