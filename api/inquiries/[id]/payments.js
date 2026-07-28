import { createServerSupabaseClient } from "../../_lib/supabaseServer.js";

const RECEIPT_BUCKET = "inquiry-artworks";
const MAX_RECEIPT_SIZE = 10 * 1024 * 1024;
const RECEIPT_EXTENSIONS = new Set(["png", "jpg", "jpeg", "pdf"]);
const PAYMENT_SELECT = [
  "id",
  "quoted_amount",
  "amount_due",
  "quote_status",
  "artwork_status",
  "payment_status",
  "payment_proof_path",
  "payment_selected_amount",
  "payment_type",
  "payment_method",
  "payment_review_note",
].join(",");

export default async function handler(request, response) {
  if (process.env.ENABLE_CUSTOMER_PAYMENT_WORKFLOW !== "true") {
    return sendJson(response, 404, { ok: false, error: "payment workflow is not available" });
  }

  const inquiryReference = getInquiryReference(request);
  if (!/^[A-Z0-9][A-Z0-9_-]{2,79}$/.test(inquiryReference)) {
    return sendJson(response, 400, { ok: false, error: "invalid inquiry reference" });
  }

  if (request.method !== "GET" && request.method !== "POST") {
    return sendJson(response, 405, { ok: false, error: "method not allowed" });
  }

  try {
    const supabase = createServerSupabaseClient();
    const { data: inquiry, error } = await supabase
      .from("ops_inquiries")
      .select(PAYMENT_SELECT)
      .eq("id", inquiryReference)
      .maybeSingle();

    if (error) throw error;
    if (!inquiry) return sendJson(response, 404, { ok: false, error: "inquiry not found" });

    if (request.method === "GET") {
      return sendJson(response, 200, { ok: true, payment: toCustomerPayment(inquiry) });
    }

    const body = await readJsonBody(request);
    const action = cleanText(body.action, 80);
    const now = new Date().toISOString();

    if (action === "prepare_receipt_upload") {
      const filename = sanitizeFilename(cleanText(body.filename, 180));
      const fileSize = Number(body.fileSize);
      const contentType = cleanText(body.contentType, 120) || "application/octet-stream";
      const validation = getPaymentAllowedError(inquiry);
      if (validation) return sendJson(response, 400, { ok: false, error: validation });
      if (!filename || !RECEIPT_EXTENSIONS.has(getExtension(filename))) return sendJson(response, 400, { ok: false, error: "upload PNG, JPG, or PDF receipt" });
      if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_RECEIPT_SIZE) return sendJson(response, 400, { ok: false, error: "receipt must be between 1 byte and 10 MB" });

      const receiptPath = `${inquiryReference}/payments/${crypto.randomUUID()}-${filename}`;
      const { data: signed, error: signedError } = await supabase.storage
        .from(RECEIPT_BUCKET)
        .createSignedUploadUrl(receiptPath, { upsert: false });
      if (signedError || !signed?.signedUrl) throw signedError || new Error("Signed upload URL missing.");

      return sendJson(response, 200, { ok: true, upload: { signedUrl: signed.signedUrl, path: receiptPath, contentType } });
    }

    const updates = buildPaymentUpdate(action, body, inquiry, now);
    if (updates.error) return sendJson(response, 400, { ok: false, error: updates.error });

    const { data: updated, error: updateError } = await supabase
      .from("ops_inquiries")
      .update({ ...updates.values, updated_at: now })
      .eq("id", inquiryReference)
      .select(PAYMENT_SELECT)
      .single();

    if (updateError) throw updateError;
    return sendJson(response, 200, { ok: true, payment: toCustomerPayment(updated) });
  } catch (error) {
    console.error("Customer payment action failed.", { message: error?.message, code: error?.code });
    const schemaMissing = /payment_selected_amount|payment_type|payment_method|payment_reference|schema cache|could not find/i.test(String(error?.message || ""));
    return sendJson(response, schemaMissing ? 503 : 500, {
      ok: false,
      error: schemaMissing ? "payment database fields are not ready" : "payment action failed",
    });
  }
}

function buildPaymentUpdate(action, body, inquiry, now) {
  const validation = getPaymentAllowedError(inquiry);
  if (validation) return { error: validation };

  if (action === "pay_at_shop") {
    const method = cleanPaymentMethod(body.paymentMethod) || "cash";
    return {
      values: {
        payment_method: method,
        payment_type: "shop",
        payment_selected_amount: null,
        payment_status: "pay_at_shop",
        payment_review_note: null,
        payment_rejected_at: null,
      },
    };
  }

  if (action !== "submit_receipt") return { error: "invalid payment action" };

  const selectedAmount = getMoney(body.selectedAmount);
  const paymentType = cleanPaymentType(body.paymentType);
  const expected = expectedPaymentAmount(inquiry, paymentType);
  const proofPath = cleanText(body.proofPath, 500);
  if (!Number.isFinite(selectedAmount) || selectedAmount <= 0) return { error: "invalid payment amount" };
  if (!expected.ok || Math.abs(selectedAmount - expected.amount) > 0.009) return { error: expected.error || "payment amount does not match quote" };
  if (!isValidReceiptPath(proofPath, inquiry.id)) return { error: "invalid receipt upload" };

  return {
    values: {
      payment_method: "online",
      payment_type: paymentType,
      payment_selected_amount: selectedAmount,
      payment_reference: cleanText(body.referenceNumber, 120) || null,
      payment_customer_note: cleanText(body.customerNote, 1000) || null,
      payment_receipt_filename: sanitizeFilename(cleanText(body.receiptFilename, 180)) || null,
      payment_receipt_content_type: cleanText(body.receiptContentType, 120) || null,
      payment_receipt_size: Number.isFinite(Number(body.receiptSize)) ? Number(body.receiptSize) : null,
      payment_proof_path: proofPath,
      payment_proof_submitted_at: now,
      payment_status: "proof_submitted",
      payment_review_note: null,
      payment_rejected_at: null,
    },
  };
}

function getPaymentAllowedError(inquiry) {
  if (String(inquiry.quote_status || "") !== "approved") return "approved quote required";
  if (String(inquiry.artwork_status || "") !== "approved") return "approved artwork required";
  if (!(Number(inquiry.quoted_amount) > 0)) return "valid quote total required";
  if (["proof_submitted", "under_review", "down_payment_confirmed", "full_payment_confirmed", "partially_paid", "paid", "confirmed"].includes(String(inquiry.payment_status || ""))) return "payment is not open for changes";
  return "";
}

function expectedPaymentAmount(inquiry, paymentType) {
  const total = Number(inquiry.quoted_amount);
  if (!Number.isFinite(total) || total <= 0) return { ok: false, error: "valid quote total required" };
  if (paymentType === "full") return { ok: true, amount: total };
  if (paymentType === "down_payment") {
    if (total < 1000) return { ok: false, error: "down payment is only available for quotes of 1000 or more" };
    return { ok: true, amount: roundMoney(total * 0.5) };
  }
  return { ok: false, error: "invalid payment type" };
}

function toCustomerPayment(row) {
  const total = Number(row.quoted_amount) || 0;
  return {
    inquiryId: row.id,
    quoteTotal: total,
    fullAmount: total,
    downPaymentAmount: total >= 1000 ? roundMoney(total * 0.5) : null,
    paymentStatus: row.payment_status || "required",
    selectedAmount: numberOrNull(row.payment_selected_amount),
    paymentType: row.payment_type || "",
    paymentMethod: row.payment_method || "",
    reviewNote: row.payment_review_note || "",
  };
}

async function readJsonBody(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) return request.body;
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return {}; }
}

function getInquiryReference(request) {
  const queryId = Array.isArray(request.query?.id) ? request.query.id[0] : request.query?.id;
  if (queryId) return String(queryId).trim().toUpperCase();
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const match = url.pathname.match(/^\/api\/inquiries\/([^/]+)\/payments\/?$/);
  return match ? decodeURIComponent(match[1]).trim().toUpperCase() : "";
}

function cleanPaymentType(value) {
  const key = cleanText(value, 80).toLowerCase().replace(/[\s-]+/g, "_");
  return key === "down_payment" || key === "full" ? key : "";
}

function cleanPaymentMethod(value) {
  const key = cleanText(value, 80).toLowerCase().replace(/[\s-]+/g, "_");
  return ["cash", "gcash", "bank_transfer", "card", "other"].includes(key) ? key : "";
}

function isValidReceiptPath(path, inquiryReference) {
  return path.startsWith(`${inquiryReference}/payments/`) && RECEIPT_EXTENSIONS.has(getExtension(path));
}

function getMoney(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.trim().replace(/,/g, "");
    if (normalized && Number.isFinite(Number(normalized))) return Number(normalized);
  }
  return NaN;
}

function numberOrNull(value) {
  const number = getMoney(value);
  return Number.isFinite(number) ? number : null;
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function sanitizeFilename(filename) {
  const normalized = filename.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return normalized.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "";
}

function getExtension(filename) {
  const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}
