import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const CONTAINER = `trry-native-order-guard-db-${process.pid}`;
const IMAGE = process.env.TRRY_VERIFY_POSTGRES_IMAGE || "postgres:16-alpine";
const DB = "trry_verify";
const ACTOR_ID = "96000000-0000-4000-8000-000000001351";

let started = false;

try {
  docker(["run", "--rm", "-d", "--name", CONTAINER, "-e", "POSTGRES_PASSWORD=postgres", "-e", `POSTGRES_DB=${DB}`, IMAGE]);
  started = true;
  waitForPostgres();

  await execSql(supabaseHarnessSql());
  await applyFullMigrationChain();
  await seedAdmin();

  await verifyNativeOrderWithoutOdoo();
  await verifyNoOrderNoOdooGuard();
  await verifyLegacyOdooCompatibility();
  await verifyQuoteApprovalGuard();
  await verifyPositiveQuoteGuard();
  await verifyFullNativeLifecycleWithoutOdoo();

  console.log(`PASS Native Order guard/Odoo decoupling verified in disposable Postgres container ${CONTAINER}`);
} finally {
  if (started) docker(["rm", "-f", CONTAINER], { allowFailure: true });
}

async function applyFullMigrationChain() {
  const files = (await readdir("supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await execSql(await readFile(`supabase/migrations/${file}`, "utf8"));
  }
}

async function verifyNativeOrderWithoutOdoo() {
  await insertInquiry("TRY-R1-NATIVE", { odoo_so: null });
  await insertNativeOrder("TRY-R1-NATIVE", "TRRY-ORD-R1NATIVE");
  await execSql(`update public.ops_inquiries set status = 'won' where id = 'TRY-R1-NATIVE';`);
  await assertStage("TRY-R1-NATIVE", null);
  await execSql(`update public.ops_inquiries set production_stage = 'printing' where id = 'TRY-R1-NATIVE';`);
  await assertStage("TRY-R1-NATIVE", "printing");
}

async function verifyNoOrderNoOdooGuard() {
  await insertInquiry("TRY-R1-NOORDER", { odoo_so: null });
  await assertSqlFails(
    `update public.ops_inquiries set status = 'won' where id = 'TRY-R1-NOORDER';`,
    /native TRRY Order|confirmed order/i
  );
}

async function verifyLegacyOdooCompatibility() {
  await insertInquiry("TRY-R1-LEGACY", { odoo_so: "SO-R1-LEGACY" });
  await assertSqlFails(
    `update public.ops_inquiries set status = 'won' where id = 'TRY-R1-LEGACY';`,
    /native TRRY Order|confirmed native|confirmed order/i
  );
  await assertSqlFails(
    `update public.ops_inquiries set production_stage = 'printing' where id = 'TRY-R1-LEGACY';`,
    /native TRRY Order|confirmed native|confirmed order/i
  );
}

async function verifyQuoteApprovalGuard() {
  await insertInquiry("TRY-R1-UNAPPROVED", { quote_status: "ready", odoo_so: null });
  await insertNativeOrder("TRY-R1-UNAPPROVED", "TRRY-ORD-R1UNAPP1");
  await assertSqlFails(
    `update public.ops_inquiries set status = 'won' where id = 'TRY-R1-UNAPPROVED';`,
    /quote approval|native TRRY Order/i
  );
}

async function verifyPositiveQuoteGuard() {
  await insertInquiry("TRY-R1-ZERO", { quoted_amount: 0, amount_due: 0, odoo_so: null });
  await insertNativeOrder("TRY-R1-ZERO", "TRRY-ORD-R1ZERO12");
  await assertSqlFails(
    `update public.ops_inquiries set status = 'won' where id = 'TRY-R1-ZERO';`,
    /positive quote|native TRRY Order/i
  );
}

async function verifyFullNativeLifecycleWithoutOdoo() {
  await insertInquiry("TRY-R1-LIFE", { odoo_so: null });
  await insertNativeOrder("TRY-R1-LIFE", "TRRY-ORD-R1LIFE12");
  await execSql(`
    update public.ops_inquiries set status = 'won' where id = 'TRY-R1-LIFE';
    update public.ops_inquiries set production_stage = 'printing' where id = 'TRY-R1-LIFE';
    update public.ops_inquiries
    set production_started_at = '2026-08-08T09:00:00Z',
        production_started_by = '${ACTOR_ID}'
    where id = 'TRY-R1-LIFE';
    update public.ops_inquiries
    set production_stage = 'qc',
        qc_started_at = '2026-08-08T10:00:00Z',
        qc_started_by = '${ACTOR_ID}'
    where id = 'TRY-R1-LIFE';
    update public.ops_inquiries
    set qc_note = 'Native QC note without Odoo.'
    where id = 'TRY-R1-LIFE';
    update public.ops_inquiries
    set production_stage = 'ready',
        qc_completed_at = '2026-08-08T10:30:00Z',
        qc_completed_by = '${ACTOR_ID}'
    where id = 'TRY-R1-LIFE';
    update public.ops_inquiries
    set production_stage = 'completed',
        production_completed_at = '2026-08-08T11:00:00Z',
        production_completed_by = '${ACTOR_ID}'
    where id = 'TRY-R1-LIFE';
  `);
  const row = await single(`
    select status, odoo_so, production_stage, production_started_at is not null as started,
           qc_started_at is not null as qc_started, qc_completed_at is not null as qc_completed,
           production_completed_at is not null as production_completed, qc_note
    from public.ops_inquiries
    where id = 'TRY-R1-LIFE'
  `);
  assert.deepEqual(row, {
    status: "won",
    odoo_so: null,
    production_stage: "completed",
    started: true,
    qc_started: true,
    qc_completed: true,
    production_completed: true,
    qc_note: "Native QC note without Odoo.",
  });
}

async function insertInquiry(id, overrides = {}) {
  const row = {
    id,
    customer_name: `${id} Customer`,
    contact: "+639171351351",
    product: "DTF",
    product_desc: "Native guard shirts",
    quantity: "12 pcs",
    due_date: "2026-09-15",
    status: "approved",
    quote_status: "approved",
    quoted_amount: 1350,
    amount_due: 0,
    quote_breakdown: "Synthetic R1 quote",
    quote_notes: "Synthetic R1 note",
    quote_valid_until: "2026-09-08",
    quote_approved_at: "2026-08-08T08:00:00Z",
    odoo_so: null,
    artwork_status: "approved",
    artwork_approved_at: "2026-08-08T08:05:00Z",
    assigned_staff: "Phase 13 R1 Staff",
    assigned_user_id: ACTOR_ID,
    payment_status: "paid",
    payment_verified_amount: 1350,
    payment_confirmed_amount: 1350,
    payment_confirmed_at: "2026-08-08T08:15:00Z",
    payment_proof_path: `${id}/proofs/receipt.png`,
    production_stage: null,
    ...overrides,
  };
  const columns = Object.keys(row);
  const values = columns.map((column) => sqlLiteral(row[column]));
  await execSql(`insert into public.ops_inquiries (${columns.map(quoteIdent).join(", ")}) values (${values.join(", ")});`);
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
    insert into auth.users (id, email) values ('${ACTOR_ID}', 'phase13r1@trry.test') on conflict (id) do nothing;
    insert into public.admin_users (user_id, email, role, is_active)
    values ('${ACTOR_ID}', 'phase13r1@trry.test', 'admin', true)
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
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    input: options.input,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0 && !options.allowFailure) throw new Error(`${result.stderr || result.stdout}`.trim());
  return result;
}

function supabaseHarnessSql() {
  return `
    create extension if not exists pgcrypto;
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
    end $$;
    create schema if not exists auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text,
      created_at timestamptz not null default now()
    );
    create or replace function auth.uid()
    returns uuid
    language sql
    stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create schema if not exists storage;
    create table storage.buckets (
      id text primary key,
      name text not null,
      public boolean not null default false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text not null,
      name text not null,
      owner uuid,
      metadata jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
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
