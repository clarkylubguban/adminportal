import {
  createSupabaseRowWithAuth,
  executeSupabaseRpcWithAuth,
  isSupabaseReady,
  readSupabaseTableWithAuth,
  updateSupabaseRowsWithAuth,
} from "../lib/supabaseClient.js";

export const LEGACY_CATALOG_PRODUCTS_TABLE = "catalog_products";
export const PRODUCT_CATEGORIES_TABLE = "product_categories";
export const BRANDS_TABLE = "brands";
export const MASTER_PRODUCTS_TABLE = "products";
export const PRODUCT_VARIANTS_TABLE = "product_variants";
export const PRODUCT_IMAGES_TABLE = "product_images";

export const canonicalSalesChannels = [
  { code: "STLOLAB", label: "STLOLab" },
  { code: "TRRY_WEBAPP", label: "TRRY WebApp" },
  { code: "POS", label: "POS" },
  { code: "TRRY_APPAREL", label: "TRRY Apparel" },
];

export const catalogOptions = [
  { key: "stlolab", label: "STLOLab", channel: "STLOLAB" },
  { key: "trry_webapp", label: "TRRY WebApp", channel: "TRRY_WEBAPP" },
  { key: "pos", label: "POS", channel: "POS" },
  { key: "trry_apparel", label: "TRRY Apparel", channel: "TRRY_APPAREL" },
];

export const canonicalSalesChannelCodes = new Set(canonicalSalesChannels.map((channel) => channel.code));

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

export async function getAdminBrands(authSession) {
  if (!isSupabaseReady()) {
    return {
      brands: [],
      status: "empty",
      source: "local",
      error: null,
    };
  }

  try {
    const accessToken = getAccessToken(authSession);
    const [rows, productRows] = await Promise.all([
      readSupabaseTableWithAuth(BRANDS_TABLE, { select: "*", order: "name.asc" }, accessToken),
      readSupabaseTableWithAuth(MASTER_PRODUCTS_TABLE, { select: "brand_id" }, accessToken),
    ]);
    const productCounts = getBrandProductCounts(productRows);
    const brands = Array.isArray(rows) ? rows.map((row) => mapBrandRowToBrand(row, productCounts.get(row.id) ?? 0)) : [];

    return {
      brands: brands.sort(sortBrands),
      status: brands.length ? "success" : "empty",
      source: "supabase",
      error: null,
    };
  } catch (error) {
    console.error("Unable to load Supabase brands.", error);
    return {
      brands: [],
      status: "error",
      source: "supabase",
      error,
    };
  }
}

export async function createAdminBrand(brand, authSession) {
  assertValidBrandForWrite(brand);
  let rows;
  try {
    rows = await createSupabaseRowWithAuth(
      BRANDS_TABLE,
      mapBrandToRow(brand),
      getAccessToken(authSession)
    );
  } catch (error) {
    throw getBrandWriteError(error);
  }

  return rows?.[0] ? mapBrandRowToBrand(rows[0]) : null;
}

export async function updateAdminBrand(id, brand, authSession) {
  assertValidBrandForWrite(brand, { edit: true });
  let rows;
  try {
    rows = await updateSupabaseRowsWithAuth(
      BRANDS_TABLE,
      { id: `eq.${id}` },
      mapBrandToRow(brand, { edit: true }),
      getAccessToken(authSession)
    );
  } catch (error) {
    throw getBrandWriteError(error);
  }

  return rows?.[0] ? mapBrandRowToBrand(rows[0]) : null;
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
    const accessToken = getAccessToken(authSession);
    const [products, categories, brands, variants, images] = await Promise.all([
      readSupabaseTableWithAuth(MASTER_PRODUCTS_TABLE, { select: "*", order: "name.asc" }, accessToken),
      readSupabaseTableWithAuth(PRODUCT_CATEGORIES_TABLE, { select: "id,name,code,product_type,parent_category_id" }, accessToken),
      readSupabaseTableWithAuth(BRANDS_TABLE, { select: "id,brand_code,name,ownership_type,owner_name,website_slug,status" }, accessToken),
      readSupabaseTableWithAuth(PRODUCT_VARIANTS_TABLE, { select: "*", order: "created_at.asc" }, accessToken),
      readSupabaseTableWithAuth(PRODUCT_IMAGES_TABLE, {
        select: "*",
        active: "eq.true",
        archived_at: "is.null",
        order: "position.asc,created_at.asc",
      }, accessToken),
    ]);
    const categoryById = new Map((Array.isArray(categories) ? categories : []).map((category) => [category.id, category]));
    const brandById = new Map((Array.isArray(brands) ? brands : []).map((brand) => [brand.id, brand]));
    const variantsByProduct = groupBy(Array.isArray(variants) ? variants : [], "product_id");
    const imagesByProduct = groupBy(Array.isArray(images) ? images : [], "product_id");
    const mappedProducts = (Array.isArray(products) ? products : []).map((row) => mapCanonicalRowToProduct(
      row,
      categoryById.get(row.category_id),
      brandById.get(row.brand_id),
      variantsByProduct.get(row.id) ?? [],
      imagesByProduct.get(row.id) ?? []
    ));

    return {
      products: mappedProducts.sort(sortCatalogProducts),
      status: mappedProducts.length ? "success" : "empty",
      source: "supabase",
      error: null,
    };
  } catch (error) {
    console.error("Unable to load Supabase canonical products.", error);
    return {
      products: [],
      status: "error",
      source: "supabase",
      error,
    };
  }
}

export async function getLegacyCatalogProductsReadOnly(authSession) {
  const rows = await readSupabaseTableWithAuth(
    LEGACY_CATALOG_PRODUCTS_TABLE,
    {
      select: "*",
      order: "sort_order.asc,name.asc",
    },
    getAccessToken(authSession)
  );
  return Array.isArray(rows) ? rows.map(mapLegacyCatalogRowToProduct) : [];
}

export async function createAdminProduct(product, authSession) {
  const accessToken = getAccessToken(authSession);
  const productRows = await createSupabaseRowWithAuth(
    MASTER_PRODUCTS_TABLE,
    mapProductToCanonicalRow(product, { create: true }),
    accessToken
  );
  const savedRow = productRows?.[0];
  if (!savedRow?.id) throw new Error("Product create failed before identifiers were returned.");

  await replaceProductVariants(savedRow, product, accessToken);
  if (Array.isArray(product.images)) {
    await replaceProductImages(savedRow.id, product.images, accessToken);
  }
  return getAdminProductById(savedRow.id, authSession);
}

export async function updateAdminProduct(id, product, authSession) {
  const accessToken = getAccessToken(authSession);
  const rows = await updateSupabaseRowsWithAuth(
    MASTER_PRODUCTS_TABLE,
    { id: `eq.${id}` },
    mapProductToCanonicalRow(product, { create: false }),
    accessToken
  );
  const savedRow = rows?.[0];
  if (!savedRow?.id) throw new Error("Product update failed or returned no rows.");

  await replaceProductVariants(savedRow, product, accessToken);
  if (Array.isArray(product.images)) {
    await replaceProductImages(savedRow.id, product.images, accessToken);
  }
  return getAdminProductById(savedRow.id, authSession);
}

export async function duplicateAdminProduct(product, authSession) {
  const duplicate = {
    ...product,
    id: "",
    masterProductId: "",
    productCode: "",
    name: `${product.name} Copy`,
    status: "draft",
    isFeatured: false,
    sortOrder: Number(product.sortOrder || 0) + 1,
    variants: (product.variants ?? []).map((variant) => ({
      ...variant,
      id: "",
      masterVariantId: "",
      sku: "",
      globalSku: "",
    })),
    images: (product.images ?? []).map((image) => ({
      storagePath: image.storagePath,
      publicUrl: image.publicUrl || image.url,
      altText: image.altText || product.name,
      isPrimary: image.isPrimary === true,
    })).filter((image) => image.storagePath),
  };
  return createAdminProduct(duplicate, authSession);
}

async function getAdminProductById(id, authSession) {
  const accessToken = getAccessToken(authSession);
  const [products, categories, brands, variants, images] = await Promise.all([
    readSupabaseTableWithAuth(MASTER_PRODUCTS_TABLE, { select: "*", id: `eq.${id}`, limit: "1" }, accessToken),
    readSupabaseTableWithAuth(PRODUCT_CATEGORIES_TABLE, { select: "id,name,code,product_type,parent_category_id" }, accessToken),
    readSupabaseTableWithAuth(BRANDS_TABLE, { select: "id,brand_code,name,ownership_type,owner_name,website_slug,status" }, accessToken),
    readSupabaseTableWithAuth(PRODUCT_VARIANTS_TABLE, { select: "*", product_id: `eq.${id}`, order: "created_at.asc" }, accessToken),
    readSupabaseTableWithAuth(PRODUCT_IMAGES_TABLE, {
      select: "*",
      product_id: `eq.${id}`,
      active: "eq.true",
      archived_at: "is.null",
      order: "position.asc,created_at.asc",
    }, accessToken),
  ]);
  const row = products?.[0];
  if (!row) return null;
  const categoryById = new Map((Array.isArray(categories) ? categories : []).map((category) => [category.id, category]));
  const brandById = new Map((Array.isArray(brands) ? brands : []).map((brand) => [brand.id, brand]));
  return mapCanonicalRowToProduct(row, categoryById.get(row.category_id), brandById.get(row.brand_id), variants ?? [], images ?? []);
}

function mapProductToCanonicalRow(product, { create = false } = {}) {
  const statusFields = mapCatalogStatusToCanonical(product.status, product);
  const row = cleanRow({
    category_id: product.categoryId || product.category_id || null,
    brand_id: product.brandId || product.brand_id || null,
    name: product.name,
    description: emptyToNull(product.description),
    brand: emptyToNull(product.brandName || product.brand),
    product_type: normalizeProductType(product.productType) || "PHYSICAL",
    eligible_channels: mapCatalogKeysToChannels(product.catalogKeys ?? [product.catalogKey]),
    typed_config: mapProductToTypedConfig(product),
    updated_at: new Date().toISOString(),
    ...statusFields,
  });

  if (create) {
    row.created_by_user_id = undefined;
  }

  return row;
}

function mapProductToTypedConfig(product) {
  return {
    price_label: emptyToNull(product.priceLabel),
    minimum_quantity: Number(product.minimumQuantity || 1),
    print_methods: product.printMethods ?? [],
    material: emptyToNull(product.material),
    weight_gsm: emptyToNull(product.weightGsm),
    fit_cut: emptyToNull(product.fitCut),
    production_use: emptyToNull(product.productionUse),
    production_notes: emptyToNull(product.productionNotes),
    is_featured: product.isFeatured === true,
    sort_order: Number(product.sortOrder || 0),
    subcategory: emptyToNull(product.subcategory),
  };
}

function mapCatalogStatusToCanonical(status, product = {}) {
  if (status === "archived") {
    return {
      active: false,
      readiness_status: "ARCHIVED",
      sellable: false,
      purchasable: false,
      archived_at: product.archivedAt || new Date().toISOString(),
      archive_reason: product.archiveReason || "Archived from Admin Product editor",
    };
  }
  if (status === "published") {
    return {
      active: true,
      readiness_status: "READY_FOR_SALE",
      sellable: true,
      purchasable: false,
      archived_at: null,
      archived_by_user_id: null,
      archive_reason: null,
    };
  }
  if (status === "hidden") {
    return {
      active: true,
      readiness_status: "NEEDS_SETUP",
      sellable: false,
      purchasable: false,
      archived_at: null,
      archived_by_user_id: null,
      archive_reason: null,
    };
  }
  return {
    active: true,
    readiness_status: "DRAFT",
    sellable: false,
    purchasable: false,
    archived_at: null,
    archived_by_user_id: null,
    archive_reason: null,
  };
}

async function replaceProductVariants(savedProduct, product, accessToken) {
  const desiredVariants = buildDesiredVariants(product);
  const existingRows = await readSupabaseTableWithAuth(
    PRODUCT_VARIANTS_TABLE,
    { select: "*", product_id: `eq.${savedProduct.id}`, order: "created_at.asc" },
    accessToken
  );

  const plan = buildVariantReconciliationPlan(existingRows, desiredVariants);

  for (const match of plan.updates) {
    await updateSupabaseRowsWithAuth(
      PRODUCT_VARIANTS_TABLE,
      { id: `eq.${match.existing.id}` },
      mapVariantToRow(match.desired, product, { update: true }),
      accessToken
    );
  }

  for (const match of plan.reactivations) {
    await updateSupabaseRowsWithAuth(
      PRODUCT_VARIANTS_TABLE,
      { id: `eq.${match.existing.id}` },
      mapVariantToRow(match.desired, product, { update: true }),
      accessToken
    );
  }

  for (const desired of plan.inserts) {
    await createSupabaseRowWithAuth(
      PRODUCT_VARIANTS_TABLE,
      mapVariantToRow(desired, product, { productId: savedProduct.id }),
      accessToken
    );
  }

  for (const stale of plan.archives) {
    await updateSupabaseRowsWithAuth(
      PRODUCT_VARIANTS_TABLE,
      { id: `eq.${stale.id}` },
      {
        active: false,
        archived_at: new Date().toISOString(),
        archive_reason: "Removed from Product editor",
        updated_at: new Date().toISOString(),
      },
      accessToken
    );
  }
}

function buildDesiredVariants(product) {
  const supplied = Array.isArray(product.variants) ? product.variants.filter((variant) => variant?.active !== false) : [];
  if (supplied.length) {
    return supplied.map((variant) => ({
      id: variant.id || "",
      masterVariantId: variant.masterVariantId || variant.master_variant_id || "",
      size: variant.size || "",
      color: variant.color || "",
      sellingPrice: variant.sellingPrice ?? product.startingPrice ?? 0,
      unitCost: variant.unitCost ?? product.unitCost ?? 0,
      variantType: variant.variantType || getVariantTypeForProduct(product.productType),
    }));
  }

  const sizes = Array.isArray(product.availableSizes) && product.availableSizes.length ? product.availableSizes : [""];
  const colors = Array.isArray(product.availableColors) && product.availableColors.length ? product.availableColors : [""];
  return sizes.flatMap((size) => colors.map((color) => ({
    id: "",
    masterVariantId: "",
    size,
    color,
    sellingPrice: product.startingPrice || 0,
    unitCost: product.unitCost || 0,
    variantType: getVariantTypeForProduct(product.productType),
  })));
}

export function buildVariantReconciliationPlan(existingRows, desiredVariants) {
  const rows = Array.isArray(existingRows) ? existingRows : [];
  const activeRows = rows.filter(isActiveVariantRow);
  const archivedRows = rows.filter((row) => !isActiveVariantRow(row));
  const desiredRows = Array.isArray(desiredVariants) ? desiredVariants : [];

  assertUniqueDesiredVariantCombinations(desiredRows);

  const activeById = indexRowsByValue(activeRows, (row) => row.id);
  const activeByMasterVariantId = indexRowsByValue(activeRows, (row) => row.master_variant_id);
  const activeByCombination = indexRowsByValue(activeRows, getVariantCombinationKey, { unique: true });
  const archivedById = indexRowsByValue(archivedRows, (row) => row.id);
  const archivedByMasterVariantId = indexRowsByValue(archivedRows, (row) => row.master_variant_id);
  const archivedByCombination = indexRowsByValue(archivedRows, getVariantCombinationKey, { unique: true });
  const matchedActiveIds = new Set();
  const matchedArchivedIds = new Set();
  const updates = [];
  const reactivations = [];
  const inserts = [];

  for (const desired of desiredRows) {
    const match = findVariantMatch(desired, {
      activeById,
      activeByMasterVariantId,
      activeByCombination,
      archivedById,
      archivedByMasterVariantId,
      archivedByCombination,
    });

    if (match) {
      assertVariantMatchIsSafe(match, desired);
      if (matchedActiveIds.has(match.id) || matchedArchivedIds.has(match.id)) {
        throw new Error("Duplicate Variant identity in Product editor draft.");
      }
      if (isActiveVariantRow(match)) {
        matchedActiveIds.add(match.id);
        updates.push({ existing: match, desired });
      } else {
        matchedArchivedIds.add(match.id);
        reactivations.push({ existing: match, desired });
      }
    } else {
      inserts.push(desired);
    }
  }

  const archives = activeRows.filter((row) => !matchedActiveIds.has(row.id));
  return { updates, reactivations, inserts, archives };
}

function findVariantMatch(desired, indexes) {
  const id = String(desired.id || "").trim();
  const masterVariantId = String(desired.masterVariantId || desired.master_variant_id || "").trim();
  const combinationKey = getVariantCombinationKey(desired);
  const idMatch = id ? indexes.activeById.get(id) ?? indexes.archivedById.get(id) : null;
  const masterMatch = masterVariantId ? indexes.activeByMasterVariantId.get(masterVariantId) ?? indexes.archivedByMasterVariantId.get(masterVariantId) : null;

  if (id && !idMatch) {
    throw new Error("Variant ID was not found for this Product.");
  }
  if (masterVariantId && !masterMatch) {
    throw new Error("Master Variant ID was not found for this Product.");
  }
  if (idMatch && masterMatch && idMatch.id !== masterMatch.id) {
    throw new Error("Variant ID and Master Variant ID refer to different persisted variants.");
  }
  const activeCombinationMatch = indexes.activeByCombination.get(combinationKey);
  if (idMatch && !isActiveVariantRow(idMatch) && activeCombinationMatch && activeCombinationMatch.id !== idMatch.id) {
    throw new Error("Archived Variant identity cannot be restored over an active matching combination.");
  }
  if (masterMatch && !isActiveVariantRow(masterMatch) && activeCombinationMatch && activeCombinationMatch.id !== masterMatch.id) {
    throw new Error("Archived Master Variant identity cannot be restored over an active matching combination.");
  }
  if (idMatch) return idMatch;
  if (masterMatch) return masterMatch;
  return activeCombinationMatch ?? indexes.archivedByCombination.get(combinationKey) ?? null;
}

function assertUniqueDesiredVariantCombinations(variants) {
  const seen = new Map();
  for (const variant of variants) {
    const key = getVariantCombinationKey(variant);
    if (seen.has(key)) {
      throw new Error("Duplicate size and color combination in Product editor draft.");
    }
    seen.set(key, variant);
  }
}

function assertVariantMatchIsSafe(existing, desired) {
  if (getVariantCombinationKey(existing) !== getVariantCombinationKey(desired)) {
    const existingLabel = formatVariantCombination(existing);
    const desiredLabel = formatVariantCombination(desired);
    throw new Error(`Variant identity conflict: persisted ${existingLabel} cannot be saved as ${desiredLabel}.`);
  }
}

function indexRowsByValue(rows, getValue, { unique = false } = {}) {
  const index = new Map();
  const duplicateValues = new Set();
  for (const row of rows) {
    const value = String(getValue(row) || "").trim();
    if (!value) continue;
    if (index.has(value)) duplicateValues.add(value);
    index.set(value, row);
  }
  if (unique && duplicateValues.size) {
    throw new Error("Duplicate persisted Variant size and color combination requires manual cleanup before save.");
  }
  return index;
}

function isActiveVariantRow(row) {
  return row?.active !== false && !row?.archived_at && !row?.archivedAt;
}

function getVariantCombinationKey(variant) {
  return `${normalizeVariantIdentityToken(variant?.color)}\u0000${normalizeVariantIdentityToken(variant?.size)}`;
}

function normalizeVariantIdentityToken(value) {
  return String(value || "").trim().toLowerCase();
}

function formatVariantCombination(variant) {
  const color = String(variant?.color || "").trim() || "blank color";
  const size = String(variant?.size || "").trim() || "blank size";
  return `${color}/${size}`;
}

export function mapVariantToRow(variant, product, options = {}) {
  const row = cleanRow({
    product_id: options.productId,
    master_variant_id: undefined,
    sku: undefined,
    global_sku: undefined,
    size: emptyToNull(variant.size),
    color: emptyToNull(variant.color),
    selling_price: Number(variant.sellingPrice || 0),
    unit_cost: Number(variant.unitCost || 0),
    variant_type: variant.variantType || getVariantTypeForProduct(product.productType),
    active: true,
    archived_at: null,
    archived_by_user_id: null,
    archive_reason: null,
    updated_at: new Date().toISOString(),
  });
  return row;
}

async function replaceProductImages(productId, images, accessToken) {
  const payload = images.slice(0, 6).map((image) => ({
    id: image.id || undefined,
    storagePath: image.storagePath || image.storage_path || "",
    publicUrl: image.publicUrl || image.public_url || image.url || "",
    altText: image.altText || image.alt_text || "",
    isPrimary: image.isPrimary === true || image.is_primary === true,
  })).filter((image) => image.storagePath);
  await executeSupabaseRpcWithAuth("set_product_images_for_product", {
    p_product_id: productId,
    p_images: payload,
  }, accessToken);
}

function mapCanonicalRowToProduct(row, category, brand, variants, images) {
  const typedConfig = isPlainObject(row.typed_config) ? row.typed_config : {};
  const mappedImages = images
    .slice()
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
    .map(mapImageRowToProductImage);
  const primaryImage = mappedImages.find((image) => image.isPrimary) ?? mappedImages[0] ?? null;
  const activeVariants = variants.filter((variant) => variant.active !== false && !variant.archived_at);
  const primaryVariant = activeVariants[0] ?? null;
  const catalogKeys = mapChannelsToCatalogKeys(row.eligible_channels);
  const catalogKey = catalogKeys[0] ?? catalogOptions[0].key;

  return {
    id: row.id,
    masterProductId: row.master_product_id,
    productCode: row.product_code,
    catalogKey,
    catalogKeys,
    name: row.name,
    slug: row.product_code,
    categoryId: row.category_id,
    category: category?.name ?? "",
    categoryCode: category?.code ?? "",
    brandId: row.brand_id ?? "",
    brandCode: brand?.brand_code ?? "",
    brandName: brand?.name ?? row.brand ?? "",
    brandStatus: brand?.status ?? "",
    brand: brand?.name ?? row.brand ?? "",
    description: row.description ?? "",
    imageUrl: primaryImage?.url ?? "",
    images: mappedImages,
    startingPrice: primaryVariant?.selling_price === null || primaryVariant?.selling_price === undefined ? "" : String(primaryVariant.selling_price),
    unitCost: primaryVariant?.unit_cost === null || primaryVariant?.unit_cost === undefined ? "" : String(primaryVariant.unit_cost),
    priceLabel: typedConfig.price_label ?? "",
    minimumQuantity: Number(typedConfig.minimum_quantity ?? 1),
    availableSizes: uniqueList(activeVariants.map((variant) => variant.size).filter(Boolean)),
    availableColors: uniqueList(activeVariants.map((variant) => variant.color).filter(Boolean)),
    printMethods: Array.isArray(typedConfig.print_methods) ? typedConfig.print_methods : [],
    sortOrder: Number(typedConfig.sort_order ?? 0),
    isFeatured: typedConfig.is_featured === true,
    status: mapCanonicalStatusToCatalog(row),
    productType: normalizeProductType(row.product_type),
    subcategory: typedConfig.subcategory ?? "",
    material: typedConfig.material ?? "",
    weightGsm: typedConfig.weight_gsm ?? "",
    fitCut: typedConfig.fit_cut ?? "",
    productionUse: typedConfig.production_use ?? "",
    productionNotes: typedConfig.production_notes ?? "",
    variants: activeVariants.map(mapVariantRowToProductVariant),
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
    archivedAt: row.archived_at ?? "",
    archiveReason: row.archive_reason ?? "",
  };
}

function mapImageRowToProductImage(row) {
  return {
    id: row.id,
    storagePath: row.storage_path,
    publicUrl: row.public_url ?? "",
    url: row.public_url ?? "",
    altText: row.alt_text ?? "",
    position: Number(row.position ?? 0),
    isPrimary: row.is_primary === true,
  };
}

function mapVariantRowToProductVariant(row) {
  return {
    id: row.id,
    masterVariantId: row.master_variant_id,
    sku: row.sku,
    globalSku: row.global_sku,
    size: row.size ?? "",
    color: row.color ?? "",
    sellingPrice: row.selling_price === null || row.selling_price === undefined ? "" : String(row.selling_price),
    unitCost: row.unit_cost === null || row.unit_cost === undefined ? "" : String(row.unit_cost),
    variantType: row.variant_type ?? "STANDARD",
    active: row.active !== false,
  };
}

function mapCanonicalStatusToCatalog(row) {
  if (row.readiness_status === "ARCHIVED" || row.active === false || row.archived_at) return "archived";
  if (row.sellable === true || row.readiness_status === "READY_FOR_SALE") return "published";
  if (row.readiness_status === "NEEDS_SETUP") return "hidden";
  return "draft";
}

function mapCatalogKeysToChannels(keys) {
  const normalizedKeys = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
  const channels = normalizedKeys
    .map((key) => catalogOptions.find((catalog) => catalog.key === key)?.channel || String(key).trim().toUpperCase())
    .filter((channel) => canonicalSalesChannelCodes.has(channel))
    .filter(Boolean);
  return Array.from(new Set(channels));
}

function mapChannelsToCatalogKeys(channels) {
  return (Array.isArray(channels) ? channels : [])
    .map((channel) => catalogOptions.find((catalog) => catalog.channel === channel)?.key)
    .filter(Boolean);
}

function getVariantTypeForProduct(productType) {
  if (productType === "SERVICE") return "SERVICE_TIER";
  if (productType === "MATERIAL_SUPPLY") return "SUPPLY_OPTION";
  return "STANDARD";
}

function sortCatalogProducts(a, b) {
  return a.catalogKey.localeCompare(b.catalogKey) || Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || a.name.localeCompare(b.name);
}

function sortBrands(a, b) {
  const statusRank = Number(a.status === "archived") - Number(b.status === "archived");
  return statusRank || a.name.localeCompare(b.name);
}

function mapLegacyCatalogRowToProduct(row) {
  return {
    id: row.id,
    catalogKey: row.catalog_key,
    catalogKeys: [row.catalog_key].filter(Boolean),
    name: row.name,
    slug: row.slug,
    category: row.category ?? "",
    description: row.description ?? "",
    imageUrl: row.image_url ?? "",
    images: row.image_url ? [{ url: row.image_url, publicUrl: row.image_url, storagePath: "", isPrimary: true, position: 0 }] : [],
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

function mapBrandRowToBrand(row, productCount = 0) {
  return {
    id: row.id,
    brandCode: row.brand_code,
    name: row.name,
    ownershipType: row.ownership_type,
    ownerName: row.owner_name,
    websiteSlug: row.website_slug ?? "",
    status: row.status,
    active: row.status === "active",
    productCount: Number(productCount ?? 0),
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

function mapBrandToRow(brand, { edit = false } = {}) {
  return cleanRow({
    brand_code: edit ? undefined : String(brand.brandCode ?? "").trim().toUpperCase(),
    name: brand.name,
    ownership_type: brand.ownershipType,
    owner_name: brand.ownerName,
    website_slug: emptyToNull(brand.websiteSlug),
    status: brand.status || "active",
    updated_at: new Date().toISOString(),
  });
}

function getBrandProductCounts(rows) {
  const counts = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row.brand_id) continue;
    counts.set(row.brand_id, (counts.get(row.brand_id) ?? 0) + 1);
  }
  return counts;
}

function assertValidCategoryForWrite(category) {
  if (!normalizeProductType(category?.productType)) {
    throw new Error("Select a product type.");
  }
}

function assertValidBrandForWrite(brand, { edit = false } = {}) {
  if (!edit && !String(brand?.brandCode ?? "").trim()) throw new Error("Brand Code is required.");
  if (!String(brand?.name ?? "").trim()) throw new Error("Brand name is required.");
  if (!String(brand?.ownerName ?? "").trim()) throw new Error("Owner name is required.");
  if (!["internal", "partner"].includes(brand?.ownershipType)) throw new Error("Choose a valid ownership type.");
  if (!["active", "archived"].includes(brand?.status || "active")) throw new Error("Choose a valid brand status.");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function getBrandWriteError(error) {
  const message = String(error?.message || error || "");
  const mappings = [
    ["BRAND_CODE_IMMUTABLE", "Brand Code cannot be changed after creation."],
    ["BRAND_HAS_ASSIGNED_PRODUCTS", "Archive is blocked while products are assigned to this Brand."],
    ["duplicate key", "Brand Code, name, and website slug must be unique."],
    ["brands_brand_code_not_blank", "Brand Code is required."],
    ["brands_name_not_blank", "Brand name is required."],
    ["brands_owner_name_not_blank", "Owner name is required."],
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

function groupBy(rows, key) {
  const grouped = new Map();
  for (const row of rows) {
    const groupKey = row[key];
    if (!groupKey) continue;
    const group = grouped.get(groupKey) ?? [];
    group.push(row);
    grouped.set(groupKey, group);
  }
  return grouped;
}

function uniqueList(values) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}
