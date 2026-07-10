import {
  createSupabaseRowWithAuth,
  isSupabaseReady,
  readSupabaseTableWithAuth,
  updateSupabaseRowsWithAuth,
} from "../lib/supabaseClient.js";

export const OPS_INQUIRIES_TABLE = "ops_inquiries";

// Database schema and RLS policies must be managed in Supabase,
// not embedded inside the Admin Portal frontend.
export const OPS_INQUIRIES_SQL = null;

export async function getOpsBoardInquiries(
  fallbackInquiries = [],
  authSession
) {
  if (!isSupabaseReady()) {
    return {
      inquiries: [...fallbackInquiries],
      status: "local",
      source: "local",
      error: null,
      sql: null,
    };
  }

  try {
    const rows = await readSupabaseTableWithAuth(
      OPS_INQUIRIES_TABLE,
      {
        select: "*",
        order: "created_at.desc",
      },
      getAccessToken(authSession)
    );

    return {
      inquiries: Array.isArray(rows)
        ? rows.map(mapOpsRowToInquiry)
        : [],
      status: rows?.length ? "success" : "empty",
      source: "supabase",
      error: null,
      sql: null,
    };
  } catch (error) {
    console.error(
      "Unable to load Supabase Ops Board inquiries.",
      error
    );

    return {
      inquiries: [],
      status: isMissingTableError(error)
        ? "missing-table"
        : "error",
      source: "supabase",
      error,
      sql: null,
    };
  }
}

export async function createOpsBoardInquiry(
  inquiry,
  authSession
) {
  const rows = await createSupabaseRowWithAuth(
    OPS_INQUIRIES_TABLE,
    mapInquiryToOpsRow(inquiry),
    getAccessToken(authSession)
  );

  return mapOpsRowToInquiry(
    rows?.[0] ?? mapInquiryToOpsRow(inquiry)
  );
}

export async function updateOpsInquiryStatus(
  id,
  updates,
  authSession
) {
  const rows = await updateSupabaseRowsWithAuth(
    OPS_INQUIRIES_TABLE,
    { id: `eq.${id}` },
    mapInquiryUpdatesToOpsRow(updates),
    getAccessToken(authSession)
  );

  return rows?.[0]
    ? mapOpsRowToInquiry(rows[0])
    : null;
}

export async function updateOpsInquiryNextAction(
  id,
  nextAction,
  authSession
) {
  return updateOpsInquiryFields(
    id,
    { next: nextAction },
    authSession
  );
}

export async function updateOpsInquiryDates(
  id,
  { dueDate, followUpDate },
  authSession
) {
  return updateOpsInquiryFields(
    id,
    { dueDate, followUpDate },
    authSession
  );
}

export async function saveOpsInquiryOdooSO(
  id,
  odooSO,
  authSession
) {
  const rows = await updateSupabaseRowsWithAuth(
    OPS_INQUIRIES_TABLE,
    { id: `eq.${id}` },
    mapInquiryUpdatesToOpsRow({ odooSO }),
    getAccessToken(authSession)
  );

  return rows?.[0]
    ? mapOpsRowToInquiry(rows[0])
    : null;
}

export async function confirmOpsInquiryOdooSO(
  id,
  odooSO,
  authSession
) {
  const rows = await updateSupabaseRowsWithAuth(
    OPS_INQUIRIES_TABLE,
    { id: `eq.${id}` },
    mapInquiryUpdatesToOpsRow({
      status: "won",
      odooSO,
      next: "Odoo Sales Order recorded",
    }),
    getAccessToken(authSession)
  );

  return rows?.[0]
    ? mapOpsRowToInquiry(rows[0])
    : null;
}

export const updateOpsInquiryOdooSO =
  confirmOpsInquiryOdooSO;

export async function updateOpsInquiryFields(
  id,
  updates,
  authSession
) {
  const rows = await updateSupabaseRowsWithAuth(
    OPS_INQUIRIES_TABLE,
    { id: `eq.${id}` },
    mapInquiryUpdatesToOpsRow(updates),
    getAccessToken(authSession)
  );

  return rows?.[0]
    ? mapOpsRowToInquiry(rows[0])
    : null;
}

export function mapOpsRowToInquiry(row) {
  return {
    id: getFirstValue(row, ["id"]),
    customer: getFirstValue(row, [
      "customer_name",
      "customer",
    ]),
    contact: getFirstValue(row, ["contact"]),
    source:
      getFirstValue(row, ["source"]) || "FB",
    message: getFirstValue(row, ["message"]),
    service:
      getFirstValue(row, [
        "product",
        "service",
        "service_type",
      ]) || "-",
    qty:
      getFirstValue(row, ["quantity", "qty"]) ||
      "-",
    priority:
      getFirstValue(row, ["priority"]) ||
      "normal",
    status:
      normalizeOpsStatus(
        getFirstValue(row, ["status"])
      ) || "new",
    next:
      getFirstValue(row, [
        "next_action",
        "next",
      ]) || "Review inquiry",
    dueDate: normalizeDate(
      getFirstValue(row, ["due_date", "dueDate"])
    ),
    followUpDate: normalizeDate(
      getFirstValue(row, [
        "follow_up_date",
        "followUpDate",
      ])
    ),
    odooSO: getFirstValue(row, [
      "odoo_so",
      "odooSO",
    ]),
    estimatedValue: getFirstValue(row, [
      "estimated_value",
      "estimatedValue",
    ]),
    assigned:
      getFirstValue(row, ["assigned"]) ||
      "Unassigned",
  };
}

export function mapInquiryToOpsRow(inquiry) {
  return cleanRow({
    id: inquiry.id,
    customer_name: inquiry.customer,
    contact: inquiry.contact,
    source: inquiry.source,
    message: inquiry.message,
    product: inquiry.service,
    quantity: inquiry.qty,
    priority: inquiry.priority || "normal",
    status: normalizeOpsStatus(inquiry.status),
    next_action: inquiry.next,
    due_date: normalizeDate(inquiry.dueDate),
    follow_up_date: normalizeDate(
      inquiry.followUpDate
    ),
    odoo_so: inquiry.odooSO,
    estimated_value: inquiry.estimatedValue,
  });
}

function mapInquiryUpdatesToOpsRow(updates) {
  return cleanRow({
    customer_name: updates.customer,
    contact: updates.contact,
    source: updates.source,
    message: updates.message,
    product: updates.service,
    quantity: updates.qty,
    priority: updates.priority,
    status:
      updates.status === undefined
        ? undefined
        : normalizeOpsStatus(updates.status),
    next_action: updates.next,
    due_date:
      updates.dueDate === undefined
        ? undefined
        : normalizeDate(updates.dueDate),
    follow_up_date:
      updates.followUpDate === undefined
        ? undefined
        : normalizeDate(updates.followUpDate),
    odoo_so: updates.odooSO,
    estimated_value: updates.estimatedValue,
  });
}

function normalizeOpsStatus(value) {
  const normalized = String(value || "new")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  const statusMap = {
    new: "new",
    inquiry_received: "new",
    new_inquiry: "new",
    quote: "quote",
    needs_quote: "quote",
    quote_needed: "quote",
    sent: "sent",
    quote_sent: "sent",
    followup: "followup",
    follow_up: "followup",
    won: "won",
    odoo_created: "won",
    won_odoo_created: "won",
    lost: "lost",
  };

  return statusMap[normalized] ?? "new";
}

function getAccessToken(authSession) {
  const accessToken =
    typeof authSession === "string"
      ? authSession
      : authSession?.access_token;

  if (!accessToken) {
    throw new Error(
      "Supabase auth session is required for ops_inquiries."
    );
  }

  return accessToken;
}

function cleanRow(row) {
  return Object.fromEntries(
    Object.entries(row).filter(
      ([, value]) => value !== undefined
    )
  );
}

function getFirstValue(record, keys) {
  for (const key of keys) {
    const value = record?.[key];

    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      return value;
    }
  }

  return "";
}

function normalizeDate(value) {
  if (!value) return null;

  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed)
    .toISOString()
    .slice(0, 10);
}

function isMissingTableError(error) {
  const message = String(
    error?.message || error || ""
  ).toLowerCase();

  return (
    message.includes("could not find") ||
    message.includes("does not exist") ||
    message.includes("pgrst205") ||
    message.includes("42p01")
  );
}