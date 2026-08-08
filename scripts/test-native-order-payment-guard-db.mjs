import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { buildPaymentConfirmationUpdate } from "../api/_lib/paymentConfirmation.js";

const CONTAINER = `trry-phase13r5-payment-guard-${process.pid}`;
const IMAGE = process.env.TRY_VERIFY_POSTGRES_IMAGE || process.env.TRRY_VERIFY_POSTGRES_IMAGE || "postgres:16-alpine";
const DB = "trry_verify";
const ACTOR_ID = "96000000-0000-4000-8000-000000001357";
const OTHER_ACTOR_ID = "96000000-0000-4000-8000-000000001358";
const NOW = "2026-08-08T14:30:00.000Z";

let started = false;
try {
  docker(["run", "--rm", "-d", "--name", CONTAINER, "-e", "POSTGRES_PASSWORD=postgres", "-e", `POSTGRES_DB=${DB}`, IMAGE]);
  started = true;
  waitForPostgres();
  await execSql(harnessSql());
  await applyFullMigrationChain();
  await seedAdminUsers();

  await verifyNativePaymentWithoutProofOrArtwork();
  await verifyIdempotencyAndPaidRejection();
  await verifyInvalidPaymentNoMutation();
  await verifyOdooOnlyRejected();
  await verifyWonOnlyRejected();
  await verifyReleaseGateStillProtected();

  console.log(`PASS Phase 13-R5 native Order payment guard verified in disposable Postgres container ${CONTAINER}`);
} finally {
  if (started) docker(["rm", "-f", CONTAINER], { allowFailure: true });
}

async function verifyNativePaymentWithoutProofOrArtwork() {
  await insertInquiry("TRY-R5-NATIVE", {
    status: "approved",
    quote_status: "approved",
    quoted_amount: 560,
    amount_due: 560,
    quote_approved_at: "2026-08-08T14:22:03Z",
    artwork_status: null,
    artwork_approved_at: null,
    payment_status: "required",
    payment_proof_path: null,
    odoo_so: null,
  });
  await insertNativeOrder("TRY-R5-NATIVE", "TRRY-ORD-R5NATIVE");

  const result = buildPaymentConfirmationUpdate({
    inquiry: await dbInquiry("TRY-R5-NATIVE"),
    body: {
      amountReceived: 560,
      paymentSource: "gcash",
      referenceNumber: "R5-MESSENGER-RECEIPT",
      internalNote: "Owner manually checked Messenger receipt.",
      idempotencyKey: "r5-full-payment",
    },
    adminUser: { user_id: ACTOR_ID, role: "admin" },
    now: NOW,
  });

  assert.equal(result.ok, true);
  await applyUpdates("TRY-R5-NATIVE", result.updates);

  const row = await paymentSnapshot("TRY-R5-NATIVE");
  assert.equal(row.status, "approved", "Inquiry status does not need to be won");
  assert.equal(row.odoo_so, null, "Odoo SO is not active authority");
  assert.equal(row.artwork_status, null, "payment confirmation did not require artwork approval");
  assert.equal(row.payment_proof_path, null, "payment confirmation did not require in-app receipt proof");
  assert.equal(row.payment_status, "paid");
  assert.equal(Number(row.payment_confirmed_amount), 560);
  assert.equal(Number(row.payment_verified_amount), 560);
  assert.equal(Number(row.amount_due), 0);
  assert.equal(row.payment_method, "gcash");
  assert.equal(row.payment_reference, "R5-MESSENGER-RECEIPT");
  assert.equal(row.payment_confirmed_by, ACTOR_ID);
  assert.equal(row.history_count, 1);
  assert.equal(row.first_history_id, "r5-full-payment");
  assert.equal(row.event_count, 0, "admin payment confirmation remains persisted in payment_history only");
}

async function verifyIdempotencyAndPaidRejection() {
  const retry = buildPaymentConfirmationUpdate({
    inquiry: await dbInquiry("TRY-R5-NATIVE"),
    body: {
      amountReceived: 560,
      paymentSource: "gcash",
      referenceNumber: "R5-MESSENGER-RECEIPT",
      idempotencyKey: "r5-full-payment",
    },
    adminUser: { user_id: OTHER_ACTOR_ID, role: "admin" },
    now: "2026-08-08T14:40:00.000Z",
  });
  assert.equal(retry.ok, true);
  assert.equal(retry.idempotent, true);
  assert.deepEqual(retry.updates, {});
  assert.equal((await paymentSnapshot("TRY-R5-NATIVE")).history_count, 1);

  const secondKey = buildPaymentConfirmationUpdate({
    inquiry: await dbInquiry("TRY-R5-NATIVE"),
    body: {
      amountReceived: 560,
      paymentSource: "cash",
      idempotencyKey: "r5-second-key-after-paid",
    },
    adminUser: { user_id: ACTOR_ID, role: "admin" },
    now: "2026-08-08T14:45:00.000Z",
  });
  assert.equal(secondKey.ok, false);
  assert.equal(secondKey.error, "payment is already fully confirmed");
  assert.equal((await paymentSnapshot("TRY-R5-NATIVE")).history_count, 1);
}

async function verifyInvalidPaymentNoMutation() {
  await insertInquiry("TRY-R5-INVALID", { quoted_amount: 560, amount_due: 560, payment_status: "required", odoo_so: null });
  await insertNativeOrder("TRY-R5-INVALID", "TRRY-ORD-R5INVALD");
  const before = await paymentSnapshot("TRY-R5-INVALID");
  const result = buildPaymentConfirmationUpdate({
    inquiry: await dbInquiry("TRY-R5-INVALID"),
    body: { amountReceived: 560, paymentSource: "", idempotencyKey: "r5-invalid" },
    adminUser: { user_id: ACTOR_ID, role: "admin" },
    now: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "payment source is required");
  assert.deepEqual(await paymentSnapshot("TRY-R5-INVALID"), before);
}

async function verifyOdooOnlyRejected() {
  await insertInquiry("TRY-R5-ODOO", {
    status: "approved",
    odoo_so: "SO-R5-HISTORICAL",
    quoted_amount: 560,
    amount_due: 560,
    payment_status: "required",
  });
  const result = buildPaymentConfirmationUpdate({
    inquiry: await dbInquiry("TRY-R5-ODOO"),
    body: { amountReceived: 560, paymentSource: "cash", idempotencyKey: "r5-odoo-only" },
    adminUser: { user_id: ACTOR_ID, role: "owner" },
    now: NOW,
  });
  assert.equal(result.ok, true, "client helper prepares a payment update, DB guard owns native authority rejection");
  await assertApplyUpdatesFails("TRY-R5-ODOO", result.updates, /native TRRY Order|Payment confirmation requires/i);
  assert.equal((await paymentSnapshot("TRY-R5-ODOO")).history_count, 0);
}

async function verifyWonOnlyRejected() {
  await insertInquiry("TRY-R5-WON", {
    status: "won",
    odoo_so: null,
    quoted_amount: 560,
    amount_due: 560,
    payment_status: "required",
  });
  const result = buildPaymentConfirmationUpdate({
    inquiry: await dbInquiry("TRY-R5-WON"),
    body: { amountReceived: 560, paymentSource: "cash", idempotencyKey: "r5-won-only" },
    adminUser: { user_id: ACTOR_ID, role: "owner" },
    now: NOW,
  });
  assert.equal(result.ok, true, "status=won alone is not checked by helper; DB native authority guard rejects it");
  await assertApplyUpdatesFails("TRY-R5-WON", result.updates, /native TRRY Order|Payment confirmation requires/i);
  assert.equal((await paymentSnapshot("TRY-R5-WON")).history_count, 0);
}

async function verifyReleaseGateStillProtected() {
  await insertInquiry("TRY-R5-RELEASE", {
    quoted_amount: 560,
    amount_due: 560,
    artwork_status: null,
    artwork_approved_at: null,
    payment_status: "required",
    payment_proof_path: null,
    odoo_so: null,
  });
  await insertNativeOrder("TRY-R5-RELEASE", "TRRY-ORD-R5RELEAS");

  const result = buildPaymentConfirmationUpdate({
    inquiry: await dbInquiry("TRY-R5-RELEASE"),
    body: { amountReceived: 560, paymentSource: "gcash", idempotencyKey: "r5-release-gate-payment" },
    adminUser: { user_id: ACTOR_ID, role: "admin" },
    now: NOW,
  });
  assert.equal(result.ok, true);
  await applyUpdates("TRY-R5-RELEASE", result.updates);
  assert.equal((await paymentSnapshot("TRY-R5-RELEASE")).payment_status, "paid");

  await assertSqlFails(`
    update public.ops_inquiries
    set production_stage = 'printing'
    where id = 'TRY-R5-RELEASE';
  `, /Production requirements are incomplete|artwork/i);
  assert.equal((await productionSnapshot("TRY-R5-RELEASE")).production_stage, null);
}

async function applyFullMigrationChain() {
  const files = (await readdir("supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.ok(files.includes("202608080006_phase13r2_native_order_authority.sql"));
  assert.ok(files.includes("202608080007_phase13r5_native_order_payment_guard.sql"));
  for (const file of files) await execSql(await readFile(`supabase/migrations/${file}`, "utf8"));

  const functionDef = await single(`select pg_get_functiondef('public.enforce_ops_inquiry_mvp_workflow()'::regprocedure) as body`);
  assert.ok(functionDef.body.includes("native TRRY Order"), "R5 payment guard requires native Order authority");
  assert.ok(!/payment_proof_path[\\s\\S]*Payment confirmation requires/.test(functionDef.body), "payment guard no longer requires Inquiry proof path");
}

async function seedAdminUsers() {
  await execSql(`
    insert into auth.users (id, email) values
      ('${ACTOR_ID}', 'phase13r5-admin@trry.test'),
      ('${OTHER_ACTOR_ID}', 'phase13r5-other@trry.test')
    on conflict (id) do nothing;
    insert into public.admin_users (user_id, email, role, is_active)
    values
      ('${ACTOR_ID}', 'phase13r5-admin@trry.test', 'admin', true),
      ('${OTHER_ACTOR_ID}', 'phase13r5-other@trry.test', 'admin', true)
    on conflict (user_id) do update set role = excluded.role, is_active = excluded.is_active;
  `);
}

async function insertInquiry(id, overrides = {}) {
  const row = inquiry({ id, ...overrides });
  const columns = [
    "id", "customer_name", "contact", "product", "product_desc", "quantity", "fulfillment_method",
    "due_date", "status", "quote_status", "quoted_amount", "amount_due", "quote_breakdown",
    "quote_notes", "quote_valid_until", "quote_approved_at", "odoo_so", "artwork_status",
    "artwork_approved_at", "assigned_staff", "assigned_user_id", "payment_status",
    "payment_method", "payment_type", "payment_selected_amount", "payment_reference",
    "payment_confirmed_amount", "payment_confirmed_at", "payment_confirmed_by",
    "payment_verified_amount", "payment_verified_at", "payment_verified_by",
    "payment_proof_path", "payment_history", "production_stage", "production_note"
  ];
  await execSql(`insert into public.ops_inquiries (${columns.map(quoteIdent).join(", ")}) values (${columns.map((column) => sqlLiteral(row[column])).join(", ")});`);
}

function inquiry(overrides = {}) {
  return {
    id: "TRY-R5",
    customer_name: "Phase 13 R5 Customer",
    contact: "phase13r5@trry.test",
    product: "DTF",
    product_desc: "Native payment shirts",
    quantity: "12 pcs",
    fulfillment_method: "pickup",
    due_date: "2026-09-15",
    status: "approved",
    quote_status: "approved",
    quoted_amount: 560,
    amount_due: 560,
    quote_breakdown: "Synthetic R5 quote",
    quote_notes: "Synthetic R5 note",
    quote_valid_until: "2026-09-08",
    quote_approved_at: "2026-08-08T14:22:03Z",
    odoo_so: null,
    artwork_status: "approved",
    artwork_approved_at: "2026-08-08T14:25:00Z",
    assigned_staff: "Phase 13 R5 Staff",
    assigned_user_id: ACTOR_ID,
    payment_status: "required",
    payment_method: null,
    payment_type: null,
    payment_selected_amount: null,
    payment_reference: null,
    payment_confirmed_amount: null,
    payment_confirmed_at: null,
    payment_confirmed_by: null,
    payment_verified_amount: null,
    payment_verified_at: null,
    payment_verified_by: null,
    payment_proof_path: null,
    payment_history: [],
    production_stage: null,
    production_note: "Production note.",
    ...overrides,
  };
}

async function insertNativeOrder(sourceInquiryId, reference) {
  await execSql(`
    insert into public.orders (
      order_reference, source_inquiry_id, quoted_amount, amount_due, quote_breakdown,
      quote_note, quote_valid_until, quote_approved_at, customer_name, customer_contact,
      product, product_desc, quantity, fulfillment_method, due_date
    )
    select '${reference}', id, quoted_amount, amount_due, quote_breakdown,
           quote_notes, quote_valid_until, quote_approved_at, customer_name, contact,
           product, product_desc, quantity, fulfillment_method, due_date
    from public.ops_inquiries
    where id = '${sourceInquiryId}';
  `);
}

async function dbInquiry(id) {
  return single(`
    select id, status, quote_status, quoted_amount, amount_due, payment_status,
           payment_method, payment_type, payment_selected_amount, payment_reference,
           payment_confirmed_amount, payment_confirmed_at, payment_confirmed_by,
           payment_verified_amount, payment_verified_at, payment_verified_by,
           payment_review_note, payment_rejected_at, payment_history
    from public.ops_inquiries
    where id = '${id}'
  `);
}

async function paymentSnapshot(id) {
  const row = await single(`
    select i.id, i.status, i.odoo_so, i.artwork_status, i.payment_proof_path,
           i.payment_status, i.payment_method, i.payment_reference,
           i.payment_confirmed_amount, i.payment_confirmed_by,
           i.payment_verified_amount, i.amount_due,
           coalesce(jsonb_array_length(i.payment_history), 0)::int as history_count,
           i.payment_history -> 0 ->> 'id' as first_history_id
    from public.ops_inquiries i
    where i.id = '${id}'
  `);
  return { ...row, event_count: await paymentEventCount(id) };
}

async function paymentEventCount(id) {
  const exists = await single(`select to_regclass('public.inquiry_payment_events') is not null as exists`);
  if (!exists.exists) return 0;
  const row = await single(`select count(*)::int as count from public.inquiry_payment_events where inquiry_id = '${id}'`);
  return row.count;
}

async function productionSnapshot(id) {
  return single(`select production_stage from public.ops_inquiries where id = '${id}'`);
}

async function applyUpdates(id, updates) {
  const entries = Object.entries(updates);
  assert.ok(entries.length > 0, "expected updates to apply");
  await execSql(`
    update public.ops_inquiries
    set ${entries.map(([column, value]) => `${quoteIdent(column)} = ${sqlLiteral(value)}`).join(", ")}
    where id = '${id}';
  `);
}

async function assertApplyUpdatesFails(id, updates, pattern) {
  let failed = false;
  try {
    await applyUpdates(id, updates);
  } catch (error) {
    failed = true;
    assert.match(error.message, pattern);
  }
  assert.equal(failed, true, "payment update was expected to fail");
}

async function assertSqlFails(sql, pattern) {
  let failed = false;
  try {
    await execSql(sql);
  } catch (error) {
    failed = true;
    assert.match(error.message, pattern);
  }
  assert.equal(failed, true, "SQL was expected to fail");
}

async function single(sql) {
  const rows = await queryJson(sql);
  assert.equal(rows.length, 1, "expected exactly one row");
  return rows[0];
}

async function queryJson(sql) {
  const output = psql(["-t", "-A", "-c", `select coalesce(json_agg(row_to_json(q)), '[]'::json)::text from (${sql.replace(/;+\s*$/, "")}) q`]);
  return JSON.parse(output.trim() || "[]");
}

async function execSql(sql) {
  psql(["-v", "ON_ERROR_STOP=1", "-q"], sql);
}

function psql(args, input = null) {
  const result = docker(["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DB, "-X", ...args], { input, allowFailure: true });
  if (result.status !== 0) throw new Error(`${result.stderr || result.stdout}`.trim());
  return result.stdout;
}

function waitForPostgres() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    const result = docker(["exec", CONTAINER, "pg_isready", "-U", "postgres"], { allowFailure: true });
    if (result.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error("Postgres container did not become ready.");
}

function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    input: options.input ?? undefined,
    maxBuffer: 1024 * 1024 * 20,
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`docker ${args.join(" ")} failed\n${result.stderr || result.stdout}`);
  }
  return result;
}

function harnessSql() {
  return `
    create extension if not exists pgcrypto;
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
    end $$;
    create schema if not exists auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz not null default now());
    create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create schema if not exists storage;
    create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, owner uuid, metadata jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    alter table storage.objects enable row level security;
    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    grant all on auth.users, storage.buckets, storage.objects to service_role;
    grant select, insert, update, delete on storage.objects to anon, authenticated;
  `;
}

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value) || (typeof value === "object" && value)) {
    return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}
