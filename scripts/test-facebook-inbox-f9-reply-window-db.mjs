import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const CONTAINER = `trry-facebook-inbox-f9-reply-window-db-${process.pid}`;
const IMAGE = process.env.TRRY_VERIFY_POSTGRES_IMAGE || "postgres:16-alpine";
const DB = "trry_verify";
const F1 = "202608250001_add_facebook_inbox_f1_foundation.sql";
const F2 = "202608250002_add_facebook_inbox_f2_receive_indexes.sql";
const F21 = "202608250003_add_facebook_inbox_f2_transactional_ingestion.sql";
const F4 = "202608260001_add_facebook_inbox_f4_reply_ownership.sql";
const F5 = "202608270001_add_facebook_inbox_f5_inquiry_bridge.sql";
const F6 = "202608270002_add_facebook_inbox_f6_send_reconciliation.sql";
const F98 = "202608280001_add_facebook_inbox_f9_reply_window_ingestion.sql";

const admin = "98000000-0000-4000-8000-000000000002";
const conversation = "99000000-0000-4000-8000-000000000098";

let started = false;

try {
  docker(["run", "--rm", "-d", "--name", CONTAINER, "-e", "POSTGRES_PASSWORD=postgres", "-e", `POSTGRES_DB=${DB}`, IMAGE]);
  started = true;
  waitForPostgres();
  await execSql(supabaseHarnessSql());
  await applyCoreMigrations();
  await installPeopleAccessPrerequisite();
  await execSql((await Promise.all([F1, F2, F21, F4, F5, F6, F98].map((file) => readMigration(file)))).join("\n\n"));
  await seedData();

  await verifyFreshInboundExtendsReplyWindow();
  await verifyNewerInboundExtendsReplyWindow();
  await verifyOutOfOrderInboundCannotShortenWindow();
  await verifyDuplicateWebhookDoesNotExtendOrDuplicate();
  await verifyOutboundEchoDeliveryReadAndStaffReplyDoNotExtendWindow();
  await verifyReserveGuardAllowsBeforeExpiry();
  await verifyReserveGuardBlocksAfterExpiry();
  await verifyMigrationSafetyContract();

  console.log(`PASS Facebook Inbox F9.8A reply-window ingestion contract verified in disposable Postgres container ${CONTAINER}`);
} finally {
  if (started) docker(["rm", "-f", CONTAINER], { allowFailure: true });
}

async function seedData() {
  await execSql(`
    insert into auth.users (id, email) values ('${admin}', 'admin@trry.test');

    insert into public.admin_users (user_id, email, role, access_role_key, display_name, is_active, is_test)
    values ('${admin}', 'admin@trry.test', 'admin', 'admin_operations', 'Operations', true, false);

    insert into public.admin_role_module_permissions (role_key, module_key, can_access)
    values ('admin_operations', 'inbox', true)
    on conflict (role_key, module_key) do update set can_access = excluded.can_access;

    insert into public.meta_page_connections (id, page_id, page_name, status)
    values ('90000000-0000-4000-8000-000000009800', 'PAGE-F98', 'F98 Page', 'testing');

    insert into public.inbox_contacts (id, display_name)
    values ('91000000-0000-4000-8000-000000009800', 'F98 Customer');

    insert into public.inbox_channel_identities (id, contact_id, page_connection_id, channel, external_user_id)
    values (
      '92000000-0000-4000-8000-000000009800',
      '91000000-0000-4000-8000-000000009800',
      '90000000-0000-4000-8000-000000009800',
      'facebook_messenger',
      'PSID-F98'
    );

    insert into public.inbox_conversations (
      id, channel_identity_id, state, owner_user_id, last_message_at, last_inbound_at, last_outbound_at, reply_window_expires_at
    )
    values (
      '${conversation}',
      '92000000-0000-4000-8000-000000009800',
      'waiting',
      '${admin}',
      '2026-08-27T23:00:00Z',
      '2026-08-27T23:00:00Z',
      null,
      '2026-08-28T00:10:00Z'
    );
  `);
}

async function verifyFreshInboundExtendsReplyWindow() {
  await ingest([inboundEvent({ mid: "MID-F98-INBOUND-1", text: "fresh customer message", eventTime: "2026-08-28T01:00:00.000Z" })]);
  const row = await conversationRow();
  assert.equal(row.state, "needs_reply");
  assert.equal(row.last_message_at, "2026-08-28T01:00:00+00:00");
  assert.equal(row.last_inbound_at, "2026-08-28T01:00:00+00:00");
  assert.equal(row.reply_window_expires_at, "2026-08-29T01:00:00+00:00");
}

async function verifyNewerInboundExtendsReplyWindow() {
  await ingest([inboundEvent({ mid: "MID-F98-INBOUND-2", text: "newer customer message", eventTime: "2026-08-28T02:00:00.000Z" })]);
  const row = await conversationRow();
  assert.equal(row.last_message_at, "2026-08-28T02:00:00+00:00");
  assert.equal(row.last_inbound_at, "2026-08-28T02:00:00+00:00");
  assert.equal(row.reply_window_expires_at, "2026-08-29T02:00:00+00:00");
}

async function verifyOutOfOrderInboundCannotShortenWindow() {
  await ingest([inboundEvent({ mid: "MID-F98-INBOUND-OLDER", text: "older customer message", eventTime: "2026-08-28T00:30:00.000Z" })]);
  const row = await conversationRow();
  assert.equal(row.last_message_at, "2026-08-28T02:00:00+00:00");
  assert.equal(row.last_inbound_at, "2026-08-28T02:00:00+00:00");
  assert.equal(row.reply_window_expires_at, "2026-08-29T02:00:00+00:00");
}

async function verifyDuplicateWebhookDoesNotExtendOrDuplicate() {
  const before = await conversationRow();
  const result = await ingest([inboundEvent({ mid: "MID-F98-INBOUND-2", text: "duplicate customer message", eventTime: "2026-08-28T02:00:00.000Z" })]);
  assert.equal(result.duplicates, 1);
  assert.equal((await single(`select count(*)::int as count from public.inbox_messages where external_message_id = 'MID-F98-INBOUND-2'`)).count, 1);
  assert.deepEqual(await conversationRow(), before);
}

async function verifyOutboundEchoDeliveryReadAndStaffReplyDoNotExtendWindow() {
  const before = await conversationRow();
  await ingest([echoEvent({ mid: "MID-F98-ECHO", text: "staff echo", eventTime: "2026-08-28T03:00:00.000Z" })]);
  assert.equal((await conversationRow()).reply_window_expires_at, before.reply_window_expires_at);

  await ingest([deliveryEvent({ eventKey: "meta:delivery:F98", eventTime: "2026-08-28T04:00:00.000Z" })]);
  assert.equal((await conversationRow()).reply_window_expires_at, before.reply_window_expires_at);

  await ingest([readEvent({ eventKey: "meta:read:F98", eventTime: "2026-08-28T05:00:00.000Z" })]);
  assert.equal((await conversationRow()).reply_window_expires_at, before.reply_window_expires_at);

  await execSql(`
    insert into public.inbox_messages (conversation_id, provider, external_message_id, direction, message_type, body, sender_user_id, is_echo, sent_at)
    values ('${conversation}', 'meta', 'MID-F98-STAFF-OUT', 'outbound', 'text', 'direct staff reply', '${admin}', false, '2026-08-28T06:00:00Z');
  `);
  const afterStaffReply = await conversationRow();
  assert.equal(afterStaffReply.reply_window_expires_at, before.reply_window_expires_at);
  assert.equal(afterStaffReply.last_outbound_at, "2026-08-28T06:00:00+00:00");
}

async function verifyReserveGuardAllowsBeforeExpiry() {
  await execSql(`update public.inbox_conversations set reply_window_expires_at = now() + interval '1 hour' where id = '${conversation}'`);
  const result = await rpc("reserve_inbox_reply", {
    p_conversation_id: conversation,
    p_actor_user_id: admin,
    p_idempotency_key: "idem-f98-before-expiry",
    p_body_hash: "hash-f98-before-expiry",
    p_expected_updated_at: null,
  });
  assert.equal(result.ok, true);
  assert.equal(result.conversationId, conversation);
}

async function verifyReserveGuardBlocksAfterExpiry() {
  await execSql(`update public.inbox_conversations set reply_window_expires_at = now() - interval '1 minute' where id = '${conversation}'`);
  const result = await rpc("reserve_inbox_reply", {
    p_conversation_id: conversation,
    p_actor_user_id: admin,
    p_idempotency_key: "idem-f98-after-expiry",
    p_body_hash: "hash-f98-after-expiry",
    p_expected_updated_at: null,
  });
  assert.equal(result.error, "REPLY_WINDOW_CLOSED");
}

async function verifyMigrationSafetyContract() {
  const migration = await readMigration(F98);
  assert.ok(migration.includes("coalesce(new.is_echo, false) = false"), "reply window must require a non-echo customer inbound message");
  assert.ok(migration.includes("latest_customer_inbound"), "migration must backfill from canonical inbox_messages");
  assert.equal(/create\s+table|alter\s+table/i.test(migration), false, "F9.8A must not add or alter schema");
  const reserve = await readMigration(F4);
  assert.ok(reserve.includes("reply_window_expires_at is null or conversation_row.reply_window_expires_at <= now()"), "reserve guard must remain strict");
}

async function ingest(events) {
  const rows = await queryJson(`select public.ingest_meta_messenger_events('${JSON.stringify(events).replaceAll("'", "''")}'::jsonb, now(), 'page') as result`);
  return rows[0].result;
}

function inboundEvent({ mid, text, eventTime }) {
  return normalizedEvent({ mid, text, eventTime, direction: "inbound", isEcho: false, eventType: "message", conversationState: "needs_reply" });
}

function echoEvent({ mid, text, eventTime }) {
  return normalizedEvent({ mid, text, eventTime, direction: "outbound", isEcho: true, eventType: "message_echo", conversationState: "waiting" });
}

function deliveryEvent({ eventKey, eventTime }) {
  return {
    eventKey,
    pageId: "PAGE-F98",
    eventType: "delivery",
    raw: { delivery: { mids: ["MID-F98-ECHO"] } },
    eventTime,
    shouldProcess: true,
    customerPsid: "PSID-F98",
    customerDisplayName: "",
    conversationState: "waiting",
    message: null,
    attachments: [],
    delivery: { messageIds: ["MID-F98-ECHO"] },
    read: false,
    referralAttribution: null,
  };
}

function readEvent({ eventKey, eventTime }) {
  return {
    eventKey,
    pageId: "PAGE-F98",
    eventType: "read",
    raw: { read: { watermark: Date.parse(eventTime) } },
    eventTime,
    shouldProcess: true,
    customerPsid: "PSID-F98",
    customerDisplayName: "",
    conversationState: "waiting",
    message: null,
    attachments: [],
    delivery: null,
    read: true,
    referralAttribution: null,
  };
}

function normalizedEvent({ mid, text, eventTime, direction, isEcho, eventType, conversationState }) {
  const page = "PAGE-F98";
  const psid = "PSID-F98";
  return {
    eventKey: `meta:message:${mid}`,
    pageId: page,
    eventType,
    raw: {
      sender: { id: isEcho ? page : psid },
      recipient: { id: isEcho ? psid : page },
      message: { mid, text, is_echo: isEcho },
    },
    eventTime,
    shouldProcess: true,
    customerPsid: psid,
    customerDisplayName: "",
    conversationState,
    message: {
      externalMessageId: mid,
      direction,
      messageType: "text",
      body: text,
      senderExternalId: isEcho ? page : psid,
      isEcho,
      metadata: {},
    },
    attachments: [],
    delivery: null,
    read: null,
    referralAttribution: null,
  };
}

async function conversationRow() {
  return single(`
    select state, last_message_at, last_inbound_at, last_outbound_at, reply_window_expires_at
    from public.inbox_conversations
    where id = '${conversation}'
  `);
}

async function rpc(name, params) {
  const pairs = Object.entries(params).map(([key, value]) => `${key} => ${value === null ? "null" : `'${String(value).replaceAll("'", "''")}'`}`);
  const rows = await queryJson(`select public.${name}(${pairs.join(", ")}) as result`);
  return rows[0].result;
}

async function readMigration(file) {
  return (await readFile(`supabase/migrations/${file}`, "utf8")).replace(/^\uFEFF/, "");
}

async function applyCoreMigrations() {
  const files = (await readdir("supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => ![F1, F2, F21, F4, F5, F6, F98].includes(name))
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
