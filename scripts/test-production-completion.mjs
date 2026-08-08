import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { buildOpsWorkflowUpdates } from "../api/_lib/opsWorkflow.js";
import { handleWorkflowRequest } from "../api/inquiries/[id]/workflow.js";
import { mapOpsRowToInquiry } from "../src/services/opsBoard.js";

const CONTAINER = `trry-production-completion-db-${process.pid}`;
const IMAGE = process.env.TRY_VERIFY_POSTGRES_IMAGE || "postgres:16-alpine";
const DB = "trry_verify";
const ACTOR_ID = "96000000-0000-4000-8000-000000000888";
const OTHER_ACTOR_ID = "96000000-0000-4000-8000-000000000889";
const READY_AT = "2026-08-08T09:20:00.000Z";
const COMPLETE_AT = "2026-08-08T10:05:00.000Z";

verifyPureWorkflowContract();
await verifyWorkflowApiContract();
verifyReadModelContract();
await verifyDisposableDatabaseContract();

console.log("PASS Production completion metadata, idempotency, guards, read model, and fulfillment immutability");

function verifyPureWorkflowContract() {
  const ready = gateClearInquiry({
    production_stage: "ready",
    qc_started_at: "2026-08-08T09:00:00.000Z",
    qc_started_by: ACTOR_ID,
    qc_completed_at: READY_AT,
    qc_completed_by: ACTOR_ID,
    tracking_substatus: "ready_for_pickup",
    tracking_note: "Bring valid ID.",
  });

  const complete = buildOpsWorkflowUpdates("advance_production", { productionStage: "completed", actorUserId: ACTOR_ID }, ready, COMPLETE_AT);
  assert.equal(complete.ok, true, "ready production can be completed");
  assert.equal(complete.updates.production_stage, "completed");
  assert.equal(complete.updates.production_completed_at, COMPLETE_AT);
  assert.equal(complete.updates.production_completed_by, ACTOR_ID);
  assert.equal(complete.updates.tracking_substatus, undefined, "production completion does not update tracking status");
  assert.equal(complete.updates.tracking_note, undefined, "production completion does not update tracking note");
  assert.equal(complete.updates.fulfillment_method, undefined, "production completion does not update fulfillment method");
  assert.equal(complete.updates.assigned_staff, undefined, "completion does not overwrite assignment");
  assert.equal(complete.updates.production_note, undefined, "completion does not overwrite production note");

  const retry = buildOpsWorkflowUpdates("advance_production", { productionStage: "completed", actorUserId: OTHER_ACTOR_ID }, {
    ...ready,
    production_stage: "completed",
    production_completed_at: COMPLETE_AT,
    production_completed_by: ACTOR_ID,
  }, "2026-08-08T10:30:00.000Z");
  assert.equal(retry.ok, true, "completed retry reconciles safely");
  assert.equal(retry.noop, true);
  assert.deepEqual(retry.updates, {}, "completed retry does not rewrite completion metadata");

  const missingQc = buildOpsWorkflowUpdates("advance_production", { productionStage: "completed", actorUserId: ACTOR_ID }, gateClearInquiry({ production_stage: "ready" }), COMPLETE_AT);
  assert.equal(missingQc.ok, false, "ready rows without QC completion cannot complete production");

  for (const stage of ["queued", "printing", "qc"]) {
    const result = buildOpsWorkflowUpdates("advance_production", { productionStage: "completed", actorUserId: ACTOR_ID }, gateClearInquiry({
      production_stage: stage,
      production_started_at: stage === "queued" ? null : "2026-08-08T08:15:00.000Z",
      qc_started_at: stage === "qc" ? "2026-08-08T09:00:00.000Z" : null,
      qc_completed_at: stage === "qc" ? READY_AT : null,
    }), COMPLETE_AT);
    assert.equal(result.ok, false, `${stage} cannot directly complete production`);
  }

  const blocked = buildOpsWorkflowUpdates("advance_production", { productionStage: "completed", actorUserId: ACTOR_ID }, {
    ...ready,
    blocked_reason: "Missing item",
  }, COMPLETE_AT);
  assert.equal(blocked.ok, false, "blocked ready production cannot complete");
}

async function verifyWorkflowApiContract() {
  const rows = new Map([
    ["TRY-API-READY", gateClearInquiry({
      id: "TRY-API-READY",
      production_stage: "ready",
      qc_started_at: "2026-08-08T09:00:00.000Z",
      qc_started_by: ACTOR_ID,
      qc_completed_at: READY_AT,
      qc_completed_by: ACTOR_ID,
      fulfillment_method: "pickup",
      tracking_substatus: "ready_for_pickup",
      tracking_note: "Bring valid ID.",
      delivery_address: "Front counter",
      delivery_city: "Bacolod",
    })],
    ["TRY-API-COMPLETED", gateClearInquiry({
      id: "TRY-API-COMPLETED",
      production_stage: "completed",
      qc_started_at: "2026-08-08T09:00:00.000Z",
      qc_completed_at: READY_AT,
      production_completed_at: COMPLETE_AT,
      production_completed_by: ACTOR_ID,
    })],
  ]);
  const updates = [];
  const supabase = fakeSupabase(rows, updates);

  const complete = await invokeWorkflowApi(supabase, "TRY-API-READY", { action: "advance_production", productionStage: "completed" });
  assert.equal(complete.status, 200);
  assert.equal(complete.body.inquiry.productionStage, "completed");
  assert.ok(complete.body.inquiry.productionCompletedAt, "API returns production completion timestamp");
  assert.equal(complete.body.inquiry.productionCompletedBy, ACTOR_ID);

  const saved = rows.get("TRY-API-READY");
  assert.equal(saved.fulfillment_method, "pickup");
  assert.equal(saved.tracking_substatus, "ready_for_pickup");
  assert.equal(saved.tracking_note, "Bring valid ID.");
  assert.equal(saved.delivery_address, "Front counter");
  assert.equal(saved.delivery_city, "Bacolod");

  const retry = await invokeWorkflowApi(supabase, "TRY-API-COMPLETED", { action: "advance_production", productionStage: "completed" });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.inquiry.productionCompletedAt, COMPLETE_AT);
  assert.equal(retry.body.inquiry.productionCompletedBy, ACTOR_ID);
  assert.equal(updates.filter((entry) => entry.id === "TRY-API-COMPLETED").length, 0, "completed retry does not update row");
}

function verifyReadModelContract() {
  const mapped = mapOpsRowToInquiry({
    id: "TRY-READ-COMPLETED",
    assigned_staff: "Louvelyngel",
    assigned_user_id: ACTOR_ID,
    production_stage: "completed",
    production_note: "Production note.",
    production_updated_at: COMPLETE_AT,
    production_started_at: "2026-08-08T08:15:00Z",
    production_started_by: ACTOR_ID,
    production_completed_at: COMPLETE_AT,
    production_completed_by: OTHER_ACTOR_ID,
    qc_started_at: "2026-08-08T09:00:00Z",
    qc_started_by: ACTOR_ID,
    qc_note: "QC note.",
    qc_completed_at: READY_AT,
    qc_completed_by: ACTOR_ID,
  });
  assert.equal(mapped.productionCompletedAt, COMPLETE_AT);
  assert.equal(mapped.productionCompletedBy, OTHER_ACTOR_ID);
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
    await execSql(await readFile("supabase/migrations/202608080004_phase10_production_completion.sql", "utf8"));
    await execSql(`create trigger ops_inquiries_mvp_workflow_guard before update on public.ops_inquiries for each row execute function public.enforce_ops_inquiry_mvp_workflow();`);

    const columns = await queryJson(`
      select column_name, udt_name, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = 'ops_inquiries'
        and column_name in ('production_completed_at', 'production_completed_by')
      order by column_name
    `);
    assert.deepEqual(columns, [
      { column_name: "production_completed_at", udt_name: "timestamptz", is_nullable: "YES" },
      { column_name: "production_completed_by", udt_name: "uuid", is_nullable: "YES" },
    ]);

    const constraints = await queryJson(`
      select conname, pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conrelid = 'public.ops_inquiries'::regclass
        and conname in ('ops_inquiries_production_completed_by_fkey', 'ops_inquiries_production_completion_after_qc_check')
      order by conname
    `);
    assert.equal(constraints.length, 2);
    assert.match(JSON.stringify(constraints), /production_completed_by\) REFERENCES admin_users\(user_id\) ON DELETE SET NULL/);

    await execSql(seedSql());

    await assertSqlFails(`
      update public.ops_inquiries
      set production_stage = 'completed',
          production_completed_at = '2026-08-08T10:05:00Z',
          production_completed_by = '${ACTOR_ID}'
      where id = 'TRY-DB-QC';
    `, /Invalid production stage transition/i);

    await assertSqlFails(`
      update public.ops_inquiries
      set production_stage = 'completed',
          production_completed_at = '2026-08-08T10:05:00Z',
          production_completed_by = '${ACTOR_ID}'
      where id = 'TRY-DB-READY-NO-QC';
    `, /Quality Check completion is required before Production completion|violates check constraint/i);

    await assertSqlFails(`
      update public.ops_inquiries
      set production_stage = 'completed',
          production_completed_at = '2026-08-08T10:05:00Z',
          production_completed_by = '${ACTOR_ID}'
      where id = 'TRY-DB-BLOCKED';
    `, /Blocked production cannot be completed/i);

    await execSql(`
      update public.ops_inquiries
      set production_stage = 'completed',
          production_completed_at = '2026-08-08T10:05:00Z',
          production_completed_by = '${ACTOR_ID}'
      where id = 'TRY-DB-READY';
    `);
    let row = await single(`
      select production_stage, production_completed_at::text, production_completed_by::text,
             fulfillment_method, tracking_substatus, tracking_note, delivery_address, delivery_city
      from public.ops_inquiries
      where id = 'TRY-DB-READY'
    `);
    assert.equal(row.production_stage, "completed");
    assert.match(row.production_completed_at, /^2026-08-08 10:05:00/);
    assert.equal(row.production_completed_by, ACTOR_ID);
    assert.equal(row.fulfillment_method, "pickup");
    assert.equal(row.tracking_substatus, "ready_for_pickup");
    assert.equal(row.tracking_note, "Bring valid ID.");
    assert.equal(row.delivery_address, "Front counter");
    assert.equal(row.delivery_city, "Bacolod");

    const reloaded = await single(`select production_completed_at::text, production_completed_by::text from public.ops_inquiries where id = 'TRY-DB-READY'`);
    assert.match(reloaded.production_completed_at, /^2026-08-08 10:05:00/);
    assert.equal(reloaded.production_completed_by, ACTOR_ID);

    await assertSqlFails(`
      update public.ops_inquiries
      set production_completed_at = '2026-08-08T10:30:00Z',
          production_completed_by = '${OTHER_ACTOR_ID}'
      where id = 'TRY-DB-READY';
    `, /Ready and completed production details are locked|Production completion is immutable/i);
    row = await single(`select production_completed_at::text, production_completed_by::text from public.ops_inquiries where id = 'TRY-DB-READY'`);
    assert.match(row.production_completed_at, /^2026-08-08 10:05:00/);
    assert.equal(row.production_completed_by, ACTOR_ID);

    row = await single(`select id, production_stage, production_completed_at, production_completed_by from public.ops_inquiries where id = 'TRY-DB-LEGACY-COMPLETED'`);
    assert.equal(row.production_stage, "completed");
    assert.equal(row.production_completed_at, null);
    assert.equal(row.production_completed_by, null);
  } finally {
    if (started) docker(["rm", "-f", CONTAINER], { allowFailure: true });
  }
}

function gateClearInquiry(overrides = {}) {
  return {
    id: "TRY-COMPLETE",
    status: "won",
    quote_status: "approved",
    quoted_amount: 850,
    amount_due: 850,
    odoo_so: "SO-COMPLETE",
    product: "DTF",
    product_desc: "Premium Tshirt",
    quantity: "12 pcs",
    due_date: "2026-08-20",
    artwork_status: "approved",
    assigned_staff: "Louvelyngel",
    assigned_user_id: ACTOR_ID,
    payment_status: "paid",
    payment_verified_amount: 850,
    payment_confirmed_amount: 850,
    production_stage: "queued",
    production_note: "Production note stays.",
    production_updated_at: null,
    production_started_at: "2026-08-08T08:15:00.000Z",
    production_started_by: ACTOR_ID,
    production_completed_at: null,
    production_completed_by: null,
    qc_started_at: null,
    qc_started_by: null,
    qc_note: null,
    qc_completed_at: null,
    qc_completed_by: null,
    blocked_reason: null,
    fulfillment_method: "pickup",
    tracking_substatus: null,
    tracking_note: null,
    delivery_address: null,
    delivery_city: null,
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
      assigned_user_id uuid,
      production_stage text,
      production_note text,
      production_updated_at timestamptz,
      blocked_reason text,
      payment_status text,
      payment_proof_path text,
      payment_confirmed_amount numeric,
      payment_confirmed_at timestamptz,
      fulfillment_method text,
      tracking_substatus text,
      tracking_note text,
      tracking_updated_at timestamptz,
      delivery_address text,
      delivery_city text,
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

    insert into public.ops_inquiries (
      id, status, quote_status, quoted_amount, amount_due, odoo_so, product, product_desc, quantity,
      due_date, artwork_status, assigned_staff, assigned_user_id, payment_status, payment_confirmed_amount,
      payment_confirmed_at, production_stage, production_note, production_started_at, production_started_by,
      qc_started_at, qc_started_by, qc_completed_at, qc_completed_by, blocked_reason,
      fulfillment_method, tracking_substatus, tracking_note, delivery_address, delivery_city
    )
    values
      ('TRY-DB-READY', 'won', 'approved', 850, 850, 'SO-RDY', 'DTF', 'Premium Tshirt', '12 pcs',
       '2026-08-20', 'approved', 'Louvelyngel', '${ACTOR_ID}', 'paid', 850, '2026-08-08T08:00:00Z',
       'ready', 'Production note stays.', '2026-08-08T08:15:00Z', '${ACTOR_ID}',
       '2026-08-08T09:00:00Z', '${ACTOR_ID}', '2026-08-08T09:20:00Z', '${ACTOR_ID}', null,
       'pickup', 'ready_for_pickup', 'Bring valid ID.', 'Front counter', 'Bacolod'),
      ('TRY-DB-QC', 'won', 'approved', 850, 850, 'SO-QC', 'DTF', 'Premium Tshirt', '12 pcs',
       '2026-08-20', 'approved', 'Louvelyngel', '${ACTOR_ID}', 'paid', 850, '2026-08-08T08:00:00Z',
       'qc', 'Production note stays.', '2026-08-08T08:15:00Z', '${ACTOR_ID}',
       '2026-08-08T09:00:00Z', '${ACTOR_ID}', '2026-08-08T09:20:00Z', '${ACTOR_ID}', null,
       'pickup', 'ready_for_pickup', 'Bring valid ID.', 'Front counter', 'Bacolod'),
      ('TRY-DB-READY-NO-QC', 'won', 'approved', 850, 850, 'SO-NQ', 'DTF', 'Premium Tshirt', '12 pcs',
       '2026-08-20', 'approved', 'Louvelyngel', '${ACTOR_ID}', 'paid', 850, '2026-08-08T08:00:00Z',
       'ready', null, '2026-08-08T08:15:00Z', '${ACTOR_ID}',
       null, null, null, null, null,
       'pickup', 'ready_for_pickup', 'Bring valid ID.', 'Front counter', 'Bacolod'),
      ('TRY-DB-BLOCKED', 'won', 'approved', 850, 850, 'SO-BLK', 'DTF', 'Premium Tshirt', '12 pcs',
       '2026-08-20', 'approved', 'Louvelyngel', '${ACTOR_ID}', 'paid', 850, '2026-08-08T08:00:00Z',
       'ready', null, '2026-08-08T08:15:00Z', '${ACTOR_ID}',
       '2026-08-08T09:00:00Z', '${ACTOR_ID}', '2026-08-08T09:20:00Z', '${ACTOR_ID}', 'Missing item',
       'pickup', 'ready_for_pickup', 'Bring valid ID.', 'Front counter', 'Bacolod'),
      ('TRY-DB-LEGACY-COMPLETED', 'won', 'approved', 850, 850, 'SO-LEG', 'DTF', 'Premium Tshirt', '12 pcs',
       '2026-08-20', 'approved', 'Louvelyngel', '${ACTOR_ID}', 'paid', 850, '2026-08-08T08:00:00Z',
       'completed', null, null, null,
       null, null, null, null, null,
       'pickup', 'completed', 'Historical complete.', 'Front counter', 'Bacolod');
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
