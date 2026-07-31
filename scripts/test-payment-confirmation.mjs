import assert from "node:assert/strict";
import { buildUpdates } from "../api/inquiries/[id]/customer-actions.js";

const NOW = "2026-07-31T12:00:00.000Z";
const ADMIN = { user_id: "00000000-0000-4000-8000-000000000123", role: "owner" };

test("850 down payment is rejected", () => {
  const result = confirmOnline(inquiry({ quoted_amount: 850, payment_type: "down_payment", payment_selected_amount: 425 }), 425);
  assert.equal(result.error, "confirmed amount must match the full quote total");
});

test("850 full payment is accepted", () => {
  const result = confirmOnline(inquiry({ quoted_amount: 850, payment_type: "full", payment_selected_amount: 850 }), 850);
  assert.equal(result.payment_status, "paid");
  assert.equal(result.payment_confirmed_amount, 850);
  assert.equal(result.amount_due, 0);
});

test("1050 down payment of 525 is accepted", () => {
  const result = confirmOnline(inquiry({ quoted_amount: 1050, payment_type: "down_payment", payment_selected_amount: 525 }), 525);
  assert.equal(result.payment_status, "down_payment_confirmed");
  assert.equal(result.payment_confirmed_amount, 525);
  assert.equal(result.payment_verified_amount, 525);
  assert.equal(result.amount_due, 525);
});

test("1050 arbitrary partial payment is rejected", () => {
  const result = confirmOnline(inquiry({ quoted_amount: 1050, payment_type: "down_payment", payment_selected_amount: 525 }), 700);
  assert.equal(result.error, "confirmed amount must match the 50% down payment or full quote total");
});

test("1050 full payment is accepted", () => {
  const result = confirmOnline(inquiry({ quoted_amount: 1050, payment_type: "full", payment_selected_amount: 1050 }), 1050);
  assert.equal(result.payment_status, "paid");
  assert.equal(result.payment_confirmed_amount, 1050);
  assert.equal(result.amount_due, 0);
});

test("online down payment review creates correct remaining balance", () => {
  const result = confirmOnline(inquiry({ id: "TRRY-WZTBV9U2", quoted_amount: 1050, payment_type: "down_payment", payment_selected_amount: 525 }), 525);
  assert.equal(result.payment_status, "down_payment_confirmed");
  assert.equal(result.payment_verified_amount, 525);
  assert.equal(result.amount_due, 525);
});

test("pay at shop down payment receiving creates correct remaining balance", () => {
  const result = buildUpdates("confirm_cash_payment", { confirmedAmount: 525 }, inquiry({
    id: "TRRY-U772FGZQ",
    quoted_amount: 1050,
    payment_status: "pay_at_shop",
    payment_method: "cash",
    payment_type: "shop",
    payment_selected_amount: null,
  }), NOW, ADMIN);
  assert.equal(result.payment_status, "down_payment_confirmed");
  assert.equal(result.payment_type, "down_payment");
  assert.equal(result.payment_method, "cash");
  assert.equal(result.payment_confirmed_amount, 525);
  assert.equal(result.amount_due, 525);
});

test("duplicate confirmation is rejected", () => {
  const result = buildUpdates("confirm_payment", { confirmedAmount: 525 }, inquiry({
    quoted_amount: 1050,
    payment_status: "down_payment_confirmed",
    payment_type: "down_payment",
    payment_selected_amount: 525,
  }), NOW, ADMIN);
  assert.equal(result, null);
});

test("authenticated verifier or receiver is recorded", () => {
  const online = confirmOnline(inquiry({ quoted_amount: 1050, payment_type: "down_payment", payment_selected_amount: 525 }), 525);
  const shop = buildUpdates("confirm_cash_payment", { confirmedAmount: 525 }, inquiry({
    quoted_amount: 1050,
    payment_status: "pay_at_shop",
    payment_method: "cash",
    payment_type: "shop",
    payment_selected_amount: null,
  }), NOW, ADMIN);
  assert.equal(online.payment_verified_by, ADMIN.user_id);
  assert.equal(shop.payment_verified_by, ADMIN.user_id);
});

test("stale or already reviewed receipt actions remain blocked", () => {
  const correction = buildUpdates("confirm_payment", { confirmedAmount: 525 }, inquiry({
    quoted_amount: 1050,
    payment_status: "correction_required",
    payment_type: "down_payment",
    payment_selected_amount: 525,
  }), NOW, ADMIN);
  const paid = buildUpdates("confirm_payment", { confirmedAmount: 1050 }, inquiry({
    quoted_amount: 1050,
    payment_status: "paid",
    payment_type: "full",
    payment_selected_amount: 1050,
  }), NOW, ADMIN);
  assert.equal(correction, null);
  assert.equal(paid, null);
});

function confirmOnline(row, amount) {
  return buildUpdates("confirm_payment", { confirmedAmount: amount }, row, NOW, ADMIN);
}

function inquiry(overrides = {}) {
  return {
    id: "TRRY-TEST",
    quote_status: "approved",
    artwork_status: "approved",
    production_stage: "queued",
    quoted_amount: 1050,
    amount_due: 1050,
    payment_status: "proof_submitted",
    payment_method: "online",
    payment_type: "full",
    payment_selected_amount: 1050,
    payment_proof_path: "TRRY-TEST/payments/receipt.png",
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
