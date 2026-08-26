import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const CONTAINER = `trry-facebook-inbox-f4-db-${process.pid}`;
const IMAGE = process.env.TRRY_VERIFY_POSTGRES_IMAGE || "postgres:16-alpine";
const DB = "trry_verify";
const F1 = "202608250001_add_facebook_inbox_f1_foundation.sql";
const F2 = "202608250002_add_facebook_inbox_f2_receive_indexes.sql";
const F21 = "202608250003_add_facebook_inbox_f2_transactional_ingestion.sql";
const F4 = "202608260001_add_facebook_inbox_f4_reply_ownership.sql";

const owner = "98000000-0000-4000-8000-000000000001";
const admin = "98000000-0000-4000-8000-000000000002";
const cashier = "98000000-0000-4000-8000-000000000003";
const production = "98000000-0000-4000-8000-000000000004";
const legacyStaff = "98000000-0000-4000-8000-000000000005";
const tempActiveStaff = "98000000-0000-4000-8000-000000000006";
const tempExpiredStaff = "98000000-0000-4000-8000-000000000007";
const tempFutureStaff = "98000000-0000-4000-8000-000000000008";
const tempRevokedStaff = "98000000-0000-4000-8000-000000000009";
const conversation = "99000000-0000-4000-8000-000000000001";
const ownedConversation = "99000000-0000-4000-8000-000000000002";
const followUpConversation = "99000000-0000-4000-8000-000000000003";
const tempGrantConversation = "99000000-0000-4000-8000-000000000004";

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
  await seedInboxData();

  await verifyActionMatrix();
  await verifyLiveSchemaReferences();
  await verifyOutboundAttemptContract();
  await verifyLegacyStaffDoesNotElevate();
  await verifyTemporaryGrantAssignmentTargets();
  await verifyReplyReservationAndCompletion();
  await verifyIdempotencyAndCollision();
  await verifyOwnershipRules();
  await verifyNotesFollowUpCloseAndInboundNormalization();
  await verifyOptimisticConcurrency();

  console.log(`PASS Facebook Inbox F4 DB reply and ownership contract verified in disposable Postgres container ${CONTAINER}`);
} finally {
  if (started) docker(["rm", "-f", CONTAINER], { allowFailure: true });
}

async function applyCoreMigrations() {
  const files = (await readdir("supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => ![F1, F2, F21, F4].includes(name))
    .filter((name) => name < "202608110001_add_master_catalog_m0_foundation.sql")
    .sort();
  for (const file of files) await execSql(await readFile(`supabase/migrations/${file}`, "utf8"));
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

async function seedInboxData() {
  await execSql(`
    insert into auth.users (id, email) values
      ('${owner}', 'owner@trry.test'),
      ('${admin}', 'admin@trry.test'),
      ('${cashier}', 'cashier@trry.test'),
      ('${production}', 'production@trry.test'),
      ('${legacyStaff}', 'legacy-staff@trry.test'),
      ('${tempActiveStaff}', 'temp-active@trry.test'),
      ('${tempExpiredStaff}', 'temp-expired@trry.test'),
      ('${tempFutureStaff}', 'temp-future@trry.test'),
      ('${tempRevokedStaff}', 'temp-revoked@trry.test');

    insert into public.admin_users (user_id, email, role, access_role_key, display_name, is_active, is_test)
    values
      ('${owner}', 'owner@trry.test', 'owner', 'owner_admin', 'Owner', true, false),
      ('${admin}', 'admin@trry.test', 'admin', 'admin_operations', 'Operations', true, false),
      ('${cashier}', 'cashier@trry.test', 'staff', 'cashier_front_desk', 'Cashier', true, false),
      ('${production}', 'production@trry.test', 'staff', 'production_staff', 'Production', true, false),
      ('${legacyStaff}', 'legacy-staff@trry.test', 'staff', null, 'Legacy Staff', true, false),
      ('${tempActiveStaff}', 'temp-active@trry.test', 'staff', null, 'Temp Active', true, false),
      ('${tempExpiredStaff}', 'temp-expired@trry.test', 'staff', null, 'Temp Expired', true, false),
      ('${tempFutureStaff}', 'temp-future@trry.test', 'staff', null, 'Temp Future', true, false),
      ('${tempRevokedStaff}', 'temp-revoked@trry.test', 'staff', null, 'Temp Revoked', true, false);

    insert into public.admin_role_module_permissions (role_key, module_key, can_access)
    values
      ('owner_admin', 'inbox', true),
      ('admin_operations', 'inbox', true),
      ('cashier_front_desk', 'inbox', true),
      ('production_staff', 'inbox', false)
    on conflict (role_key, module_key) do update
    set can_access = excluded.can_access;

    insert into public.admin_temporary_module_grants (user_id, module_key, starts_at, expires_at, revoked_at)
    values
      ('${tempActiveStaff}', 'inbox', now() - interval '1 hour', now() + interval '1 hour', null),
      ('${tempExpiredStaff}', 'inbox', now() - interval '2 hours', now() - interval '1 hour', null),
      ('${tempFutureStaff}', 'inbox', now() + interval '1 hour', now() + interval '2 hours', null),
      ('${tempRevokedStaff}', 'inbox', now() - interval '1 hour', now() + interval '1 hour', now());

    insert into public.meta_page_connections (id, page_id, page_name, status)
    values ('90000000-0000-4000-8000-000000000001', 'PAGE-F4', 'F4 Page', 'testing');

    insert into public.inbox_contacts (id, display_name)
    values
      ('91000000-0000-4000-8000-000000000001', 'F4 Customer 1'),
      ('91000000-0000-4000-8000-000000000002', 'F4 Customer 2'),
      ('91000000-0000-4000-8000-000000000003', 'F4 Customer 3'),
      ('91000000-0000-4000-8000-000000000004', 'F4 Customer 4');

    insert into public.inbox_channel_identities (id, contact_id, page_connection_id, channel, external_user_id)
    values
      ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 'facebook_messenger', 'PSID-F4-1'),
      ('92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001', 'facebook_messenger', 'PSID-F4-2'),
      ('92000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000003', '90000000-0000-4000-8000-000000000001', 'facebook_messenger', 'PSID-F4-3'),
      ('92000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000004', '90000000-0000-4000-8000-000000000001', 'facebook_messenger', 'PSID-F4-4');

    insert into public.inbox_conversations (id, channel_identity_id, state, owner_user_id, last_message_at, reply_window_expires_at)
    values
      ('${conversation}', '92000000-0000-4000-8000-000000000001', 'needs_reply', null, now(), now() + interval '2 hours'),
      ('${ownedConversation}', '92000000-0000-4000-8000-000000000002', 'needs_reply', '${admin}', now(), now() + interval '2 hours'),
      ('${followUpConversation}', '92000000-0000-4000-8000-000000000003', 'follow_up', '${cashier}', now(), now() + interval '2 hours'),
      ('${tempGrantConversation}', '92000000-0000-4000-8000-000000000004', 'needs_reply', null, now(), now() + interval '2 hours');
  `);
}

async function verifyActionMatrix() {
  const rows = await queryJson(`
    select role_key, action_key, can_perform
    from public.admin_role_action_permissions
    where action_key like 'inbox_%'
    order by role_key, action_key
  `);
  assert.equal(rows.length, 30);
  assert.equal(rows.find((row) => row.role_key === "cashier_front_desk" && row.action_key === "inbox_reply").can_perform, true);
  assert.equal(rows.find((row) => row.role_key === "cashier_front_desk" && row.action_key === "inbox_reassign").can_perform, false);
  assert.equal(rows.find((row) => row.role_key === "production_staff" && row.action_key === "inbox_reply").can_perform, false);

  const actions = await queryJson(`
    select action_key, name, is_protected
    from public.admin_actions
    where action_key like 'inbox_%'
    order by action_key
  `);
  assert.equal(actions.length, 5);
  assert.equal(actions.find((row) => row.action_key === "inbox_reassign").is_protected, true);
  assert.equal(actions.find((row) => row.action_key === "inbox_reply").name, "Reply to Inbox customers");
}

async function verifyLiveSchemaReferences() {
  const migration = await readFile(`supabase/migrations/${F4}`, "utf8");
  assert.equal(migration.includes("action_name"), false, "F4 migration must not reference admin_actions.action_name");
  assert.equal(migration.includes("admin_temporary_module_access"), false, "F4 migration must not reference non-canonical temp module table");
  assert.ok(migration.includes("admin_actions (action_key, name, is_protected)"), "F4 migration must use admin_actions.name");
  assert.ok(migration.includes("admin_role_action_permissions (role_key, action_key, can_perform)"), "F4 migration must use can_perform");
  assert.ok(migration.includes("admin_temporary_module_grants"), "F4 migration must use canonical temporary grants");
  assert.ok(migration.includes("admin_legacy_role_to_access_role"), "F4 migration must delegate legacy role mapping");
}

async function verifyOutboundAttemptContract() {
  const rel = await single(`select relrowsecurity from pg_class where oid = 'public.inbox_outbound_attempts'::regclass`);
  assert.equal(rel.relrowsecurity, true);
  const authedGrants = await queryJson(`
    select privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'inbox_outbound_attempts' and grantee in ('anon','authenticated')
  `);
  assert.deepEqual(authedGrants, []);
  const indexes = await queryJson(`select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'inbox_outbound_attempts'`);
  assert.ok(indexes.some((index) => index.indexname === "inbox_outbound_attempts_active_conversation_uidx" && /status = ANY|status IN/i.test(index.indexdef)));
}

async function verifyLegacyStaffDoesNotElevate() {
  assert.equal((await single(`select public.admin_legacy_role_to_access_role('staff') as role_key`)).role_key, "staff");
  for (const action of ["inbox_reply", "inbox_take_ownership", "inbox_reassign", "inbox_internal_note", "inbox_manage_state"]) {
    const allowed = await single(`select public.inbox_f4_user_has_action('${legacyStaff}', '${action}') as allowed`);
    assert.equal(allowed.allowed, false, `legacy Staff without access_role_key must not receive ${action}`);
  }

  assert.equal((await single(`select public.inbox_f4_user_has_action('${cashier}', 'inbox_reply') as allowed`)).allowed, true);
  assert.equal((await single(`select public.inbox_f4_user_has_action('${cashier}', 'inbox_reassign') as allowed`)).allowed, false);
}

async function verifyTemporaryGrantAssignmentTargets() {
  const active = await rpc("mutate_inbox_assignment", {
    p_conversation_id: tempGrantConversation,
    p_actor_user_id: admin,
    p_target_user_id: tempActiveStaff,
    p_expected_updated_at: null,
    p_idempotency_key: "idem-temp-active",
  });
  assert.equal(active.ok, true);

  for (const [target, key] of [
    [tempExpiredStaff, "expired"],
    [tempFutureStaff, "future"],
    [tempRevokedStaff, "revoked"],
  ]) {
    const result = await rpc("mutate_inbox_assignment", {
      p_conversation_id: tempGrantConversation,
      p_actor_user_id: admin,
      p_target_user_id: target,
      p_expected_updated_at: null,
      p_idempotency_key: `idem-temp-${key}`,
    });
    assert.equal(result.error, "ASSIGNMENT_TARGET_DENIED", `${key} temporary Inbox grant must be denied`);
  }
}

async function verifyReplyReservationAndCompletion() {
  const before = await single(`select updated_at from public.inbox_conversations where id = '${conversation}'`);
  const reserve = await rpc("reserve_inbox_reply", {
    p_conversation_id: conversation,
    p_actor_user_id: cashier,
    p_idempotency_key: "idem-reply-one",
    p_body_hash: "hash-one-123456789",
    p_expected_updated_at: before.updated_at,
  });
  assert.equal(reserve.ok, true);
  assert.equal(reserve.pageId, "PAGE-F4");
  assert.equal(reserve.customerPsid, "PSID-F4-1");
  assert.equal((await single(`select owner_user_id from public.inbox_conversations where id = '${conversation}'`)).owner_user_id, cashier);

  const complete = await rpc("complete_inbox_reply", {
    p_attempt_id: reserve.attemptId,
    p_external_message_id: "MID-F4-OUT",
    p_body: "Hello from F4",
  });
  assert.equal(complete.ok, true);
  assert.equal((await single(`select count(*)::int as count from public.inbox_messages where external_message_id = 'MID-F4-OUT'`)).count, 1);
  assert.equal((await single(`select state, snoozed_until from public.inbox_conversations where id = '${conversation}'`)).state, "waiting");
}

async function verifyIdempotencyAndCollision() {
  const replay = await rpc("reserve_inbox_reply", {
    p_conversation_id: conversation,
    p_actor_user_id: cashier,
    p_idempotency_key: "idem-reply-one",
    p_body_hash: "hash-one-123456789",
    p_expected_updated_at: null,
  });
  assert.equal(replay.replay, true);

  const current = await single(`select updated_at from public.inbox_conversations where id = '${ownedConversation}'`);
  const first = await rpc("reserve_inbox_reply", {
    p_conversation_id: ownedConversation,
    p_actor_user_id: admin,
    p_idempotency_key: "idem-active-one",
    p_body_hash: "hash-active-12345",
    p_expected_updated_at: current.updated_at,
  });
  assert.equal(first.ok, true);
  const blocked = await rpc("reserve_inbox_reply", {
    p_conversation_id: ownedConversation,
    p_actor_user_id: admin,
    p_idempotency_key: "idem-active-two",
    p_body_hash: "hash-active-67890",
    p_expected_updated_at: null,
  });
  assert.equal(blocked.error, "SEND_IN_PROGRESS");
  await rpc("fail_inbox_reply", { p_attempt_id: first.attemptId, p_status: "unknown", p_error_code: "META_SEND_TIMEOUT" });
  const unknown = await rpc("reserve_inbox_reply", {
    p_conversation_id: ownedConversation,
    p_actor_user_id: admin,
    p_idempotency_key: "idem-active-three",
    p_body_hash: "hash-active-abcde",
    p_expected_updated_at: null,
  });
  assert.equal(unknown.error, "SEND_STATUS_UNKNOWN");
}

async function verifyOwnershipRules() {
  const denied = await rpc("reserve_inbox_reply", {
    p_conversation_id: ownedConversation,
    p_actor_user_id: cashier,
    p_idempotency_key: "idem-other-owner",
    p_body_hash: "hash-other-123456",
    p_expected_updated_at: null,
  });
  assert.equal(denied.error, "CONVERSATION_OWNED_BY_OTHER");

  const cashierReassign = await rpc("mutate_inbox_assignment", {
    p_conversation_id: followUpConversation,
    p_actor_user_id: cashier,
    p_target_user_id: admin,
    p_expected_updated_at: null,
    p_idempotency_key: "idem-cashier-reassign",
  });
  assert.equal(cashierReassign.error, "INBOX_REASSIGN_DENIED");

  const adminReassign = await rpc("mutate_inbox_assignment", {
    p_conversation_id: followUpConversation,
    p_actor_user_id: admin,
    p_target_user_id: owner,
    p_expected_updated_at: null,
    p_idempotency_key: "idem-admin-reassign",
  });
  assert.equal(adminReassign.ok, true);

  const invalidTarget = await rpc("mutate_inbox_assignment", {
    p_conversation_id: followUpConversation,
    p_actor_user_id: admin,
    p_target_user_id: production,
    p_expected_updated_at: null,
    p_idempotency_key: "idem-invalid-target",
  });
  assert.equal(invalidTarget.error, "ASSIGNMENT_TARGET_DENIED");
}

async function verifyNotesFollowUpCloseAndInboundNormalization() {
  const note = await rpc("add_inbox_internal_note", {
    p_conversation_id: followUpConversation,
    p_actor_user_id: cashier,
    p_body: "Internal only",
    p_idempotency_key: "idem-note-one",
  });
  assert.equal(note.ok, true);
  await rpc("add_inbox_internal_note", {
    p_conversation_id: followUpConversation,
    p_actor_user_id: cashier,
    p_body: "Internal only",
    p_idempotency_key: "idem-note-one",
  });
  assert.equal((await single(`select count(*)::int as count from public.inbox_conversation_notes where conversation_id = '${followUpConversation}'`)).count, 1);

  const follow = await rpc("schedule_inbox_follow_up", {
    p_conversation_id: followUpConversation,
    p_actor_user_id: cashier,
    p_snoozed_until: new Date(Date.now() + 3600000).toISOString(),
    p_reason: "Call later",
    p_expected_updated_at: null,
    p_idempotency_key: "idem-follow-one",
  });
  assert.equal(follow.ok, true);
  const snoozed = await single(`select state, snoozed_until from public.inbox_conversations where id = '${followUpConversation}'`);
  assert.equal(snoozed.state, "follow_up");
  assert.ok(snoozed.snoozed_until);

  await execSql(`
    insert into public.inbox_messages (conversation_id, external_message_id, direction, message_type, body, sender_external_id, sent_at)
    values ('${followUpConversation}', 'MID-F4-INBOUND', 'inbound', 'text', 'hello again', 'PSID-F4-3', now());
    update public.inbox_conversations set state = 'needs_reply' where id = '${followUpConversation}';
  `);
  const inbound = await single(`select state, snoozed_until from public.inbox_conversations where id = '${followUpConversation}'`);
  assert.equal(inbound.state, "needs_reply");
  assert.equal(inbound.snoozed_until, null);

  const close = await rpc("close_inbox_conversation", {
    p_conversation_id: followUpConversation,
    p_actor_user_id: cashier,
    p_expected_updated_at: null,
    p_idempotency_key: "idem-close-one",
  });
  assert.equal(close.ok, true);
  const closed = await single(`select state, closed_at, snoozed_until from public.inbox_conversations where id = '${followUpConversation}'`);
  assert.equal(closed.state, "closed");
  assert.ok(closed.closed_at);
  assert.equal(closed.snoozed_until, null);
}

async function verifyOptimisticConcurrency() {
  const stale = await rpc("mutate_inbox_assignment", {
    p_conversation_id: conversation,
    p_actor_user_id: admin,
    p_target_user_id: owner,
    p_expected_updated_at: "2020-01-01T00:00:00Z",
    p_idempotency_key: "idem-stale-one",
  });
  assert.equal(stale.error, "CONVERSATION_CHANGED");
}

async function rpc(name, args) {
  const rows = await queryJson(`select public.${name}(${Object.values(args).map(sqlValue).join(", ")}) as result`);
  return rows[0].result;
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
