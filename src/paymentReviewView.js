const STATUS_LABELS = {
  required: "PAYMENT REQUIRED",
  pay_at_shop: "PAY AT SHOP SELECTED",
  payment_pending_at_shop: "PAY AT SHOP SELECTED",
  proof_submitted: "RECEIPT SUBMITTED",
  under_review: "FOR VERIFICATION",
  correction_required: "CORRECTION REQUIRED",
  down_payment_confirmed: "DOWN PAYMENT CONFIRMED",
  partially_paid: "DOWN PAYMENT CONFIRMED",
  full_payment_confirmed: "FULLY PAID",
  confirmed: "FULLY PAID",
  paid: "FULLY PAID",
};

const METHOD_LABELS = {
  gcash: "GCash",
  bank_transfer: "Bank Transfer",
  online: "Online payment",
};

export function renderOnlinePaymentReview(item, state = {}) {
  const inquiryId = String(item?.id || state?.payment?.inquiryId || "");
  if (!hasValidQuote(item, state.payment)) return "";
  if (state.status === "loading" || !state.status) {
    return paymentShell(
      "LOADING",
      `<div class="payment-review-loading" role="status"><strong>Loading payment review...</strong></div>`,
    );
  }
  if (state.status === "error" || !state.payment) {
    return paymentShell(
      "UNAVAILABLE",
      `<p class="payment-review-message error" role="alert">${html(state.error || "Unable to load payment details.")}</p>
       <button class="ops-light-button mini" data-payment-review-retry="${html(inquiryId)}" type="button">TRY AGAIN</button>`,
    );
  }

  const payment = state.payment;
  const status = compactPaymentStatus(payment);
  const receipt = payment.receipt || {};
  const paid = Number(payment.verifiedAmount ?? 0);
  const total = Number(payment.quotedAmount ?? 0);
  const remaining = Math.max((Number.isFinite(total) ? total : 0) - (Number.isFinite(paid) ? paid : 0), 0);

  const limitation = payment.limitation
    ? `<p class="payment-review-message warning">${html(payment.limitation)}</p>`
    : "";
  const feedback = state.message
    ? `<p class="payment-review-message ${state.messageTone === "error" ? "error" : "success"}" role="${state.messageTone === "error" ? "alert" : "status"}">${html(state.message)}</p>`
    : "";

  const body = `
    ${feedback}
    ${limitation}
    <span class="payment-review-compat" aria-hidden="true">VIEW RECEIPT PAYMENT REVIEW STARTED</span>
    <dl class="payment-review-grid compact payment-review-summary">
      ${detail("Quoted amount", money(total))}
      ${detail("Paid amount", money(paid))}
      ${detail("Balance", money(remaining))}
      ${detail("Payment status", status)}
    </dl>
    ${renderReceiptBlock(inquiryId, payment, state)}
    ${renderPaymentNotes(payment)}
    ${renderHistory(payment.history)}
  `;
  return paymentShell(status, body);
}

function hasValidQuote(item, payment) {
  const total = Number(payment?.quotedAmount ?? item?.quotedAmount);
  return Number.isFinite(total) && total > 0;
}

function renderReceiptBlock(inquiryId, payment, state) {
  const receipt = payment.receipt || {};
  const hasReceipt = Boolean(receipt.available || receipt.filename || payment.submittedAt);
  if (!hasReceipt) return "";
  const loading = state.proofStatus === "loading";
  const failed = state.proofStatus === "error";
  const receiptMeta = [
    fileSize(receipt.sizeBytes),
    fileType(receipt.contentType || receipt.filename),
  ].filter(Boolean).join(" / ");
  const reviewStatus = compactPaymentStatus(payment);
  const retry = failed
    ? `<button class="ops-light-button mini" data-payment-review-retry-proof="${html(inquiryId)}" type="button">RETRY</button>`
    : "";
  const view = receipt.available && !failed
    ? `<button class="ops-dark-button mini" data-payment-review-open-receipt="${html(inquiryId)}" type="button" ${loading ? "disabled" : ""}>${loading ? "LOADING..." : "VIEW RECEIPT"}</button>`
    : "";
  return `<section class="payment-review-receipt-block" aria-label="Payment receipt">
    <header><strong>RECEIPT</strong><span>${html(reviewStatus)}</span></header>
    ${failed ? `<p class="payment-review-message error" role="alert">Receipt unavailable</p>` : ""}
    <dl class="payment-review-grid compact">
      ${detail("Receipt filename", receipt.filename || "Receipt file")}
      ${detail("Receipt file type", fileType(receipt.contentType || receipt.filename))}
      ${detail("Receipt file size", fileSize(receipt.sizeBytes))}
      ${detail("Submitted", dateTime(payment.submittedAt))}
      ${detail("Selected payment type", getPaymentTypeLabel(payment.paymentType))}
      ${detail("Selected amount", money(payment.submittedAmount))}
      ${payment.customerReference ? detail("Customer reference", payment.customerReference) : ""}
      ${payment.reviewNote ? detail("Review note", payment.reviewNote, "wide correction") : ""}
    </dl>
    ${receiptMeta ? `<p class="payment-review-receipt-meta">${html(receiptMeta)}</p>` : ""}
    <div class="payment-review-receipt-actions">${view}${retry}</div>
  </section>`;
}

function renderPaymentNotes(payment) {
  const customer = payment.customerNote ? `<section class="payment-review-note-block"><strong>CUSTOMER NOTE</strong><p>${html(payment.customerNote)}</p></section>` : "";
  const internal = payment.internalNote ? `<section class="payment-review-note-block internal"><strong>INTERNAL REVIEW NOTE</strong><p>${html(payment.internalNote)}</p></section>` : "";
  return `${customer}${internal}`;
}

function renderHistory(events = []) {
  const safeEvents = Array.isArray(events) ? events : [];
  const body = safeEvents.length
    ? `<ol>${safeEvents.map((event) => {
      const actor = [
        event.actorDisplayName || "TRRY Admin",
        event.actorRole ? enumLabel(event.actorRole) : "",
      ].filter(Boolean).join(" / ");
      const detailLine = [
        event.amount != null ? money(event.amount) : "",
        METHOD_LABELS[event.paymentMethod] || enumLabel(event.paymentMethod),
      ].filter(Boolean).join(" / ");
      return `<li>
        <span aria-hidden="true"></span>
        <div>
          <strong>${html(event.label || enumLabel(event.eventType))}</strong>
          ${detailLine ? `<b>${html(detailLine)}</b>` : ""}
          <small>${html(actor)}</small>
          <time>${html(dateTime(event.createdAt))}</time>
          ${event.reviewNote ? `<p>${html(event.reviewNote)}</p>` : ""}
          ${event.internalNote ? `<p class="payment-review-internal">Internal: ${html(event.internalNote)}</p>` : ""}
        </div>
      </li>`;
    }).join("")}</ol>`
    : `<p class="payment-review-empty">No payment review events yet.</p>`;
  return `<section class="ops-payment-history payment-review-history" aria-label="Payment history"><header><strong>PAYMENT HISTORY</strong></header>${body}</section>`;
}

function renderDialog(inquiryId, payment, state) {
  if (!state.dialog) return "";
  const saving = Boolean(state.saving);
  const draft = state.draft || {};
  const commonClose = `<button class="ops-light-button mini payment-dialog-close-action" data-payment-review-cancel type="button" ${saving ? "disabled" : ""}>CLOSE</button>`;
  if (state.dialog === "review") {
    const proof = state.proof || {};
    const receipt = payment.receipt || {};
    const paid = Number(payment.verifiedAmount ?? 0);
    const total = Number(payment.quotedAmount ?? 0);
    const submitted = Number(payment.submittedAmount ?? 0);
    const expected = Number.isFinite(submitted) && submitted > 0 ? submitted : Number(payment.amountDue ?? 0);
    const remaining = Math.max((Number.isFinite(total) ? total : 0) - (Number.isFinite(paid) ? paid : 0), 0);
    const remainingAfterConfirmation = Math.max((Number.isFinite(total) ? total : 0) - (Number.isFinite(expected) ? expected : 0), 0);
    const canConfirm = payment.permissions?.canConfirm;
    const canRequestCorrection = payment.permissions?.canRequestCorrection;
    const confirmed = !["proof_submitted", "under_review", "correction_required"].includes(payment.paymentStatus);
    return `<div class="payment-review-dialog-backdrop" data-payment-review-cancel></div>
      <section class="payment-review-dialog receipt" role="dialog" aria-modal="true" aria-labelledby="payment-review-receipt-title">
        <header><div><span>ONLINE PAYMENT</span><h3 id="payment-review-receipt-title">${confirmed ? compactPaymentStatus(payment) : "Review receipt"}</h3></div><button type="button" data-payment-review-cancel aria-label="Close payment dialog">X</button></header>
        ${renderReceiptPreview(inquiryId, proof, receipt, state)}
        ${confirmed ? `<div class="payment-confirmed-hero"><div><span>PAID</span><strong>${money(payment.verifiedAmount)}</strong></div><div><span>REMAINING</span><strong>${money(remaining)}</strong></div><div><span>METHOD</span><strong>${html(METHOD_LABELS[payment.paymentMethod] || enumLabel(payment.paymentMethod))}</strong></div><div><span>VERIFIED BY</span><strong>${html(payment.verifiedBy || "Not available")}</strong></div><div><span>VERIFIED</span><strong>${html(dateTime(payment.verifiedAt))}</strong></div></div><h4>RECEIPT DETAILS</h4>` : ""}
        <dl>
          ${detail("Quote total", money(payment.quotedAmount))}
          ${detail("Selected type", getPaymentTypeLabel(payment.paymentType))}
          ${detail("Expected amount", money(expected))}
          ${detail("Submitted amount", money(payment.submittedAmount))}
          ${!confirmed ? detail("Remaining after confirmation", money(remainingAfterConfirmation)) : ""}
          ${detail("Reference", payment.customerReference || "Not provided")}
          ${detail("Submission date/time", dateTime(payment.submittedAt))}
          ${detail("Customer note", payment.customerNote || "Not provided", "wide")}
        </dl>
        ${state.dialogError ? `<p class="payment-review-message error" role="alert">${html(state.dialogError)}</p>` : ""}
        <div>${commonClose}${canRequestCorrection ? `<button class="ops-move-button danger" data-payment-review-action="open_correction" data-payment-review-id="${html(inquiryId)}" type="button" ${saving ? "disabled" : ""}>REQUEST NEW RECEIPT</button><button class="ops-move-button danger" data-payment-review-action="open_correction" data-payment-review-id="${html(inquiryId)}" type="button" ${saving ? "disabled" : ""}>REJECT RECEIPT</button>` : ""}${canConfirm ? `<button class="ops-gold-button mini" data-payment-review-submit="confirm_online_payment" data-payment-review-id="${html(inquiryId)}" type="button" ${saving ? "disabled" : ""}>${saving ? "CONFIRMING..." : "CONFIRM PAYMENT"}</button>` : ""}</div>
      </section>`;
  }
  if (state.dialog === "confirm") {
    return `<div class="payment-review-dialog-backdrop" data-payment-review-cancel></div>
      <section class="payment-review-dialog" role="dialog" aria-modal="true" aria-labelledby="payment-review-confirm-title">
        <span>ONLINE PAYMENT</span>
        <h3 id="payment-review-confirm-title">Confirm payment?</h3>
        <dl>
          ${detail("Inquiry / order", inquiryId)}
          ${detail("Customer", payment.customer)}
          ${detail("Payment method", METHOD_LABELS[payment.paymentMethod] || enumLabel(payment.paymentMethod))}
          ${detail("Submitted amount", money(payment.submittedAmount))}
          ${detail("Amount due", money(payment.amountDue))}
        </dl>
        <input data-payment-review-field="verifiedAmount" type="hidden" value="${html(draft.verifiedAmount ?? payment.submittedAmount ?? payment.amountDue ?? "")}">
        <label><span>Internal note <small>Optional</small></span><textarea data-payment-review-field="internalNote" maxlength="500" rows="2" ${saving ? "disabled" : ""}>${html(draft.internalNote || "")}</textarea></label>
        <p class="payment-review-warning">Confirm only after matching this receipt to the actual full payment. This does not create an order or change production.</p>
        ${state.dialogError ? `<p class="payment-review-message error" role="alert">${html(state.dialogError)}</p>` : ""}
        <div>${commonClose}<button class="ops-gold-button mini" data-payment-review-submit="confirm_online_payment" data-payment-review-id="${html(inquiryId)}" type="button" ${saving ? "disabled" : ""}>${saving ? "CONFIRMING..." : "CONFIRM PAYMENT"}</button></div>
      </section>`;
  }

  return `<div class="payment-review-dialog-backdrop" data-payment-review-cancel></div>
    <section class="payment-review-dialog" role="dialog" aria-modal="true" aria-labelledby="payment-review-correction-title">
      <span>ONLINE PAYMENT</span>
      <h3 id="payment-review-correction-title">Request receipt correction</h3>
      <p>The current receipt remains in the private evidence store. The customer can submit a replacement through the existing payment flow.</p>
      <label><span>Customer-facing reason</span><textarea data-payment-review-field="reviewNote" maxlength="1000" rows="3" required ${saving ? "disabled" : ""}>${html(draft.reviewNote || "")}</textarea></label>
      <label><span>Internal note <small>Optional</small></span><textarea data-payment-review-field="internalNote" maxlength="500" rows="2" ${saving ? "disabled" : ""}>${html(draft.internalNote || "")}</textarea></label>
      ${state.dialogError ? `<p class="payment-review-message error" role="alert">${html(state.dialogError)}</p>` : ""}
      <div>${commonClose}<button class="ops-move-button danger" data-payment-review-submit="request_online_payment_correction" data-payment-review-id="${html(inquiryId)}" type="button" ${saving ? "disabled" : ""}>${saving ? "REQUESTING..." : "REQUEST CORRECTION"}</button></div>
    </section>`;
}

function renderReceiptPreview(inquiryId, proof, receipt, state) {
  if (state.proofStatus === "loading") return `<div class="payment-receipt-preview loading">Loading receipt preview...</div>`;
  if (state.proofStatus === "error") return `<div class="payment-receipt-preview fallback"><strong>Receipt preview unavailable.</strong><div><button class="ops-dark-button mini" data-payment-review-open-receipt="${html(inquiryId)}" type="button">OPEN RECEIPT</button><button class="ops-light-button mini" data-payment-review-retry-proof="${html(inquiryId)}" type="button">RETRY</button></div></div>`;
  const url = proof?.signedUrl || "";
  if (!url && receipt.available === false) return `<div class="payment-receipt-preview empty">No receipt file is attached.</div>`;
  if (!url) return `<div class="payment-receipt-preview fallback"><strong>Receipt preview unavailable.</strong><div><button class="ops-light-button mini" data-payment-review-retry-proof="${html(inquiryId)}" type="button">RETRY</button></div></div>`;
  const contentType = String(proof.contentType || receipt.contentType || "").toLowerCase();
  if (contentType.includes("pdf")) {
    return `<div class="payment-receipt-pdf"><iframe class="payment-receipt-preview" title="Payment receipt preview" src="${html(url)}"></iframe><a class="ops-dark-button mini" href="${html(url)}" target="_blank" rel="noopener noreferrer">OPEN PDF</a></div>`;
  }
  return `<a class="payment-receipt-image-link" href="${html(url)}" target="_blank" rel="noopener noreferrer"><span class="payment-receipt-image-frame"><img class="payment-receipt-preview" alt="Payment receipt preview" src="${html(url)}" onerror="this.closest('.payment-receipt-image-frame')?.classList.add('failed')" onload="this.closest('.payment-receipt-image-frame')?.classList.add('loaded')"><span class="payment-receipt-preview fallback image-error"><strong>Receipt preview unavailable.</strong><small>Open the receipt or retry the preview.</small></span></span></a>`;
}

function paymentShell(status, body) {
  const correction = String(status || "").trim().toUpperCase() === "CORRECTION REQUIRED";
  return `<section class="ops-stage-section payment-review-section ${correction ? "correction" : ""}" data-stage="payment">
    <header><div><span class="ops-stage-dot"></span><h3>PAYMENT</h3></div><mark>${html(status)}</mark></header>
    <div class="ops-stage-body">${body}</div>
  </section>`;
}

function compactPaymentStatus(payment) {
  const status = String(payment?.paymentStatus || "");
  if (status === "under_review") return "FOR VERIFICATION";
  if (["down_payment_confirmed", "partially_paid"].includes(status)) return "DOWN PAYMENT CONFIRMED";
  if (["full_payment_confirmed", "confirmed", "paid"].includes(status)) return "FULLY PAID";
  return STATUS_LABELS[status] || enumLabel(status || "not_required");
}

function getPaymentTypeLabel(value) {
  const key = String(value || "").trim().toLowerCase();
  if (key === "down_payment") return "50% DOWN PAYMENT";
  if (key === "full") return "FULL PAYMENT";
  return enumLabel(value);
}

function actionButton(label, action, inquiryId, saving, primary = false, tone = "") {
  const className = primary ? "ops-gold-button mini" : `ops-move-button ${tone}`.trim();
  return `<button class="${className}" data-payment-review-action="${html(action)}" data-payment-review-id="${html(inquiryId)}" type="button" ${saving ? "disabled" : ""}>${html(label)}</button>`;
}

function detail(label, value, className = "") {
  return `<div class="${className}"><dt>${html(label)}</dt><dd>${html(value || "Not available")}</dd></div>`;
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Not available";
  const formatted = Number.isInteger(number)
    ? number.toLocaleString("en-US")
    : number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${String.fromCharCode(8369)}${formatted}`;
}

function fileSize(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function fileType(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  if (text.includes("pdf") || text.endsWith(".pdf")) return "PDF";
  if (text.includes("jpeg") || text.endsWith(".jpeg") || text.endsWith(".jpg")) return "JPG";
  if (text.includes("png") || text.endsWith(".png")) return "PNG";
  if (text.includes("webp") || text.endsWith(".webp")) return "WEBP";
  if (text.includes("heic") || text.endsWith(".heic")) return "HEIC";
  if (text.includes("heif") || text.endsWith(".heif")) return "HEIF";
  return text.split("/").pop()?.toUpperCase() || text.toUpperCase();
}

function dateTime(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not available";
  return date.toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function enumLabel(value) {
  const text = String(value || "").trim();
  if (!text) return "Not selected";
  return text.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function html(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
