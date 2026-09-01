import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildOpsWorkflowUpdates } from "../api/_lib/opsWorkflow.js";

const workflowSource = await readFile("api/inquiries/[id]/workflow.js", "utf8");
assert.ok(workflowSource.includes("payment_confirmed_amount"), "workflow read model includes confirmed payment amount");
assert.ok(workflowSource.includes("payment_verified_amount"), "workflow read model includes verified payment amount");

const releaseBody = {};

function gateReadyInquiry(overrides = {}) {
  return {
    id: "TRY-RELEASE-PAYMENT-READ-MODEL",
    status: "approved",
    nativeOrderAuthority: true,
    nativeOrderId: "96000000-0000-4000-8000-000000000991",
    nativeOrderReference: "TRRY-ORD-PAYMENT-RM",
    quote_status: "approved",
    product: "DTF",
    product_desc: "Synthetic Shirt",
    quantity: "12",
    due_date: "2026-08-20",
    artwork_status: "approved",
    assigned_staff: "QA Staff - Staging",
    payment_status: "paid",
    payment_confirmed_amount: 600,
    payment_verified_amount: 600,
    quoted_amount: 600,
    amount_due: 0,
    production_stage: "queued",
    blocked_reason: null,
    ...overrides,
  };
}

let result = buildOpsWorkflowUpdates("release_production", releaseBody, gateReadyInquiry(), "2026-08-09T01:00:00.000Z");
assert.equal(result.ok, true, "native order with full confirmed payment passes release gate");
assert.equal(result.updates.production_stage, "queued");

result = buildOpsWorkflowUpdates("release_production", releaseBody, gateReadyInquiry({
  payment_verified_amount: null,
}), "2026-08-09T01:05:00.000Z");
assert.equal(result.ok, true, "paid status with canonical confirmed amount passes release gate");

result = buildOpsWorkflowUpdates("release_production", releaseBody, gateReadyInquiry({
  payment_confirmed_amount: null,
  payment_verified_amount: null,
}), "2026-08-09T01:10:00.000Z");
assert.equal(result.ok, false, "paid status without confirmed amount remains blocked");
assert.match(result.error, /confirmed payment/);

result = buildOpsWorkflowUpdates("release_production", releaseBody, gateReadyInquiry({
  payment_confirmed_amount: 300,
  payment_verified_amount: 300,
}), "2026-08-09T01:15:00.000Z");
assert.equal(result.ok, false, "partial confirmed payment remains blocked");
assert.match(result.error, /confirmed payment/);

for (const [label, body, overrides, expected] of [
  ["artwork", releaseBody, { artwork_status: "submitted" }, /artwork approval/],
  ["due date", releaseBody, { due_date: null }, /due date/],
  ["staff", { productionStage: "printing" }, { assigned_staff: "" }, /assigned staff/],
  ["blocker", releaseBody, { blocked_reason: "Waiting on replacement blank" }, /blocked reason/],
]) {
  result = buildOpsWorkflowUpdates("release_production", body, gateReadyInquiry(overrides), "2026-08-09T01:20:00.000Z");
  assert.equal(result.ok, false, `${label} guard remains enforced`);
  assert.match(result.error, expected);
}

console.log("PASS release payment read model and production gate payment regressions");
