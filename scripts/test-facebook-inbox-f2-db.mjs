import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";

const CONTAINER = `trry-facebook-inbox-f2-db-${process.pid}`;
const IMAGE = process.env.TRRY_VERIFY_POSTGRES_IMAGE || "postgres:16-alpine";
const DB = "trry_verify";
const F1_MIGRATION = "202608250001_add_facebook_inbox_f1_foundation.sql";
const F2_MIGRATION = "202608250002_add_facebook_inbox_f2_receive_indexes.sql";
const F21_MIGRATION = "202608250003_add_facebook_inbox_f2_transactional_ingestion.sql";

let started = false;

try {
  docker(["run", "--rm", "-d", "--name", CONTAINER, "-e", "POSTGRES_PASSWORD=postgres", "-e", `POSTGRES_DB=${DB}`, IMAGE]);
  started = true;
  waitForPostgres();

  await execSql(supabaseHarnessSql());
  await applyMigrationsBeforeF1();
  await installPeopleAccessPrerequisite();
  await seedCoreBaseline();
  await execSql(await readFile(`supabase/migrations/${F1_MIGRATION}`, "utf8"));
  await execSql(await readFile(`supabase/migrations/${F2_MIGRATION}`, "utf8"));
  await execSql(await readFile(`supabase/migrations/${F21_MIGRATION}`, "utf8"));

  const indexes = await queryJson(`
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'inbox_conversations_owner_user_id_idx',
        'inbox_messages_sender_user_id_idx',
        'inbox_conversation_notes_created_by_user_id_idx',
        'inbox_conversation_events_actor_user_id_idx',
        'inbox_inquiry_links_converted_by_user_id_idx'
      )
    order by indexname
  `);
  assert.deepEqual(indexes.map((row) => row.indexname), [
    "inbox_conversation_events_actor_user_id_idx",
    "inbox_conversation_notes_created_by_user_id_idx",
    "inbox_conversations_owner_user_id_idx",
    "inbox_inquiry_links_converted_by_user_id_idx",
    "inbox_messages_sender_user_id_idx",
  ]);

  await assertRpcPermissions();
  await assertTransactionalRpcBehavior();
  await assertConcurrentRpcIdempotency();
  assert.deepEqual(await coreCounts(), { ops_inquiries: 28, orders: 9, admin_users: 10 });
  console.log(`PASS Facebook Inbox F2 DB index and transactional RPC contract verified in disposable Postgres container ${CONTAINER}`);
} finally {
  if (started) docker(["rm", "-f", CONTAINER], { allowFailure: true });
}

async function assertRpcPermissions() {
  await execSql(`
    set role service_role;
    select public.ingest_meta_messenger_events('[]'::jsonb, '2026-08-25T12:00:00Z'::timestamptz, 'page');
    reset role;
  `);

  const denied = psql([
    "-v", "ON_ERROR_STOP=1", "-q", "-c",
    "set role authenticated; select public.ingest_meta_messenger_events('[]'::jsonb, '2026-08-25T12:00:00Z'::timestamptz, 'page');",
  ], { allowFailure: true });
  assert.notEqual(denied.status, 0);
  assert.match(`${denied.stderr}${denied.stdout}`, /permission denied/i);
}

async function assertTransactionalRpcBehavior() {
  await execSql(`
    set role service_role;

    select public.ingest_meta_messenger_events(
      $json$[
        {
          "eventKey":"meta:message:MID-RPC-INBOUND",
          "pageId":"PAGE-RPC",
          "eventType":"message",
          "raw":{"sender":{"id":"PSID-RPC"},"recipient":{"id":"PAGE-RPC"},"timestamp":1787654321000,"message":{"mid":"MID-RPC-INBOUND","text":"hello"}},
          "eventTime":"2026-08-25T10:38:41.000Z",
          "shouldProcess":true,
          "customerPsid":"PSID-RPC",
          "customerDisplayName":"",
          "conversationState":"needs_reply",
          "message":{"externalMessageId":"MID-RPC-INBOUND","direction":"inbound","messageType":"text","body":"hello","senderExternalId":"PSID-RPC","isEcho":false,"metadata":{"rawMessage":{"mid":"MID-RPC-INBOUND","text":"hello"},"standby":false}},
          "attachments":[],
          "delivery":null,
          "read":false,
          "referralAttribution":null
        }
      ]$json$::jsonb,
      '2026-08-25T12:00:00Z'::timestamptz,
      'page'
    );

    select public.ingest_meta_messenger_events(
      $json$[
        {
          "eventKey":"meta:message:MID-RPC-INBOUND",
          "pageId":"PAGE-RPC",
          "eventType":"message",
          "raw":{"sender":{"id":"PSID-RPC"},"recipient":{"id":"PAGE-RPC"},"timestamp":1787654321000,"message":{"mid":"MID-RPC-INBOUND","text":"hello"}},
          "eventTime":"2026-08-25T10:38:41.000Z",
          "shouldProcess":true,
          "customerPsid":"PSID-RPC",
          "customerDisplayName":"",
          "conversationState":"needs_reply",
          "message":{"externalMessageId":"MID-RPC-INBOUND","direction":"inbound","messageType":"text","body":"hello","senderExternalId":"PSID-RPC","isEcho":false,"metadata":{"rawMessage":{"mid":"MID-RPC-INBOUND","text":"hello"},"standby":false}},
          "attachments":[],
          "delivery":null,
          "read":false,
          "referralAttribution":null
        },
        {
          "eventKey":"meta:message:MID-RPC-DUP-MID",
          "pageId":"PAGE-RPC",
          "eventType":"message",
          "raw":{"sender":{"id":"PSID-RPC"},"recipient":{"id":"PAGE-RPC"},"timestamp":1787654321000,"message":{"mid":"MID-RPC-INBOUND","text":"hello again"}},
          "eventTime":"2026-08-25T10:38:41.000Z",
          "shouldProcess":true,
          "customerPsid":"PSID-RPC",
          "customerDisplayName":"",
          "conversationState":"needs_reply",
          "message":{"externalMessageId":"MID-RPC-INBOUND","direction":"inbound","messageType":"text","body":"hello again","senderExternalId":"PSID-RPC","isEcho":false,"metadata":{"rawMessage":{"mid":"MID-RPC-INBOUND","text":"hello again"},"standby":false}},
          "attachments":[],
          "delivery":null,
          "read":false,
          "referralAttribution":null
        }
      ]$json$::jsonb,
      '2026-08-25T12:00:00Z'::timestamptz,
      'page'
    );

    select public.ingest_meta_messenger_events(
      $json$[
        {
          "eventKey":"meta:message:MID-RPC-ECHO",
          "pageId":"PAGE-RPC",
          "eventType":"message_echo",
          "raw":{"sender":{"id":"PAGE-RPC"},"recipient":{"id":"PSID-RPC"},"timestamp":1787654381000,"message":{"mid":"MID-RPC-ECHO","text":"reply","is_echo":true}},
          "eventTime":"2026-08-25T10:39:41.000Z",
          "shouldProcess":true,
          "customerPsid":"PSID-RPC",
          "customerDisplayName":"",
          "conversationState":"waiting",
          "message":{"externalMessageId":"MID-RPC-ECHO","direction":"outbound","messageType":"text","body":"reply","senderExternalId":"PAGE-RPC","isEcho":true,"metadata":{"rawMessage":{"mid":"MID-RPC-ECHO","text":"reply","is_echo":true},"standby":false}},
          "attachments":[],
          "delivery":null,
          "read":false,
          "referralAttribution":null
        },
        {
          "eventKey":"meta:delivery:RPC",
          "pageId":"PAGE-RPC",
          "eventType":"delivery",
          "raw":{"sender":{"id":"PSID-RPC"},"recipient":{"id":"PAGE-RPC"},"timestamp":1787654441000,"delivery":{"mids":["MID-RPC-ECHO"],"watermark":1787654441000}},
          "eventTime":"2026-08-25T10:40:41.000Z",
          "shouldProcess":true,
          "customerPsid":"PSID-RPC",
          "customerDisplayName":"",
          "conversationState":"waiting",
          "message":null,
          "attachments":[],
          "delivery":{"messageIds":["MID-RPC-ECHO"]},
          "read":false,
          "referralAttribution":null
        },
        {
          "eventKey":"meta:read:RPC",
          "pageId":"PAGE-RPC",
          "eventType":"read",
          "raw":{"sender":{"id":"PSID-RPC"},"recipient":{"id":"PAGE-RPC"},"timestamp":1787654501000,"read":{"watermark":1787654501000}},
          "eventTime":"2026-08-25T10:41:41.000Z",
          "shouldProcess":true,
          "customerPsid":"PSID-RPC",
          "customerDisplayName":"",
          "conversationState":"waiting",
          "message":null,
          "attachments":[],
          "delivery":null,
          "read":true,
          "referralAttribution":null
        },
        {
          "eventKey":"meta:read:RPC-OLDER",
          "pageId":"PAGE-RPC",
          "eventType":"read",
          "raw":{"sender":{"id":"PSID-RPC"},"recipient":{"id":"PAGE-RPC"},"timestamp":1787654300000,"read":{"watermark":1787654300000}},
          "eventTime":"2026-08-25T10:38:20.000Z",
          "shouldProcess":true,
          "customerPsid":"PSID-RPC",
          "customerDisplayName":"",
          "conversationState":"waiting",
          "message":null,
          "attachments":[],
          "delivery":null,
          "read":true,
          "referralAttribution":null
        },
        {
          "eventKey":"meta:referral:RPC",
          "pageId":"PAGE-RPC",
          "eventType":"referral",
          "raw":{"sender":{"id":"PSID-RPC"},"recipient":{"id":"PAGE-RPC"},"timestamp":1787654561000,"referral":{"source":"ADS","ref":"rpc-ref","ad_id":"AD-RPC"}},
          "eventTime":"2026-08-25T10:42:41.000Z",
          "shouldProcess":true,
          "customerPsid":"PSID-RPC",
          "customerDisplayName":"",
          "conversationState":"needs_reply",
          "message":null,
          "attachments":[],
          "delivery":null,
          "read":false,
          "referralAttribution":{"entrySource":"ADS","ref":"rpc-ref","adId":"AD-RPC","adName":null,"campaignId":null,"campaignName":null,"raw":{"source":"ADS","ref":"rpc-ref","ad_id":"AD-RPC"}}
        },
        {
          "eventKey":"meta:message:MID-RPC-ATTACH",
          "pageId":"PAGE-RPC",
          "eventType":"message",
          "raw":{"sender":{"id":"PSID-RPC"},"recipient":{"id":"PAGE-RPC"},"timestamp":1787654621000,"message":{"mid":"MID-RPC-ATTACH","attachments":[{"type":"image","payload":{"attachment_id":"ATT-RPC","url":"https://example.invalid/rpc-image.jpg","mime_type":"image/jpeg"}}]}},
          "eventTime":"2026-08-25T10:43:41.000Z",
          "shouldProcess":true,
          "customerPsid":"PSID-RPC",
          "customerDisplayName":"",
          "conversationState":"needs_reply",
          "message":{"externalMessageId":"MID-RPC-ATTACH","direction":"inbound","messageType":"image","body":null,"senderExternalId":"PSID-RPC","isEcho":false,"metadata":{"rawMessage":{"mid":"MID-RPC-ATTACH"},"standby":false}},
          "attachments":[{"externalAttachmentId":"ATT-RPC","attachmentType":"image","sourceUrl":"https://example.invalid/rpc-image.jpg","originalFilename":null,"mimeType":"image/jpeg","metadata":{"pendingPrivateIngestion":true}}],
          "delivery":null,
          "read":false,
          "referralAttribution":null
        },
        {
          "eventKey":"meta:unknown:RPC",
          "pageId":"PAGE-RPC",
          "eventType":"unknown",
          "raw":{"sender":{"id":"PSID-RPC"},"recipient":{"id":"PAGE-RPC"},"reaction":{"action":"react"}},
          "eventTime":"2026-08-25T10:44:41.000Z",
          "shouldProcess":false,
          "customerPsid":"PSID-RPC",
          "customerDisplayName":"",
          "conversationState":"needs_reply",
          "message":null,
          "attachments":[],
          "delivery":null,
          "read":false,
          "referralAttribution":null
        }
      ]$json$::jsonb,
      '2026-08-25T12:00:00Z'::timestamptz,
      'page'
    );

    reset role;
  `);

  const result = await single(`
    select
      (select count(*)::int from public.meta_page_connections where page_id = 'PAGE-RPC') as pages,
      (select count(*)::int from public.inbox_channel_identities where external_user_id = 'PSID-RPC') as identities,
      (select count(*)::int from public.inbox_contacts c join public.inbox_channel_identities i on i.contact_id = c.id where i.external_user_id = 'PSID-RPC') as contacts,
      (select count(*)::int from public.inbox_conversations c join public.inbox_channel_identities i on i.id = c.channel_identity_id where i.external_user_id = 'PSID-RPC') as conversations,
      (select count(*)::int from public.inbox_messages where external_message_id = 'MID-RPC-INBOUND') as inbound_messages,
      (select count(*)::int from public.meta_webhook_events where event_key = 'meta:message:MID-RPC-INBOUND') as inbound_events,
      (select count(*)::int from public.meta_webhook_events where event_key = 'meta:message:MID-RPC-DUP-MID') as duplicate_mid_events,
      (select direction from public.inbox_messages where external_message_id = 'MID-RPC-ECHO') as echo_direction,
      (select is_echo from public.inbox_messages where external_message_id = 'MID-RPC-ECHO') as echo_is_echo,
      (select delivered_at from public.inbox_messages where external_message_id = 'MID-RPC-ECHO') as echo_delivered_at,
      (select read_at from public.inbox_messages where external_message_id = 'MID-RPC-ECHO') as echo_read_at,
      (select state from public.inbox_conversations c join public.inbox_channel_identities i on i.id = c.channel_identity_id where i.external_user_id = 'PSID-RPC' limit 1) as conversation_state,
      (select reply_window_expires_at from public.inbox_conversations c join public.inbox_channel_identities i on i.id = c.channel_identity_id where i.external_user_id = 'PSID-RPC' limit 1) as reply_window_expires_at,
      (select entry_source from public.inbox_conversations c join public.inbox_channel_identities i on i.id = c.channel_identity_id where i.external_user_id = 'PSID-RPC' limit 1) as entry_source,
      (select referral_ref from public.inbox_conversations c join public.inbox_channel_identities i on i.id = c.channel_identity_id where i.external_user_id = 'PSID-RPC' limit 1) as referral_ref,
      (select ad_id from public.inbox_conversations c join public.inbox_channel_identities i on i.id = c.channel_identity_id where i.external_user_id = 'PSID-RPC' limit 1) as ad_id,
      (select campaign_id from public.inbox_conversations c join public.inbox_channel_identities i on i.id = c.channel_identity_id where i.external_user_id = 'PSID-RPC' limit 1) as campaign_id,
      (select count(*)::int from public.inbox_attachments where external_attachment_id = 'ATT-RPC' and ingestion_status = 'pending') as attachments,
      (select processing_status from public.meta_webhook_events where event_key = 'meta:unknown:RPC') as unknown_status,
      (select count(*)::int from public.ops_inquiries) as ops_inquiries,
      (select count(*)::int from public.orders) as orders
  `);

  assert.equal(result.pages, 1);
  assert.equal(result.contacts, 1);
  assert.equal(result.identities, 1);
  assert.equal(result.conversations, 1);
  assert.equal(result.inbound_messages, 1);
  assert.equal(result.inbound_events, 1);
  assert.equal(result.duplicate_mid_events, 1);
  assert.equal(result.echo_direction, "outbound");
  assert.equal(result.echo_is_echo, true);
  assert.equal(result.echo_delivered_at, "2026-08-25T10:40:41+00:00");
  assert.equal(result.echo_read_at, "2026-08-25T10:41:41+00:00");
  assert.equal(result.conversation_state, "needs_reply");
  assert.equal(result.reply_window_expires_at, "2026-08-26T10:43:41+00:00");
  assert.equal(result.entry_source, "ADS");
  assert.equal(result.referral_ref, "rpc-ref");
  assert.equal(result.ad_id, "AD-RPC");
  assert.equal(result.campaign_id, null);
  assert.equal(result.attachments, 1);
  assert.equal(result.unknown_status, "ignored");
  assert.equal(result.ops_inquiries, 28);
  assert.equal(result.orders, 9);
}

async function assertConcurrentRpcIdempotency() {
  const payload = `
    set role service_role;
    select public.ingest_meta_messenger_events(
      $json$[
        {
          "eventKey":"meta:message:MID-RPC-RACE",
          "pageId":"PAGE-RPC-RACE",
          "eventType":"message",
          "raw":{"sender":{"id":"PSID-RPC-RACE"},"recipient":{"id":"PAGE-RPC-RACE"},"timestamp":1787654321000,"message":{"mid":"MID-RPC-RACE","text":"race"}},
          "eventTime":"2026-08-25T10:38:41.000Z",
          "shouldProcess":true,
          "customerPsid":"PSID-RPC-RACE",
          "customerDisplayName":"",
          "conversationState":"needs_reply",
          "message":{"externalMessageId":"MID-RPC-RACE","direction":"inbound","messageType":"text","body":"race","senderExternalId":"PSID-RPC-RACE","isEcho":false,"metadata":{"rawMessage":{"mid":"MID-RPC-RACE","text":"race"},"standby":false}},
          "attachments":[],
          "delivery":null,
          "read":false,
          "referralAttribution":null
        }
      ]$json$::jsonb,
      '2026-08-25T12:00:00Z'::timestamptz,
      'page'
    );
  `;
  await Promise.all([execSqlAsync(payload), execSqlAsync(payload)]);

  const result = await single(`
    select
      (select count(*)::int from public.meta_page_connections where page_id = 'PAGE-RPC-RACE') as pages,
      (select count(*)::int from public.inbox_channel_identities where external_user_id = 'PSID-RPC-RACE') as identities,
      (select count(*)::int from public.inbox_contacts c join public.inbox_channel_identities i on i.contact_id = c.id where i.external_user_id = 'PSID-RPC-RACE') as contacts,
      (select count(*)::int from public.inbox_conversations c join public.inbox_channel_identities i on i.id = c.channel_identity_id where i.external_user_id = 'PSID-RPC-RACE') as conversations,
      (select count(*)::int from public.inbox_messages where external_message_id = 'MID-RPC-RACE') as messages,
      (select count(*)::int from public.meta_webhook_events where event_key = 'meta:message:MID-RPC-RACE') as events
  `);
  assert.deepEqual(result, {
    pages: 1,
    identities: 1,
    contacts: 1,
    conversations: 1,
    messages: 1,
    events: 1,
  });
}

async function applyMigrationsBeforeF1() {
  const files = (await readdir("supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => name !== F1_MIGRATION && name !== F2_MIGRATION)
    .filter((name) => name < "202608110001_add_master_catalog_m0_foundation.sql")
    .sort();
  for (const file of files) await execSql(await readFile(`supabase/migrations/${file}`, "utf8"));
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
    returns boolean language sql stable security definer set search_path = public
    as $$ select false $$;
  `);
}

async function seedCoreBaseline() {
  await execSql(`
    insert into auth.users (id, email)
    select ('98000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
           'facebook-f2-admin-' || series || '@trry.test'
    from generate_series(1, 10) series;

    insert into public.admin_users (user_id, email, role, display_name, is_active)
    select ('98000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
           'facebook-f2-admin-' || series || '@trry.test',
           case when series = 1 then 'owner' when series <= 3 then 'admin' else 'staff' end,
           'Facebook F2 Admin ' || series,
           true
    from generate_series(1, 10) series;

    insert into public.ops_inquiries (id, customer_name, contact, product, quantity, status, quote_status)
    select 'TRY-F2-' || lpad(series::text, 3, '0'), 'Facebook F2 Customer ' || series,
           '+63918000' || lpad(series::text, 4, '0'), 'DTF Print', '12 pcs', 'approved', 'approved'
    from generate_series(1, 28) series;

    insert into public.orders (order_reference, source_inquiry_id)
    select 'TRRY-ORD-F2' || lpad(series::text, 6, '0'), 'TRY-F2-' || lpad(series::text, 3, '0')
    from generate_series(1, 9) series;
  `);
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
  assert.equal(rows.length, 1);
  return rows[0];
}

async function queryJson(sql) {
  const output = psql(["-t", "-A", "-c", `select coalesce(json_agg(row_to_json(q)), '[]'::json)::text from (${sql.replace(/;+\s*$/, "")}) q`]);
  return JSON.parse(output.trim() || "[]");
}

async function execSql(sql) {
  psql(["-v", "ON_ERROR_STOP=1", "-q"], sql);
}

async function execSqlAsync(sql) {
  await new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DB, "-X", "-v", "ON_ERROR_STOP=1", "-q"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${stderr || stdout}`.trim()));
    });
    child.stdin.end(sql);
  });
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
