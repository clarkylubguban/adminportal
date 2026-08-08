import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { handleWorkflowRequest } from "../api/inquiries/[id]/workflow.js";

const CONTAINER = `trry-native-order-db-${process.pid}`;
const IMAGE = process.env.TRRY_VERIFY_POSTGRES_IMAGE || "postgres:16-alpine";
const DB = "trry_verify";
const ADMIN_USER_ID = "96000000-0000-4000-8000-000000000001";

let started = false;

try {
  docker(["run", "--rm", "-d", "--name", CONTAINER, "-e", "POSTGRES_PASSWORD=postgres", "-e", `POSTGRES_DB=${DB}`, IMAGE]);
  started = true;
  waitForPostgres();

  await execSql(bootstrapSql());
  await execSql(await readFile("supabase/migrations/202608080001_phase3d_native_orders.sql", "utf8"));

  await verifyTableContract();
  await verifyDirectDatabaseConstraints();
  await verifyRls();
  await verifyConversionApi();
  await verifyLegacySafety();

  console.log(`PASS Native Order database contract verified in disposable Postgres container ${CONTAINER}`);
} finally {
  if (started) docker(["rm", "-f", CONTAINER], { allowFailure: true });
}

async function verifyTableContract() {
  const columns = await queryJson(`
    select column_name, data_type, udt_name, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public' and table_name = 'orders'
    order by ordinal_position
  `);
  assert.deepEqual(columns.map((column) => column.column_name), [
    "id",
    "order_reference",
    "source_inquiry_id",
    "status",
    "quoted_amount",
    "amount_due",
    "quote_breakdown",
    "quote_note",
    "quote_valid_until",
    "quote_approved_at",
    "customer_name",
    "customer_contact",
    "product",
    "product_desc",
    "quantity",
    "fulfillment_method",
    "due_date",
    "created_at",
    "updated_at",
  ]);
  assert.equal(columns.find((column) => column.column_name === "id").udt_name, "uuid");
  assert.match(columns.find((column) => column.column_name === "id").column_default, /gen_random_uuid/);
  assert.equal(columns.find((column) => column.column_name === "source_inquiry_id").udt_name, "text");
  assert.equal(columns.find((column) => column.column_name === "status").column_default, "'awaiting_payment'::text");

  const constraints = await queryJson(`
    select conname, contype, pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conrelid = 'public.orders'::regclass
    order by conname
  `);
  assert.ok(constraints.some((constraint) => constraint.conname === "orders_pkey" && constraint.contype === "p"));
  assert.ok(constraints.some((constraint) => constraint.conname === "orders_order_reference_key" && constraint.contype === "u"));
  assert.ok(constraints.some((constraint) => constraint.conname === "orders_source_inquiry_id_key" && constraint.contype === "u"));
  assert.ok(constraints.some((constraint) => constraint.contype === "f" && constraint.definition.includes("source_inquiry_id") && constraint.definition.includes("ops_inquiries")));

  const rls = await queryJson(`
    select relrowsecurity, relforcerowsecurity
    from pg_class
    where oid = 'public.orders'::regclass
  `);
  assert.equal(rls[0].relrowsecurity, true);

  const policies = await queryJson(`
    select policyname, cmd, roles, qual, with_check
    from pg_policies
    where schemaname = 'public' and tablename = 'orders'
    order by policyname
  `);
  assert.deepEqual(policies.map((policy) => policy.policyname), [
    "Active admins can read orders",
    "Active staff can insert orders",
    "Active staff can update orders",
  ]);
}

async function verifyDirectDatabaseConstraints() {
  await execSql(`
    insert into public.ops_inquiries (id, customer_name, contact, product, product_desc, quantity, fulfillment_method, due_date, quote_status, quoted_amount, amount_due, quote_breakdown, quote_notes, quote_valid_until, quote_approved_at, odoo_so)
    values ('TRY-DB-001', 'DB Customer', '0917-111-1111', 'DTF Print', 'DB product desc', '12 pcs', 'pickup', '2026-08-20', 'approved', 1200, 1200, '12 pcs | PHP 100', 'DB quote note', '2026-08-31', '2026-08-08T03:00:00Z', null);

    insert into public.orders (order_reference, source_inquiry_id, quoted_amount)
    values ('TRRY-ORD-TEST0001', 'TRY-DB-001', 1200);
  `);

  const row = await single(`
    select order_reference, source_inquiry_id, status, created_at is not null as has_created_at, updated_at is not null as has_updated_at
    from public.orders
    where source_inquiry_id = 'TRY-DB-001'
  `);
  assert.equal(row.status, "awaiting_payment");
  assert.equal(row.has_created_at, true);
  assert.equal(row.has_updated_at, true);

  await assertSqlFails(`
    insert into public.orders (order_reference, source_inquiry_id)
    values ('TRRY-ORD-TEST0002', 'TRY-DB-MISSING');
  `, /foreign key|orders_source_inquiry_id_fkey/i);

  await assertSqlFails(`
    insert into public.orders (order_reference, source_inquiry_id)
    values ('TRRY-ORD-TEST0003', 'TRY-DB-001');
  `, /duplicate key|orders_source_inquiry_id_key/i);

  await execSql(`
    insert into public.ops_inquiries (id, quote_status, quoted_amount)
    values ('TRY-DB-002', 'approved', 100);
  `);
  await assertSqlFails(`
    insert into public.orders (order_reference, source_inquiry_id)
    values ('TRRY-ORD-TEST0001', 'TRY-DB-002');
  `, /duplicate key|orders_order_reference_key/i);
}

async function verifyRls() {
  await assertSqlFails(`
    set role anon;
    insert into public.orders (order_reference, source_inquiry_id)
    values ('TRRY-ORD-ANON0001', 'TRY-DB-001');
  `, /permission denied|violates row-level security/i);

  await assertSqlFails(`
    insert into public.admin_users (user_id, role, is_active)
    values ('${ADMIN_USER_ID}', 'staff', true)
    on conflict (user_id) do update set role = excluded.role, is_active = excluded.is_active;

    insert into public.ops_inquiries (id, quote_status, quoted_amount)
    values ('TRY-DB-RLS', 'approved', 100)
    on conflict (id) do nothing;

    set role authenticated;
    set request.jwt.claim.sub = '${ADMIN_USER_ID}';
    insert into public.orders (order_reference, source_inquiry_id)
    values ('TRRY-ORD-RLS00001', 'TRY-DB-RLS');
    reset role;
  `, /permission denied|violates row-level security/i);

  await execSql(`
    set role authenticated;
    set request.jwt.claim.sub = '${ADMIN_USER_ID}';
    select count(*) from public.orders;
    reset role;
  `);

  await execSql(`
    insert into public.ops_inquiries (id, quote_status, quoted_amount)
    values ('TRY-DB-SVC', 'approved', 100)
    on conflict (id) do nothing;

    set role service_role;
    insert into public.orders (order_reference, source_inquiry_id)
    values ('TRRY-ORD-SVC00001', 'TRY-DB-SVC');
    reset role;
  `);
}

async function verifyConversionApi() {
  await execSql(`
    insert into public.ops_inquiries (id, customer_name, contact, product, product_desc, quantity, fulfillment_method, due_date, quote_status, quoted_amount, amount_due, quote_breakdown, quote_notes, quote_valid_until, quote_approved_at, odoo_so)
    values
      ('TRY-API-001', 'API Customer', '0917-222-2222', 'Embroidery', 'API product desc', '32 pcs', 'delivery', '2026-09-01', 'approved', 3200, 3200, '32 pcs | PHP 100', 'API quote note', '2026-09-15', '2026-08-08T04:00:00Z', null),
      ('TRY-API-BAD', 'Bad Customer', '0917-333-3333', 'Screen Print', 'Bad product', '10 pcs', 'pickup', '2026-09-02', 'ready', 1000, 1000, 'bad', 'bad', '2026-09-15', null, null);
  `);

  const supabase = databaseBackedSupabase();
  const first = await invokeOrdersApi(supabase, "TRY-API-001");
  assert.equal(first.status, 201);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.created, true);
  assert.ok(first.body.order.id);
  assert.match(first.body.order.orderReference, /^TRRY-ORD-[A-Z0-9]{8}$/);
  assert.equal(first.body.order.sourceInquiryId, "TRY-API-001");
  assert.equal(first.body.order.status, "awaiting_payment");

  const second = await invokeOrdersApi(supabase, "TRY-API-001");
  assert.equal(second.status, 200);
  assert.equal(second.body.created, false);
  assert.equal(second.body.order.id, first.body.order.id);
  assert.equal(await orderCount("TRY-API-001"), 1);

  const [left, right] = await Promise.all([
    invokeOrdersApi(supabase, "TRY-API-001"),
    invokeOrdersApi(supabase, "TRY-API-001"),
  ]);
  assert.equal(left.body.order.id, first.body.order.id);
  assert.equal(right.body.order.id, first.body.order.id);
  assert.equal(await orderCount("TRY-API-001"), 1);

  const snapshot = await single(`
    select quoted_amount::text, amount_due::text, quote_breakdown, quote_note, quote_valid_until::text, quote_approved_at is not null as has_quote_approved_at,
           customer_name, customer_contact, product, product_desc, quantity, fulfillment_method, due_date::text
    from public.orders
    where source_inquiry_id = 'TRY-API-001'
  `);
  assert.deepEqual(snapshot, {
    quoted_amount: "3200",
    amount_due: "3200",
    quote_breakdown: "32 pcs | PHP 100",
    quote_note: "API quote note",
    quote_valid_until: "2026-09-15",
    has_quote_approved_at: true,
    customer_name: "API Customer",
    customer_contact: "0917-222-2222",
    product: "Embroidery",
    product_desc: "API product desc",
    quantity: "32 pcs",
    fulfillment_method: "delivery",
    due_date: "2026-09-01",
  });

  const bad = await invokeOrdersApi(supabase, "TRY-API-BAD");
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "QUOTE_NOT_APPROVED");

  const missing = await invokeOrdersApi(supabase, "TRY-API-MISSING");
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, "INQUIRY_NOT_FOUND");
}

async function verifyLegacySafety() {
  const workflow = await readFile("api/_lib/opsWorkflow.js", "utf8");
  assert.ok(!workflow.includes("confirm_order"), "legacy confirm_order is not an active workflow action");
  assert.ok(!workflow.includes("odoo_so"), "workflow authority does not write Odoo SO");
  assert.ok(workflow.includes("advance_production"));
  const payment = await readFile("api/_lib/paymentConfirmation.js", "utf8");
  assert.ok(payment.includes("payment_history"));
  const main = await readFile("src/main.js", "utf8");
  assert.ok(!main.includes("confirmOpsSO"), "legacy Odoo confirmation UI handler is removed");
  assert.ok(main.includes("Review the Messenger receipt"));
  const opsBoard = await readFile("src/services/opsBoard.js", "utf8");
  assert.ok(opsBoard.includes("Legacy Odoo SO writes are disabled"), "legacy Odoo service writes are disabled");
  assert.ok(!opsBoard.includes("odoo_so: updates.odooSO"), "generic inquiry updates do not write Odoo SO");
  assert.ok(!opsBoard.includes("odoo_so: inquiry.odooSO"), "new inquiry mapping does not write Odoo SO");
  const dashboard = await readFile("src/mvpDashboard.js", "utf8");
  assert.ok(dashboard.includes("data-mvp-open-messenger"));
}

async function invokeOrdersApi(supabase, inquiryId) {
  const request = Readable.from(["{}"]);
  request.method = "POST";
  request.url = `/api/inquiries/${encodeURIComponent(inquiryId)}/orders`;
  request.headers = { host: "localhost", authorization: "Bearer synthetic" };
  const response = createResponse();
  await handleWorkflowRequest(request, response, { supabase, adminUser: { role: "staff" } });
  return response.result();
}

function databaseBackedSupabase() {
  return {
    from(table) {
      const query = { table, filters: {}, action: "select", row: null };
      const builder = {
        select() { return builder; },
        eq(key, value) { query.filters[key] = value; return builder; },
        insert(row) { query.action = "insert"; query.row = row; return builder; },
        async maybeSingle() {
          const rows = await selectRows(query.table, query.filters);
          return { data: rows[0] || null, error: null };
        },
        async single() {
          if (query.action === "insert") {
            const result = await insertRow(query.table, query.row);
            return result.error ? result : { data: result.data, error: null };
          }
          const rows = await selectRows(query.table, query.filters);
          return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: "not found" } };
        },
      };
      return builder;
    },
  };
}

async function selectRows(table, filters) {
  const where = Object.entries(filters).map(([key, value]) => `${quoteIdent(key)} = ${sqlLiteral(value)}`).join(" and ") || "true";
  return queryJson(`select * from public.${quoteIdent(table)} where ${where} order by created_at nulls last, id`);
}

async function insertRow(table, row) {
  const columns = Object.keys(row);
  const values = columns.map((column) => sqlLiteral(row[column]));
  const sql = `with inserted as (
    insert into public.${quoteIdent(table)} (${columns.map(quoteIdent).join(", ")})
    values (${values.join(", ")})
    returning *
  ) select coalesce(json_agg(row_to_json(inserted)), '[]'::json)::text from inserted`;
  try {
    const rows = JSON.parse(psql(["-t", "-A", "-c", sql]).trim() || "[]");
    return { data: rows[0] || null, error: null };
  } catch (error) {
    return { data: null, error: normalizePgError(error) };
  }
}

async function orderCount(sourceInquiryId) {
  const row = await single(`select count(*)::int as count from public.orders where source_inquiry_id = ${sqlLiteral(sourceInquiryId)}`);
  return row.count;
}

async function single(sql) {
  const rows = await queryJson(sql);
  assert.ok(rows.length <= 1, "expected one row at most");
  return rows[0] || null;
}

async function queryJson(sql) {
  const wrapped = `select coalesce(json_agg(row_to_json(q)), '[]'::json)::text from (${sql.replace(/;+\s*$/, "")}) q`;
  const output = psql(["-t", "-A", "-c", wrapped]);
  return JSON.parse(output.trim() || "[]");
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
  if (result.status !== 0) {
    throw new Error(`${result.stderr || result.stdout}`.trim());
  }
  return result.stdout;
}

function waitForPostgres() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const result = docker(["exec", CONTAINER, "pg_isready", "-U", "postgres", "-d", DB], { allowFailure: true });
    if (result.status === 0) return;
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
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${result.stderr || result.stdout}`.trim());
  }
  return result;
}

function bootstrapSql() {
  return `
    create extension if not exists pgcrypto;

    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
    end $$;

    create schema if not exists auth;
    create or replace function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create table public.admin_users (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null unique,
      role text not null,
      is_active boolean not null default true
    );

    create table public.ops_inquiries (
      id text primary key,
      customer_name text,
      contact text,
      product text,
      product_desc text,
      quantity text,
      fulfillment_method text,
      due_date date,
      status text not null default 'new',
      quote_status text,
      quoted_amount numeric,
      amount_due numeric,
      quote_breakdown text,
      quote_notes text,
      quote_valid_until date,
      quote_approved_at timestamptz,
      odoo_so text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    grant usage on schema public to anon, authenticated, service_role;
    grant usage on schema auth to anon, authenticated, service_role;
    grant select on public.admin_users to authenticated;
    grant all on public.admin_users to service_role;
    grant all on public.ops_inquiries to authenticated, service_role;
  `;
}

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function normalizePgError(error) {
  const text = String(error?.message || error || "");
  const sourceInquiry = /orders_source_inquiry_id_key/.test(text);
  const orderReference = /orders_order_reference_key/.test(text);
  const foreignKey = /orders_source_inquiry_id_fkey/.test(text);
  return {
    code: sourceInquiry || orderReference ? "23505" : foreignKey ? "23503" : "",
    message: text,
    details: text,
  };
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
