const TERMINAL_STATUSES = new Set(["lost", "cancelled", "canceled"]);
const ACTIVE_STAGES = new Set(["printing", "embroidery", "screen_printing"]);

export function buildOpsWorkflowUpdates(action, body, inquiry, now = new Date().toISOString()) {
  if (!inquiry || TERMINAL_STATUSES.has(key(inquiry.status))) {
    return failure("lost or cancelled inquiries cannot enter the order workflow");
  }

  if (!["save_production", "save_qc_note", "start_production", "advance_production"].includes(action)) {
    return failure("invalid workflow action");
  }
  if (!isConfirmedOrder(inquiry)) return failure("a confirmed TRRY order is required");

  const currentStage = canonicalStage(inquiry.production_stage);
  const alreadyStarted = Boolean(inquiry.production_started_at);
  const actorUserId = cleanUuid(body.actorUserId || body.productionStartedBy || body.qcStartedBy || body.qcCompletedBy || body.productionCompletedBy);
  if (action === "start_production") {
    if (alreadyStarted) return { ok: true, updates: {}, noop: true };
    if (!ACTIVE_STAGES.has(currentStage)) return failure("production must be released before it can start");
    if (cleanText(inquiry.blocked_reason, 500)) return failure("blocked production cannot start");
    return success({
      production_started_at: now,
      production_started_by: actorUserId || null,
      production_updated_at: now,
    });
  }

  if (action === "save_qc_note") {
    if (currentStage !== "qc") return failure("QC note can only be saved during quality check");
    return success({
      qc_note: cleanText(body.qcNote, 500) || null,
      production_updated_at: now,
    });
  }

  if (["ready", "completed"].includes(currentStage) && action === "save_production") {
    return failure("ready and completed production details are locked");
  }
  if (action === "save_production") return success(productionFields(body, now));

  const requestedStage = canonicalStage(body.productionStage);
  if (currentStage === "completed" && requestedStage === "completed") {
    return { ok: true, updates: {}, noop: true };
  }
  if (currentStage === "ready" && requestedStage === "ready" && inquiry.qc_completed_at) {
    return { ok: true, updates: {}, noop: true };
  }
  const expectedStage = nextStage(currentStage, inquiry);
  if (!expectedStage || requestedStage !== expectedStage) return failure("invalid production stage transition");

  const updates = currentStage === "ready" && requestedStage === "completed"
    ? { production_updated_at: now }
    : productionFields(body, now);

  const candidate = { ...inquiry, ...updates, production_stage: requestedStage };
  if (currentStage === "queued") {
    const missing = productionGate(candidate);
    if (missing.length) return failure(`production requirements missing: ${missing.join(", ")}`);
  } else if (ACTIVE_STAGES.has(currentStage) && requestedStage === "qc" && !alreadyStarted) {
    return failure("production must be started before quality check");
  }

  const lifecycleUpdates = {};
  if (requestedStage === "qc" && !inquiry.qc_started_at) {
    lifecycleUpdates.qc_started_at = now;
    lifecycleUpdates.qc_started_by = actorUserId || null;
  }
  if (currentStage === "qc" && requestedStage === "ready") {
    if (cleanText(inquiry.blocked_reason, 500)) return failure("blocked production cannot complete quality check");
    if (!inquiry.qc_started_at) {
      lifecycleUpdates.qc_started_at = now;
      lifecycleUpdates.qc_started_by = actorUserId || null;
    }
    if (!inquiry.qc_completed_at) {
      lifecycleUpdates.qc_completed_at = now;
      lifecycleUpdates.qc_completed_by = actorUserId || null;
    }
  }
  if (currentStage === "ready" && requestedStage === "completed") {
    if (cleanText(inquiry.blocked_reason, 500)) return failure("blocked production cannot be completed");
    if (!inquiry.qc_completed_at) return failure("quality check completion is required before production completion");
    if (!inquiry.production_completed_at) {
      lifecycleUpdates.production_completed_at = now;
      lifecycleUpdates.production_completed_by = actorUserId || null;
    }
  }

  return success({
    ...updates,
    production_stage: requestedStage,
    ...lifecycleUpdates,
    ...(currentStage === "queued" ? { production_started_at: null, production_started_by: null } : {}),
  });
}

export function canonicalStage(value) {
  const stage = key(value);
  if (!stage) return "queued";
  if (stage === "qc_finishing") return "qc";
  if (stage === "ready_for_fulfillment") return "ready";
  return stage;
}

export function isConfirmedOrder(inquiry) {
  return hasNativeOrderAuthority(inquiry)
    && key(inquiry.quote_status) === "approved";
}

export function hasNativeOrderAuthority(inquiry) {
  return Boolean(
    inquiry?.nativeOrderAuthority === true
    || inquiry?._nativeOrderAuthority === true
    || cleanText(inquiry?.nativeOrderId, 80)
    || cleanText(inquiry?.native_order_id, 80)
  );
}

function nextStage(stage, inquiry) {
  if (stage === "queued") return stationFor(inquiry);
  if (ACTIVE_STAGES.has(stage) || stage === "in_production") return "qc";
  if (stage === "qc") return "ready";
  if (stage === "ready") return "completed";
  return "";
}

function productionGate(inquiry) {
  const missing = [];
  if (!cleanText(inquiry.product_desc || inquiry.product, 500)) missing.push("product or service");
  if (!cleanText(inquiry.quantity, 120)) missing.push("quantity");
  if (!inquiry.due_date) missing.push("due date");
  if (key(inquiry.artwork_status) !== "approved") missing.push("artwork approval");
  if (!cleanText(inquiry.assigned_staff, 120)) missing.push("assigned staff");
  if (Number(inquiry.quoted_amount || inquiry.amount_due) > 0 && !paymentSatisfiesProductionGate(inquiry)) missing.push("confirmed payment");
  if (cleanText(inquiry.blocked_reason, 500)) missing.push("blocked reason");
  return missing;
}


function paymentSatisfiesProductionGate(inquiry) {
  const total = Number(inquiry.quoted_amount || inquiry.amount_due);
  const verified = Number(inquiry.payment_verified_amount || inquiry.payment_confirmed_amount);
  const status = key(inquiry.payment_status);
  if (!Number.isFinite(total) || total <= 0) return false;
  if (["paid", "full_payment_confirmed", "confirmed"].includes(status)) return Number.isFinite(verified) && verified >= total;
  return false;
}
function productionFields(body, now) {
  const updates = { production_updated_at: now };
  if (Object.prototype.hasOwnProperty.call(body, "assignedStaff")) {
    updates.assigned_staff = cleanText(body.assignedStaff, 120) || null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "productionNote")) {
    updates.production_note = cleanText(body.productionNote, 2000) || null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "blockedReason")) {
    updates.blocked_reason = cleanText(body.blockedReason, 500) || null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "dueDate")) {
    updates.due_date = cleanDate(body.dueDate);
  }
  return updates;
}

function stationFor(inquiry) {
  const service = key(inquiry.product || inquiry.product_desc);
  if (service.includes("embro")) return "embroidery";
  if (service.includes("screen")) return "screen_printing";
  return "printing";
}

function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanUuid(value) {
  const text = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text.toLowerCase()
    : "";
}

function cleanDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function key(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function success(updates) {
  return { ok: true, updates };
}

function failure(error) {
  return { ok: false, error };
}
