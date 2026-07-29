import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createMvpDashboard } from "../src/mvpDashboard.js";

const migration = await readFile("supabase/migrations/202607290008_pay_at_shop_admin_workflow.sql", "utf8");
const api = await readFile("api/inquiries/[id]/customer-actions.js", "utf8");
const customerPaymentsApi = await readFile("api/inquiries/[id]/payments.js", "utf8");
const main = await readFile("src/main.js", "utf8");
const build = await readFile("scripts/build.mjs", "utf8");

assert.match(migration, /create table if not exists public\.inquiry_payment_events/i);
assert.match(migration, /create or replace function public\.confirm_inquiry_shop_payment/i);
assert.match(migration, /for update;/i, "confirmation locks the inquiry row");
assert.match(migration, /SHOP_PAYMENT_CONFIRMED/);
assert.match(migration, /PAY_AT_SHOP_SELECTED/);
assert.match(migration, /PRODUCTION_ACTIVE_PAYMENT_LOCKED/);
assert.match(migration, /payment_internal_note is null or char_length\(payment_internal_note\) <= 500/i);
assert.match(migration, /revoke all on table public\.inquiry_payment_events from public, anon, authenticated/i);
assert.match(migration, /grant select on table public\.inquiry_payment_events to authenticated/i);
assert.match(migration, /grant execute on function public\.confirm_inquiry_shop_payment[\s\S]+to authenticated/i);
assert.doesNotMatch(migration, /odoo/i);

assert.match(api, /ENABLE_ADMIN_PAY_AT_SHOP_WORKFLOW/);
assert.match(api, /ENABLE_CUSTOMER_PAYMENT_WORKFLOW/);
assert.match(api, /confirm_shop_payment/);
assert.match(api, /confirm_cash_payment/);
assert.match(api, /createServerUserSupabaseClient\(token\)/);
assert.match(api, /\.rpc\(\s*"confirm_inquiry_shop_payment"/);
assert.match(api, /SHOP_PAYMENT_WRITE_ROLES = new Set\(\["owner", "admin"\]\)/);
assert.match(api, /status: 403/);
assert.match(api, /status: 409/);
assert.doesNotMatch(api, /if \(action === "confirm_cash_payment"\)[\s\S]{0,900}\.update\(/, "cash alias must not use a read-then-update path");

assert.match(customerPaymentsApi, /ENABLE_CUSTOMER_PAYMENT_WORKFLOW !== "true"/);
assert.match(main, /VITE_ENABLE_ADMIN_PAY_AT_SHOP_WORKFLOW/);
assert.match(main, /role="alertdialog"/);
assert.match(main, /CONFIRM SHOP PAYMENT/);
assert.match(main, /CONFIRMING\.\.\./);
assert.match(main, /Owner\/Admin confirmation required/);
assert.match(main, /Selection time unavailable/);
assert.match(main, /PAYMENT HISTORY/);
assert.match(main, /renderPayment: renderOpsPaymentStage/);
assert.match(build, /VITE_ENABLE_ADMIN_PAY_AT_SHOP_WORKFLOW[\s\S]+?"false"/);

globalThis.window = {
  location: {
    pathname: "/orders",
    search: "",
  },
};

const dashboard = createMvpDashboard();
const orderBase = {
  id: "QA-ORDER-8A",
  status: "won",
  quoteStatus: "approved",
  quotedAmount: 1250,
  amountDue: 1250,
  artworkStatus: "approved",
  productionStage: "queued",
  customer: "QA PAY AT SHOP PHASE 8A",
  productDesc: "QA Shirt",
  qty: "1",
};
const paymentCases = [
  [{ paymentStatus: "required" }, "UNPAID"],
  [{ paymentStatus: "pay_at_shop", paymentType: "shop" }, "PAY AT SHOP"],
  [{ paymentStatus: "full_payment_confirmed", paymentType: "shop" }, "PAID AT SHOP"],
  [{ paymentStatus: "proof_submitted" }, "RECEIPT SUBMITTED"],
  [{ paymentStatus: "under_review" }, "PAYMENT REVIEW"],
  [{ paymentStatus: "partially_paid" }, "PARTIALLY PAID"],
  [{ paymentStatus: "full_payment_confirmed", paymentType: "full" }, "PAID"],
];

for (const [payment, label] of paymentCases) {
  const html = dashboard.renderOrders({ items: [{ ...orderBase, ...payment }] });
  assert.match(html, new RegExp(`>${label}<`), `Orders renders ${label}`);
}

const port = 58189;
const child = spawn(process.execPath, ["scripts/local-dev.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    ENABLE_CUSTOMER_PAYMENT_WORKFLOW: "false",
    ENABLE_ADMIN_PAY_AT_SHOP_WORKFLOW: "true",
    VITE_ENABLE_ADMIN_PAY_AT_SHOP_WORKFLOW: "true",
    VITE_USE_SUPABASE_DATA: "false",
    VITE_SUPABASE_URL: "",
    VITE_SUPABASE_ANON_KEY: "",
    SUPABASE_URL: "",
    SUPABASE_ANON_KEY: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitForServer(port, child);

  const envResponse = await fetch(`http://127.0.0.1:${port}/src/env.js`);
  assert.equal(envResponse.status, 200);
  assert.match(await envResponse.text(), /"VITE_ENABLE_ADMIN_PAY_AT_SHOP_WORKFLOW": "true"/);

  const parkedOnline = await fetch(`http://127.0.0.1:${port}/api/inquiries/QA-PAY-8A/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "submit_receipt" }),
  });
  assert.equal(parkedOnline.status, 404);
  assert.equal((await parkedOnline.json()).error, "payment workflow is not available");

  const anonymousShopConfirmation = await fetch(`http://127.0.0.1:${port}/api/inquiries/QA-PAY-8A/customer-actions`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "confirm_shop_payment",
      receivedAmount: 1250,
      paymentMethod: "cash",
      idempotencyKey: "qa:anonymous:8a",
    }),
  });
  assert.equal(anonymousShopConfirmation.status, 401);
} finally {
  child.kill("SIGTERM");
}

console.log("PASS Phase 8A Pay at Shop feature separation, contracts, Orders labels, and anonymous boundary");

async function waitForServer(serverPort, serverProcess) {
  const started = Date.now();
  let output = "";
  serverProcess.stdout.on("data", (chunk) => { output += chunk.toString(); });
  serverProcess.stderr.on("data", (chunk) => { output += chunk.toString(); });

  while (Date.now() - started < 10000) {
    if (serverProcess.exitCode !== null) throw new Error(`local dev server exited early: ${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${serverPort}/src/env.js`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error(`local dev server did not start: ${output}`);
}
