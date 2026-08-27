import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const CONTAINER = `trry-facebook-inbox-f1-db-${process.pid}`;
const IMAGE = process.env.TRRY_VERIFY_POSTGRES_IMAGE || "postgres:16-alpine";
const DB = "trry_verify";
const F1_MIGRATION = "202608250001_add_facebook_inbox_f1_foundation.sql";

const f1Tables = [
  "meta_page_connections",
  "meta_webhook_events",
  "inbox_contacts",
  "inbox_channel_identities",
  "inbox_conversations",
  "inbox_messages",
  "inbox_attachments",
  "inbox_conversation_notes",
  "inbox_conversation_events",
  "inbox_inquiry_links",
];

let started = false;

try {
  docker(["run", "--rm", "-d", "--name", CONTAINER, "-e", "POSTGRES_PASSWORD=postgres", "-e", `POSTGRES_DB=${DB}`, IMAGE]);
  started = true;
  waitForPostgres();

  await execSql(supabaseHarnessSql());
  await applyMigrationsBeforeF1();
  await installPeopleAccessPrerequisite();
  await seedStagingBaseline();

  const beforeCounts = await coreCounts();
  assert.deepEqual(beforeCounts, { ops_inquiries: 28, orders: 9, admin_users: 10 });

  await execSql(await readFile(`supabase/migrations/${F1_MIGRATION}`, "utf8"));

  await verifyTables();
  await verifyRls();
  await verifyWebhookPayloadIsolation();
  await verifyPrivateBucket();
  await verifyDeduplication();
  await verifyInquiryLinkContract();
  await verifyCashierInboxAccess();
  await verifyNoLegacyMessageTables();
  assert.deepEqual(await coreCounts(), beforeCounts, "F1 migration must not mutate core authority row counts");

  console.log(`PASS Facebook Inbox F1 database foundation verified in disposable Postgres container ${CONTAINER}`);
} finally {
  if (started) docker(["rm", "-f", CONTAINER], { allowFailure: true });
}

async function readMigration(file) {
  return (await readFile(`supabase/migrations/${file}`, "utf8")).replace(/^\uFEFF/, "");
}

async function applyMigrationsBeforeF1() {
  const files = (await readdir("supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => name !== F1_MIGRATION)
    .filter((name) => name < "202608110001_add_master_catalog_m0_foundation.sql")
    .sort();
  assert.ok(files.includes("202608080001_phase3d_native_orders.sql"), "core migration chain must include native Orders");
  if (files.length) {
    await execSql((await Promise.all(files.map((file) => readMigration(file)))).join("\n\n"));
  }
}

async function installPeopleAccessPrerequisite() {
  await execSql(`
    create table public.admin_role_module_permissions (
      role_key text not null,
      module_key text not null,
      can_access boolean not null default false,
      primary key (role_key, module_key)
    );

    create or replace function public.has_admin_module_access(module_key text)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
    as $$
      select exists (
        select 1
        from public.admin_users admin_user
        join public.admin_role_module_permissions permission
          on permission.role_key = case admin_user.role
            when 'owner' then 'owner_admin'
            when 'admin' then 'admin_operations'
            when 'staff' then 'cashier_front_desk'
            else admin_user.role
          end
         and permission.module_key = has_admin_module_access.module_key
         and permission.can_access = true
        where admin_user.user_id = (select auth.uid())
          and admin_user.is_active = true
      )
    $$;

    grant execute on function public.has_admin_module_access(text) to authenticated;
    grant select, insert, update, delete on public.admin_role_module_permissions to service_role;
  `);
}

async function seedStagingBaseline() {
  await execSql(`
    insert into auth.users (id, email)
    select
      ('97000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
      'facebook-f1-admin-' || series || '@trry.test'
    from generate_series(1, 10) series;

    insert into public.admin_users (user_id, email, role, display_name, is_active)
    select
      ('97000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
      'facebook-f1-admin-' || series || '@trry.test',
      case when series = 1 then 'owner' when series <= 3 then 'admin' else 'staff' end,
      'Facebook F1 Admin ' || series,
      true
    from generate_series(1, 10) series;

    insert into public.ops_inquiries (
      id, customer_name, contact, product, product_desc, quantity,
      fulfillment_method, due_date, status, quote_status, quoted_amount,
      amount_due, quote_breakdown, quote_notes, quote_valid_until,
      quote_approved_at, artwork_status, artwork_approved_at
    )
    select
      'TRY-F1-' || lpad(series::text, 3, '0'),
      'Facebook F1 Customer ' || series,
      '+63917000' || lpad(series::text, 4, '0'),
      'DTF Print',
      'Synthetic F1 shirts',
      '12 pcs',
      'pickup',
      date '2026-09-15',
      'approved',
      'approved',
      1200,
      1200,
      'Synthetic F1 quote',
      'Synthetic F1 note',
      date '2026-09-30',
      timestamptz '2026-08-25 00:00:00+00',
      'approved',
      timestamptz '2026-08-25 00:05:00+00'
    from generate_series(1, 28) series;

    insert into public.orders (
      order_reference, source_inquiry_id, quoted_amount, amount_due,
      customer_name, customer_contact, product, product_desc, quantity,
      fulfillment_method, due_date
    )
    select
      'TRRY-ORD-F1' || lpad(series::text, 6, '0'),
      'TRY-F1-' || lpad(series::text, 3, '0'),
      1200,
      1200,
      'Facebook F1 Customer ' || series,
      '+63917000' || lpad(series::text, 4, '0'),
      'DTF Print',
      'Synthetic F1 shirts',
      '12 pcs',
      'pickup',
      date '2026-09-15'
    from generate_series(1, 9) series;

    insert into public.admin_role_module_permissions (role_key, module_key, can_access)
    values
      ('owner_admin', 'inbox', false),
      ('admin_operations', 'inbox', false)
    on conflict (role_key, module_key) do update
    set can_access = excluded.can_access;
  `);
}

async function verifyTables() {
  const rows = await queryJson(`
    select table_name
    from information_schema.tables
    where table_schema = 'public' and table_name = any(array[${f1Tables.map(sqlLiteral).join(", ")}])
    order by table_name
  `);
  assert.deepEqual(rows.map((row) => row.table_name), [...f1Tables].sort());
}

async function verifyRls() {
  const rows = await queryJson(`
    select c.relname, c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = any(array[${f1Tables.map(sqlLiteral).join(", ")}])
    order by c.relname
  `);
  assert.equal(rows.length, 10);
  assert.equal(rows.every((row) => row.relrowsecurity === true), true, "RLS must be enabled on every F1 table");

  const policyTables = await queryJson(`
    select distinct tablename
    from pg_policies
    where schemaname = 'public'
      and tablename = any(array[${f1Tables.filter((table) => table !== "meta_webhook_events").map(sqlLiteral).join(", ")}])
      and qual ilike '%has_admin_module_access%'
    order by tablename
  `);
  assert.ok(policyTables.length >= 8, "Inbox read policies must use public.has_admin_module_access('inbox')");
}

async function verifyWebhookPayloadIsolation() {
  const grants = await queryJson(`
    select grantee, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'meta_webhook_events'
      and grantee in ('anon', 'authenticated')
  `);
  assert.deepEqual(grants, []);

  await assertSqlFails(`
    set role authenticated;
    select count(*) from public.meta_webhook_events;
  `, /permission denied/i);
}

async function verifyPrivateBucket() {
  const bucket = await single(`
    select id, public, file_size_limit, allowed_mime_types
    from storage.buckets
    where id = 'inbox-files'
  `);
  assert.equal(bucket.id, "inbox-files");
  assert.equal(bucket.public, false);
  assert.equal(Number(bucket.file_size_limit), 20971520);
  assert.ok(bucket.allowed_mime_types.includes("application/pdf"));
}

async function verifyDeduplication() {
  const indexes = await queryJson(`
    select indexname, indexdef
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'inbox_conversations_one_open_per_identity_uidx',
        'inbox_messages_external_message_uidx',
        'inbox_conversation_events_idempotency_uidx'
      )
    order by indexname
  `);
  assert.deepEqual(indexes.map((index) => index.indexname), [
    "inbox_conversation_events_idempotency_uidx",
    "inbox_conversations_one_open_per_identity_uidx",
    "inbox_messages_external_message_uidx",
  ]);
  assert.match(indexes.find((index) => index.indexname === "inbox_conversations_one_open_per_identity_uidx").indexdef, /WHERE \(state <> 'closed'::text\)/);
  assert.match(indexes.find((index) => index.indexname === "inbox_messages_external_message_uidx").indexdef, /external_message_id/);

  const webhookKey = await single(`
    select conname, contype
    from pg_constraint
    where conrelid = 'public.meta_webhook_events'::regclass
      and conname = 'meta_webhook_events_key_unique'
  `);
  assert.equal(webhookKey.contype, "u");
}

async function verifyInquiryLinkContract() {
  const constraints = await queryJson(`
    select conname, contype, pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conrelid = 'public.inbox_inquiry_links'::regclass
    order by conname
  `);
  assert.ok(constraints.some((constraint) => constraint.contype === "p" && constraint.definition.includes("PRIMARY KEY (conversation_id)")));
  assert.ok(constraints.some((constraint) => constraint.contype === "u" && constraint.definition.includes("UNIQUE (inquiry_id)")));
  assert.ok(constraints.some((constraint) => constraint.contype === "u" && constraint.definition.includes("UNIQUE (idempotency_key)")));
  assert.ok(constraints.some((constraint) => constraint.contype === "f" && constraint.definition.includes("FOREIGN KEY (inquiry_id)") && constraint.definition.includes("ops_inquiries")));
  assert.ok(constraints.some((constraint) => constraint.contype === "f" && constraint.definition.includes("FOREIGN KEY (conversation_id)") && constraint.definition.includes("inbox_conversations")));
}

async function verifyCashierInboxAccess() {
  const rows = await queryJson(`
    select role_key, module_key, can_access
    from public.admin_role_module_permissions
    where role_key in ('owner_admin', 'admin_operations', 'cashier_front_desk')
      and module_key = 'inbox'
    order by role_key
  `);
  assert.deepEqual(rows, [
    { role_key: "admin_operations", module_key: "inbox", can_access: false },
    { role_key: "cashier_front_desk", module_key: "inbox", can_access: true },
    { role_key: "owner_admin", module_key: "inbox", can_access: false },
  ]);

  const cashierAccess = await single(`
    select public.has_admin_module_access('inbox') as allowed
    from (
      select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000004', true)
    ) claim
  `);
  assert.equal(cashierAccess.allowed, true);
}

async function verifyNoLegacyMessageTables() {
  const rows = await queryJson(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in ('facebook_messages', 'messenger_messages')
  `);
  assert.deepEqual(rows, []);
}

async function coreCounts() {
  return single(`
    select
      (select count(*)::int from public.ops_inquiries) as ops_inquiries,
      (select count(*)::int from public.orders) as orders,
      (select count(*)::int from public.admin_users) as admin_users
  `);
}

async function single(sql) {
  const rows = await queryJson(sql);
  assert.equal(rows.length, 1, "expected exactly one row");
  return rows[0];
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
  } finally {
    await execSql("reset role;");
  }
  assert.equal(failed, true, "SQL was expected to fail");
}

function psql(args, input = null) {
  const result = docker(["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DB, "-X", ...args], { input, allowFailure: true });
  if (result.status !== 0) throw new Error(`${result.stderr || result.stdout}`.trim());
  return result.stdout;
}

function waitForPostgres() {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const ready = docker(["exec", CONTAINER, "pg_isready", "-U", "postgres", "-d", DB], { allowFailure: true });
    const query = docker(["exec", CONTAINER, "psql", "-U", "postgres", "-d", DB, "-X", "-t", "-A", "-c", "select 1"], { allowFailure: true });
    if (ready.status === 0 && query.status === 0 && query.stdout.trim() === "1") return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error("Postgres container did not become ready");
}

function docker(args, options = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", input: options.input, maxBuffer: 20 * 1024 * 1024 });
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

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
