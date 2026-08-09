import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { buildOpsWorkflowUpdates } from "../api/_lib/opsWorkflow.js";
import {
  reconcileNativeOrderStatusForInquiry,
  transitionNativeOrderStatus,
} from "../api/_lib/nativeOrderStatus.js";
import {
  deriveNativeOrderStatusFromFacts,
  NATIVE_ORDER_STATUS,
} from "../src/shared/nativeOrderStatus.js";

const CONTAINER = `trry-native-order-status-${process.pid}`;
const IMAGE = process.env.TRRY_VERIFY_POSTGRES_IMAGE || "postgres:16-alpine";
const DB = "trry_verify";
const ACTOR_ID = "96000000-0000-4000-8000-000000000777";

await verifyStatusDerivation();
await verifyStatusTransitions();
await verifyBackfillMigration();

console.log("PASS Native Order status authority transitions and backfill verified");

async function verifyStatusDerivation() {
  assert.equal(deriveNativeOrderStatusFromFacts(baseInquiry({ payment_status: "partially_paid", payment_confirmed_amount: 300, payment_verified_amount: 300, amount_due: 300 })), NATIVE_ORDER_STATUS.AWAITING_PAYMENT);
  assert.equal(deriveNativeOrderStatusFromFacts(baseInquiry({ assigned_staff: "" })), NATIVE_ORDER_STATUS.PAID);
  assert.equal(deriveNativeOrderStatusFromFacts(baseInquiry()), NATIVE_ORDER_STATUS.READY_TO_RELEASE);
  assert.equal(deriveNativeOrderStatusFromFacts(baseInquiry({ production_stage: "printing" })), NATIVE_ORDER_STATUS.RELEASED);
  assert.equal(deriveNativeOrderStatusFromFacts(baseInquiry({ production_stage: "qc", qc_started_at: "2026-08-09T01:00:00Z" })), NATIVE_ORDER_STATUS.RELEASED);
  assert.equal(deriveNativeOrderStatusFromFacts(baseInquiry({ production_stage: "completed", production_completed_at: "2026-08-09T02:00:00Z" })), NATIVE_ORDER_STATUS.RELEASED);
  assert.equal(deriveNativeOrderStatusFromFacts(baseInquiry({ production_stage: "completed", tracking_substatus: "completed" })), NATIVE_ORDER_STATUS.COMPLETED);

  const release = buildOpsWorkflowUpdates("advance_production", { productionStage: "printing", assignedStaff: "QA Staff" }, baseInquiry({ production_stage: "queued", nativeOrderAuthority: true }), "2026-08-09T01:00:00Z");
  assert.equal(release.ok, true);
  assert.equal(deriveNativeOrderStatusFromFacts({ ...baseInquiry(), ...release.updates }), NATIVE_ORDER_STATUS.RELEASED);

  const start = buildOpsWorkflowUpdates("start_production", { actorUserId: ACTOR_ID }, baseInquiry({ production_stage: "printing", production_started_at: null, nativeOrderAuthority: true }), "2026-08-09T01:10:00Z");
  assert.equal(start.ok, true);
  assert.equal(deriveNativeOrderStatusFromFacts({ ...baseInquiry({ production_stage: "printing" }), ...start.updates }), NATIVE_ORDER_STATUS.RELEASED);

  const qc = buildOpsWorkflowUpdates("advance_production", { productionStage: "qc", actorUserId: ACTOR_ID }, baseInquiry({ production_stage: "printing", production_started_at: "2026-08-09T01:10:00Z", nativeOrderAuthority: true }), "2026-08-09T01:20:00Z");
  assert.equal(qc.ok, true);
  assert.equal(deriveNativeOrderStatusFromFacts({ ...baseInquiry({ production_stage: "printing" }), ...qc.updates }), NATIVE_ORDER_STATUS.RELEASED);

  const completeProduction = buildOpsWorkflowUpdates("advance_production", { productionStage: "completed", actorUserId: ACTOR_ID }, baseInquiry({ production_stage: "ready", qc_started_at: "2026-08-09T01:20:00Z", qc_completed_at: "2026-08-09T01:30:00Z", nativeOrderAuthority: true }), "2026-08-09T02:00:00Z");
  assert.equal(completeProduction.ok, true);
  assert.equal(deriveNativeOrderStatusFromFacts({ ...baseInquiry({ production_stage: "ready" }), ...completeProduction.updates }), NATIVE_ORDER_STATUS.RELEASED);
}

async function verifyStatusTransitions() {
  const supabase = fakeSupabase();
  supabase.seedOrder({ source_inquiry_id: "TRY-STATUS", status: "awaiting_payment" });

  assert.equal((await reconcileNativeOrderStatusForInquiry(supabase, "TRY-STATUS", baseInquiry({ payment_status: "partially_paid", payment_confirmed_amount: 300, payment_verified_amount: 300, amount_due: 300 }))).status, "awaiting_payment");
  assert.equal((await reconcileNativeOrderStatusForInquiry(supabase, "TRY-STATUS", baseInquiry({ assigned_staff: "" }))).status, "paid");
  assert.equal((await reconcileNativeOrderStatusForInquiry(supabase, "TRY-STATUS", baseInquiry())).status, "ready_to_release");
  assert.equal((await reconcileNativeOrderStatusForInquiry(supabase, "TRY-STATUS", baseInquiry({ production_stage: "printing" }))).status, "released");
  assert.equal((await reconcileNativeOrderStatusForInquiry(supabase, "TRY-STATUS", baseInquiry({ production_stage: "completed" }))).status, "released");
  assert.equal((await reconcileNativeOrderStatusForInquiry(supabase, "TRY-STATUS", baseInquiry({ production_stage: "completed", tracking_substatus: "completed" }))).status, "completed");
  assert.equal((await reconcileNativeOrderStatusForInquiry(supabase, "TRY-STATUS", baseInquiry({ assigned_staff: "" }))).status, "completed", "completed cannot regress");

  const updateCount = supabase.updateCount;
  assert.equal((await transitionNativeOrderStatus(supabase, "TRY-STATUS", "completed")).status, "completed");
  assert.equal(supabase.updateCount, updateCount, "same-state replay is idempotent");

  supabase.seedOrder({ source_inquiry_id: "TRY-FAILED-RELEASE", status: "paid" });
  const failedRelease = buildOpsWorkflowUpdates("advance_production", { productionStage: "printing", assignedStaff: "QA Staff" }, baseInquiry({
    nativeOrderAuthority: true,
    production_stage: "queued",
    payment_status: "partially_paid",
    payment_confirmed_amount: 300,
    payment_verified_amount: 300,
    amount_due: 300,
  }), "2026-08-09T03:00:00Z");
  assert.equal(failedRelease.ok, false);
  assert.equal(supabase.order("TRY-FAILED-RELEASE").status, "paid", "failed release does not advance status");
}

async function verifyBackfillMigration() {
  let started = false;
  try {
    docker(["run", "--rm", "-d", "--name", CONTAINER, "-e", "POSTGRES_PASSWORD=postgres", "-e", `POSTGRES_DB=${DB}`, IMAGE]);
    started = true;
    waitForPostgres();
    await execSql(backfillHarnessSql());
    await execSql(await readFile("supabase/migrations/202608080008_native_order_status_authority.sql", "utf8"));

    const constraints = await queryJson(`
      select conname, pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conrelid = 'public.orders'::regclass and conname = 'orders_status_check'
    `);
    assert.match(constraints[0].definition, /awaiting_payment/);
    assert.match(constraints[0].definition, /ready_to_release/);
    assert.match(constraints[0].definition, /completed/);
    await assertSqlFails("update public.orders set status = 'printing' where source_inquiry_id = 'TRY-BACKFILL-PAID';", /orders_status_check/i);

    const rows = await queryJson("select source_inquiry_id, status from public.orders order by source_inquiry_id");
    assert.deepEqual(Object.fromEntries(rows.map((row) => [row.source_inquiry_id, row.status])), {
      "TRY-BACKFILL-COMPLETE": "completed",
      "TRY-BACKFILL-PAID": "paid",
      "TRY-BACKFILL-PRODUCTION-COMPLETE": "released",
      "TRY-BACKFILL-READY": "ready_to_release",
      "TRY-BACKFILL-RELEASED": "released",
      "TRY-FULL-SMOKE-20260809004105": "completed",
    });
  } finally {
    if (started) docker(["rm", "-f", CONTAINER], { allowFailure: true });
  }
}

function baseInquiry(overrides = {}) {
  return {
    id: "TRY-STATUS",
    status: "approved",
    quote_status: "approved",
    quoted_amount: 600,
    amount_due: 0,
    product: "Synthetic Shirt",
    product_desc: "Synthetic Shirt",
    quantity: "12",
    due_date: "2026-08-30",
    artwork_status: "approved",
    assigned_staff: "QA Staff",
    payment_status: "paid",
    payment_confirmed_amount: 600,
    payment_verified_amount: 600,
    production_stage: "queued",
    blocked_reason: null,
    nativeOrderAuthority: true,
    ...overrides,
  };
}

function fakeSupabase() {
  const orders = new Map();
  const api = {
    updateCount: 0,
    seedOrder(row) {
      orders.set(row.source_inquiry_id, {
        id: `order-${row.source_inquiry_id}`,
        order_reference: `TRRY-ORD-${row.source_inquiry_id.slice(-8).padStart(8, "0")}`.replace(/[^A-Z0-9-]/g, "0").slice(0, 17),
        quoted_amount: 600,
        amount_due: 600,
        created_at: "2026-08-09T00:00:00.000Z",
        updated_at: "2026-08-09T00:00:00.000Z",
        ...row,
      });
    },
    order(sourceInquiryId) {
      return orders.get(sourceInquiryId);
    },
    from(table) {
      assert.equal(table, "orders");
      return {
        select() {
          return {
            eq(column, value) {
              assert.equal(column, "source_inquiry_id");
              return {
                async maybeSingle() {
                  return { data: orders.get(value) || null, error: null };
                },
              };
            },
          };
        },
        update(patch) {
          return {
            eq(column, value) {
              assert.equal(column, "source_inquiry_id");
              return {
                select() {
                  return {
                    async single() {
                      const current = orders.get(value);
                      const updated = { ...current, ...patch };
                      orders.set(value, updated);
                      api.updateCount += 1;
                      return { data: updated, error: null };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  return api;
}

function backfillHarnessSql() {
  return `
    create schema if not exists public;
    create table public.ops_inquiries (
      id text primary key,
      product text,
      product_desc text,
      quantity text,
      due_date date,
      artwork_status text,
      assigned_staff text,
      blocked_reason text,
      quoted_amount numeric,
      amount_due numeric,
      payment_status text,
      payment_confirmed_amount numeric,
      payment_verified_amount numeric,
      production_stage text,
      tracking_substatus text
    );
    create table public.orders (
      id uuid primary key default gen_random_uuid(),
      order_reference text not null unique,
      source_inquiry_id text not null unique references public.ops_inquiries(id),
      status text not null default 'awaiting_payment',
      updated_at timestamptz not null default now(),
      constraint orders_status_check check (status = 'awaiting_payment')
    );
    insert into public.ops_inquiries (id, product_desc, quantity, due_date, artwork_status, assigned_staff, blocked_reason, quoted_amount, amount_due, payment_status, payment_confirmed_amount, payment_verified_amount, production_stage, tracking_substatus)
    values
      ('TRY-BACKFILL-PAID', 'Shirt', '12', '2026-08-30', 'approved', null, null, 600, 0, 'paid', 600, 600, 'queued', null),
      ('TRY-BACKFILL-READY', 'Shirt', '12', '2026-08-30', 'approved', 'QA Staff', null, 600, 0, 'paid', 600, 600, 'queued', null),
      ('TRY-BACKFILL-RELEASED', 'Shirt', '12', '2026-08-30', 'approved', 'QA Staff', null, 600, 0, 'paid', 600, 600, 'printing', null),
      ('TRY-BACKFILL-PRODUCTION-COMPLETE', 'Shirt', '12', '2026-08-30', 'approved', 'QA Staff', null, 600, 0, 'paid', 600, 600, 'completed', 'ready_for_pickup'),
      ('TRY-BACKFILL-COMPLETE', 'Shirt', '12', '2026-08-30', 'approved', 'QA Staff', null, 600, 0, 'paid', 600, 600, 'completed', 'completed'),
      ('TRY-FULL-SMOKE-20260809004105', 'Synthetic Shirt', '12', '2026-08-30', 'approved', 'QA Staff - Staging', null, 600, 0, 'paid', 600, 600, 'completed', 'completed');
    insert into public.orders (order_reference, source_inquiry_id)
    values
      ('TRRY-ORD-BACKPAID', 'TRY-BACKFILL-PAID'),
      ('TRRY-ORD-BACKRDY1', 'TRY-BACKFILL-READY'),
      ('TRRY-ORD-BACKREL1', 'TRY-BACKFILL-RELEASED'),
      ('TRRY-ORD-BACKPRDC', 'TRY-BACKFILL-PRODUCTION-COMPLETE'),
      ('TRRY-ORD-BACKDONE', 'TRY-BACKFILL-COMPLETE'),
      ('TRRY-ORD-PQGFW0AV', 'TRY-FULL-SMOKE-20260809004105');
  `;
}

async function queryJson(sql) {
  const result = docker(["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DB, "-X", "-q", "-t", "-A", "-c", `select coalesce(json_agg(row_to_json(q)), '[]'::json) from (${sql}) q;`]);
  return JSON.parse(result.stdout.trim() || "[]");
}

async function execSql(sql) {
  let last = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = docker(["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DB, "-X", "-v", "ON_ERROR_STOP=1"], { input: sql, allowFailure: true });
    if (result.status === 0) return;
    last = result;
    if (!/starting up|shutting down|could not connect|connection/i.test(`${result.stderr}\n${result.stdout}`)) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error(`${last?.stderr || last?.stdout}`.trim());
}

async function assertSqlFails(sql, pattern) {
  const result = docker(["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DB, "-X", "-v", "ON_ERROR_STOP=1"], { input: sql, allowFailure: true });
  assert.notEqual(result.status, 0, "SQL should fail");
  assert.match(`${result.stderr}\n${result.stdout}`, pattern);
}

function waitForPostgres() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = docker(["exec", CONTAINER, "pg_isready", "-U", "postgres", "-d", DB], { allowFailure: true });
    if (result.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error("Postgres container did not become ready");
}

function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    input: options.input,
  });
  if (result.status !== 0 && !options.allowFailure) throw new Error(`${result.stderr || result.stdout}`.trim());
  return result;
}
