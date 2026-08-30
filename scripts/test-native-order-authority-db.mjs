import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { buildOpsWorkflowUpdates } from "../api/_lib/opsWorkflow.js";

const CONTAINER = `trry-native-order-authority-db-${process.pid}`;
const IMAGE = process.env.TRRY_VERIFY_POSTGRES_IMAGE || "postgres:16-alpine";
const DB = "trry_verify";
const ACTOR_ID = "96000000-0000-4000-8000-000000001361";

verifyBackendAuthority();

let started = false;
try {
  docker(["run", "--rm", "-d", "--name", CONTAINER, "-e", "POSTGRES_PASSWORD=postgres", "-e", `POSTGRES_DB=${DB}`, IMAGE]);
  started = true;
  waitForPostgres();
  await execSql(supabaseHarnessSql());
  await applyFullMigrationChain();
  await seedAdmin();

  await verifyNativeStatusNotWon();
  await verifyOdooOnlyRejected();
  await verifyWonNoOdooNoOrderRejected();
  await verifyNativeWinsWhenHistoricalOdooAlsoPresent();
  await verifyQuoteGuards();
  await verifyFullNativeLifecycleWithoutWonAuthority();

  console.log(`PASS Native Order sole authority verified in disposable Postgres container ${CONTAINER}`);
} finally {
  if (started) docker(["rm", "-f", CONTAINER], { allowFailure: true, timeout: 30_000 });
}

function verifyBackendAuthority() {
  const base = inquiry({ id: "TRY-PURE", status: "approved", nativeOrderAuthority: true });
  const release = buildOpsWorkflowUpdates("advance_production", productionBody({ productionStage: "printing" }), base, "2026-08-08T09:00:00Z");
  assert.equal(release.ok, true, "native Order authority allows release without status=won");

  const wonOnly = buildOpsWorkflowUpdates("advance_production", productionBody({ productionStage: "printing" }), inquiry({ id: "TRY-PURE-WON", status: "won", odoo_so: "SO-NOPE" }), "2026-08-08T09:00:00Z");
  assert.equal(wonOnly.ok, false, "status=won and Odoo alone do not authorize workflow");

  const legacyAction = buildOpsWorkflowUpdates("confirm_order", { odooSO: "SO-NOPE" }, inquiry({ id: "TRY-CONFIRM", status: "sent" }), "2026-08-08T09:00:00Z");
  assert.equal(legacyAction.ok, false);
  assert.equal(legacyAction.error, "invalid workflow action");
}

async function verifyNativeStatusNotWon() {
  await insertInquiry("TRY-R2-NATIVE", { status: "approved", odoo_so: null });
  await insertNativeOrder("TRY-R2-NATIVE", "TRRY-ORD-R2NATIVE");
  await execSql(`update public.ops_inquiries set production_stage = 'printing' where id = 'TRY-R2-NATIVE';`);
  await assertStage("TRY-R2-NATIVE", "printing");
}

async function verifyOdooOnlyRejected() {
  await insertInquiry("TRY-R2-ODOO", { status: "won", odoo_so: "SO-R2-ODOO" });
  await assertSqlFails(
    `update public.ops_inquiries set production_stage = 'printing' where id = 'TRY-R2-ODOO';`,
    /native TRRY Order|confirmed native|confirmed order/i
  );
}

async function verifyWonNoOdooNoOrderRejected() {
  await insertInquiry("TRY-R2-NOORDER", { status: "won", odoo_so: null });
  await assertSqlFails(
    `update public.ops_inquiries set production_stage = 'printing' where id = 'TRY-R2-NOORDER';`,
    /native TRRY Order|confirmed native|confirmed order/i
  );
}

async function verifyNativeWinsWhenHistoricalOdooAlsoPresent() {
  await insertInquiry("TRY-R2-BOTH", { status: "approved", odoo_so: "SO-HISTORICAL" });
  await insertNativeOrder("TRY-R2-BOTH", "TRRY-ORD-R2BOTH12");
  await execSql(`update public.ops_inquiries set production_stage = 'printing' where id = 'TRY-R2-BOTH';`);
  await assertStage("TRY-R2-BOTH", "printing");
}

async function verifyQuoteGuards() {
  await insertInquiry("TRY-R2-UNAPP", { status: "approved", quote_status: "ready", odoo_so: null });
  await insertNativeOrder("TRY-R2-UNAPP", "TRRY-ORD-R2UNAPP1");
  await assertSqlFails(
    `update public.ops_inquiries set production_stage = 'printing' where id = 'TRY-R2-UNAPP';`,
    /approved|Production requires/i
  );

  await insertInquiry("TRY-R2-ZERO", { status: "approved", quoted_amount: 0, amount_due: 0, odoo_so: null });
  await insertNativeOrder("TRY-R2-ZERO", "TRRY-ORD-R2ZERO12");
  await assertSqlFails(
    `update public.ops_inquiries set status = 'won' where id = 'TRY-R2-ZERO';`,
    /positive quote|native TRRY Order/i
  );
}

async function verifyFullNativeLifecycleWithoutWonAuthority() {
  await insertInquiry("TRY-R2-LIFE", { status: "approved", odoo_so: null });
  await insertNativeOrder("TRY-R2-LIFE", "TRRY-ORD-R2LIFE12");
  await execSql(`
    update public.ops_inquiries set production_stage = 'printing' where id = 'TRY-R2-LIFE';
    update public.ops_inquiries
    set production_started_at = '2026-08-08T09:00:00Z',
        production_started_by = '${ACTOR_ID}'
    where id = 'TRY-R2-LIFE';
    update public.ops_inquiries
    set production_stage = 'qc',
        qc_started_at = '2026-08-08T10:00:00Z',
        qc_started_by = '${ACTOR_ID}'
    where id = 'TRY-R2-LIFE';
    update public.ops_inquiries
    set production_stage = 'ready',
        qc_completed_at = '2026-08-08T10:30:00Z',
        qc_completed_by = '${ACTOR_ID}'
    where id = 'TRY-R2-LIFE';
    update public.ops_inquiries
    set production_stage = 'completed',
        production_completed_at = '2026-08-08T11:00:00Z',
        production_completed_by = '${ACTOR_ID}'
    where id = 'TRY-R2-LIFE';
  `);
  const row = await single(`
    select status, odoo_so, production_stage, production_started_at is not null as started,
           qc_started_at is not null as qc_started, qc_completed_at is not null as qc_completed,
           production_completed_at is not null as production_completed
    from public.ops_inquiries
    where id = 'TRY-R2-LIFE'
  `);
  assert.deepEqual(row, {
    status: "approved",
    odoo_so: null,
    production_stage: "completed",
    started: true,
    qc_started: true,
    qc_completed: true,
    production_completed: true,
  });
}

async function applyFullMigrationChain() {
  const files = (await readdir("supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.ok(files.includes("202608080006_phase13r2_native_order_authority.sql"));
  for (const file of files) await execSql(await readFile(`supabase/migrations/${file}`, "utf8"));
  const helper = await single(`select public.trry_ops_inquiry_has_order_confirmation('missing', 'SO-IGNORED') as allowed`);
  assert.equal(helper.allowed, false, "Odoo-only helper input has no authority");
}

async function insertInquiry(id, overrides = {}) {
  const row = inquiry({ id, ...overrides });
  const columns = [
    "id", "customer_name", "contact", "product", "product_desc", "quantity", "fulfillment_method",
    "due_date", "status", "quote_status", "quoted_amount", "amount_due", "quote_breakdown",
    "quote_notes", "quote_valid_until", "quote_approved_at", "odoo_so", "artwork_status",
    "artwork_approved_at", "assigned_staff", "assigned_user_id", "payment_status",
    "payment_verified_amount", "payment_confirmed_amount", "payment_confirmed_at",
    "payment_proof_path", "production_stage", "production_note"
  ];
  await execSql(`insert into public.ops_inquiries (${columns.map(quoteIdent).join(", ")}) values (${columns.map((column) => sqlLiteral(row[column])).join(", ")});`);
}

function inquiry(overrides = {}) {
  return {
    id: "TRY-R2",
    customer_name: "Phase 13 R2 Customer",
    contact: "+639171361361",
    product: "DTF",
    product_desc: "Native authority shirts",
    quantity: "12 pcs",
    fulfillment_method: "pickup",
    due_date: "2026-09-15",
    status: "approved",
    quote_status: "approved",
    quoted_amount: 1360,
    amount_due: 0,
    quote_breakdown: "Synthetic R2 quote",
    quote_notes: "Synthetic R2 note",
    quote_valid_until: "2026-09-08",
    quote_approved_at: "2026-08-08T08:00:00Z",
    odoo_so: null,
    artwork_status: "approved",
    artwork_approved_at: "2026-08-08T08:05:00Z",
    assigned_staff: "Phase 13 R2 Staff",
    assigned_user_id: ACTOR_ID,
    payment_status: "paid",
    payment_verified_amount: 1360,
    payment_confirmed_amount: 1360,
    payment_confirmed_at: "2026-08-08T08:15:00Z",
    payment_proof_path: "phase13-r2/proofs/receipt.png",
    production_stage: null,
    production_note: "Production note.",
    ...overrides,
  };
}

function productionBody(overrides = {}) {
  return {
    assignedStaff: "Phase 13 R2 Staff",
    productionNote: "Production note.",
    blockedReason: "",
    actorUserId: ACTOR_ID,
    ...overrides,
  };
}

async function insertNativeOrder(sourceInquiryId, reference) {
  await execSql(`
    insert into public.orders (
      order_reference, source_inquiry_id, quoted_amount, amount_due, customer_name,
      customer_contact, product, product_desc, quantity, fulfillment_method, due_date
    )
    select '${reference}', id, quoted_amount, amount_due, customer_name,
           contact, product, product_desc, quantity, fulfillment_method, due_date
    from public.ops_inquiries
    where id = '${sourceInquiryId}';
  `);
}

async function seedAdmin() {
  await execSql(`
    insert into auth.users (id, email) values ('${ACTOR_ID}', 'phase13r2@trry.test') on conflict (id) do nothing;
    insert into public.admin_users (user_id, email, role, is_active)
    values ('${ACTOR_ID}', 'phase13r2@trry.test', 'admin', true)
    on conflict (user_id) do update set role = excluded.role, is_active = excluded.is_active;
  `);
}

async function assertStage(id, expected) {
  const row = await single(`select production_stage from public.ops_inquiries where id = '${id}'`);
  assert.equal(row.production_stage, expected);
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
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const ready = docker(["exec", CONTAINER, "pg_isready", "-U", "postgres", "-d", DB], { allowFailure: true });
    const query = docker(["exec", CONTAINER, "psql", "-U", "postgres", "-d", DB, "-X", "-t", "-A", "-c", "select 1"], { allowFailure: true });
    if (ready.status === 0 && query.status === 0 && query.stdout.trim() === "1") return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error("Postgres container did not become ready");
}

function docker(args, options = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", input: options.input, maxBuffer: 10 * 1024 * 1024, timeout: options.timeout || 0 });
  if (result.status !== 0 && !options.allowFailure) throw new Error(`${result.stderr || result.stdout}`.trim());
  return result;
}

function supabaseHarnessSql() {
  return `
    create schema if not exists extensions;
    create extension if not exists pgcrypto with schema extensions;
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
  return `'${String(value).replaceAll("'", "''")}'`;
}
