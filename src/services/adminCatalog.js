import {
  createSupabaseRowWithAuth,
  isSupabaseReady,
  readSupabaseTableWithAuth,
  updateSupabaseRowsWithAuth,
} from "../lib/supabaseClient.js";

export const CATALOG_PRODUCTS_TABLE = "catalog_products";

export const catalogOptions = [
  { key: "trry_webapp", label: "TRRY WEBAPP" },
  { key: "foghead", label: "FOGHEAD" },
  { key: "trry_portal", label: "TRRY PORTAL" },
];

export const catalogStatusOptions = ["draft", "published", "hidden", "archived"];

export async function getAdminCatalogProducts(authSession) {
  if (!isSupabaseReady()) {
    return {
      products: [],
      status: "empty",
      source: "local",
      error: null,
    };
  }

  try {
    const rows = await readSupabaseTableWithAuth(
      CATALOG_PRODUCTS_TABLE,
      {
        select: "*",
        order: "sort_order.asc,name.asc",
      },
      getAccessToken(authSession)
    );

    return {
      products: Array.isArray(rows) ? rows.map(mapCatalogRowToProduct) : [],
      status: rows?.length ? "success" : "empty",
      source: "supabase",
      error: null,
    };
  } catch (error) {
    console.error("Unable to load Supabase catalog products.", error);
    return {
      products: [],
      status: "error",
      source: "supabase",
      error,
    };
  }
}

export async function createAdminCatalogProduct(product, authSession) {
  const rows = await createSupabaseRowWithAuth(
    CATALOG_PRODUCTS_TABLE,
    mapCatalogProductToRow(product),
    getAccessToken(authSession)
  );

  return mapCatalogRowToProduct(rows?.[0] ?? product);
}

export async function updateAdminCatalogProduct(id, product, authSession) {
  const rows = await updateSupabaseRowsWithAuth(
    CATALOG_PRODUCTS_TABLE,
    { id: `eq.${id}` },
    mapCatalogProductToRow(product),
    getAccessToken(authSession)
  );

  return rows?.[0] ? mapCatalogRowToProduct(rows[0]) : null;
}

function mapCatalogRowToProduct(row) {
  return {
    id: row.id,
    catalogKey: row.catalog_key,
    name: row.name,
    slug: row.slug,
    category: row.category ?? "",
    description: row.description ?? "",
    imageUrl: row.image_url ?? "",
    startingPrice: row.starting_price === null || row.starting_price === undefined ? "" : String(row.starting_price),
    priceLabel: row.price_label ?? "",
    minimumQuantity: Number(row.minimum_quantity ?? 1),
    availableSizes: Array.isArray(row.available_sizes) ? row.available_sizes : [],
    availableColors: Array.isArray(row.available_colors) ? row.available_colors : [],
    printMethods: Array.isArray(row.print_methods) ? row.print_methods : [],
    sortOrder: Number(row.sort_order ?? 0),
    isFeatured: row.is_featured === true,
    status: row.status ?? "draft",
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
  };
}

function mapCatalogProductToRow(product) {
  return cleanRow({
    catalog_key: product.catalogKey,
    name: product.name,
    slug: product.slug,
    category: emptyToNull(product.category),
    description: emptyToNull(product.description),
    image_url: emptyToNull(product.imageUrl),
    starting_price: product.startingPrice === "" || product.startingPrice === null ? null : Number(product.startingPrice),
    price_label: emptyToNull(product.priceLabel),
    minimum_quantity: Number(product.minimumQuantity || 1),
    available_sizes: product.availableSizes ?? [],
    available_colors: product.availableColors ?? [],
    print_methods: product.printMethods ?? [],
    sort_order: Number(product.sortOrder || 0),
    is_featured: product.isFeatured === true,
    status: product.status || "draft",
    updated_at: new Date().toISOString(),
  });
}

function getAccessToken(authSession) {
  const accessToken = typeof authSession === "string" ? authSession : authSession?.access_token;

  if (!accessToken) {
    throw new Error("Supabase auth session is required for Admin Catalog.");
  }

  return accessToken;
}

function emptyToNull(value) {
  const nextValue = String(value ?? "").trim();
  return nextValue ? nextValue : null;
}

function cleanRow(row) {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined)
  );
}
