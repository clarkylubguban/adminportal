import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const CONTAINER = `trry-facebook-inbox-f7-db-${process.pid}`;
const IMAGE = process.env.TRRY_VERIFY_POSTGRES_IMAGE || "postgres:16-alpine";
const DB = "trry_verify";
const F1 = "202608250001_add_facebook_inbox_f1_foundation.sql";
const F2 = "202608250002_add_facebook_inbox_f2_receive_indexes.sql";
const F21 = "202608250003_add_facebook_inbox_f2_transactional_ingestion.sql";
const F4 = "202608260001_add_facebook_inbox_f4_reply_ownership.sql";
const F5 = "202608270001_add_facebook_inbox_f5_inquiry_bridge.sql";
const F6 = "202608270002_add_facebook_inbox_f6_send_reconciliation.sql";

const admin = "98000000-0000-4000-8000-000000000002";
const conversation = "99000000-0000-4000-8000-000000000071";

let started = false;
let convertedInquiryId = "";

try {
  docker(["run", "--rm", "-d", "--name", CONTAINER, "-e", "POSTGRES_PASSWORD=postgres", "-e", `POSTGRES_DB=${DB}`, IMAGE]);
  started = true;
  waitForPostgres();
  await execSql(supabaseHarnessSql());
  await applyCoreMigrations();
  await installPeopleAccessPrerequisite();
  await execSql((await Promise.all([F1, F2, F21, F4, F5, F6].map((file) => readMigration(file)))).join("\n\n"));
  await seedF7Data();

  await verifyConversationToInquiryToOrderLineage();
  await verifyDuplicateInquiryConversionIsIdempotent();
  await verifyDuplicateOrderConversionIsRejected();
  await verifyPostConversionMessageKeepsHistory();
  await verifyNoOdooOrLegacyLineageTables();

  console.log(`PASS Facebook Inbox F7 DB lineage contract verified in disposable Postgres container ${CONTAINER}`);
} finally {
  if (started) docker(["rm", "-f", CONTAINER], { allowFailure: true });
}

async function readMigration(file) {
  return (await readFile(`supabase/migrations/${file}`, "utf8")).replace(/^\uFEFF/, "");
}

async function applyCoreMigrations() {
  const files = (await readdir("supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => ![F1, F2, F21, F4, F5, F6].includes(name))
    .filter((name) => name < "202608110001_add_master_catalog_m0_foundation.sql")
    .sort();
  if (files.length) await execSql((await Promise.all(files.map((file) => readMigration(file)))).join("\n\n"));
}

async function installPeopleAccessPrerequisite() {
  await execSql(`
    alter table public.admin_users add column if not exists access_role_key text;

    create table public.admin_role_module_permissions (
      role_key text not null,
      module_key text not null,
      can_access boolean not null default false,
      primary key (role_key, module_key)
    );

    create table public.admin_actions (
      action_key text primary key,
      name text not null,
      is_protected boolean not null default false,
      created_at timestamptz not null default now()
    );

    create table public.admin_role_action_permissions (
      role_key text not null,
      action_key text not null references public.admin_actions(action_key) on delete cascade,
      can_perform boolean not null default false,
      created_at timestamptz not null default now(),
      primary key (role_key, action_key)
    );

    create table public.admin_temporary_module_grants (
      user_id uuid not null references public.admin_users(user_id) on delete cascade,
      module_key text not null,
      starts_at timestamptz not null default now(),
      expires_at timestamptz not null,
      revoked_at timestamptz
    );

    create or replace function public.admin_legacy_role_to_access_role(p_role text)
    returns text language sql stable as $$
      select case lower(coalesce(p_role, ''))
        when 'owner' then 'owner_admin'
        when 'admin' then 'admin_operations'
        when 'viewer' then 'viewer'
        else 'staff'
      end
    $$;

    create or replace function public.has_admin_module_access(p_module_key text)
    returns boolean language sql stable security definer set search_path = public as $$
      select exists (
        select 1 from public.admin_users admin_user
        join public.admin_role_module_permissions permission
          on permission.role_key = coalesce(admin_user.access_role_key, public.admin_legacy_role_to_access_role(admin_user.role))
         and permission.module_key = p_module_key
         and permission.can_access = true
        where admin_user.user_id = auth.uid() and admin_user.is_active = true
      )
    $$;

    create or replace function public.has_admin_action_permission(p_action_key text)
    returns boolean language sql stable security definer set search_path = public as $$
      select exists (
        select 1 from public.admin_users admin_user
        join public.admin_role_action_permissions permission
          on permission.role_key = coalesce(admin_user.access_role_key, public.admin_legacy_role_to_access_role(admin_user.role))
         and permission.action_key = p_action_key
         and permission.can_perform = true
        where admin_user.user_id = auth.uid() and admin_user.is_active = true
      )
    $$;
  `);
}

async function seedF7Data() {
  await execSql(`
    insert into auth.users (id, email) values ('${admin}', 'admin@trry.test');
    insert into public.admin_users (user_id, email, role, access_role_key, display_name, is_active, is_test)
    values ('${admin}', 'admin@trry.test', 'admin', 'admin_operations', 'Operations', true, false);

    insert into public.admin_role_module_permissions (role_key, module_key, can_access)
    values ('admin_operations', 'inbox', true), ('admin_operations', 'inquiries', true), ('admin_operations', 'orders', true)
    on conflict (role_key, module_key) do update set can_access = excluded.can_access;

    insert into public.meta_page_connections (id, page_id, page_name, status)
    values ('90000000-0000-4000-8000-000000000071', 'PAGE-F7', 'F7 Page', 'testing');

    insert into public.inbox_contacts (id, display_name, primary_phone, primary_email, company_name)
    values ('91000000-0000-4000-8000-000000000071', 'F7 Customer', '09170000071', 'f7@example.test', 'Lineage Co');

    insert into public.inbox_channel_identities (id, contact_id, page_connection_id, channel, external_user_id, external_username, display_name)
    values ('92000000-0000-4000-8000-000000000071', '91000000-0000-4000-8000-000000000071', '90000000-0000-4000-8000-000000000071', 'facebook_messenger', 'PSID-F7', 'f7customer', 'F7 Customer');

    insert into public.inbox_conversations (id, channel_identity_id, state, owner_user_id, last_message_at, last_inbound_at, reply_window_expires_at, referral_ref, campaign_name, ad_name)
    values ('${conversation}', '92000000-0000-4000-8000-000000000071', 'needs_reply', '${admin}', now(), now(), now() + interval '2 hours', 'fb-lineage-ref', 'Lineage campaign', 'Lineage ad');

    insert into public.inbox_messages (conversation_id, external_message_id, direction, message_type, body, sender_external_id, is_echo, sent_at)
    values
      ('${conversation}', 'MID-F7-IN-1', 'inbound', 'text', 'Need 72 shirts for school event', 'PSID-F7', false, now() - interval '5 minutes'),
      ('${conversation}', 'MID-F7-OUT-1', 'outbound', 'text', 'We can prepare a quote.', 'PAGE-F7', true, now() - interval '4 minutes');
  `);
}

async function verifyConversationToInquiryToOrderLineage() {
  const before = await coreCounts();
  const result = await rpc("convert_inbox_conversation_to_inquiry", {
    p_conversation_id: conversation,
    p_actor_user_id: admin,
    p_idempotency_key: "idem-f7-convert",
  });

  assert.equal(result.ok, true);
  assert.equal(result.replay, false);
  convertedInquiryId = result.inquiry.id;

  await execSql(`
    update public.ops_inquiries
    set quote_status = 'approved',
        quoted_amount = 7200,
        amount_due = 7200,
        quote_approved_at = now(),
        product = 'DTF Print',
        quantity = '72 pcs',
        fulfillment_method = 'pickup',
        due_date = current_date + interval '7 days',
        artwork_status = 'approved'
    where id = '${convertedInquiryId}';

    insert into public.orders (order_reference, source_inquiry_id, quoted_amount)
    values ('TRRY-ORD-F7000001', '${convertedInquiryId}', 7200);
  `);

  const lineage = await single(`
    select link.conversation_id, link.inquiry_id, orders.order_reference, orders.source_inquiry_id
    from public.inbox_inquiry_links link
    join public.ops_inquiries inquiry on inquiry.id = link.inquiry_id
    join public.orders orders on orders.source_inquiry_id = inquiry.id
    where link.conversation_id = '${conversation}'
  `);
  assert.equal(lineage.conversation_id, conversation);
  assert.equal(lineage.inquiry_id, convertedInquiryId);
  assert.equal(lineage.source_inquiry_id, convertedInquiryId);
  assert.equal(lineage.order_reference, "TRRY-ORD-F7000001");
  assert.equal((await coreCounts()).ops_inquiries, before.ops_inquiries + 1);
  assert.equal((await coreCounts()).orders, before.orders + 1);
}

async function verifyDuplicateInquiryConversionIsIdempotent() {
  const before = await coreCounts();
  const result = await rpc("convert_inbox_conversation_to_inquiry", {
    p_conversation_id: conversation,
    p_actor_user_id: admin,
    p_idempotency_key: "idem-f7-second-click",
  });
  assert.equal(result.ok, true);
  assert.equal(result.replay, true);
  assert.equal(result.inquiry.id, convertedInquiryId);
  assert.equal((await single(`select count(*)::int as count from public.inbox_inquiry_links where conversation_id = '${conversation}'`)).count, 1);
  assert.deepEqual(await coreCounts(), before);
}

async function verifyDuplicateOrderConversionIsRejected() {
  await assertSqlFails(`
    insert into public.orders (order_reference, source_inquiry_id)
    values ('TRRY-ORD-F7000002', '${convertedInquiryId}');
  `, /duplicate key|orders_source_inquiry_id_key/i);
  assert.equal((await single(`select count(*)::int as count from public.orders where source_inquiry_id = '${convertedInquiryId}'`)).count, 1);
}

async function verifyPostConversionMessageKeepsHistory() {
  const messagesBefore = await tableCount("inbox_messages");
  const inquiryBefore = await single(`select message from public.ops_inquiries where id = '${convertedInquiryId}'`);
  await execSql(`
    insert into public.inbox_messages (conversation_id, external_message_id, direction, message_type, body, sender_external_id, is_echo, sent_at)
    values ('${conversation}', 'MID-F7-IN-POST-CONVERT', 'inbound', 'text', 'New post-conversion note', 'PSID-F7', false, now());
  `);
  assert.equal(await tableCount("inbox_messages"), messagesBefore + 1);
  assert.equal((await single(`select count(*)::int as count from public.inbox_inquiry_links where conversation_id = '${conversation}' and inquiry_id = '${convertedInquiryId}'`)).count, 1);
  const inquiryAfter = await single(`select message from public.ops_inquiries where id = '${convertedInquiryId}'`);
  assert.equal(inquiryAfter.message, inquiryBefore.message);
  assert.equal(String(inquiryAfter.message || "").includes("New post-conversion note"), false);
}

async function verifyNoOdooOrLegacyLineageTables() {
  assert.equal(await tableExists("facebook_messages"), false);
  assert.equal(await tableExists("messenger_messages"), false);
  assert.equal(await tableExists("inbox_order_links"), false);
  const inquiry = await single(`select odoo_so from public.ops_inquiries where id = '${convertedInquiryId}'`);
  assert.equal(inquiry.odoo_so, null);
}

async function rpc(name, args) {
  const rows = await queryJson(`select public.${name}(${Object.values(args).map(sqlValue).join(", ")}) as result`);
  return rows[0].result;
}

async function assertSqlFails(sql, pattern) {
  const result = psql(["-v", "ON_ERROR_STOP=1", "-q"], sql, { allowFailure: true });
  assert.notEqual(result.status, 0, "expected SQL to fail");
  assert.match(result.stderr || result.stdout, pattern);
}

async function coreCounts() {
  return single(`
    select
      (select count(*)::int from public.ops_inquiries) as ops_inquiries,
      (select count(*)::int from public.orders) as orders,
      (select count(*)::int from public.inbox_inquiry_links) as inbox_inquiry_links,
      (select count(*)::int from public.inbox_messages) as inbox_messages
  `);
}

async function tableCount(table) {
  return (await single(`select count(*)::int as count from public.${table}`)).count;
}

async function tableExists(table) {
  return (await single(`select to_regclass('public.${table}') is not null as exists`)).exists;
}

async function single(sql) {
  const rows = await queryJson(sql);
  assert.equal(rows.length, 1, "expected exactly one row");
  return rows[0];
}

async function queryJson(sql) {
  const wrapped = `select coalesce(json_agg(row_to_json(q)), '[]'::json)::text from (${sql.replace(/;+\s*$/, "")}) q`;
  return JSON.parse(psql(["-t", "-A", "-c", wrapped]).trim() || "[]");
}

async function execSql(sql) {
  psql(["-v", "ON_ERROR_STOP=1", "-q"], sql);
}

function psql(args, input = null, options = {}) {
  if (input && typeof input === "object" && !Buffer.isBuffer(input)) {
    options = input;
    input = null;
  }
  const result = docker(["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DB, "-X", ...args], { input, allowFailure: true });
  if (result.status !== 0 && !options.allowFailure) throw new Error(`${result.stderr || result.stdout}`.trim());
  if (options.allowFailure) return result;
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

function sqlValue(value) {
  if (value === null || value === undefined || value === "") return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  return `'${String(value).replaceAll("'", "''")}'`;
}
