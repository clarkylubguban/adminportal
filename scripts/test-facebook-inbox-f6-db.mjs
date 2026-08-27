import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const CONTAINER = `trry-facebook-inbox-f6-db-${process.pid}`;
const IMAGE = process.env.TRRY_VERIFY_POSTGRES_IMAGE || "postgres:16-alpine";
const DB = "trry_verify";
const F1 = "202608250001_add_facebook_inbox_f1_foundation.sql";
const F2 = "202608250002_add_facebook_inbox_f2_receive_indexes.sql";
const F21 = "202608250003_add_facebook_inbox_f2_transactional_ingestion.sql";
const F4 = "202608260001_add_facebook_inbox_f4_reply_ownership.sql";
const F5 = "202608270001_add_facebook_inbox_f5_inquiry_bridge.sql";
const F6 = "202608270002_add_facebook_inbox_f6_send_reconciliation.sql";

const admin = "98000000-0000-4000-8000-000000000002";
const conversation = "99000000-0000-4000-8000-000000000001";
const wrongConversation = "99000000-0000-4000-8000-000000000002";
const successConversation = "99000000-0000-4000-8000-000000000003";
const inboundConversation = "99000000-0000-4000-8000-000000000004";
const ambiguousConversation = "99000000-0000-4000-8000-000000000005";

let started = false;

try {
  docker(["run", "--rm", "-d", "--name", CONTAINER, "-e", "POSTGRES_PASSWORD=postgres", "-e", `POSTGRES_DB=${DB}`, IMAGE]);
  started = true;
  waitForPostgres();
  await execSql(supabaseHarnessSql());
  await applyCoreMigrations();
  await installPeopleAccessPrerequisite();
  await execSql((await Promise.all([F1, F2, F21, F4, F5, F6].map((file) => readMigration(file)))).join("\n\n"));
  await seedF6Data();

  await verifyUnknownMatchingEchoReconciles();
  await verifyDuplicateEchoIsIdempotent();
  await verifySuccessfulSendEchoDoesNotDuplicate();
  await verifyBodyMismatchStaysUnknown();
  await verifyWrongConversationStaysUnknown();
  await verifyInboundMessageNeverReconciles();
  await verifyAmbiguousMatchStaysUnknown();
  await verifySecurityContract();

  console.log(`PASS Facebook Inbox F6 DB reconciliation contract verified in disposable Postgres container ${CONTAINER}`);
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

async function seedF6Data() {
  await execSql(`
    insert into auth.users (id, email) values ('${admin}', 'admin@trry.test');
    insert into public.admin_users (user_id, email, role, access_role_key, display_name, is_active, is_test)
    values ('${admin}', 'admin@trry.test', 'admin', 'admin_operations', 'Operations', true, false);

    insert into public.admin_role_module_permissions (role_key, module_key, can_access)
    values ('admin_operations', 'inbox', true)
    on conflict (role_key, module_key) do update set can_access = excluded.can_access;

    insert into public.meta_page_connections (id, page_id, page_name, status)
    values ('90000000-0000-4000-8000-000000000001', 'PAGE-F6', 'F6 Page', 'testing');

    insert into public.inbox_contacts (id, display_name)
    values
      ('91000000-0000-4000-8000-000000000001', 'F6 Customer 1'),
      ('91000000-0000-4000-8000-000000000002', 'F6 Customer 2'),
      ('91000000-0000-4000-8000-000000000003', 'F6 Customer 3'),
      ('91000000-0000-4000-8000-000000000004', 'F6 Customer 4'),
      ('91000000-0000-4000-8000-000000000005', 'F6 Customer 5');

    insert into public.inbox_channel_identities (id, contact_id, page_connection_id, channel, external_user_id)
    values
      ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 'facebook_messenger', 'PSID-F6-1'),
      ('92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001', 'facebook_messenger', 'PSID-F6-2'),
      ('92000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000003', '90000000-0000-4000-8000-000000000001', 'facebook_messenger', 'PSID-F6-3'),
      ('92000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000004', '90000000-0000-4000-8000-000000000001', 'facebook_messenger', 'PSID-F6-4'),
      ('92000000-0000-4000-8000-000000000005', '91000000-0000-4000-8000-000000000005', '90000000-0000-4000-8000-000000000001', 'facebook_messenger', 'PSID-F6-5');

    insert into public.inbox_conversations (id, channel_identity_id, state, owner_user_id, last_message_at, reply_window_expires_at)
    values
      ('${conversation}', '92000000-0000-4000-8000-000000000001', 'waiting', '${admin}', now(), now() + interval '2 hours'),
      ('${wrongConversation}', '92000000-0000-4000-8000-000000000002', 'waiting', '${admin}', now(), now() + interval '2 hours'),
      ('${successConversation}', '92000000-0000-4000-8000-000000000003', 'waiting', '${admin}', now(), now() + interval '2 hours'),
      ('${inboundConversation}', '92000000-0000-4000-8000-000000000004', 'waiting', '${admin}', now(), now() + interval '2 hours'),
      ('${ambiguousConversation}', '92000000-0000-4000-8000-000000000005', 'waiting', '${admin}', now(), now() + interval '2 hours');

    insert into public.inbox_outbound_attempts (conversation_id, actor_user_id, idempotency_key, body_hash, status, started_at)
    values
      ('${conversation}', '${admin}', 'idem-f6-unknown', '${hash("Please confirm sizes")}', 'unknown', now() - interval '1 minute'),
      ('${wrongConversation}', '${admin}', 'idem-f6-wrong-conversation', '${hash("Please confirm sizes")}', 'unknown', now() - interval '1 minute'),
      ('${successConversation}', '${admin}', 'idem-f6-sent', '${hash("Already sent")}', 'sent', now() - interval '1 minute'),
      ('${inboundConversation}', '${admin}', 'idem-f6-inbound', '${hash("Customer says same text")}', 'unknown', now() - interval '1 minute'),
      ('${ambiguousConversation}', '${admin}', 'idem-f6-ambiguous-a', '${hash("Ambiguous text")}', 'unknown', now() - interval '1 minute');

    update public.inbox_outbound_attempts
    set external_message_id = 'MID-F6-SENT',
        completed_at = now()
    where idempotency_key = 'idem-f6-sent';

    insert into public.inbox_messages (conversation_id, provider, external_message_id, direction, message_type, body, sender_user_id, is_echo, sent_at)
    values ('${successConversation}', 'meta', 'MID-F6-SENT', 'outbound', 'text', 'Already sent', '${admin}', false, now());
  `);
}

async function verifyUnknownMatchingEchoReconciles() {
  const result = await ingest([echoEvent({ psid: "PSID-F6-1", mid: "MID-F6-ECHO-1", text: "Please confirm sizes" })]);
  assert.equal(result.processed, 1);
  assert.equal(result.reconciled, 1);
  const attempt = await attemptByKey("idem-f6-unknown");
  assert.equal(attempt.status, "sent");
  assert.equal(attempt.external_message_id, "MID-F6-ECHO-1");
  assert.ok(attempt.completed_at);
  assert.equal((await single(`select count(*)::int as count from public.inbox_messages where external_message_id = 'MID-F6-ECHO-1'`)).count, 1);
  assert.equal((await sendState(conversation)), "sent");
}

async function verifyDuplicateEchoIsIdempotent() {
  const result = await ingest([echoEvent({ psid: "PSID-F6-1", mid: "MID-F6-ECHO-1", text: "Please confirm sizes" })]);
  assert.equal(result.duplicates, 1);
  assert.equal(result.reconciled, 0);
  assert.equal((await single(`select count(*)::int as count from public.inbox_messages where external_message_id = 'MID-F6-ECHO-1'`)).count, 1);
  assert.equal((await attemptByKey("idem-f6-unknown")).status, "sent");
}

async function verifySuccessfulSendEchoDoesNotDuplicate() {
  const result = await ingest([echoEvent({ psid: "PSID-F6-3", mid: "MID-F6-SENT", text: "Already sent" })]);
  assert.equal(result.processed, 1);
  assert.equal(result.reconciled, 0);
  assert.equal((await single(`select count(*)::int as count from public.inbox_messages where external_message_id = 'MID-F6-SENT'`)).count, 1);
  const attempt = await attemptByKey("idem-f6-sent");
  assert.equal(attempt.status, "sent");
  assert.equal(attempt.external_message_id, "MID-F6-SENT");
}

async function verifyBodyMismatchStaysUnknown() {
  await ingest([echoEvent({ psid: "PSID-F6-2", mid: "MID-F6-WRONG-BODY", text: "Different body" })]);
  const attempt = await attemptByKey("idem-f6-wrong-conversation");
  assert.equal(attempt.status, "unknown");
  assert.equal(attempt.external_message_id, null);
}

async function verifyWrongConversationStaysUnknown() {
  const result = await ingest([echoEvent({ psid: "PSID-F6-1", mid: "MID-F6-WRONG-CONV", text: "Please confirm sizes" })]);
  assert.equal(result.reconciled, 0);
  const attempt = await attemptByKey("idem-f6-wrong-conversation");
  assert.equal(attempt.conversation_id, wrongConversation);
  assert.equal(attempt.status, "unknown");
  assert.equal(attempt.external_message_id, null);
  assert.equal((await single(`select conversation_id from public.inbox_messages where external_message_id = 'MID-F6-WRONG-CONV'`)).conversation_id, conversation);
}

async function verifyInboundMessageNeverReconciles() {
  await ingest([inboundEvent({ psid: "PSID-F6-4", mid: "MID-F6-INBOUND", text: "Customer says same text" })]);
  const attempt = await attemptByKey("idem-f6-inbound");
  assert.equal(attempt.status, "unknown");
  assert.equal(attempt.external_message_id, null);
}

async function verifyAmbiguousMatchStaysUnknown() {
  await execSql(`
    drop index public.inbox_outbound_attempts_active_conversation_uidx;
    insert into public.inbox_outbound_attempts (conversation_id, actor_user_id, idempotency_key, body_hash, status, started_at)
    values ('${ambiguousConversation}', '${admin}', 'idem-f6-ambiguous-b', '${hash("Ambiguous text")}', 'unknown', now() - interval '1 minute');
  `);
  const result = await ingest([echoEvent({ psid: "PSID-F6-5", mid: "MID-F6-AMBIGUOUS", text: "Ambiguous text" })]);
  assert.equal(result.reconciled, 0);
  for (const key of ["idem-f6-ambiguous-a", "idem-f6-ambiguous-b"]) {
    const attempt = await attemptByKey(key);
    assert.equal(attempt.status, "unknown");
    assert.equal(attempt.external_message_id, null);
  }
}

async function verifySecurityContract() {
  const grants = await queryJson(`
    select privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'inbox_outbound_attempts'
      and grantee in ('anon','authenticated')
  `);
  assert.deepEqual(grants, []);

  const migration = await readFile(`supabase/migrations/${F6}`, "utf8");
  assert.equal(/alter\s+table\s+public\.inbox_outbound_attempts/i.test(migration), false, "F6 must not alter outbound-attempt schema");
  assert.equal(/grant\s+select\s+on\s+table\s+public\.inbox_outbound_attempts\s+to\s+authenticated/i.test(migration), false, "F6 must not expose outbound attempts");
  assert.equal(/sendMetaTextMessage|META_PAGE_ACCESS_TOKEN/i.test(migration), false, "F6 migration must not send or expose Meta secrets");
}

async function ingest(events) {
  const rows = await queryJson(`select public.ingest_meta_messenger_events('${JSON.stringify(events).replaceAll("'", "''")}'::jsonb, now(), 'page') as result`);
  return rows[0].result;
}

function echoEvent({ psid, mid, text }) {
  return normalizedEvent({ psid, mid, text, isEcho: true });
}

function inboundEvent({ psid, mid, text }) {
  return normalizedEvent({ psid, mid, text, isEcho: false });
}

function normalizedEvent({ psid, mid, text, isEcho }) {
  const page = "PAGE-F6";
  return {
    eventKey: `meta:message:${mid}`,
    pageId: page,
    eventType: isEcho ? "message_echo" : "message",
    raw: {
      sender: { id: isEcho ? page : psid },
      recipient: { id: isEcho ? psid : page },
      message: { mid, text, is_echo: isEcho },
    },
    eventTime: new Date().toISOString(),
    shouldProcess: true,
    customerPsid: psid,
    customerDisplayName: "",
    conversationState: isEcho ? "waiting" : "needs_reply",
    message: {
      externalMessageId: mid,
      direction: isEcho ? "outbound" : "inbound",
      messageType: "text",
      body: text,
      bodyHash: isEcho ? hash(text) : null,
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

async function sendState(conversationId) {
  const row = await single(`
    select coalesce((
      select status
      from public.inbox_outbound_attempts
      where conversation_id = '${conversationId}'
        and status in ('sending','unknown','failed','sent')
      order by created_at desc
      limit 1
    ), 'none') as status
  `);
  return row.status;
}

async function attemptByKey(key) {
  return single(`select * from public.inbox_outbound_attempts where idempotency_key = '${key}'`);
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

function hash(value) {
  return createHash("sha256").update(String(value || "").trim()).digest("hex");
}
