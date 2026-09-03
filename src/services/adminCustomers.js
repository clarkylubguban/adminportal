import {
  executeSupabaseRpcWithAuth,
  isSupabaseReady,
  readSupabaseTableWithAuth,
  writeSupabaseTableWithAuth,
} from "../lib/supabaseClient.js";

export function normalizePhilippineMobile(value) {
  const digits = String(value || "").replace(/\D+/g, "");
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
  if (/^639\d{9}$/.test(digits)) return `+${digits}`;
  if (/^9\d{9}$/.test(digits)) return `+63${digits}`;
  return "";
}

export function validateCustomerIdentityDraft(draft) {
  if (!String(draft?.fullName || "").trim()) return "Full name is required.";
  if (!normalizePhilippineMobile(draft?.mobile)) return "Enter a valid Philippine mobile number.";
  return "";
}

export async function getAdminCustomers(authSession) {
  if (!isSupabaseReady()) return [];
  return readSupabaseTableWithAuth("customers", {
    select: "id,customer_reference,full_name,mobile_raw,mobile_normalized,first_source,first_seen_at,active,created_at,updated_at",
    order: "created_at.desc",
  }, getAccessToken(authSession));
}

export async function findAdminCustomerByMobile(mobile, authSession) {
  const normalized = normalizePhilippineMobile(mobile);
  if (!normalized || !isSupabaseReady()) return null;
  const rows = await readSupabaseTableWithAuth("customers", {
    select: "id,customer_reference,full_name,mobile_raw,mobile_normalized,first_source,first_seen_at,active,created_at,updated_at",
    mobile_normalized: `eq.${normalized}`,
    limit: "1",
  }, getAccessToken(authSession));
  return rows[0] || null;
}

export async function createAdminCustomer(draft, authSession) {
  const validationError = validateCustomerIdentityDraft(draft);
  if (validationError) throw new Error(validationError);
  const existing = await findAdminCustomerByMobile(draft.mobile, authSession);
  if (existing) return { customer: existing, duplicate: true };
  try {
    const rows = await writeSupabaseTableWithAuth("customers", {
      method: "POST",
      body: {
        full_name: String(draft.fullName).trim(),
        mobile_raw: String(draft.mobile).trim(),
        first_source: draft.firstSource || "ADMIN_MANUAL",
      },
      prefer: "return=representation",
    }, getAccessToken(authSession));
    return { customer: rows[0], duplicate: false };
  } catch (error) {
    const raced = await findAdminCustomerByMobile(draft.mobile, authSession);
    if (raced) return { customer: raced, duplicate: true };
    throw error;
  }
}

export async function findOrCreateAdminCustomerIdentity(draft, authSession) {
  const validationError = validateCustomerIdentityDraft(draft);
  if (validationError) throw new Error(validationError);
  if (!isSupabaseReady()) throw new Error("Supabase env is missing or disabled.");

  const rows = await executeSupabaseRpcWithAuth(
    "find_or_create_customer_identity_c2_1",
    {
      p_full_name: String(draft.fullName || "").trim(),
      p_mobile: String(draft.mobile || "").trim(),
      p_first_source: draft.firstSource || "ADMIN_MANUAL",
    },
    getAccessToken(authSession)
  );

  const result = Array.isArray(rows) ? rows[0] : rows;
  if (!result?.customer_id) {
    throw new Error("Customer identity could not be resolved.");
  }

  return {
    customer: {
      id: result.customer_id,
      customer_reference: result.customer_reference,
      full_name: result.full_name,
      mobile_normalized: result.mobile_normalized,
      first_source: result.first_source,
    },
    duplicate: result.created === false,
    created: result.created === true,
  };
}

function getAccessToken(authSession) {
  const token = typeof authSession === "string" ? authSession : authSession?.access_token;
  if (!token) throw new Error("Supabase auth session is required for Customers.");
  return token;
}
