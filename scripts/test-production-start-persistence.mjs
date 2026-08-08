import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { buildOpsWorkflowUpdates } from "../api/_lib/opsWorkflow.js";
import { handleWorkflowRequest } from "../api/inquiries/[id]/workflow.js";

const CONTAINER = `trry-production-start-db-${process.pid}`;
const IMAGE = process.env.TRY_VERIFY_POSTGRES_IMAGE || "postgres:16-alpine";
const DB = "trry_verify";
const ACTOR_ID = "96000000-0000-4000-8000-000000000888";
const OTHER_ACTOR_ID = "96000000-0000-4000-8000-000000000889";

verifyPureWorkflowContract();
await verifyWorkflowApiContract();
await verifyDisposableDatabaseContract();

console.log("PASS Production start persistence contract, API idempotency, queued derivation, and disposable DB migration");

function verifyPureWorkflowContract() {
  const releasedAt = "2026-08-08T08:00:00.000Z";
  const startAt = "2026-08-08T08:15:00.000Z";
  const release = buildOpsWorkflowUpdates("advance_production", { productionStage: "printing", assignedStaff: "Louvelyngel" }, gateClearInquiry({ production_stage: "queued" }), releasedAt);
  assert.equal(release.ok, true, "release succeeds for gate-clear queued job");
  assert.equal(release.updates.production_stage, "printing");
  assert.equal(release.updates.production_started_at, null, "release does not mark production started");
  assert.equal(release.updates.production_started_by, null);

  const start = buildOpsWorkflowUpdates("start_production", { productionStartedBy: ACTOR_ID }, gateClearInquiry({ production_stage: "printing" }), startAt);
  assert.equal(start.ok, true, "start succeeds after release");
  assert.equal(start.updates.production_started_at, startAt);
  assert.equal(start.updates.production_started_by, ACTOR_ID);
  assert.equal(start.updates.production_stage, undefined, "start does not advance to QC");

  const retry = buildOpsWorkflowUpdates("start_production", { productionStartedBy: OTHER_ACTOR_ID }, gateClearInquiry({ production_stage: "printing", production_started_at: startAt, production_started_by: ACTOR_ID }), "2026-08-08T08:20:00.000Z");
  assert.equal(retry.ok, true, "start retry succeeds safely");
  assert.equal(retry.noop, true, "start retry is a no-op");
  assert.deepEqual(retry.updates, {}, "start retry does not rewrite authoritative timestamp");

  const notReleased = buildOpsWorkflowUpdates("start_production", { productionStartedBy: ACTOR_ID }, gateClearInquiry({ production_stage: "queued" }), startAt);
  assert.equal(notReleased.ok, false, "not-released job cannot start");

  const completed = buildOpsWorkflowUpdates("start_production", { productionStartedBy: ACTOR_ID }, gateClearInquiry({ production_stage: "completed" }), startAt);
  assert.equal(completed.ok, false, "completed job cannot start");

  const qcBeforeStart = buildOpsWorkflowUpdates("advance_production", { productionStage: "qc", assignedStaff: "Louvelyngel" }, gateClearInquiry({ production_stage: "printing" }), startAt);
  assert.equal(qcBeforeStart.ok, false, "QC requires production start first");

  const qcAfterStart = buildOpsWorkflowUpdates("advance_production", { productionStage: "qc", assignedStaff: "Louvelyngel" }, gateClearInquiry({ production_stage: "printing", production_started_at: startAt, production_started_by: ACTOR_ID }), "2026-08-08T09:00:00.000Z");
  assert.equal(qcAfterStart.ok, true, "existing QC progression remains intact after start");
}

async function verifyWorkflowApiContract() {
  const startedAt = "2026-08-08T08:15:00.000Z";
  const rows = new Map([
    ["TRY-API-START", gateClearInquiry({ id: "TRY-API-START", production_stage: "printing" })],
    ["TRY-API-STARTED", gateClearInquiry({ id: "TRY-API-STARTED", production_stage: "printing", production_started_at: startedAt, production_started_by: ACTOR_ID })],
  ]);
  const updates = [];
  const supabase = {
    from(table) {
      assert.equal(table, "ops_inquiries");
      let selectedId = "";
      let patch = null;
      const builder = {
        select() { return builder; },
        eq(key, value) { if (key === "id") selectedId = value; return builder; },
        update(value) { patch = value; return builder; },
        async maybeSingle() { return { data: rows.get(selectedId) || null, error: null }; },
        async single() {
          const current = rows.get(selectedId);
          const next = { ...current, ...patch };
          rows.set(selectedId, next);
          updates.push({ id: selectedId, patch });
          return { data: next, error: null };
        },
      };
      return builder;
    },
  };

  const first = await invokeWorkflowApi(supabase, "TRY-API-START", { action: "start_production" });
  assert.equal(first.status, 200);
  assert.equal(first.body.ok, true);
  assert.ok(first.body.inquiry.productionStartedAt, "API returns persisted start timestamp");
  assert.equal(first.body.inquiry.productionStartedBy, ACTOR_ID);
  assert.equal(updates.length, 1, "first start writes once");

  const retry = await invokeWorkflowApi(supabase, "TRY-API-STARTED", { action: "start_production" });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.inquiry.productionStartedAt, startedAt);
  assert.equal(updates.length, 1, "already-started retry does not update the row");
}

async function verifyDisposableDatabaseContract() {
  let started = false;
  try {
    docker(["run", "--rm", "-d", "--name", CONTAINER, "-e", "POSTGRES_PASSWORD=postgres", "-e", `POSTGRES_DB=${DB}`, IMAGE]);
    started = true;
    waitForPostgres();
    await execSql(bootstrapSql());
    await execSql(await readFile("supabase/migrations/202608080002_phase8_production_start_persistence.sql", "utf8"));
    await execSql(`create trigger ops_inquiries_mvp_workflow_guard before update on public.ops_inquiries for each row execute function public.enforce_ops_inquiry_mvp_workflow();`);

    const columns = await queryJson(`
      select column_name, udt_name, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = 'ops_inquiries'
        and column_name in ('production_started_at', 'production_started_by')
      order by column_name
    `);
    assert.deepEqual(columns, [
      { column_name: "production_started_at", udt_name: "timestamptz", is_nullable: "YES" },
      { column_name: "production_started_by", udt_name: "uuid", is_nullable: "YES" },
    ]);

    const constraints = await queryJson(`
      select conname, pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conrelid = 'public.ops_inquiries'::regclass
        and conname = 'ops_inquiries_production_started_by_fkey'
    `);
    assert.equal(constraints.length, 1);
    assert.match(constraints[0].definition, /FOREIGN KEY \(production_started_by\) REFERENCES admin_users\(user_id\) ON DELETE SET NULL/);

    await execSql(seedSql());
    await execSql(`
      update public.ops_inquiries
      set production_stage = 'printing', production_started_at = null, production_started_by = null
      where id = 'TRY-DB-RELEASE';
    `);
    assert.deepEqual(await single(`select production_stage, production_started_at, production_started_by from public.ops_inquiries where id = 'TRY-DB-RELEASE'`), {
      production_stage: "printing",
      production_started_at: null,
      production_started_by: null,
    });

    await assertSqlFails(`
      update public.ops_inquiries
      set production_started_at = '2026-08-08T08:15:00Z', production_started_by = '${ACTOR_ID}'
      where id = 'TRY-DB-QUEUED';
    `, /Production can only start after release/i);

    await execSql(`
      update public.ops_inquiries
      set production_started_at = '2026-08-08T08:15:00Z', production_started_by = '${ACTOR_ID}'
      where id = 'TRY-DB-RELEASE';
    `);
    const startedRow = await single(`select production_stage, production_started_at::text, production_started_by::text from public.ops_inquiries where id = 'TRY-DB-RELEASE'`);
    assert.equal(startedRow.production_stage, "printing");
    assert.match(startedRow.production_started_at, /^2026-08-08 08:15:00/);
    assert.equal(startedRow.production_started_by, ACTOR_ID);

    await assertSqlFails(`
      update public.ops_inquiries
      set production_started_at = '2026-08-08T08:20:00Z', production_started_by = '${OTHER_ACTOR_ID}'
      where id = 'TRY-DB-RELEASE';
    `, /Production start is immutable/i);

    await assertSqlFails(`
      update public.ops_inquiries
      set production_stage = 'qc'
      where id = 'TRY-DB-QC-BLOCKED';
    `, /Production must be started before Quality Check/i);

    await execSql(`
      update public.ops_inquiries
      set production_started_at = '2026-08-08T08:30:00Z', production_started_by = '${ACTOR_ID}'
      where id = 'TRY-DB-QC-BLOCKED';

      update public.ops_inquiries
      set production_stage = 'qc'
      where id = 'TRY-DB-QC-BLOCKED';
    `);
    assert.equal((await single(`select production_stage from public.ops_inquiries where id = 'TRY-DB-QC-BLOCKED'`)).production_stage, "qc");
  } finally {
    if (started) docker(["rm", "-f", CONTAINER], { allowFailure: true });
  }
}

function gateClearInquiry(overrides = {}) {
  return {
    id: "TRY-START",
    status: "won",
    quote_status: "approved",
    quoted_amount: 850,
    amount_due: 850,
    odoo_so: "SO-START",
    product: "DTF",
    product_desc: "Premium Tshirt",
    quantity: "12 pcs",
    due_date: "2026-08-20",
    artwork_status: "approved",
    assigned_staff: "Louvelyngel",
    payment_status: "paid",
    payment_verified_amount: 850,
    payment_confirmed_amount: 850,
    production_stage: "queued",
    production_started_at: null,
    production_started_by: null,
    blocked_reason: null,
    ...overrides,
  };
}

async function invokeWorkflowApi(supabase, inquiryId, body) {
  const request = Readable.from([JSON.stringify(body)]);
  request.method = "PATCH";
  request.url = `/api/inquiries/${encodeURIComponent(inquiryId)}/workflow`;
  request.headers = { host: "localhost", authorization: "Bearer synthetic" };
  const response = createResponse();
  await handleWorkflowRequest(request, response, { supabase, adminUser: { role: "staff", userId: ACTOR_ID } });
  return response.result();
}

async function queryJson(sql) {
  return JSON.parse(psql(["-t", "-A", "-c", `select coalesce(json_agg(row_to_json(q)), '[]'::json)::text from (${sql}) q`]).trim() || "[]");
}

async function single(sql) {
  const rows = await queryJson(sql);
  assert.ok(rows.length <= 1, "expected one row at most");
  return rows[0] || null;
}

async function execSql(sql) {
  psql(["-v", "ON_ERROR_STOP=1", "-q"], sql);
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

function bootstrapSql() {
  return `
    create extension if not exists pgcrypto;

    create table public.admin_users (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null unique,
      email text,
      display_name text,
      role text not null check (role in ('owner', 'admin', 'staff', 'viewer')),
      is_active boolean not null default true
    );

    create table public.ops_inquiries (
      id text primary key,
      status text not null default 'new',
      quote_status text,
      quoted_amount numeric,
      amount_due numeric,
      odoo_so text,
      product text,
      product_desc text,
      quantity text,
      due_date date,
      artwork_status text,
      assigned_staff text,
      production_stage text,
      production_note text,
      production_updated_at timestamptz,
      blocked_reason text,
      payment_status text,
      payment_proof_path text,
      payment_confirmed_amount numeric,
      payment_confirmed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `;
}

function seedSql() {
  return `
    insert into public.admin_users (user_id, email, display_name, role, is_active)
    values
      ('${ACTOR_ID}', 'louvelyngel@trry.test', 'Louvelyngel', 'staff', true),
      ('${OTHER_ACTOR_ID}', 'other@trry.test', 'Other', 'staff', true);

    insert into public.ops_inquiries (id, status, quote_status, quoted_amount, amount_due, odoo_so, product, product_desc, quantity, due_date, artwork_status, assigned_staff, payment_status, payment_confirmed_amount, payment_confirmed_at, production_stage)
    values
      ('TRY-DB-RELEASE', 'won', 'approved', 850, 850, 'SO-REL', 'DTF', 'Premium Tshirt', '12 pcs', '2026-08-20', 'approved', 'Louvelyngel', 'paid', 850, '2026-08-08T08:00:00Z', 'queued'),
      ('TRY-DB-QUEUED', 'won', 'approved', 850, 850, 'SO-QUE', 'DTF', 'Premium Tshirt', '12 pcs', '2026-08-20', 'approved', 'Louvelyngel', 'paid', 850, '2026-08-08T08:00:00Z', 'queued'),
      ('TRY-DB-QC-BLOCKED', 'won', 'approved', 850, 850, 'SO-QC', 'DTF', 'Premium Tshirt', '12 pcs', '2026-08-20', 'approved', 'Louvelyngel', 'paid', 850, '2026-08-08T08:00:00Z', 'printing');
  `;
}

function createResponse() {
  const response = {
    statusCode: 200,
    headers: {},
    setHeader(key, value) { response.headers[key.toLowerCase()] = value; },
    end(payload = "") { response.payload = payload; },
    result() {
      return {
        status: response.statusCode,
        headers: response.headers,
        body: response.payload ? JSON.parse(response.payload) : null,
      };
    },
  };
  return response;
}
