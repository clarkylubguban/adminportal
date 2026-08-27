import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";

const CONTAINER = `trry-facebook-inbox-f5-db-${process.pid}`;
const IMAGE = process.env.TRRY_VERIFY_POSTGRES_IMAGE || "postgres:16-alpine";
const DB = "trry_verify";
const F1 = "202608250001_add_facebook_inbox_f1_foundation.sql";
const F2 = "202608250002_add_facebook_inbox_f2_receive_indexes.sql";
const F21 = "202608250003_add_facebook_inbox_f2_transactional_ingestion.sql";
const F4 = "202608260001_add_facebook_inbox_f4_reply_ownership.sql";
const F5 = "202608270001_add_facebook_inbox_f5_inquiry_bridge.sql";

const owner = "98000000-0000-4000-8000-000000000001";
const admin = "98000000-0000-4000-8000-000000000002";
const cashier = "98000000-0000-4000-8000-000000000003";
const conversation = "99000000-0000-4000-8000-000000000001";
const concurrentConversation = "99000000-0000-4000-8000-000000000002";
const existingLinkConversation = "99000000-0000-4000-8000-000000000003";
const missingConversation = "99000000-0000-4000-8000-000000000099";

let started = false;

try {
  docker(["run", "--rm", "-d", "--name", CONTAINER, "-e", "POSTGRES_PASSWORD=postgres", "-e", `POSTGRES_DB=${DB}`, IMAGE]);
  started = true;
  waitForPostgres();
  await execSql(supabaseHarnessSql());
  await applyCoreMigrations();
  await installPeopleAccessPrerequisite();
  await execSql(await readFile(`supabase/migrations/${F1}`, "utf8"));
  await execSql(await readFile(`supabase/migrations/${F2}`, "utf8"));
  await execSql(await readFile(`supabase/migrations/${F21}`, "utf8"));
  await execSql(await readFile(`supabase/migrations/${F4}`, "utf8"));
  await execSql(await readFile(`supabase/migrations/${F5}`, "utf8"));
  await seedF5Data();

  await verifyActionPermission();
  await verifyNormalConversion();
  await verifyDuplicateAndIdempotentReplay();
  await verifyUnauthorizedAndMissingConversation();
  await verifyExistingLinkedConversationReplay();
  await verifyConcurrentConversion();
  await verifyNoLegacySideEffects();
  await verifyMigrationContract();

  console.log(`PASS Facebook Inbox F5 DB conversion contract verified in disposable Postgres container ${CONTAINER}`);
} finally {
  if (started) docker(["rm", "-f", CONTAINER], { allowFailure: true });
}

async function readMigration(file) {
  return (await readFile(`supabase/migrations/${file}`, "utf8")).replace(/^\uFEFF/, "");
}

async function applyCoreMigrations() {
  const files = (await readdir("supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => ![F1, F2, F21, F4, F5].includes(name))
    .filter((name) => name < "202608110001_add_master_catalog_m0_foundation.sql")
    .sort();
  if (files.length) {
    await execSql((await Promise.all(files.map((file) => readMigration(file)))).join("\n\n"));
  }
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

async function seedF5Data() {
  await execSql(`
    insert into auth.users (id, email) values
      ('${owner}', 'owner@trry.test'),
      ('${admin}', 'admin@trry.test'),
      ('${cashier}', 'cashier@trry.test');

    insert into public.admin_users (user_id, email, role, access_role_key, display_name, is_active, is_test)
    values
      ('${owner}', 'owner@trry.test', 'owner', 'owner_admin', 'Owner', true, false),
      ('${admin}', 'admin@trry.test', 'admin', 'admin_operations', 'Operations', true, false),
      ('${cashier}', 'cashier@trry.test', 'staff', 'cashier_front_desk', 'Cashier', true, false);

    insert into public.admin_role_module_permissions (role_key, module_key, can_access)
    values
      ('owner_admin', 'inbox', true),
      ('admin_operations', 'inbox', true),
      ('cashier_front_desk', 'inbox', true)
    on conflict (role_key, module_key) do update set can_access = excluded.can_access;

    insert into public.meta_page_connections (id, page_id, page_name, status)
    values ('90000000-0000-4000-8000-000000000001', 'PAGE-F5', 'F5 Page', 'testing');

    insert into public.inbox_contacts (id, display_name, primary_phone, primary_email, company_name)
    values
      ('91000000-0000-4000-8000-000000000001', 'F5 Customer 1', '09171234567', 'one@example.test', 'Messenger Co'),
      ('91000000-0000-4000-8000-000000000002', 'F5 Customer 2', null, null, null),
      ('91000000-0000-4000-8000-000000000003', 'F5 Customer 3', null, null, null);

    insert into public.inbox_channel_identities (id, contact_id, page_connection_id, channel, external_user_id, external_username, display_name)
    values
      ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 'facebook_messenger', 'PSID-F5-1', 'f5customer1', 'F5 Customer 1'),
      ('92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001', 'facebook_messenger', 'PSID-F5-2', 'f5customer2', 'F5 Customer 2'),
      ('92000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000003', '90000000-0000-4000-8000-000000000001', 'facebook_messenger', 'PSID-F5-3', 'f5customer3', 'F5 Customer 3');

    insert into public.inbox_conversations (id, channel_identity_id, state, owner_user_id, last_message_at, last_inbound_at, reply_window_expires_at, referral_ref, campaign_name, ad_name)
    values
      ('${conversation}', '92000000-0000-4000-8000-000000000001', 'needs_reply', '${admin}', now(), now(), now() + interval '2 hours', 'fb-post-1', 'School uniforms', 'Batch tee ad'),
      ('${concurrentConversation}', '92000000-0000-4000-8000-000000000002', 'needs_reply', '${admin}', now(), now(), now() + interval '2 hours', null, null, null),
      ('${existingLinkConversation}', '92000000-0000-4000-8000-000000000003', 'converted', '${admin}', now(), now(), now() + interval '2 hours', null, null, null);

    insert into public.inbox_messages (conversation_id, external_message_id, direction, message_type, body, sender_external_id, sender_user_id, is_echo, sent_at)
    values
      ('${conversation}', 'MID-F5-IN-1', 'inbound', 'text', 'Need 50 embroidered polos next week', 'PSID-F5-1', null, false, now()),
      ('${conversation}', 'MID-F5-OUT-1', 'outbound', 'text', 'We can help.', 'PAGE-F5', '${admin}', true, now()),
      ('${concurrentConversation}', 'MID-F5-IN-2', 'inbound', 'text', 'Need rush DTF shirts', 'PSID-F5-2', null, false, now()),
      ('${existingLinkConversation}', 'MID-F5-IN-3', 'inbound', 'text', 'Already linked', 'PSID-F5-3', null, false, now());

    insert into public.ops_inquiries (id, customer_name, contact, source, message, priority, status, next_action)
    values ('TRY-20260827000000', 'Existing Linked Customer', 'Messenger', 'FB', 'Existing linked inquiry', 'normal', 'new', 'Review inquiry');

    insert into public.inbox_inquiry_links (conversation_id, inquiry_id, converted_by_user_id, idempotency_key)
    values ('${existingLinkConversation}', 'TRY-20260827000000', '${admin}', 'idem-existing-link');
  `);
}

async function verifyActionPermission() {
  const rows = await queryJson(`
    select role_key, action_key, can_perform
    from public.admin_role_action_permissions
    where action_key = 'inbox_convert_to_inquiry'
    order by role_key
  `);
  assert.equal(rows.length, 6);
  assert.equal(rows.find((row) => row.role_key === "owner_admin").can_perform, true);
  assert.equal(rows.find((row) => row.role_key === "admin_operations").can_perform, true);
  assert.equal(rows.find((row) => row.role_key === "cashier_front_desk").can_perform, false);
}

async function verifyNormalConversion() {
  const messageCountBefore = await countMessages(conversation);
  const orderCountBefore = await tableCount("orders");
  const result = await rpc("convert_inbox_conversation_to_inquiry", {
    p_conversation_id: conversation,
    p_actor_user_id: admin,
    p_idempotency_key: "idem-convert-normal",
  });

  assert.equal(result.ok, true);
  assert.equal(result.replay, false);
  assert.match(result.inquiry.id, /^TRY-\d{14}$/);
  assert.equal(result.inquiry.customer, "F5 Customer 1");
  assert.equal(result.inquiry.contact, "09171234567");
  assert.equal(result.inquiry.company, "Messenger Co");
  assert.equal(result.inquiry.source, "FB");
  assert.equal(result.inquiry.channel, "Facebook Messenger");
  assert.equal(result.inquiry.status, "new");
  assert.equal(result.inquiry.next, "Review inquiry");
  assert.equal(result.conversation.state, "converted");

  const link = await single(`select * from public.inbox_inquiry_links where conversation_id = '${conversation}'`);
  assert.equal(link.inquiry_id, result.inquiry.id);
  assert.equal(link.idempotency_key, "idem-convert-normal");
  assert.equal(await countMessages(conversation), messageCountBefore);
  assert.equal(await tableCount("orders"), orderCountBefore);
}

async function verifyDuplicateAndIdempotentReplay() {
  const first = await rpc("convert_inbox_conversation_to_inquiry", {
    p_conversation_id: conversation,
    p_actor_user_id: admin,
    p_idempotency_key: "idem-convert-normal",
  });
  const second = await rpc("convert_inbox_conversation_to_inquiry", {
    p_conversation_id: conversation,
    p_actor_user_id: admin,
    p_idempotency_key: "idem-second-click",
  });
  assert.equal(first.replay, true);
  assert.equal(second.replay, true);
  assert.equal(first.inquiry.id, second.inquiry.id);
  assert.equal((await single(`select count(*)::int as count from public.inbox_inquiry_links where conversation_id = '${conversation}'`)).count, 1);
}

async function verifyUnauthorizedAndMissingConversation() {
  const denied = await rpc("convert_inbox_conversation_to_inquiry", {
    p_conversation_id: concurrentConversation,
    p_actor_user_id: cashier,
    p_idempotency_key: "idem-cashier-denied",
  });
  assert.equal(denied.error, "INBOX_CONVERT_TO_INQUIRY_DENIED");

  const missing = await rpc("convert_inbox_conversation_to_inquiry", {
    p_conversation_id: missingConversation,
    p_actor_user_id: admin,
    p_idempotency_key: "idem-missing-conversation",
  });
  assert.equal(missing.error, "CONVERSATION_NOT_FOUND");
}

async function verifyExistingLinkedConversationReplay() {
  const countBefore = await tableCount("ops_inquiries");
  const result = await rpc("convert_inbox_conversation_to_inquiry", {
    p_conversation_id: existingLinkConversation,
    p_actor_user_id: admin,
    p_idempotency_key: "idem-existing-new-click",
  });
  assert.equal(result.ok, true);
  assert.equal(result.replay, true);
  assert.equal(result.inquiry.id, "TRY-20260827000000");
  assert.equal(await tableCount("ops_inquiries"), countBefore);
}

async function verifyConcurrentConversion() {
  const beforeMessages = await countMessages(concurrentConversation);
  const [a, b] = await Promise.all([
    rpcSpawn("convert_inbox_conversation_to_inquiry", {
      p_conversation_id: concurrentConversation,
      p_actor_user_id: admin,
      p_idempotency_key: "idem-concurrent-a",
    }),
    rpcSpawn("convert_inbox_conversation_to_inquiry", {
      p_conversation_id: concurrentConversation,
      p_actor_user_id: admin,
      p_idempotency_key: "idem-concurrent-b",
    }),
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal((await single(`select count(*)::int as count from public.inbox_inquiry_links where conversation_id = '${concurrentConversation}'`)).count, 1);
  assert.equal((await single(`select count(*)::int as count from public.ops_inquiries inquiry join public.inbox_inquiry_links link on link.inquiry_id = inquiry.id where link.conversation_id = '${concurrentConversation}'`)).count, 1);
  assert.equal(await countMessages(concurrentConversation), beforeMessages);
}

async function verifyNoLegacySideEffects() {
  assert.equal(await tableExists("facebook_messages"), false);
  assert.equal(await tableExists("messenger_messages"), false);
}

async function verifyMigrationContract() {
  const migration = await readFile(`supabase/migrations/${F5}`, "utf8");
  assert.equal(/create\s+table\s+(if\s+not\s+exists\s+)?public\.ops_inquiries/i.test(migration), false, "F5 must not create a parallel Inquiry authority");
  assert.equal(/create\s+table\s+(if\s+not\s+exists\s+)?public\.orders/i.test(migration), false, "F5 must not create or alter Orders");
  assert.ok(migration.includes("pg_advisory_xact_lock"), "F5 RPC must lock conversion by conversation");
  assert.ok(migration.includes("inbox_inquiry_links"), "F5 RPC must link Inbox conversation to Inquiry exactly once");
}

async function rpc(name, args) {
  const rows = await queryJson(`select public.${name}(${Object.values(args).map(sqlValue).join(", ")}) as result`);
  return rows[0].result;
}

async function rpcSpawn(name, args) {
  const sql = `select public.${name}(${Object.values(args).map(sqlValue).join(", ")})::text`;
  const output = await psqlSpawn(["-t", "-A", "-c", sql]);
  return JSON.parse(output.trim());
}

async function countMessages(conversationId) {
  return (await single(`select count(*)::int as count from public.inbox_messages where conversation_id = '${conversationId}'`)).count;
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

function psql(args, input = null) {
  const result = docker(["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DB, "-X", ...args], { input, allowFailure: true });
  if (result.status !== 0) throw new Error(`${result.stderr || result.stdout}`.trim());
  return result.stdout;
}

function psqlSpawn(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DB, "-X", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error((stderr || stdout).trim()));
    });
  });
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
    create schema if not exists auth;
    create schema if not exists storage;
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
    end $$;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz not null default now());
    create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
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
