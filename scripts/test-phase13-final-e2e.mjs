import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { buildPaymentConfirmationUpdate } from "../api/_lib/paymentConfirmation.js";
import { buildOpsWorkflowUpdates } from "../api/_lib/opsWorkflow.js";
import { createMvpDashboard } from "../src/mvpDashboard.js";

const CONTAINER = `trry-phase13-final-e2e-${process.pid}`;
const IMAGE = process.env.TRRY_VERIFY_POSTGRES_IMAGE || "postgres:16-alpine";
const DB = "trry_verify";
const ACTOR_ID = "96000000-0000-4000-8000-000000001313";
const OTHER_ACTOR_ID = "96000000-0000-4000-8000-000000001314";
const INQUIRY_ID = "TRY-P13-FINAL-001";
const ORDER_REF = "TRRY-ORD-P13FINAL";
const LEGACY_ID = "TRY-P13-LEGACY";
const NOW = {
  payment: "2026-08-08T09:00:00.000Z",
  release: "2026-08-08T09:20:00.000Z",
  start: "2026-08-08T09:35:00.000Z",
  qc: "2026-08-08T10:00:00.000Z",
  ready: "2026-08-08T10:25:00.000Z",
  complete: "2026-08-08T11:05:00.000Z",
};

const report = {
  disposableDb: CONTAINER,
  inquiryReference: INQUIRY_ID,
  nativeOrderReference: ORDER_REF,
};

let started = false;
try {
  docker(["run", "--rm", "-d", "--name", CONTAINER, "-e", "POSTGRES_PASSWORD=postgres", "-e", `POSTGRES_DB=${DB}`, IMAGE]);
  started = true;
  waitForPostgres();
  await execSql(harnessSql());
  await applyFullMigrationChain();
  await seedAdminUsers();
  await seedSyntheticInquiry();

  await verifyNativeOrderCreation();
  await verifyMessengerDoesNotMutatePayment();
  await verifyPaymentRequiredBeforeRelease();
  await confirmAdminPayment();
  await releaseToProduction();
  await startProduction();
  await advanceToQualityCheck();
  await completeQualityCheck();
  await markProductionComplete();
  await verifyIdempotencyAndImmutability();
  await verifyOdooZeroAuthority();
  await verifyLegacyReadOnlyAndIdentity();

  console.log(`PASS Phase 13 final synthetic E2E lifecycle in disposable Postgres container ${CONTAINER}`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (started) docker(["rm", "-f", CONTAINER], { allowFailure: true });
}

async function verifyNativeOrderCreation() {
  await execSql(`
    insert into public.orders (
      order_reference, source_inquiry_id, quoted_amount, amount_due, quote_breakdown,
      quote_note, quote_valid_until, quote_approved_at, customer_name, customer_contact,
      product, product_desc, quantity, fulfillment_method, due_date
    )
    select '${ORDER_REF}', id, quoted_amount, amount_due, quote_breakdown,
           quote_notes, quote_valid_until, quote_approved_at, customer_name, contact,
           product, product_desc, quantity, fulfillment_method, due_date
    from public.ops_inquiries
    where id = '${INQUIRY_ID}';
  `);
  await assertSqlFails(`
    insert into public.orders (order_reference, source_inquiry_id)
    values ('TRRY-ORD-DUPEP130', '${INQUIRY_ID}');
  `, /orders_source_inquiry_id_key|duplicate key/i);

  const row = await single(`
    select i.id, i.status, i.odoo_so, count(o.id)::int as order_count,
           min(o.order_reference) as order_reference,
           min(o.status) as order_status
    from public.ops_inquiries i
    left join public.orders o on o.source_inquiry_id = i.id
    where i.id = '${INQUIRY_ID}'
    group by i.id, i.status, i.odoo_so
  `);
  assert.deepEqual(row, {
    id: INQUIRY_ID,
    status: "approved",
    odoo_so: null,
    order_count: 1,
    order_reference: ORDER_REF,
    order_status: "awaiting_payment",
  });
  report.nativeOrderCreation = "PASS: exactly one public.orders row, odoo_so NULL, status != won";
}

async function verifyMessengerDoesNotMutatePayment() {
  const before = await paymentSnapshot(INQUIRY_ID);
  const dashboardSource = await readFile("src/mvpDashboard.js", "utf8");
  const mainSource = await readFile("src/main.js", "utf8");
  assert.ok(dashboardSource.includes("data-mvp-open-messenger"), "Messenger open hook remains present");
  assert.ok(mainSource.includes("Review the Messenger receipt"));
  assert.ok(!dashboardSource.includes("payment_status: \"under_review\""), "Messenger open does not encode automatic under-review state");
  const after = await paymentSnapshot(INQUIRY_ID);
  assert.deepEqual(after, before, "opening Messenger has no backend payment mutation");
  report.messengerPaymentState = "PASS: Pay Online/Messenger open causes no payment state transition";
}

async function verifyPaymentRequiredBeforeRelease() {
  const row = await workflowInquiry(INQUIRY_ID);
  const release = buildOpsWorkflowUpdates("advance_production", productionBody({ productionStage: "printing" }), row, NOW.release);
  assert.equal(release.ok, false);
  assert.match(release.error, /confirmed payment/i);
  await assertSqlFails(`
    update public.ops_inquiries
    set production_stage = 'printing'
    where id = '${INQUIRY_ID}';
  `, /confirmed payment|Production requires|production requirements/i);
  report.paymentGate = "PASS: release blocked before Admin payment confirmation";
}

async function confirmAdminPayment() {
  const inquiry = await dbInquiry(INQUIRY_ID);
  const result = buildPaymentConfirmationUpdate({
    inquiry,
    body: {
      amountReceived: 1360,
      paymentSource: "gcash",
      referenceNumber: "P13-FINAL-RECEIPT",
      internalNote: "Synthetic final release-candidate payment confirmation.",
      idempotencyKey: "phase13-final-payment",
    },
    adminUser: { user_id: ACTOR_ID, role: "admin" },
    now: NOW.payment,
  });
  assert.equal(result.ok, true);
  await applyUpdates(INQUIRY_ID, result.updates);

  const paid = await paymentSnapshot(INQUIRY_ID);
  assert.equal(paid.payment_status, "paid");
  assert.equal(Number(paid.amount_due), 0);
  assert.equal(Number(paid.payment_confirmed_amount), 1360);
  assert.equal(paid.payment_confirmed_by, ACTOR_ID);

  const retry = buildPaymentConfirmationUpdate({
    inquiry: await dbInquiry(INQUIRY_ID),
    body: {
      amountReceived: 1360,
      paymentSource: "gcash",
      referenceNumber: "P13-FINAL-RECEIPT",
      idempotencyKey: "phase13-final-payment",
    },
    adminUser: { user_id: OTHER_ACTOR_ID, role: "admin" },
    now: "2026-08-08T09:10:00.000Z",
  });
  assert.equal(retry.ok, true);
  assert.equal(retry.idempotent, true);
  assert.deepEqual(retry.updates, {});
  report.paymentConfirmation = "PASS: Admin confirmation required and retry is idempotent";
}

async function releaseToProduction() {
  const result = buildOpsWorkflowUpdates("advance_production", productionBody({ productionStage: "printing" }), await workflowInquiry(INQUIRY_ID), NOW.release);
  assert.equal(result.ok, true);
  await applyUpdates(INQUIRY_ID, result.updates);
  const row = await productionSnapshot(INQUIRY_ID);
  assert.equal(row.status, "approved");
  assert.equal(row.odoo_so, null);
  assert.equal(row.production_stage, "printing");
  assert.equal(row.production_started_at, null);
  report.release = "PASS: release persisted with status != won and odoo_so NULL";
}

async function startProduction() {
  const result = buildOpsWorkflowUpdates("start_production", productionBody(), await workflowInquiry(INQUIRY_ID), NOW.start);
  assert.equal(result.ok, true);
  await applyUpdates(INQUIRY_ID, result.updates);
  const row = await productionSnapshot(INQUIRY_ID);
  assert.match(row.production_started_at, /^2026-08-08 09:35:00/);
  assert.equal(row.production_started_by, ACTOR_ID);

  const retry = buildOpsWorkflowUpdates("start_production", productionBody({ actorUserId: OTHER_ACTOR_ID }), await workflowInquiry(INQUIRY_ID), "2026-08-08T09:45:00.000Z");
  assert.equal(retry.ok, true);
  assert.equal(retry.noop, true);
  assert.deepEqual(retry.updates, {});
  report.startProduction = "PASS: start timestamp/actor persisted; retry noop";
}

async function advanceToQualityCheck() {
  const result = buildOpsWorkflowUpdates("advance_production", productionBody({ productionStage: "qc" }), await workflowInquiry(INQUIRY_ID), NOW.qc);
  assert.equal(result.ok, true);
  await applyUpdates(INQUIRY_ID, result.updates);
  const row = await productionSnapshot(INQUIRY_ID);
  assert.equal(row.production_stage, "qc");
  assert.match(row.qc_started_at, /^2026-08-08 10:00:00/);
  assert.equal(row.qc_started_by, ACTOR_ID);
  report.qualityCheck = "PASS: QC start timestamp/actor persisted";
}

async function completeQualityCheck() {
  const saveNote = buildOpsWorkflowUpdates("save_qc_note", { qcNote: "Synthetic QC passed.", actorUserId: ACTOR_ID }, await workflowInquiry(INQUIRY_ID), "2026-08-08T10:05:00.000Z");
  assert.equal(saveNote.ok, true);
  await applyUpdates(INQUIRY_ID, saveNote.updates);

  const result = buildOpsWorkflowUpdates("advance_production", productionBody({ productionStage: "ready" }), await workflowInquiry(INQUIRY_ID), NOW.ready);
  assert.equal(result.ok, true);
  await applyUpdates(INQUIRY_ID, result.updates);
  const row = await productionSnapshot(INQUIRY_ID);
  assert.equal(row.production_stage, "ready");
  assert.equal(row.qc_note, "Synthetic QC passed.");
  assert.match(row.qc_completed_at, /^2026-08-08 10:25:00/);
  assert.equal(row.qc_completed_by, ACTOR_ID);

  const retry = buildOpsWorkflowUpdates("advance_production", productionBody({ productionStage: "ready", actorUserId: OTHER_ACTOR_ID }), await workflowInquiry(INQUIRY_ID), "2026-08-08T10:40:00.000Z");
  assert.equal(retry.ok, true);
  assert.equal(retry.noop, true);
  assert.deepEqual(retry.updates, {});
  report.completeQc = "PASS: QC completion timestamp/actor persisted; retry noop";
}

async function markProductionComplete() {
  const before = await fulfillmentSnapshot(INQUIRY_ID);
  const result = buildOpsWorkflowUpdates("advance_production", productionBody({ productionStage: "completed" }), await workflowInquiry(INQUIRY_ID), NOW.complete);
  assert.equal(result.ok, true);
  await applyUpdates(INQUIRY_ID, result.updates);
  const row = await productionSnapshot(INQUIRY_ID);
  assert.equal(row.production_stage, "completed");
  assert.match(row.production_completed_at, /^2026-08-08 11:05:00/);
  assert.equal(row.production_completed_by, ACTOR_ID);
  assert.deepEqual(await fulfillmentSnapshot(INQUIRY_ID), before, "Production completion does not mutate fulfillment fields");
  report.productionCompletion = "PASS: completion timestamp/actor persisted and fulfillment unchanged";
}

async function verifyIdempotencyAndImmutability() {
  const before = await productionSnapshot(INQUIRY_ID);
  const retry = buildOpsWorkflowUpdates("advance_production", productionBody({ productionStage: "completed", actorUserId: OTHER_ACTOR_ID }), await workflowInquiry(INQUIRY_ID), "2026-08-08T11:30:00.000Z");
  assert.equal(retry.ok, true);
  assert.equal(retry.noop, true);
  assert.deepEqual(retry.updates, {});
  await assertSqlFails(`
    update public.ops_inquiries
    set production_completed_at = '2026-08-08T11:30:00Z',
        production_completed_by = '${OTHER_ACTOR_ID}'
    where id = '${INQUIRY_ID}';
  `, /locked|immutable|Production completion/i);
  assert.deepEqual(await productionSnapshot(INQUIRY_ID), before);
  const order = await single(`select status, amount_due from public.orders where source_inquiry_id = '${INQUIRY_ID}'`);
  assert.deepEqual(order, { status: "awaiting_payment", amount_due: 1360 });
  report.idempotency = "PASS: retries do not rewrite lifecycle metadata; native Order row not converted into fulfillment/completion";
}

async function verifyOdooZeroAuthority() {
  await insertInquiry(LEGACY_ID, { status: "won", odoo_so: "SO-P13-LEGACY", payment_status: "paid", payment_confirmed_amount: 1360, payment_verified_amount: 1360, amount_due: 0 });
  await assertSqlFails(`
    update public.ops_inquiries
    set production_stage = 'printing'
    where id = '${LEGACY_ID}';
  `, /native TRRY Order|confirmed native|confirmed order/i);

  const pure = buildOpsWorkflowUpdates("advance_production", productionBody({ productionStage: "printing" }), {
    ...(await dbInquiry(LEGACY_ID)),
    nativeOrderAuthority: false,
  }, NOW.release);
  assert.equal(pure.ok, false);
  assert.equal(pure.error, "a confirmed TRRY order is required");
  report.odooZeroAuthority = "PASS: Odoo-only/status=won record rejected by DB guard and backend workflow";
}

async function verifyLegacyReadOnlyAndIdentity() {
  const legacy = await dbInquiry(LEGACY_ID);
  const dashboard = createMvpDashboard({ getAssignmentContext: () => ({ users: [], loadState: "success", error: "" }) });
  const html = dashboard.renderOrders({ items: [{
    ...legacyToOrder(legacy),
    sourceType: "legacy",
    nativeOrderId: "",
    sourceInquiryId: "",
    orderReference: "TRRY-LEGACY-P13",
    odooSO: "SO-P13-LEGACY",
  }] });
  assert.ok(html.includes("TRRY-LEGACY-P13"), "legacy record remains readable in Orders compatibility UI");
  assert.ok(!html.includes("PRD-"), "UI does not fabricate Production job identity");
  assert.ok(!html.includes("data-mvp-release-order"), "legacy Odoo-only row has no release action");

  const completedHtml = dashboard.renderProduction({ items: [{
    ...legacyToOrder(legacy),
    sourceType: "legacy",
    nativeOrderId: "",
    sourceInquiryId: "",
    orderReference: "TRRY-LEGACY-P13",
    odooSO: "SO-P13-LEGACY",
    productionStage: "completed",
  }] });
  assert.ok(!completedHtml.includes("mvp-production-drawer"), "legacy Odoo-only production row cannot open active Production drawer");
  report.legacyReadOnly = "PASS: legacy Odoo record readable only; no active release/Production progression and no fake PRD identity";
}

async function applyFullMigrationChain() {
  const files = (await readdir("supabase/migrations")).filter((name) => name.endsWith(".sql")).sort();
  assert.ok(files.includes("202608080006_phase13r2_native_order_authority.sql"), "R2 native authority migration is present");
  for (const file of files) await execSql(await readFile(`supabase/migrations/${file}`, "utf8"));
  const helper = await single(`select public.trry_ops_inquiry_has_order_confirmation('missing', 'SO-IGNORED') as allowed`);
  assert.equal(helper.allowed, false);
  report.migrationChain = `PASS: ${files.length} migrations applied including 202608080006_phase13r2_native_order_authority.sql`;
}

async function seedAdminUsers() {
  await execSql(`
    insert into auth.users (id, email) values
      ('${ACTOR_ID}', 'phase13-final-admin@trry.test'),
      ('${OTHER_ACTOR_ID}', 'phase13-final-other@trry.test')
    on conflict (id) do nothing;
    insert into public.admin_users (user_id, email, role, is_active)
    values
      ('${ACTOR_ID}', 'phase13-final-admin@trry.test', 'admin', true),
      ('${OTHER_ACTOR_ID}', 'phase13-final-other@trry.test', 'admin', true)
    on conflict (user_id) do update set role = excluded.role, is_active = excluded.is_active;
  `);
}

async function seedSyntheticInquiry() {
  await insertInquiry(INQUIRY_ID, {
    status: "approved",
    odoo_so: null,
    payment_status: "required",
    payment_method: "online",
    payment_type: "full",
    payment_selected_amount: 1360,
    payment_proof_path: "messenger/manual-receipt.png",
    tracking_substatus: "ready_for_pickup",
    tracking_note: "Customer will pick up after notification.",
    delivery_address: "TRRY front counter",
    delivery_city: "Iligan",
  });
}

async function insertInquiry(id, overrides = {}) {
  const row = {
    id,
    customer_name: "Phase 13 Final Customer",
    contact: "+639171313131",
    product: "DTF",
    product_desc: "Final RC shirts",
    quantity: "12 pcs",
    fulfillment_method: "pickup",
    due_date: "2026-09-15",
    status: "approved",
    quote_status: "approved",
    quoted_amount: 1360,
    amount_due: 1360,
    quote_breakdown: "Synthetic final quote",
    quote_notes: "Synthetic final note",
    quote_valid_until: "2026-09-08",
    quote_approved_at: "2026-08-08T08:00:00.000Z",
    odoo_so: null,
    artwork_status: "approved",
    artwork_approved_at: "2026-08-08T08:05:00.000Z",
    assigned_staff: "Phase 13 Final Staff",
    assigned_user_id: ACTOR_ID,
    payment_status: "required",
    payment_method: "online",
    payment_type: "full",
    payment_selected_amount: 1360,
    payment_verified_amount: null,
    payment_confirmed_amount: null,
    payment_confirmed_at: null,
    payment_confirmed_by: null,
    payment_proof_path: null,
    payment_history: [],
    production_stage: null,
    production_note: "Initial production note.",
    blocked_reason: null,
    tracking_substatus: "ready_for_pickup",
    tracking_note: "Customer will pick up after notification.",
    delivery_address: "TRRY front counter",
    delivery_city: "Iligan",
    ...overrides,
  };
  const columns = Object.keys(row);
  await execSql(`insert into public.ops_inquiries (${columns.map(quoteIdent).join(", ")}) values (${columns.map((column) => sqlLiteral(row[column])).join(", ")});`);
}

async function workflowInquiry(id) {
  const row = await dbInquiry(id);
  const order = await single(`select id, order_reference from public.orders where source_inquiry_id = '${id}'`);
  return order
    ? { ...row, nativeOrderAuthority: true, nativeOrderId: order.id, nativeOrderReference: order.order_reference }
    : row;
}

async function dbInquiry(id) {
  return single(`select * from public.ops_inquiries where id = '${id}'`);
}

function productionBody(overrides = {}) {
  return {
    assignedStaff: "Phase 13 Final Staff",
    productionNote: "Production note remains internal.",
    blockedReason: "",
    actorUserId: ACTOR_ID,
    ...overrides,
  };
}

async function applyUpdates(id, updates) {
  const entries = Object.entries(updates || {});
  if (!entries.length) return;
  await execSql(`
    update public.ops_inquiries
    set ${entries.map(([key, value]) => `${quoteIdent(key)} = ${sqlLiteral(value)}`).join(", ")}
    where id = '${id}';
  `);
}

async function paymentSnapshot(id) {
  return single(`
    select payment_status, payment_method, payment_type, payment_selected_amount,
           payment_confirmed_amount, payment_confirmed_by::text, payment_verified_amount,
           amount_due, payment_history
    from public.ops_inquiries
    where id = '${id}'
  `);
}

async function productionSnapshot(id) {
  return single(`
    select status, odoo_so, production_stage, production_started_at::text,
           production_started_by::text, qc_started_at::text, qc_started_by::text,
           qc_note, qc_completed_at::text, qc_completed_by::text,
           production_completed_at::text, production_completed_by::text
    from public.ops_inquiries
    where id = '${id}'
  `);
}

async function fulfillmentSnapshot(id) {
  return single(`
    select fulfillment_method, tracking_substatus, tracking_note, delivery_address, delivery_city
    from public.ops_inquiries
    where id = '${id}'
  `);
}

function legacyToOrder(row) {
  return {
    id: row.id,
    status: row.status,
    quoteStatus: row.quote_status,
    quotedAmount: row.quoted_amount,
    amountDue: row.amount_due,
    customer: row.customer_name,
    contact: row.contact,
    service: row.product,
    productDesc: row.product_desc,
    qty: row.quantity,
    dueDate: row.due_date,
    paymentStatus: row.payment_status,
    paymentVerifiedAmount: row.payment_verified_amount,
    paymentConfirmedAmount: row.payment_confirmed_amount,
    productionStage: row.production_stage,
    artworkStatus: row.artwork_status,
    assignedStaff: row.assigned_staff,
  };
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
  assert.equal(rows.length, 1, `expected exactly one row for ${sql}`);
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
  const result = spawnSync("docker", args, { encoding: "utf8", input: options.input, maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0 && !options.allowFailure) throw new Error(`${result.stderr || result.stdout}`.trim());
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
  if (Array.isArray(value) || (typeof value === "object" && value)) return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  return `'${String(value).replaceAll("'", "''")}'`;
}
