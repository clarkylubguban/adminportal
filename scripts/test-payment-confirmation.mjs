import assert from "node:assert/strict";
import { buildOpsWorkflowUpdates } from "../api/_lib/opsWorkflow.js";
import { buildPaymentConfirmationUpdate } from "../api/_lib/paymentConfirmation.js";

const NOW = "2026-08-01T04:00:00.000Z";
const ADMIN = { user_id: "00000000-0000-4000-8000-000000000123", role: "owner" };

test("pay at shop selection is not payment confirmation", () => {
  const result = advanceProduction(order({ payment_status: "pay_at_shop", payment_method: "cash" }));
  assert.equal(result.ok, false);
  assert.match(result.error, /confirmed payment/);
});

test("pay online selection without confirmation remains blocked", () => {
  const result = advanceProduction(order({ payment_status: "proof_submitted", payment_method: "online" }));
  assert.equal(result.ok, false);
  assert.match(result.error, /confirmed payment/);
});

test("full payment confirmation updates paid amount and zero balance", () => {
  const result = confirmPayment(order(), { amountReceived: 1050, paymentSource: "gcash", idempotencyKey: "pay-full" });
  assert.equal(result.ok, true);
  assert.equal(result.updates.payment_status, "paid");
  assert.equal(result.updates.payment_method, "gcash");
  assert.equal(result.updates.payment_confirmed_amount, 1050);
  assert.equal(result.updates.payment_verified_amount, 1050);
  assert.equal(result.updates.amount_due, 0);
  assert.equal(result.updates.payment_confirmed_by, ADMIN.user_id);
  assert.equal(result.updates.payment_history.length, 1);
});

test("partial payment remains partially paid with remaining balance", () => {
  const result = confirmPayment(order(), { amountReceived: 525, paymentSource: "cash", idempotencyKey: "pay-partial" });
  assert.equal(result.ok, true);
  assert.equal(result.updates.payment_status, "partially_paid");
  assert.equal(result.updates.payment_confirmed_amount, 525);
  assert.equal(result.updates.amount_due, 525);
});

test("partial payment does not satisfy production readiness", () => {
  const partial = {
    ...order(),
    payment_status: "partially_paid",
    payment_confirmed_amount: 525,
    payment_verified_amount: 525,
    amount_due: 525,
  };
  const result = advanceProduction(partial);
  assert.equal(result.ok, false);
  assert.match(result.error, /confirmed payment/);
});

test("duplicate idempotency key returns idempotent success without new update", () => {
  const result = confirmPayment(order({
    payment_history: [{ id: "same-click" }],
  }), { amountReceived: 1050, paymentSource: "card", idempotencyKey: "same-click" });
  assert.equal(result.ok, true);
  assert.equal(result.idempotent, true);
  assert.deepEqual(result.updates, {});
});

test("amount above remaining balance is rejected", () => {
  const result = confirmPayment(order({ payment_confirmed_amount: 500, payment_verified_amount: 500, amount_due: 550 }), { amountReceived: 600, paymentSource: "cash" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "amount received cannot exceed remaining balance");
});

test("full payment but missing due date remains blocked", () => {
  const result = advanceProduction(paidOrder({ due_date: null }));
  assert.equal(result.ok, false);
  assert.match(result.error, /due date/);
});

test("full payment but artwork pending remains blocked", () => {
  const result = advanceProduction(paidOrder({ artwork_status: "under_review" }));
  assert.equal(result.ok, false);
  assert.match(result.error, /artwork approval/);
});

test("full payment but staff unassigned remains blocked", () => {
  const result = advanceProduction(paidOrder({ assigned_staff: "" }));
  assert.equal(result.ok, false);
  assert.match(result.error, /assigned staff/);
});

test("every requirement complete is ready without Odoo SO", () => {
  const result = advanceProduction(paidOrder({ odoo_so: "" }));
  assert.equal(result.ok, true);
  assert.equal(result.updates.production_stage, "printing");
});

function confirmPayment(inquiry, body) {
  return buildPaymentConfirmationUpdate({ inquiry, body, adminUser: ADMIN, now: NOW });
}

function advanceProduction(inquiry) {
  return buildOpsWorkflowUpdates("advance_production", {
    productionStage: "printing",
    assignedStaff: inquiry.assigned_staff,
  }, inquiry, NOW);
}

function paidOrder(overrides = {}) {
  return order({
    payment_status: "paid",
    payment_confirmed_amount: 1050,
    payment_verified_amount: 1050,
    amount_due: 0,
    ...overrides,
  });
}

function order(overrides = {}) {
  return {
    id: "TRRY-TEST",
    status: "won",
    quote_status: "approved",
    quoted_amount: 1050,
    amount_due: 1050,
    product: "DTF Printing",
    product_desc: "DTF Printing",
    quantity: "10 pcs",
    due_date: "2026-08-10",
    artwork_status: "approved",
    assigned_staff: "Clark - Admin",
    blocked_reason: "",
    production_stage: "queued",
    payment_status: "required",
    payment_method: "online",
    payment_confirmed_amount: null,
    payment_verified_amount: null,
    payment_history: [],
    odoo_so: "",
    ...overrides,
  };
}

function test(name, run) {
  try {
    run();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${name}\n${error.stack || error}\n`);
    process.exitCode = 1;
  }
}
