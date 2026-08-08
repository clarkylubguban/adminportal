import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { buildOpsWorkflowUpdates } from "../api/_lib/opsWorkflow.js";
import { handleWorkflowRequest } from "../api/inquiries/[id]/workflow.js";
import { mapOpsRowToInquiry } from "../src/services/opsBoard.js";

const CONTAINER = `trry-qc-persistence-db-${process.pid}`;
const IMAGE = process.env.TRY_VERIFY_POSTGRES_IMAGE || "postgres:16-alpine";
const DB = "trry_verify";
const ACTOR_ID = "96000000-0000-4000-8000-000000000888";
const OTHER_ACTOR_ID = "96000000-0000-4000-8000-000000000889";

verifyPureWorkflowContract();
await verifyWorkflowApiContract();
verifyReadModelContract();
await verifyDisposableDatabaseContract();

console.log("PASS QC persistence contract, API metadata, read model exposure, idempotency, guards, and disposable DB migration");

function verifyPureWorkflowContract() {
  const qcAt = "2026-08-08T09:00:00.000Z";
  const completeAt = "2026-08-08T09:20:00.000Z";
  const started = gateClearInquiry({
    production_stage: "printing",
    production_started_at: "2026-08-08T08:15:00.000Z",
    production_started_by: ACTOR_ID,
  });

  const enterQc = buildOpsWorkflowUpdates("advance_production", { productionStage: "qc", assignedStaff: "Louvelyngel", actorUserId: ACTOR_ID }, started, qcAt);
  assert.equal(enterQc.ok, true, "started production can enter QC");
  assert.equal(enterQc.updates.production_stage, "qc");
  assert.equal(enterQc.updates.qc_started_at, qcAt);
  assert.equal(enterQc.updates.qc_started_by, ACTOR_ID);

  const enterQcRetry = buildOpsWorkflowUpdates("advance_production", { productionStage: "qc", assignedStaff: "Louvelyngel", actorUserId: OTHER_ACTOR_ID }, {
    ...started,
    production_stage: "qc",
    qc_started_at: qcAt,
    qc_started_by: ACTOR_ID,
  }, "2026-08-08T09:05:00.000Z");
  assert.equal(enterQcRetry.ok, false, "already-QC rows do not re-enter QC as a new transition");

  const invalidQc = buildOpsWorkflowUpdates("advance_production", { productionStage: "qc", assignedStaff: "Louvelyngel", actorUserId: ACTOR_ID }, gateClearInquiry({ production_stage: "printing", production_started_at: null }), qcAt);
  assert.equal(invalidQc.ok, false, "not-started production cannot enter QC");

  const note = buildOpsWorkflowUpdates("save_qc_note", { qcNote: "Checked quantity and artwork placement.", actorUserId: ACTOR_ID }, {
    ...started,
    production_stage: "qc",
    qc_started_at: qcAt,
    qc_started_by: ACTOR_ID,
    production_note: "Production completed.",
  }, "2026-08-08T09:10:00.000Z");
  assert.equal(note.ok, true, "QC note saves during QC");
  assert.equal(note.updates.qc_note, "Checked quantity and artwork placement.");
  assert.equal(note.updates.production_note, undefined, "QC note does not overwrite production note");
  assert.equal(note.updates.production_stage, undefined, "QC note does not advance stage");

  const completeQc = buildOpsWorkflowUpdates("advance_production", { productionStage: "ready", assignedStaff: "Louvelyngel", actorUserId: ACTOR_ID }, {
    ...started,
    production_stage: "qc",
    qc_started_at: qcAt,
    qc_started_by: ACTOR_ID,
    qc_note: "Looks good.",
  }, completeAt);
  assert.equal(completeQc.ok, true, "QC can complete to ready");
  assert.equal(completeQc.updates.production_stage, "ready");
  assert.equal(completeQc.updates.qc_completed_at, completeAt);
  assert.equal(completeQc.updates.qc_completed_by, ACTOR_ID);

  const legacyComplete = buildOpsWorkflowUpdates("advance_production", { productionStage: "ready", assignedStaff: "Louvelyngel", actorUserId: ACTOR_ID }, {
    ...started,
    production_stage: "qc",
    qc_started_at: null,
    qc_started_by: null,
  }, completeAt);
  assert.equal(legacyComplete.ok, true, "legacy QC row can reconcile metadata when completed");
  assert.equal(legacyComplete.updates.qc_started_at, completeAt);
  assert.equal(legacyComplete.updates.qc_completed_at, completeAt);

  const retryComplete = buildOpsWorkflowUpdates("advance_production", { productionStage: "ready", assignedStaff: "Louvelyngel", actorUserId: OTHER_ACTOR_ID }, {
    ...started,
    production_stage: "ready",
    qc_started_at: qcAt,
    qc_started_by: ACTOR_ID,
    qc_completed_at: completeAt,
    qc_completed_by: ACTOR_ID,
  }, "2026-08-08T09:30:00.000Z");
  assert.equal(retryComplete.ok, true, "ready retry reconciles safely");
  assert.equal(retryComplete.noop, true);
  assert.deepEqual(retryComplete.updates, {}, "ready retry does not rewrite QC completion metadata");

  const blockedComplete = buildOpsWorkflowUpdates("advance_production", { productionStage: "ready", assignedStaff: "Louvelyngel", actorUserId: ACTOR_ID }, {
    ...started,
    production_stage: "qc",
    qc_started_at: qcAt,
    blocked_reason: "Print defect",
  }, completeAt);
  assert.equal(blockedComplete.ok, false, "blocked QC cannot complete to ready");
}

async function verifyWorkflowApiContract() {
  const rows = new Map([
    ["TRY-API-QC", gateClearInquiry({
      id: "TRY-API-QC",
      production_stage: "printing",
      production_started_at: "2026-08-08T08:15:00.000Z",
      production_started_by: ACTOR_ID,
    })],
    ["TRY-API-NOTE", gateClearInquiry({
      id: "TRY-API-NOTE",
      production_stage: "qc",
      production_started_at: "2026-08-08T08:15:00.000Z",
      production_started_by: ACTOR_ID,
      qc_started_at: "2026-08-08T09:00:00.000Z",
      qc_started_by: ACTOR_ID,
      production_note: "Production note stays.",
    })],
    ["TRY-API-READY", gateClearInquiry({
      id: "TRY-API-READY",
      production_stage: "ready",
      production_started_at: "2026-08-08T08:15:00.000Z",
      qc_started_at: "2026-08-08T09:00:00.000Z",
      qc_completed_at: "2026-08-08T09:20:00.000Z",
      qc_completed_by: ACTOR_ID,
    })],
  ]);
  const updates = [];
  const supabase = fakeSupabase(rows, updates);

  const enter = await invokeWorkflowApi(supabase, "TRY-API-QC", { action: "advance_production", productionStage: "qc" });
  assert.equal(enter.status, 200);
  assert.equal(enter.body.inquiry.productionStage, "qc");
  assert.ok(enter.body.inquiry.qcStartedAt, "API returns QC start timestamp");
  assert.equal(enter.body.inquiry.qcStartedBy, ACTOR_ID);

  const note = await invokeWorkflowApi(supabase, "TRY-API-NOTE", { action: "save_qc_note", qcNote: "Checked quantity." });
  assert.equal(note.status, 200);
  assert.equal(note.body.inquiry.qcNote, "Checked quantity.");
  assert.equal(rows.get("TRY-API-NOTE").production_note, "Production note stays.");

  const complete = await invokeWorkflowApi(supabase, "TRY-API-NOTE", { action: "advance_production", productionStage: "ready" });
  assert.equal(complete.status, 200);
  assert.equal(complete.body.inquiry.productionStage, "ready");
  assert.ok(complete.body.inquiry.qcCompletedAt, "API returns QC completion timestamp");
  assert.equal(complete.body.inquiry.qcCompletedBy, ACTOR_ID);

  const retry = await invokeWorkflowApi(supabase, "TRY-API-READY", { action: "advance_production", productionStage: "ready" });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.inquiry.qcCompletedAt, "2026-08-08T09:20:00.000Z");
  assert.equal(updates.filter((entry) => entry.id === "TRY-API-READY").length, 0, "ready retry does not update row");
}

function verifyReadModelContract() {
  const mapped = mapOpsRowToInquiry({
    id: "TRY-READ-QC",
    assigned_staff: "Louvelyngel",
    assigned_user_id: ACTOR_ID,
    production_stage: "qc",
    production_note: "Production note.",
    production_updated_at: "2026-08-08T09:10:00Z",
    production_started_at: "2026-08-08T08:15:00Z",
    production_started_by: ACTOR_ID,
    qc_started_at: "2026-08-08T09:00:00Z",
    qc_started_by: ACTOR_ID,
    qc_note: "QC note.",
    qc_completed_at: "2026-08-08T09:20:00Z",
    qc_completed_by: OTHER_ACTOR_ID,
  });
  assert.equal(mapped.qcStartedAt, "2026-08-08T09:00:00Z");
  assert.equal(mapped.qcStartedBy, ACTOR_ID);
  assert.equal(mapped.qcNote, "QC note.");
  assert.equal(mapped.qcCompletedAt, "2026-08-08T09:20:00Z");
  assert.equal(mapped.qcCompletedBy, OTHER_ACTOR_ID);
  assert.equal(mapped.productionFieldsReady, true);
}

async function verifyDisposableDatabaseContract() {
  let started = false;
  try {
    docker(["run", "--rm", "-d", "--name", CONTAINER, "-e", "POSTGRES_PASSWORD=postgres", "-e", `POSTGRES_DB=${DB}`, IMAGE]);
    started = true;
    waitForPostgres();
    await execSql(bootstrapSql());
    await execSql(await readFile("supabase/migrations/202608080002_phase8_production_start_persistence.sql", "utf8"));
    await execSql(await readFile("supabase/migrations/202608080003_phase9_qc_persistence.sql", "utf8"));
    await execSql(`create trigger ops_inquiries_mvp_workflow_guard before update on public.ops_inquiries for each row execute function public.enforce_ops_inquiry_mvp_workflow();`);

    const columns = await queryJson(`
      select column_name, udt_name, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = 'ops_inquiries'
        and column_name in ('qc_started_at', 'qc_started_by', 'qc_note', 'qc_completed_at', 'qc_completed_by')
      order by column_name
    `);
    assert.deepEqual(columns, [
      { column_name: "qc_completed_at", udt_name: "timestamptz", is_nullable: "YES" },
      { column_name: "qc_completed_by", udt_name: "uuid", is_nullable: "YES" },
      { column_name: "qc_note", udt_name: "text", is_nullable: "YES" },
      { column_name: "qc_started_at", udt_name: "timestamptz", is_nullable: "YES" },
      { column_name: "qc_started_by", udt_name: "uuid", is_nullable: "YES" },
    ]);

    const constraints = await queryJson(`
      select conname, pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conrelid = 'public.ops_inquiries'::regclass
        and conname in ('ops_inquiries_qc_started_by_fkey', 'ops_inquiries_qc_completed_by_fkey', 'ops_inquiries_qc_note_length_check', 'ops_inquiries_qc_completion_after_start_check')
      order by conname
    `);
    assert.equal(constraints.length, 4);
    assert.match(JSON.stringify(constraints), /qc_started_by\) REFERENCES admin_users\(user_id\) ON DELETE SET NULL/);
    assert.match(JSON.stringify(constraints), /qc_completed_by\) REFERENCES admin_users\(user_id\) ON DELETE SET NULL/);

    await execSql(seedSql());
    await assertSqlFails(`
      update public.ops_inquiries
      set production_stage = 'qc'
      where id = 'TRY-DB-NOT-STARTED';
    `, /Production must be started before Quality Check/i);

    await assertSqlFails(`
      update public.ops_inquiries
      set production_stage = 'qc'
      where id = 'TRY-DB-QC';
    `, /Quality Check entry metadata is required/i);

    await execSql(`
      update public.ops_inquiries
      set production_stage = 'qc',
          qc_started_at = '2026-08-08T09:00:00Z',
          qc_started_by = '${ACTOR_ID}'
      where id = 'TRY-DB-QC';
    `);
    let row = await single(`select production_stage, qc_started_at::text, qc_started_by::text from public.ops_inquiries where id = 'TRY-DB-QC'`);
    assert.equal(row.production_stage, "qc");
    assert.match(row.qc_started_at, /^2026-08-08 09:00:00/);
    assert.equal(row.qc_started_by, ACTOR_ID);

    await assertSqlFails(`
      update public.ops_inquiries
      set qc_started_at = '2026-08-08T09:05:00Z', qc_started_by = '${OTHER_ACTOR_ID}'
      where id = 'TRY-DB-QC';
    `, /Quality Check start is immutable/i);

    await execSql(`
      update public.ops_inquiries
      set qc_note = 'Checked quantity and packaging.'
      where id = 'TRY-DB-QC';
    `);
    row = await single(`select qc_note, production_note from public.ops_inquiries where id = 'TRY-DB-QC'`);
    assert.equal(row.qc_note, "Checked quantity and packaging.");
    assert.equal(row.production_note, "Production note stays.");

    await assertSqlFails(`
      update public.ops_inquiries
      set qc_completed_at = '2026-08-08T08:59:00Z', qc_completed_by = '${ACTOR_ID}', production_stage = 'ready'
      where id = 'TRY-DB-QC';
    `, /Quality Check completion cannot predate start|violates check constraint/i);

    await execSql(`
      update public.ops_inquiries
      set qc_completed_at = '2026-08-08T09:20:00Z',
          qc_completed_by = '${ACTOR_ID}',
          production_stage = 'ready'
      where id = 'TRY-DB-QC';
    `);
    row = await single(`select production_stage, qc_completed_at::text, qc_completed_by::text from public.ops_inquiries where id = 'TRY-DB-QC'`);
    assert.equal(row.production_stage, "ready");
    assert.match(row.qc_completed_at, /^2026-08-08 09:20:00/);
    assert.equal(row.qc_completed_by, ACTOR_ID);

    await assertSqlFails(`
      update public.ops_inquiries
      set qc_completed_at = '2026-08-08T09:30:00Z', qc_completed_by = '${OTHER_ACTOR_ID}'
      where id = 'TRY-DB-QC';
    `, /Quality Check completion is immutable|Ready and completed production details are locked/i);

    await assertSqlFails(`
      update public.ops_inquiries
      set qc_completed_at = '2026-08-08T09:30:00Z', qc_completed_by = '${ACTOR_ID}'
      where id = 'TRY-DB-NON-QC';
    `, /Quality Check can only complete into Ready for Fulfillment/i);

    row = await single(`select id, production_stage, qc_started_at, qc_completed_at from public.ops_inquiries where id = 'TRY-DB-LEGACY-READY'`);
    assert.equal(row.production_stage, "ready");
    assert.equal(row.qc_started_at, null);
    assert.equal(row.qc_completed_at, null);
  } finally {
    if (started) docker(["rm", "-f", CONTAINER], { allowFailure: true });
  }
}

function gateClearInquiry(overrides = {}) {
  return {
    id: "TRY-QC",
    status: "approved",
    nativeOrderAuthority: true,
    nativeOrderId: "96000000-0000-4000-8000-000000000889",
    quote_status: "approved",
    quoted_amount: 850,
    amount_due: 850,
    odoo_so: "SO-QC",
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
    production_note: "Production note stays.",
    production_started_at: null,
    production_started_by: null,
    qc_started_at: null,
    qc_started_by: null,
    qc_note: null,
    qc_completed_at: null,
    qc_completed_by: null,
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

function fakeSupabase(rows, updates) {
  return {
    from(table) {
      let selectedId = "";
      let patch = null;
      const builder = {
        select() { return builder; },
        eq(key, value) { if (key === "id" || key === "source_inquiry_id") selectedId = value; return builder; },
        update(value) { patch = value; return builder; },
        async maybeSingle() {
          if (table === "orders") return { data: rows.has(selectedId) ? { id: `native-${selectedId}`, order_reference: `TRRY-ORD-${selectedId.slice(-8).padStart(8, "0")}`, source_inquiry_id: selectedId } : null, error: null };
          assert.equal(table, "ops_inquiries");
          return { data: rows.get(selectedId) || null, error: null };
        },
        async single() {
          assert.equal(table, "ops_inquiries");
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

    insert into public.ops_inquiries (id, status, quote_status, quoted_amount, amount_due, odoo_so, product, product_desc, quantity, due_date, artwork_status, assigned_staff, payment_status, payment_confirmed_amount, payment_confirmed_at, production_stage, production_note, production_started_at, production_started_by)
    values
      ('TRY-DB-QC', 'won', 'approved', 850, 850, 'SO-QC', 'DTF', 'Premium Tshirt', '12 pcs', '2026-08-20', 'approved', 'Louvelyngel', 'paid', 850, '2026-08-08T08:00:00Z', 'printing', 'Production note stays.', '2026-08-08T08:15:00Z', '${ACTOR_ID}'),
      ('TRY-DB-NOT-STARTED', 'won', 'approved', 850, 850, 'SO-NS', 'DTF', 'Premium Tshirt', '12 pcs', '2026-08-20', 'approved', 'Louvelyngel', 'paid', 850, '2026-08-08T08:00:00Z', 'printing', null, null, null),
      ('TRY-DB-NON-QC', 'won', 'approved', 850, 850, 'SO-NQ', 'DTF', 'Premium Tshirt', '12 pcs', '2026-08-20', 'approved', 'Louvelyngel', 'paid', 850, '2026-08-08T08:00:00Z', 'printing', null, '2026-08-08T08:15:00Z', '${ACTOR_ID}'),
      ('TRY-DB-LEGACY-READY', 'won', 'approved', 850, 850, 'SO-LR', 'DTF', 'Premium Tshirt', '12 pcs', '2026-08-20', 'approved', 'Louvelyngel', 'paid', 850, '2026-08-08T08:00:00Z', 'ready', null, null, null);
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
