import assert from "node:assert/strict";
import {
  RECEIPT_MAX_BYTES,
  isAcceptedReceiptType,
  isSafeReceiptPath,
  receiptExtensionsMatch,
  validateReceiptUploadMetadata,
} from "../api/_lib/receiptValidation.js";
import { getPaymentAllowedError } from "../api/inquiries/[id]/payments.js";

const accepted = [
  ["receipt.jpg", "image/jpeg"],
  ["receipt.jpeg", "image/jpeg"],
  ["receipt.png", "image/png"],
  ["receipt.heic", "image/heic"],
  ["receipt.heif", "image/heif"],
  ["receipt.webp", "image/webp"],
  ["receipt.pdf", "application/pdf"],
  ["receipt.png", ""],
  ["receipt.webp", "application/octet-stream"],
];

for (const [filename, contentType] of accepted) {
  const result = validateReceiptUploadMetadata({ filename, contentType, fileSize: 12345 });
  assert.equal(result.ok, true, `${filename} ${contentType || "blank MIME"} is accepted`);
}

assert.equal(validateReceiptUploadMetadata({ filename: "receipt.exe", contentType: "application/octet-stream", fileSize: 123 }).code, "INVALID_RECEIPT_TYPE");
assert.equal(validateReceiptUploadMetadata({ filename: "receipt.png", contentType: "image/png", fileSize: 0 }).code, "EMPTY_RECEIPT_FILE");
assert.equal(validateReceiptUploadMetadata({ filename: "receipt.png", contentType: "image/png", fileSize: RECEIPT_MAX_BYTES + 1 }).code, "RECEIPT_TOO_LARGE");
assert.equal(isAcceptedReceiptType("receipt.pdf", "image/png"), false);
assert.equal(isSafeReceiptPath("TRRY-ABC/payments/receipt.heic", "TRRY-ABC"), true);
assert.equal(isSafeReceiptPath("TRRY-ABC/other/receipt.heic", "TRRY-ABC"), false);
assert.equal(receiptExtensionsMatch("TRRY-ABC/payments/receipt.jpeg", "receipt.jpg"), true);

const eligible = {
  quote_status: "approved",
  artwork_status: "approved",
  quoted_amount: 1050,
  payment_status: "required",
};
assert.equal(getPaymentAllowedError(eligible), "");
assert.equal(getPaymentAllowedError({ ...eligible, artwork_status: "missing" }), "", "eligible legacy approved inquiry can prepare upload");
assert.equal(getPaymentAllowedError({ ...eligible, artwork_status: null }), "", "eligible legacy blank artwork state can prepare upload");
assert.equal(getPaymentAllowedError({ ...eligible, quote_status: "ready" }).code, "INQUIRY_NOT_PAYMENT_ELIGIBLE");
assert.equal(getPaymentAllowedError({ ...eligible, payment_status: "proof_submitted" }).code, "PAYMENT_STATE_UNSUPPORTED");
assert.equal(getPaymentAllowedError({ ...eligible, artwork_status: "approval_required" }).code, "INQUIRY_NOT_PAYMENT_ELIGIBLE");

console.log("PASS customer payment upload receipt policy and eligibility");
