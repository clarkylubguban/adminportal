import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationPath = "supabase/migrations/202607300009_online_payment_review.sql";
const migration = await readFile(migrationPath, "utf8");
const parked = await readFile("supabase/migrations/202607260001_complete_payment_workflow.sql", "utf8");
const payAtShop = await readFile("supabase/migrations/202607290008_pay_at_shop_admin_workflow.sql", "utf8");
const customerApi = await readFile("api/inquiries/[id]/payments.js", "utf8");

for (const column of [
  "payment_selected_amount",
  "payment_reference",
  "payment_customer_note",
  "payment_receipt_filename",
  "payment_receipt_content_type",
  "payment_receipt_size",
]) {
  assert.match(migration, new RegExp(`add column if not exists ${column}\\b`, "i"));
}

for (const eventType of [
  "PAY_AT_SHOP_SELECTED",
  "SHOP_PAYMENT_CONFIRMED",
  "ONLINE_PAYMENT_REVIEW_STARTED",
  "ONLINE_PAYMENT_CONFIRMED",
  "ONLINE_PAYMENT_CORRECTION_REQUESTED",
]) {
  assert.match(migration, new RegExp(eventType));
}

assert.match(migration, /create or replace function public\.review_online_payment/i);
assert.match(migration, /security definer[\s\S]+set search_path = ''/i);
assert.match(migration, /auth\.uid\(\)/i);
assert.match(migration, /role in \('owner', 'admin'\)/i);
assert.match(migration, /for update;/i);
assert.match(migration, /PAYMENT_STALE_VERSION/);
assert.match(migration, /IDEMPOTENCY_KEY_CONFLICT/);
assert.match(migration, /payment_type, ''\) <> 'full'/i);
assert.match(migration, /payment_method, ''\) not in \('gcash', 'bank_transfer'\)/i);
assert.match(migration, /PAY_AT_SHOP_REVIEW_FORBIDDEN/);
assert.match(migration, /FULL_AMOUNT_DUE_REQUIRED/);
assert.match(migration, /payment_proof_path not like v_inquiry\.id \|\| '\/payments\/%'/i);
assert.match(migration, /payment_receipt_content_type/);
assert.match(migration, /payment_receipt_size > 10485760/);
assert.match(migration, /insert into public\.inquiry_payment_events[\s\S]+update public\.ops_inquiries|update public\.ops_inquiries[\s\S]+insert into public\.inquiry_payment_events/i);
assert.match(migration, /revoke all on table public\.inquiry_payment_events from public, anon, authenticated/i);
assert.match(migration, /grant select on table public\.inquiry_payment_events to authenticated/i);
assert.match(migration, /revoke execute on function public\.review_online_payment[\s\S]+from public, anon/i);
assert.doesNotMatch(migration, /update public\.(ops_orders|production_jobs)/i);
assert.doesNotMatch(migration, /odoo/i);

assert.match(customerApi, /ONLINE_PAYMENT_METHODS = new Set\(\["gcash", "bank_transfer"\]\)/);
assert.match(customerApi, /payment_method: paymentMethod/);
assert.match(customerApi, /isApprovedReceiptType/);
assert.match(customerApi, /payment_status: "proof_submitted"/);
assert.doesNotMatch(
  customerApi,
  /\[[^\]]*"correction_required"[^\]]*\][\s\S]{0,100}payment is not open for changes/,
  "correction_required must remain open for customer resubmission",
);

assert.notEqual(migration, parked, "new migration must not copy the parked migration");
assert.notEqual(migration, payAtShop, "new migration must not edit or copy Pay at Shop");

console.log("PASS Phase 9A forward migration, atomic review RPC, and customer resubmission contract");
