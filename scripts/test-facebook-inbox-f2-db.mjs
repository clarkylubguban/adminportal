import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const CONTAINER = `trry-facebook-inbox-f2-db-${process.pid}`;
const IMAGE = process.env.TRRY_VERIFY_POSTGRES_IMAGE || "postgres:16-alpine";
const DB = "trry_verify";
const F1_MIGRATION = "202608250001_add_facebook_inbox_f1_foundation.sql";
const F2_MIGRATION = "202608250002_add_facebook_inbox_f2_receive_indexes.sql";

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

  assert.deepEqual(await coreCounts(), { ops_inquiries: 28, orders: 9, admin_users: 10 });
  console.log(`PASS Facebook Inbox F2 DB index contract verified in disposable Postgres container ${CONTAINER}`);
} finally {
  if (started) docker(["rm", "-f", CONTAINER], { allowFailure: true });
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
