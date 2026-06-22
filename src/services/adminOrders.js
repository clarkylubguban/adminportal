import { isSupabaseReady, readSupabaseTable } from "../lib/supabaseClient.js";

export async function getAdminReorderRequests(fallbackOrders = []) {
  if (!isSupabaseReady()) {
    return {
      orders: [...fallbackOrders],
      status: "local",
      source: "local",
      error: null,
    };
  }

  try {
    const requests = await fetchReorderRequests();

    if (!Array.isArray(requests) || requests.length === 0) {
      return {
        orders: [],
        status: "empty",
        source: "supabase",
        error: null,
      };
    }

    const clients = await fetchClientsForRequests(requests);
    const requestItems = await fetchItemsForRequests(requests);

    return {
      orders: requests.map((request) =>
        mapReorderRequestToOrder(request, clients, requestItems)
      ),
      status: "success",
      source: "supabase",
      error: null,
    };
  } catch (error) {
    console.error("Unable to load Supabase orders.", error);
    return {
      orders: [],
      status: "error",
      source: "supabase",
      error,
    };
  }
}

async function fetchReorderRequests() {
  try {
    return await readSupabaseTable("reorder_requests", {
      select: "*",
      order: "created_at.desc",
    });
  } catch (error) {
    console.warn("Retrying reorder_requests without created_at sort.", error);
    return readSupabaseTable("reorder_requests", {
      select: "*",
    });
  }
}

async function fetchClientsForRequests(requests) {
  const clientIds = uniqueValues(requests.map((request) => getFirstValue(request, ["client_id", "clientId"])));
  if (clientIds.length === 0) return [];

  try {
    return await readSupabaseTable("clients", {
      select: "*",
      id: `in.(${clientIds.join(",")})`,
    });
  } catch (error) {
    console.warn("Unable to load related clients for admin orders.", error);
    return [];
  }
}

async function fetchItemsForRequests(requests) {
  const requestIds = uniqueValues(requests.map((request) => request.id));
  if (requestIds.length === 0) return [];

  try {
    return await readSupabaseTable("request_items", {
      select: "*",
      request_id: `in.(${requestIds.join(",")})`,
    });
  } catch (error) {
    console.warn("Unable to load request_items by request_id; trying legacy key.", error);
    try {
      return await readSupabaseTable("request_items", {
        select: "*",
        reorder_request_id: `in.(${requestIds.join(",")})`,
      });
    } catch (legacyError) {
      console.warn("Unable to load related request_items for admin orders.", legacyError);
      return [];
    }
  }
}

function mapReorderRequestToOrder(request, clients, requestItems) {
  const clientId = getFirstValue(request, ["client_id", "clientId"]);
  const client = clients.find((item) => String(item.id) === String(clientId)) ?? {};
  const items = requestItems.filter((item) =>
    [item.reorder_request_id, item.request_id].some((id) => String(id) === String(request.id))
  );
  const clientName = getFirstValue(client, ["name", "client_name", "business_name", "company_name"]) || "Urban Coffee";
  const itemLines = buildItemLines(items, request);
  const totalQuantity = itemLines.reduce((total, item) => total + item.qty, 0);
  const requestedQuantity = totalQuantity || Number(getFirstValue(request, ["total_quantity", "quantity", "qty"])) || 0;
  const requestedBy = getFirstValue(request, ["requested_by", "requester_name", "contact_name"]) ||
    getFirstValue(client, ["primary_contact", "contact_name"]) ||
    `${clientName} Admin`;
  const assignedStaff = getFirstValue(request, ["assigned_staff_names", "assigned_staff", "staff_names"]);

  return {
    id: getFirstValue(request, ["request_no", "request_number", "order_no", "code", "id"]),
    client: clientName,
    clientInitials: getInitials(clientName),
    requestedBy,
    requesterRole: assignedStaff || getFirstValue(request, ["requester_role", "role"]) || "Portal Request",
    requesterEmail: getFirstValue(request, ["requester_email", "email"]) ||
      getFirstValue(client, ["contact_email", "email"]) ||
      "To be added",
    requesterPhone: getFirstValue(request, ["requester_phone", "phone"]) ||
      getFirstValue(client, ["contact_number", "phone"]) ||
      "To be added",
    clientAddress: getFirstValue(client, ["portal_domain", "domain", "slug"]) || "Private client portal",
    cityState: getFirstValue(client, ["address", "city", "location"]) || "Private client portal",
    items: itemLines.map((item) => item.name).join(", ") || "Reorder request",
    itemCount: Number(getFirstValue(request, ["total_items", "item_count", "items_count"])) || itemLines.length || 0,
    qty: requestedQuantity,
    qtyLabel: requestedQuantity ? `${requestedQuantity} pc${requestedQuantity === 1 ? "" : "s"}` : "0 pcs",
    fulfillment: getFirstValue(request, ["fulfillment", "fulfillment_method", "delivery_method"]) || "Delivery",
    neededDate: formatDate(getFirstValue(request, ["needed_date", "needed_by", "date_needed"])),
    daysUntilNeeded: getFirstValue(request, ["production_note", "needed_label"]) || "Supabase request",
    status: normalizeStatus(getFirstValue(request, ["status", "request_status"])),
    shipTo: getFirstValue(request, ["ship_to", "delivery_name"]) || `${clientName} - Delivery`,
    shipAddress: getFirstValue(request, ["ship_address", "delivery_address", "address"]) || "Delivery address to be confirmed",
    itemLines,
    updated: formatDate(getFirstValue(request, ["updated_at", "created_at"])) || "From Supabase",
  };
}

function buildItemLines(items, request) {
  if (items.length > 0) {
    return items.map((item) => ({
      name: getFirstValue(item, ["product_name", "item_name", "name", "description"]) || "Product item",
      qty: Number(getFirstValue(item, ["quantity", "qty", "total_quantity"])) || 0,
      sizeSummary: getFirstValue(item, ["size_summary", "sizes", "size"]),
    }));
  }

  const fallbackName = getFirstValue(request, ["product_name", "item_name", "items"]);
  if (!fallbackName) return [];

  return [{
    name: fallbackName,
    qty: Number(getFirstValue(request, ["total_quantity", "quantity", "qty"])) || 0,
  }];
}

function getFirstValue(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }

  return "";
}

function uniqueValues(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ""))];
}

function getInitials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function normalizeStatus(value) {
  const status = String(value || "Pending Review").trim().toLowerCase();
  const statusMap = {
    pending: "Pending Review",
    pending_review: "Pending Review",
    "pending review": "Pending Review",
    approved: "Approved",
    in_production: "In Production",
    "in production": "In Production",
    ready: "Ready",
    ready_to_ship: "Ready",
    "ready to ship": "Ready",
    completed: "Completed",
    cancelled: "Cancelled",
    canceled: "Cancelled",
  };

  return statusMap[status] ?? "Pending Review";
}

function formatDate(value) {
  if (!value) return "To be confirmed";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "2-digit",
    year: "numeric",
  });
}
