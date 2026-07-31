export const RECEIPT_BUCKET = "inquiry-artworks";
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;

const RECEIPT_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif", "pdf"]);
const WILDCARD_IMAGE_TYPES = /^image\/[-+.\w]+$/i;

export function sanitizeReceiptFilename(value) {
  const normalized = String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return normalized
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 180);
}

export function receiptExtension(value) {
  return String(value || "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
}

export function normalizeReceiptContentType(value) {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, 120) : "";
}

export function isAcceptedReceiptExtension(extension) {
  return RECEIPT_EXTENSIONS.has(String(extension || "").toLowerCase());
}

export function isAcceptedReceiptType(filename, contentType) {
  const extension = receiptExtension(filename);
  const type = normalizeReceiptContentType(contentType);

  if (!isAcceptedReceiptExtension(extension)) return false;
  if (!type || type === "application/octet-stream") return true;
  if (extension === "pdf") return type === "application/pdf";
  if (type === "application/pdf") return false;
  return WILDCARD_IMAGE_TYPES.test(type);
}

export function validateReceiptUploadMetadata({ filename, fileSize, contentType }) {
  const safeFilename = sanitizeReceiptFilename(filename);
  const size = Number(fileSize);

  if (!safeFilename || !isAcceptedReceiptExtension(receiptExtension(safeFilename))) {
    return { ok: false, code: "INVALID_RECEIPT_TYPE", message: "Upload an image or PDF receipt." };
  }
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, code: "EMPTY_RECEIPT_FILE", message: "The selected receipt file is empty." };
  }
  if (size > RECEIPT_MAX_BYTES) {
    return { ok: false, code: "RECEIPT_TOO_LARGE", message: "The selected receipt is larger than 10 MB." };
  }
  if (!isAcceptedReceiptType(safeFilename, contentType)) {
    return { ok: false, code: "INVALID_RECEIPT_TYPE", message: "Upload an image or PDF receipt." };
  }

  return {
    ok: true,
    filename: safeFilename,
    fileSize: size,
    contentType: normalizeReceiptContentType(contentType) || "application/octet-stream",
  };
}

export function isSafeReceiptPath(path, inquiryReference) {
  const prefix = `${inquiryReference}/payments/`;
  const objectName = String(path || "").startsWith(prefix) ? String(path).slice(prefix.length) : "";
  return Boolean(
    objectName
    && !objectName.includes("/")
    && !objectName.includes("\\")
    && isAcceptedReceiptExtension(receiptExtension(objectName))
  );
}

export function receiptExtensionsMatch(path, filename) {
  const pathExtension = receiptExtension(path);
  const filenameExtension = receiptExtension(filename);
  if (["jpg", "jpeg"].includes(pathExtension) && ["jpg", "jpeg"].includes(filenameExtension)) return true;
  return pathExtension === filenameExtension;
}

export function receiptTypesMatch(left, right) {
  const normalizedLeft = normalizeReceiptContentType(left);
  const normalizedRight = normalizeReceiptContentType(right);
  if (!normalizedLeft || normalizedLeft === "application/octet-stream") return true;
  if (!normalizedRight || normalizedRight === "application/octet-stream") return true;
  return normalizedLeft === normalizedRight;
}
