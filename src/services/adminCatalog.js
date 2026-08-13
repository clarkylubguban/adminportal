import {
  createSupabaseRowWithAuth,
  isSupabaseReady,
  readSupabaseTableWithAuth,
  updateSupabaseRowsWithAuth,
} from "../lib/supabaseClient.js";

export const CATALOG_PRODUCTS_TABLE = "catalog_products";
export const PRODUCT_CATEGORIES_TABLE = "product_categories";
export const MASTER_PRODUCTS_TABLE = "products";

export const catalogOptions = [
  { key: "trry_webapp", label: "TRRY WEBAPP" },
  { key: "foghead", label: "FOGHEAD" },
  { key: "trry_portal", label: "TRRY PORTAL" },
];

export const catalogStatusOptions = ["draft", "published", "hidden", "archived"];

export const productTypeOptions = [
  { value: "PHYSICAL", label: "Physical Product" },
  { value: "SERVICE", label: "Service" },
  { value: "MATERIAL_SUPPLY", label: "Material / Supply" },
];

export async function getAdminProductCategories(authSession) {
  if (!isSupabaseReady()) {
    return {
      categories: [],
      status: "empty",
      source: "local",
      error: null,
    };
  }

  try {
    const rows = await readSupabaseTableWithAuth(
      PRODUCT_CATEGORIES_TABLE,
      {
        select: "*",
        order: "name.asc",
      },
      getAccessToken(authSession)
    );
    const categoryProductCounts = await getCategoryProductCounts(authSession).catch((error) => {
      console.warn("Unable to load Master Catalog category product counts.", error);
      return new Map();
    });

    return {
      categories: Array.isArray(rows) ? rows.map((row) => mapCategoryRowToCategory(row, categoryProductCounts)) : [],
      status: rows?.length ? "success" : "empty",
      source: "supabase",
      error: null,
    };
  } catch (error) {
    console.error("Unable to load Supabase product categories.", error);
    return {
      categories: [],
      status: "error",
      source: "supabase",
      error,
    };
  }
}

export async function createAdminProductCategory(category, authSession) {
  assertValidCategoryForWrite(category);
  let rows;
  try {
    rows = await createSupabaseRowWithAuth(
      PRODUCT_CATEGORIES_TABLE,
      mapCategoryToRow(category),
      getAccessToken(authSession)
    );
  } catch (error) {
    throw getCategoryWriteError(error);
  }

  return mapCategoryRowToCategory(rows?.[0] ?? category);
}

export async function updateAdminProductCategory(id, category, authSession) {
  assertValidCategoryForWrite(category);
  let rows;
  try {
    rows = await updateSupabaseRowsWithAuth(
      PRODUCT_CATEGORIES_TABLE,
      { id: `eq.${id}` },
      mapCategoryToRow(category),
      getAccessToken(authSession)
    );
  } catch (error) {
    throw getCategoryWriteError(error);
  }

  return rows?.[0] ? mapCategoryRowToCategory(rows[0]) : null;
}

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

async function getCategoryProductCounts(authSession) {
  const rows = await readSupabaseTableWithAuth(
    MASTER_PRODUCTS_TABLE,
    {
      select: "category_id,product_type",
    },
    getAccessToken(authSession)
  );
  const counts = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const categoryId = row.category_id;
    if (!categoryId) continue;
    const current = counts.get(categoryId) ?? { count: 0, productTypes: new Set() };
    current.count += 1;
    if (row.product_type) current.productTypes.add(row.product_type);
    counts.set(categoryId, current);
  }
  return counts;
}

function mapCategoryRowToCategory(row, categoryProductCounts = new Map()) {
  const productUsage = categoryProductCounts.get(row.id);
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    productType: normalizeProductType(row.product_type),
    productTypeLabel: formatProductType(row.product_type),
    parentCategoryId: row.parent_category_id ?? "",
    productCount: Number(productUsage?.count ?? row.product_count ?? 0),
    assignedProductTypes: Array.from(productUsage?.productTypes ?? []),
    active: row.active !== false,
    archivedAt: row.archived_at ?? "",
    archivedByUserId: row.archived_by_user_id ?? "",
    archiveReason: row.archive_reason ?? "",
    createdByUserId: row.created_by_user_id ?? "",
    updatedByUserId: row.updated_by_user_id ?? "",
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
  };
}

function mapCategoryToRow(category) {
  return cleanRow({
    name: category.name,
    code: category.code,
    product_type: normalizeProductType(category.productType),
    parent_category_id: emptyToNull(category.parentCategoryId),
    active: category.active !== false,
    archived_at: category.archivedAt || null,
    archived_by_user_id: category.archivedByUserId || null,
    archive_reason: emptyToNull(category.archiveReason),
    updated_at: new Date().toISOString(),
  });
}

function assertValidCategoryForWrite(category) {
  if (!normalizeProductType(category?.productType)) {
    throw new Error("Select a product type.");
  }
}

function normalizeProductType(value) {
  const normalizedValue = String(value ?? "").trim().toUpperCase();
  return productTypeOptions.some((option) => option.value === normalizedValue) ? normalizedValue : "";
}

function formatProductType(value) {
  const normalizedValue = normalizeProductType(value);
  return productTypeOptions.find((option) => option.value === normalizedValue)?.label ?? "";
}

function getCategoryWriteError(error) {
  const message = String(error?.message || error || "");
  const mappings = [
    ["null value in column \"product_type\"", "Select a product type."],
    ["INVALID_CATEGORY_PRODUCT_TYPE", "Select a product type."],
    ["CATEGORY_PARENT_PRODUCT_TYPE_MISMATCH", "Only categories with the same product type are available."],
    ["PRODUCT_CATEGORY_TYPE_MISMATCH", "Product type must match the selected category."],
    ["CATEGORY_LINKED_PRODUCT_TYPE_MISMATCH", "Product type cannot be changed while this category is in use."],
    ["CATEGORY_CHILD_PRODUCT_TYPE_MISMATCH", "Product type cannot be changed while this category has child categories or assigned products."],
    ["CATEGORY_MAX_DEPTH_EXCEEDED", "Hierarchy depth is limited to two levels."],
    ["CATEGORY_PRODUCT_TYPE_MAPPING_REQUIRED", "Existing categories need an approved product type mapping before this change can be applied."],
  ];
  const mapped = mappings.find(([token]) => message.includes(token));
  return new Error(mapped?.[1] ?? message);
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
