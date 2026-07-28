const TERMINAL_STATUSES = new Set(["lost", "cancelled", "canceled"]);
const ACTIVE_STAGES = new Set(["printing", "embroidery", "screen_printing"]);

export function buildOpsWorkflowUpdates(action, body, inquiry, now = new Date().toISOString()) {
  if (!inquiry || TERMINAL_STATUSES.has(key(inquiry.status))) {
    return failure("lost or cancelled inquiries cannot enter the order workflow");
  }

  if (action === "confirm_order") {
    if (key(inquiry.quote_status) !== "approved") return failure("quote approval is required");
    if (!(Number(inquiry.quoted_amount) > 0)) return failure("a valid quoted amount is required");
    return success({ status: "won", next_action: "TRRY order confirmed - ready for production handoff" });
  }

  if (!["save_production", "advance_production"].includes(action)) {
    return failure("invalid workflow action");
  }
  if (!isConfirmedOrder(inquiry)) return failure("a confirmed TRRY order is required");

  const currentStage = canonicalStage(inquiry.production_stage);
  if (["ready", "completed"].includes(currentStage) && action === "save_production") {
    return failure("ready and completed production details are locked");
  }

  const updates = productionFields(body, now);
  if (action === "save_production") return success(updates);

  const requestedStage = canonicalStage(body.productionStage);
  const expectedStage = nextStage(currentStage, inquiry);
  if (!expectedStage || requestedStage !== expectedStage) return failure("invalid production stage transition");

  const candidate = { ...inquiry, ...updates, production_stage: requestedStage };
  if (currentStage === "queued") {
    const missing = productionGate(candidate);
    if (missing.length) return failure(`production requirements missing: ${missing.join(", ")}`);
  }

  return success({ ...updates, production_stage: requestedStage });
}

export function canonicalStage(value) {
  const stage = key(value);
  if (!stage) return "queued";
  if (stage === "qc_finishing") return "qc";
  if (stage === "ready_for_fulfillment") return "ready";
  return stage;
}

export function isConfirmedOrder(inquiry) {
  return key(inquiry.status) === "won"
    && key(inquiry.quote_status) === "approved";
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
  if (cleanText(inquiry.blocked_reason, 500)) missing.push("blocked reason");
  return missing;
}
function productionFields(body, now) {
  return {
    assigned_staff: cleanText(body.assignedStaff, 120) || null,
    production_note: cleanText(body.productionNote, 2000) || null,
    blocked_reason: cleanText(body.blockedReason, 500) || null,
    production_updated_at: now,
  };
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

function key(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function success(updates) {
  return { ok: true, updates };
}

function failure(error) {
  return { ok: false, error };
}
