import {
  createSupabaseRowWithAuth,
  isSupabaseReady,
  readSupabaseTableWithAuth,
  updateSupabaseRowsWithAuth,
} from "../lib/supabaseClient.js";

export const SUPPLIERS_TABLE = "suppliers";
export const SUPPLIER_REFERENCE_PREFIX = "SUP";

export async function getAdminSuppliers(authSession) {
  if (!isSupabaseReady()) {
    return {
      suppliers: [],
      status: "empty",
      source: "local",
      error: null,
    };
  }

  try {
    const rows = await readSupabaseTableWithAuth(
      SUPPLIERS_TABLE,
      {
        select: "*",
        archived_at: "is.null",
        order: "supplier_reference.asc",
      },
      getAccessToken(authSession)
    );
    const suppliers = Array.isArray(rows) ? rows.map(mapSupplierRowToSupplier) : [];
    return {
      suppliers,
      status: suppliers.length ? "success" : "empty",
      source: "supabase",
      error: null,
    };
  } catch (error) {
    console.error("Unable to load Admin Suppliers.", error);
    return {
      suppliers: [],
      status: "error",
      source: "supabase",
      error,
    };
  }
}

export async function createAdminSupplier(supplier, authSession) {
  assertValidSupplierForWrite(supplier);
  const rows = await createSupabaseRowWithAuth(
    SUPPLIERS_TABLE,
    mapSupplierToRow(supplier, { create: true }),
    getAccessToken(authSession)
  );
  return rows?.[0] ? mapSupplierRowToSupplier(rows[0]) : null;
}

export async function updateAdminSupplier(id, supplier, authSession) {
  assertValidSupplierForWrite(supplier);
  const rows = await updateSupabaseRowsWithAuth(
    SUPPLIERS_TABLE,
    { id: `eq.${id}` },
    mapSupplierToRow(supplier, { create: false }),
    getAccessToken(authSession)
  );
  return rows?.[0] ? mapSupplierRowToSupplier(rows[0]) : null;
}

export function canWriteSuppliersForRole(role) {
  return ["owner", "admin"].includes(String(role || "").trim().toLowerCase());
}

export function getSupplierReferencePreview() {
  return "Auto-generated on save";
}

export function normalizeSupplierDraft(draft = {}) {
  const leadTimeValue = String(draft.leadTimeDays ?? "").trim();
  return {
    supplierReference: String(draft.supplierReference ?? "").trim(),
    name: String(draft.name ?? "").trim(),
    supplyType: emptyToNull(draft.supplyType),
    countryRegion: emptyToNull(draft.countryRegion),
    contactPerson: emptyToNull(draft.contactPerson),
    phone: emptyToNull(draft.phone),
    email: emptyToNull(draft.email),
    addressLocation: emptyToNull(draft.addressLocation),
    currency: String(draft.currency ?? "PHP").trim().toUpperCase(),
    paymentTerms: emptyToNull(draft.paymentTerms),
    leadTimeDays: leadTimeValue === "" ? null : Number(leadTimeValue),
    internalNotes: emptyToNull(draft.internalNotes),
    active: draft.active !== false,
  };
}

export function validateSupplierDraft(draft = {}) {
  const supplier = normalizeSupplierDraft(draft);
  if (!supplier.name) return "Supplier Name is required.";
  if (!supplier.currency) return "Currency is required.";
  if (
    supplier.leadTimeDays !== null &&
    (!Number.isInteger(supplier.leadTimeDays) || supplier.leadTimeDays < 0)
  ) {
    return "Lead Time must be zero or a positive whole number.";
  }
  return "";
}

function assertValidSupplierForWrite(supplier) {
  const error = validateSupplierDraft(supplier);
  if (error) throw new Error(error);
}

function mapSupplierToRow(supplier, { create = false } = {}) {
  const normalized = normalizeSupplierDraft(supplier);
  return cleanRow({
    supplier_reference: create ? undefined : normalized.supplierReference || undefined,
    name: normalized.name,
    supply_type: normalized.supplyType,
    country_region: normalized.countryRegion,
    contact_person: normalized.contactPerson,
    phone: normalized.phone,
    email: normalized.email,
    address_location: normalized.addressLocation,
    currency: normalized.currency || "PHP",
    payment_terms: normalized.paymentTerms,
    lead_time_days: normalized.leadTimeDays,
    internal_notes: normalized.internalNotes,
    active: normalized.active,
    archived_at: null,
    updated_at: new Date().toISOString(),
  });
}

function mapSupplierRowToSupplier(row) {
  return {
    id: row.id,
    supplierReference: row.supplier_reference,
    name: row.name,
    supplyType: row.supply_type ?? "",
    countryRegion: row.country_region ?? "",
    contactPerson: row.contact_person ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    addressLocation: row.address_location ?? "",
    currency: row.currency ?? "PHP",
    paymentTerms: row.payment_terms ?? "",
    leadTimeDays: row.lead_time_days === null || row.lead_time_days === undefined ? "" : String(row.lead_time_days),
    internalNotes: row.internal_notes ?? "",
    active: row.active !== false,
    createdByUserId: row.created_by_user_id ?? "",
    updatedByUserId: row.updated_by_user_id ?? "",
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
    archivedAt: row.archived_at ?? "",
  };
}

function getAccessToken(authSession) {
  const accessToken = typeof authSession === "string" ? authSession : authSession?.access_token;
  if (!accessToken) throw new Error("Supabase auth session is required for Admin Suppliers.");
  return accessToken;
}

function emptyToNull(value) {
  const nextValue = String(value ?? "").trim();
  return nextValue ? nextValue : null;
}

function cleanRow(row) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}
