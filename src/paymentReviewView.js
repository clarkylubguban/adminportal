const STATUS_LABELS = {
  proof_submitted: "RECEIPT SUBMITTED",
  under_review: "UNDER REVIEW",
  correction_required: "CORRECTION REQUIRED",
  full_payment_confirmed: "FULL PAYMENT CONFIRMED",
};

const METHOD_LABELS = {
  gcash: "GCash",
  bank_transfer: "Bank Transfer",
  online: "Online payment",
};

export function renderOnlinePaymentReview(item, state = {}) {
  const inquiryId = String(item?.id || state?.payment?.inquiryId || "");
  if (state.status === "loading" || !state.status) {
    return paymentShell(
      "LOADING",
      `<p class="payment-review-state" role="status">Loading payment review...</p>`,
    );
  }
  if (state.status === "error" || !state.payment) {
    return paymentShell(
      "UNAVAILABLE",
      `<p class="payment-review-message error" role="alert">${html(state.error || "Payment review is unavailable.")}</p>
       <button class="ops-light-button mini" data-payment-review-retry="${html(inquiryId)}" type="button">TRY AGAIN</button>`,
    );
  }

  const payment = state.payment;
  const status = STATUS_LABELS[payment.paymentStatus] || enumLabel(payment.paymentStatus || "not_required");
  const receipt = payment.receipt || {};
  const proofLabel = state.proofStatus === "loading"
    ? "OPENING..."
    : state.proofStatus === "error"
      ? "TRY RECEIPT AGAIN"
      : "VIEW RECEIPT";
  const proofButton = receipt.available
    ? `<button class="ops-dark-button mini" data-payment-review-proof="${html(inquiryId)}" type="button" ${state.proofStatus === "loading" ? "disabled" : ""}>${proofLabel}</button>`
    : `<span class="payment-review-empty">Receipt unavailable</span>`;
  const permissions = payment.permissions || {};
  const actions = [
    permissions.canStartReview
      ? actionButton("REVIEW PAYMENT", "start_online_payment_review", inquiryId, state.saving)
      : "",
    permissions.canConfirm
      ? actionButton("CONFIRM PAYMENT", "open_confirm", inquiryId, state.saving, true)
      : "",
    permissions.canRequestCorrection
      ? actionButton("REQUEST CORRECTION", "open_correction", inquiryId, state.saving, false, "danger")
      : "",
  ].filter(Boolean).join("");

  const limitation = payment.limitation
    ? `<p class="payment-review-message warning">${html(payment.limitation)}</p>`
    : "";
  const feedback = state.message
    ? `<p class="payment-review-message ${state.messageTone === "error" ? "error" : "success"}" role="${state.messageTone === "error" ? "alert" : "status"}">${html(state.message)}</p>`
    : "";
  const managerActions = actions
    ? `<div class="ops-stage-actions payment-review-actions">${actions}</div>`
    : `<p class="payment-review-readonly"><strong>READ ONLY</strong> Owner or Admin review is required for payment actions.</p>`;

  const body = `
    ${feedback}
    ${limitation}
    <div class="payment-review-heading">
      <strong class="ops-payment-state-badge ${payment.paymentStatus === "full_payment_confirmed" ? "confirmed" : "pending"}">${html(status)}</strong>
      ${proofButton}
    </div>
    <dl class="payment-review-grid">
      ${detail("Payment method", METHOD_LABELS[payment.paymentMethod] || enumLabel(payment.paymentMethod))}
      ${detail("Submitted amount", money(payment.submittedAmount))}
      ${detail("Quoted amount", money(payment.quotedAmount))}
      ${detail("Current amount due", money(payment.amountDue))}
      ${detail("Submitted", dateTime(payment.submittedAt))}
      ${detail("Receipt file", receipt.filename || "Not available")}
      ${detail("Content type", receipt.contentType || "Not available")}
      ${detail("Customer reference", payment.customerReference || "Not provided")}
      ${detail("Customer note", payment.customerNote || "Not provided", "wide")}
      ${payment.reviewNote ? detail("Correction reason", payment.reviewNote, "wide") : ""}
      ${payment.verifiedAmount != null ? detail("Verified amount", money(payment.verifiedAmount)) : ""}
      ${payment.verifiedBy ? detail("Verified by", payment.verifiedBy) : ""}
      ${payment.verifiedAt ? detail("Verified", dateTime(payment.verifiedAt)) : ""}
      ${payment.internalNote ? detail("Internal note", payment.internalNote, "wide") : ""}
    </dl>
    ${managerActions}
    ${renderHistory(payment.history)}
    ${renderDialog(inquiryId, payment, state)}
  `;
  return paymentShell(status, body);
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
  const commonClose = `<button class="ops-light-button mini" data-payment-review-cancel type="button" ${saving ? "disabled" : ""}>CANCEL</button>`;
  if (state.dialog === "confirm") {
    return `<div class="payment-review-dialog-backdrop" data-payment-review-cancel></div>
      <section class="payment-review-dialog" role="dialog" aria-modal="true" aria-labelledby="payment-review-confirm-title">
        <span>ONLINE PAYMENT</span>
        <h3 id="payment-review-confirm-title">Confirm full payment?</h3>
        <dl>
          ${detail("Inquiry / order", inquiryId)}
          ${detail("Customer", payment.customer)}
          ${detail("Payment method", METHOD_LABELS[payment.paymentMethod] || enumLabel(payment.paymentMethod))}
          ${detail("Submitted amount", money(payment.submittedAmount))}
          ${detail("Amount due", money(payment.amountDue))}
        </dl>
        <label><span>Verified amount</span><input data-payment-review-field="verifiedAmount" inputmode="decimal" min="0" step="0.01" type="number" value="${html(draft.verifiedAmount ?? payment.amountDue ?? "")}" ${saving ? "disabled" : ""}></label>
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

function paymentShell(status, body) {
  return `<section class="ops-stage-section payment-review-section" data-stage="payment">
    <header><div><span class="ops-stage-dot"></span><h3>PAYMENT</h3></div><mark>${html(status)}</mark></header>
    <div class="ops-stage-body">${body}</div>
  </section>`;
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
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(number);
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
