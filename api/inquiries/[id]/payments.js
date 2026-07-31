import { createServerSupabaseClient } from "../../_lib/supabaseServer.js";
import {
  RECEIPT_BUCKET,
  isSafeReceiptPath,
  receiptExtensionsMatch,
  sanitizeReceiptFilename,
  validateReceiptUploadMetadata,
} from "../../_lib/receiptValidation.js";

const ONLINE_PAYMENT_METHODS = new Set(["gcash", "bank_transfer"]);
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
      const validation = getPaymentAllowedError(inquiry);
      if (validation) return paymentError(response, validation.status, validation.code, validation.message);
      const receipt = validateReceiptUploadMetadata(body);
      if (!receipt.ok) return paymentError(response, 400, receipt.code, receipt.message);

      const receiptPath = `${inquiryReference}/payments/${crypto.randomUUID()}-${receipt.filename}`;
      const { data: signed, error: signedError } = await supabase.storage
        .from(RECEIPT_BUCKET)
        .createSignedUploadUrl(receiptPath, { upsert: false });
      if (signedError || !signed?.signedUrl) {
        console.error("Receipt signed upload preparation failed.", { code: signedError?.code || "SIGNED_URL_MISSING" });
        return paymentError(response, 503, "STORAGE_UPLOAD_UNAVAILABLE", "Receipt upload is temporarily unavailable.");
      }

      return sendJson(response, 200, { ok: true, upload: { signedUrl: signed.signedUrl, path: receiptPath, contentType: receipt.contentType } });
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
  const paymentMethod = cleanPaymentMethod(body.paymentMethod);
  const expected = expectedPaymentAmount(inquiry, paymentType);
  const proofPath = cleanText(body.proofPath, 500);
  const receiptFilename = sanitizeReceiptFilename(cleanText(body.receiptFilename, 180));
  const receiptContentType = cleanText(body.receiptContentType, 120).toLowerCase() || "application/octet-stream";
  const receiptSize = Number(body.receiptSize);
  const receipt = validateReceiptUploadMetadata({
    filename: receiptFilename,
    fileSize: receiptSize,
    contentType: receiptContentType,
  });
  if (!Number.isFinite(selectedAmount) || selectedAmount <= 0) return { error: "invalid payment amount" };
  if (!expected.ok || Math.abs(selectedAmount - expected.amount) > 0.009) return { error: expected.error || "payment amount does not match quote" };
  if (!ONLINE_PAYMENT_METHODS.has(paymentMethod)) return { error: "select GCash or bank transfer" };
  if (!isSafeReceiptPath(proofPath, inquiry.id)) return { error: "invalid receipt upload" };
  if (!receipt.ok) return { error: receipt.message };
  if (!receiptExtensionsMatch(proofPath, receiptFilename)) return { error: "receipt metadata does not match the upload" };

  return {
    values: {
      payment_method: paymentMethod,
      payment_type: paymentType,
      payment_selected_amount: selectedAmount,
      payment_reference: cleanText(body.referenceNumber, 120) || null,
      payment_customer_note: cleanText(body.customerNote, 1000) || null,
      payment_receipt_filename: receiptFilename,
      payment_receipt_content_type: receiptContentType,
      payment_receipt_size: receiptSize,
      payment_proof_path: proofPath,
      payment_proof_submitted_at: now,
      payment_status: "proof_submitted",
      payment_review_note: null,
      payment_rejected_at: null,
    },
  };
}

export function getPaymentAllowedError(inquiry) {
  const quoteStatus = cleanKey(inquiry.quote_status);
  const artworkStatus = cleanKey(inquiry.artwork_status);
  const paymentStatus = cleanKey(inquiry.payment_status) || "required";

  if (quoteStatus !== "approved") {
    return { status: 400, code: "INQUIRY_NOT_PAYMENT_ELIGIBLE", message: "Approved quotation is required before payment." };
  }
  if (!(Number(inquiry.quoted_amount) > 0)) {
    return { status: 400, code: "INQUIRY_NOT_PAYMENT_ELIGIBLE", message: "A valid quote total is required before payment." };
  }
  if (["proof_submitted", "under_review", "down_payment_confirmed", "full_payment_confirmed", "partially_paid", "paid", "confirmed"].includes(paymentStatus)) {
    return { status: 400, code: "PAYMENT_STATE_UNSUPPORTED", message: "Payment is not open for receipt changes." };
  }
  if (!["required", "correction_required", "not_required"].includes(paymentStatus)) {
    return { status: 400, code: "PAYMENT_STATE_UNSUPPORTED", message: "Payment is not open for receipt changes." };
  }
  if (artworkStatus && !["approved", "missing"].includes(artworkStatus)) {
    return { status: 400, code: "INQUIRY_NOT_PAYMENT_ELIGIBLE", message: "Approved artwork is required before payment." };
  }
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

function cleanKey(value) {
  return cleanText(value, 80).toLowerCase().replace(/[\s-]+/g, "_");
}

function paymentError(response, status, code, message) {
  return sendJson(response, status, { ok: false, error: message, errorCode: code });
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}
