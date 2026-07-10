import { isSupabaseReady, readSupabaseTableWithAuth } from "../lib/supabaseClient.js";

const INACTIVE_ORDER_STATUSES = new Set(["completed", "cancelled", "canceled"]);

export async function getAdminClientPrograms(fallbackProgram, authSession) {
  if (!isSupabaseReady()) {
    return {
      clients: [{ ...fallbackProgram }],
      status: "local",
      source: "local",
      error: null,
    };
  }

  try {
    const accessToken = getAccessToken(authSession);
    const [clientRows, requestRows, employeeRows, productRows] = await Promise.all([
      readAdminTable("clients", { select: "*" }, accessToken),
      readAdminTable("reorder_requests", { select: "*" }, accessToken),
      readAdminTable("employees", { select: "*" }, accessToken),
      readAdminTable("approved_products", { select: "*" }, accessToken),
    ]);

    const urbanCoffeeClient = findUrbanCoffeeClient(clientRows) ?? {};
    const clientId = urbanCoffeeClient.id ?? fallbackProgram.supabaseClientId ?? "";
    const clientRequests = requestRows.filter((request) => sameId(getFirstValue(request, ["client_id", "clientId"]), clientId));
    const activeOrders = clientRequests.filter((request) => isActiveOrderStatus(getFirstValue(request, ["status", "request_status"]))).length;
    const savedEmployees = employeeRows.filter((employee) =>
      sameId(getFirstValue(employee, ["client_id", "clientId"]), clientId) && employee.is_active !== false
    ).length;
    const approvedProducts = productRows.filter((product) =>
      sameId(getFirstValue(product, ["client_id", "clientId"]), clientId)
    ).length;

    return {
      clients: [
        {
          ...fallbackProgram,
          name: getFirstValue(urbanCoffeeClient, ["name", "client_name", "business_name", "company_name"]) || fallbackProgram.name,
          domain: getFirstValue(urbanCoffeeClient, ["portal_domain", "domain", "website"]) || fallbackProgram.domain,
          status: normalizeClientStatus(getFirstValue(urbanCoffeeClient, ["status", "client_status"]), fallbackProgram.status),
          primaryContact: getFirstValue(urbanCoffeeClient, ["primary_contact", "contact_name", "contact_person"]) || fallbackProgram.primaryContact,
          contactEmail: getFirstValue(urbanCoffeeClient, ["contact_email", "email"]) || fallbackProgram.contactEmail,
          contactNumber: getFirstValue(urbanCoffeeClient, ["contact_number", "phone", "mobile"]) || fallbackProgram.contactNumber,
          approvedProducts,
          savedEmployees,
          activeOrders,
          lastOrderDate: getLastOrderDate(clientRequests),
          supabaseClientId: clientId,
        },
      ],
      status: "success",
      source: "supabase",
      error: null,
    };
  } catch (error) {
    console.error("Unable to load Supabase clients.", error);
    return {
      clients: [{ ...fallbackProgram }],
      status: "error",
      source: "supabase",
      error,
    };
  }
}

async function readAdminTable(tableName, params, accessToken) {
  try {
    return await readSupabaseTableWithAuth(tableName, params, accessToken);
  } catch (error) {
    console.warn(`Unable to load ${tableName} for Admin Clients.`, error);
    return [];
  }
}

function findUrbanCoffeeClient(clients) {
  return clients.find((client) => {
    const fields = [
      client.slug,
      client.portal_slug,
      client.portal_domain,
      client.domain,
      client.name,
      client.client_name,
      client.business_name,
      client.company_name,
    ].join(" ").toLowerCase();

    return fields.includes("urban-coffee") || fields.includes("urbancoffee") || fields.includes("urban coffee");
  });
}

function isActiveOrderStatus(status) {
  return !INACTIVE_ORDER_STATUSES.has(String(status || "").trim().toLowerCase());
}

function getLastOrderDate(requests) {
  const latestTimestamp = requests
    .map((request) => new Date(getFirstValue(request, ["created_at", "updated_at"])).getTime())
    .filter((timestamp) => !Number.isNaN(timestamp))
    .sort((a, b) => b - a)[0];

  if (!latestTimestamp) return "None yet";

  return new Date(latestTimestamp).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function normalizeClientStatus(status, fallback) {
  const normalized = String(status || "").trim();
  if (!normalized) return fallback;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getAccessToken(authSession) {
  const accessToken = typeof authSession === "string" ? authSession : authSession?.access_token;

  if (!accessToken) {
    throw new Error("Supabase auth session is required for Admin Clients.");
  }

  return accessToken;
}

function getFirstValue(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }

  return "";
}

function sameId(left, right) {
  return Boolean(left && right && String(left) === String(right));
}