import assert from "node:assert/strict";
import { buildOpsWorkflowUpdates, isConfirmedOrder } from "../api/_lib/opsWorkflow.js";

const baseInquiry = {
  id: "TRRY-WF-001",
  status: "sent",
  quote_status: "approved",
  quoted_amount: 1500,
  amount_due: 1500,
  odoo_so: "",
  product: "Embroidery",
  product_desc: "Admin Polo",
  quantity: "12",
  due_date: "2026-08-15",
  artwork_status: "approved",
  assigned_staff: "QA Staff",
  production_stage: "queued",
  blocked_reason: "",
  payment_status: "required",
  payment_verified_amount: 0,
  payment_confirmed_amount: 0,
};

const confirmed = buildOpsWorkflowUpdates("confirm_order", {}, baseInquiry, "2026-07-28T00:00:00.000Z");
assert.equal(confirmed.ok, true, "approved positive quote converts without Odoo");
assert.deepEqual(confirmed.updates, {
  status: "won",
  next_action: "TRRY order confirmed - ready for production handoff",
});

assert.equal(isConfirmedOrder({ ...baseInquiry, status: "won", quote_status: "approved", odoo_so: "" }), true, "blank Odoo SO does not block confirmed order");

const lost = buildOpsWorkflowUpdates("confirm_order", {}, { ...baseInquiry, status: "lost" });
assert.equal(lost.ok, false, "lost inquiry cannot convert");

const unapproved = buildOpsWorkflowUpdates("confirm_order", {}, { ...baseInquiry, quote_status: "ready" });
assert.equal(unapproved.ok, false, "unapproved quote cannot convert");

const zeroQuote = buildOpsWorkflowUpdates("confirm_order", {}, { ...baseInquiry, quoted_amount: 0 });
assert.equal(zeroQuote.ok, false, "zero quote cannot convert");

const production = buildOpsWorkflowUpdates("advance_production", { productionStage: "embroidery", assignedStaff: "QA Staff" }, { ...baseInquiry, status: "won", quote_status: "approved", odoo_so: "" });
assert.equal(production.ok, true, "production can start with blank Odoo and parked payment");

const missing = buildOpsWorkflowUpdates("advance_production", { productionStage: "embroidery", assignedStaff: "" }, { ...baseInquiry, status: "won", quote_status: "approved", assigned_staff: "" });
assert.equal(missing.ok, false, "normal production requirements still apply");
assert.match(missing.error, /assigned staff/);

console.log("PASS direct TRRY order conversion and parked payment/Odoo workflow gates");
