import { getSupabaseConfig, isSupabaseReady } from "../lib/supabaseClient.js";

export const CATALOG_IMAGES_BUCKET = "catalog-images";
export const CATALOG_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const CATALOG_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

const CATALOG_IMAGE_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

export function validateCatalogImageFile(file) {
  if (!file) return "Choose an image file.";
  if (file.size <= 0) return "Image file is empty.";
  if (!CATALOG_IMAGE_MIME_TYPES.has(file.type)) return "Use JPG, PNG, WEBP, or AVIF only.";
  if (file.size > CATALOG_IMAGE_MAX_BYTES) return "Image must be 5 MB or smaller.";
  return "";
}

export async function validateCatalogImageFileWithDimensions(file) {
  const validationError = validateCatalogImageFile(file);
  if (validationError) return validationError;

  const dimensions = await readImageDimensions(file);
  if (dimensions.width !== dimensions.height) {
    return "IMAGE MUST BE SQUARE.\nUpload a 1:1 image, such as 1200 × 1200 px.";
  }

  if (dimensions.width < 800 || dimensions.height < 800) {
    return "IMAGE IS TOO SMALL.\nUpload at least 800 × 800 px.";
  }

  return "";
}

export async function uploadCatalogImage(file, product, authSession) {
  const validationError = await validateCatalogImageFileWithDimensions(file);
  if (validationError) throw new Error(validationError);

  const config = getStorageConfig();
  const path = createCatalogImagePath(file, product);
  const response = await fetch(`${config.url}/storage/v1/object/${CATALOG_IMAGES_BUCKET}/${encodeStoragePath(path)}`, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${getAccessToken(authSession)}`,
      "Content-Type": file.type,
      "x-upsert": "false",
    },
    body: file,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Image upload failed. ${message || response.status}`);
  }

  return {
    path,
    publicUrl: getCatalogImagePublicUrl(path),
  };
}

export async function deleteCatalogImageByUrl(url, authSession) {
  const path = getCatalogImagePathFromPublicUrl(url);
  if (!path) return false;
  await deleteCatalogImagePath(path, authSession);
  return true;
}

export async function deleteCatalogImagePath(path, authSession) {
  if (!path) return;

  const config = getStorageConfig();
  const response = await fetch(`${config.url}/storage/v1/object/${CATALOG_IMAGES_BUCKET}`, {
    method: "DELETE",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${getAccessToken(authSession)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefixes: [path] }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Image cleanup failed. ${message || response.status}`);
  }
}

export function getCatalogImagePathFromPublicUrl(url) {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) return "";

  try {
    const config = getStorageConfig();
    const publicPrefix = `${config.url}/storage/v1/object/public/${CATALOG_IMAGES_BUCKET}/`;
    if (!normalizedUrl.startsWith(publicPrefix)) return "";
    return decodeURIComponent(normalizedUrl.slice(publicPrefix.length));
  } catch {
    return "";
  }
}

function getCatalogImagePublicUrl(path) {
  const config = getStorageConfig();
  return `${config.url}/storage/v1/object/public/${CATALOG_IMAGES_BUCKET}/${encodeStoragePath(path)}`;
}

function createCatalogImagePath(file, product) {
  const catalogKey = slugSegment(product.catalogKey || "catalog");
  const ownerId = slugSegment(product.id || product.imageDraftId || product.slug || product.name || "draft");
  const safeName = safeFilename(file.name, CATALOG_IMAGE_EXTENSIONS[file.type]);
  return `${catalogKey}/${ownerId}/${Date.now()}-${randomId()}-${safeName}`;
}

function safeFilename(name, fallbackExtension) {
  const cleaned = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const withoutSvg = cleaned.replace(/\.svgz?$/i, "");
  const hasExtension = /\.[a-z0-9]+$/.test(withoutSvg);
  return hasExtension ? withoutSvg : `catalog-image.${fallbackExtension}`;
}

function slugSegment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "item";
}

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Math.random().toString(36).slice(2, 12);
}

function encodeStoragePath(path) {
  return String(path || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function getStorageConfig() {
  if (!isSupabaseReady()) throw new Error("Supabase storage is not configured.");

  const config = getSupabaseConfig();
  if (!config.url || !config.anonKey) throw new Error("Supabase storage env is missing.");
  return config;
}

function getAccessToken(authSession) {
  const accessToken = typeof authSession === "string" ? authSession : authSession?.access_token;
  if (!accessToken) throw new Error("Supabase auth session is required for catalog images.");
  return accessToken;
}

function readImageDimensions(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to read image dimensions."));
    };

    image.src = objectUrl;
  });
}