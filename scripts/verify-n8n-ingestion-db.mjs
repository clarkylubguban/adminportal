import { spawn, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const root = process.cwd();
const container = process.env.N8N_TEST_CONTAINER ?? "codex-trry-n8n-verify-20260803";
const image = "public.ecr.aws/supabase/postgres:17.6.1.127";
const docker = (args, options = {}) =>
  spawnSync("docker", args, { encoding: "utf8", maxBuffer: 8_000_000, ...options });

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

cleanup();
run([
  "run", "-d",
  "--name", container,
  "--label", "codex.production=false",
  "--label", "codex.purpose=trry-n8n-foundation-disposable",
  "-e", "POSTGRES_PASSWORD=postgres",
  "-e", "JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long",
  "-p", "127.0.0.1::5432",
  image,
]);
await waitForPostgres();
await sleep(3000);
await waitForPostgres();

psql(`
  create schema if not exists storage;
  create table if not exists storage.buckets (
    id text primary key,
    name text not null,
    owner uuid,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[],
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );
  create table if not exists storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text not null,
    name text not null,
    owner uuid,
    metadata jsonb,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
`);

const migrations = readdirSync(join(root, "supabase", "migrations"))
  .filter((name) => name.endsWith(".sql") && name !== "202607260001_complete_payment_workflow.sql")
  .sort();
for (const migration of migrations) {
  console.log(`APPLY ${migration}`);
  psqlStdin(readFileSync(join(root, "supabase", "migrations", migration), "utf8"));
}

seed();
verifySingleExecution();
verifyReplayAndConflicts();
await verifyConcurrentExecution();
verifyOperationalTablesUnchanged();
cleanup();
console.log("N8N foundation database verification passed.");

function seed() {
  psql(`
    insert into auth.users (instance_id,id,aud,role,email,encrypted_password,confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values
      ('00000000-0000-0000-0000-000000000000','96000000-0000-4000-8000-000000000001','authenticated','authenticated','phase83-owner@invalid.example','',clock_timestamp(),'{}'::jsonb,'{}'::jsonb,clock_timestamp(),clock_timestamp()),
      ('00000000-0000-0000-0000-000000000000','96000000-0000-4000-8000-000000000002','authenticated','authenticated','phase83-admin@invalid.example','',clock_timestamp(),'{}'::jsonb,'{}'::jsonb,clock_timestamp(),clock_timestamp()),
      ('00000000-0000-0000-0000-000000000000','96000000-0000-4000-8000-000000000003','authenticated','authenticated','phase83-staff@invalid.example','',clock_timestamp(),'{}'::jsonb,'{}'::jsonb,clock_timestamp(),clock_timestamp());
    insert into public.admin_users (user_id,email,role,display_name,is_active,is_test)
    values
      ('96000000-0000-4000-8000-000000000001','phase83-owner@invalid.example','owner','Phase 8.3 Owner',true,false),
      ('96000000-0000-4000-8000-000000000002','phase83-admin@invalid.example','admin','Phase 8.3 Admin',true,false),
      ('96000000-0000-4000-8000-000000000003','phase83-staff@invalid.example','staff','Phase 8.3 Staff',true,false);
    update public.task_feature_flags set enabled=true where feature='TASK_DOMAIN';
    insert into public.planning_requests (
      id, request_code, requested_by_user_id, quick_direction, active_campaign,
      capacity_snapshot, maximum_tasks, status, planning_context
    )
    values
      ('96100000-0000-4000-8000-000000000001','PLN-PHASE83A','96000000-0000-4000-8000-000000000001','Synthetic Phase 8.3 plan','Synthetic campaign','{"capacity":"available"}'::jsonb,3,'REQUESTED','{"approved":"context"}'::jsonb),
      ('96100000-0000-4000-8000-000000000002','PLN-PHASE83B','96000000-0000-4000-8000-000000000001','Synthetic Phase 8.3 concurrent plan','Synthetic campaign','{"capacity":"available"}'::jsonb,3,'REQUESTED','{"approved":"context"}'::jsonb),
      ('96100000-0000-4000-8000-000000000003','PLN-PHASE83C','96000000-0000-4000-8000-000000000001','Synthetic Phase 8.3 invalid plan','Synthetic campaign','{"capacity":"available"}'::jsonb,3,'REQUESTED','{"approved":"context"}'::jsonb);
  `);
}

function verifySingleExecution() {
  const result = psqlQuiet(callSql({
    planning: "96100000-0000-4000-8000-000000000001",
    execution: "exec-phase83-a",
    key: "phase83-key-a",
    hash: "a".repeat(64),
    tasks: validTasks(),
  }));
  assert(result.includes('"tasksCreated": 2') || result.includes('"tasksCreated":2'), "valid execution did not create two tasks");
  assert(psqlQuiet(`
    select case when
      (select count(*) from public.automation_receipts where external_execution_id='exec-phase83-a' and request_status='COMPLETED' and tasks_created=2) = 1
      and (select count(*) from public.tasks where automation_receipt_id = (select id from public.automation_receipts where external_execution_id='exec-phase83-a') and status='DRAFT' and assigned_user_id is null and planning_request_id='96100000-0000-4000-8000-000000000001' and external_task_id is not null) = 2
      and (select count(*) from public.task_time_entries where task_id in (select id from public.tasks where external_workflow_id='exec-phase83-a')) = 0
      and (select count(*) from public.task_submissions where task_id in (select id from public.tasks where external_workflow_id='exec-phase83-a')) = 0
      and (select count(*) from public.task_events where task_id in (select id from public.tasks where external_workflow_id='exec-phase83-a') and actor_kind='AUTOMATION' and actor_role='automation') = 2
      and (select bool_and(automation_metadata ? 'suggestedAssignee') from public.tasks where external_workflow_id='exec-phase83-a')
    then 'PASS' else 'FAIL' end;
  `) === "PASS", "traceability/draft-only assertion failed");

  const denied = psqlStatus(`
    set role authenticated;
    select public.task_ingest_n8n_drafts('n8n','wf','exec-denied','96100000-0000-4000-8000-000000000003','denied-key','${"b".repeat(64)}','[]'::jsonb);
  `);
  assert(denied.status !== 0, "authenticated role executed service-only ingestion RPC");
}

function verifyReplayAndConflicts() {
  const before = counts();
  const replay = psqlQuiet(callSql({
    planning: "96100000-0000-4000-8000-000000000001",
    execution: "exec-phase83-a",
    key: "phase83-key-a",
    hash: "a".repeat(64),
    tasks: validTasks(),
  }));
  assert(replay.includes('"replayed": true') || replay.includes('"replayed":true'), "identical retry did not replay");
  assert(counts() === before, "identical retry created duplicate records");

  assert(psqlStatus(callSql({
    planning: "96100000-0000-4000-8000-000000000001",
    execution: "exec-phase83-a",
    key: "phase83-key-a",
    hash: "c".repeat(64),
    tasks: validTasks(),
  })).status !== 0, "conflicting execution payload was accepted");

  assert(psqlStatus(callSql({
    planning: "96100000-0000-4000-8000-000000000003",
    execution: "exec-phase83-conflict-key",
    key: "phase83-key-a",
    hash: "d".repeat(64),
    tasks: validTasks("conflict"),
  })).status !== 0, "conflicting idempotency key was accepted");

  assert(psqlStatus(callSql({
    planning: "96100000-0000-4000-8000-000000000003",
    execution: "exec-phase83-invalid-source",
    key: "phase83-key-invalid-source",
    hash: "e".repeat(64),
    tasks: [{ ...validTasks()[0], sourceType: "MANUAL", externalTaskId: "bad-source" }],
  })).status !== 0, "invalid source type was accepted");

  assert(psqlStatus(callSql({
    planning: "96100000-0000-4000-8000-000000000003",
    execution: "exec-phase83-assigned",
    key: "phase83-key-assigned",
    hash: "f".repeat(64),
    tasks: [{ ...validTasks()[0], externalTaskId: "assigned", assignedUserId: "96000000-0000-4000-8000-000000000003" }],
  })).status !== 0, "assignment attempt was accepted");

  assert(psqlStatus(callSql({
    planning: "96100000-0000-4000-8000-000000000003",
    execution: "exec-phase83-dupes",
    key: "phase83-key-dupes",
    hash: "1".repeat(64),
    tasks: [{ ...validTasks()[0], externalTaskId: "dupe" }, { ...validTasks()[1], externalTaskId: "dupe" }],
  })).status !== 0, "duplicate external task IDs were accepted");
}

async function verifyConcurrentExecution() {
  const sql = callSql({
    planning: "96100000-0000-4000-8000-000000000002",
    execution: "exec-phase83-race",
    key: "phase83-key-race",
    hash: "2".repeat(64),
    tasks: validTasks("race"),
  });
  const [left, right] = await Promise.all([psqlConcurrent(sql), psqlConcurrent(sql)]);
  assert(left.code === 0 && right.code === 0, "concurrent identical requests should both return success/replay");
  assert(psqlQuiet(`
    select case when
      (select count(*) from public.automation_receipts where external_execution_id='exec-phase83-race') = 1
      and (select count(*) from public.tasks where external_workflow_id='exec-phase83-race') = 2
      and (select count(distinct external_task_id) from public.tasks where external_workflow_id='exec-phase83-race') = 2
    then 'PASS' else 'FAIL' end;
  `) === "PASS", "concurrent retry duplicated receipt or tasks");
}

function verifyOperationalTablesUnchanged() {
  assert(psqlQuiet(`
    select case when
      (select count(*) from public.ops_inquiries) = 0
      and (select count(*) from public.catalog_products) = 0
      and (select count(*) from public.reorder_requests) = 0
    then 'PASS' else 'FAIL' end;
  `) === "PASS", "operational records changed during n8n verifier");
}

function validTasks(suffix = "a") {
  return [
    {
      externalTaskId: `draft-${suffix}-001`,
      sourceType: "AI_MARKETING",
      title: "Synthetic automation task",
      brief: "Disposable n8n foundation task.",
      priority: "MEDIUM",
      suggestedAssignee: { label: "Synthetic staff", reason: "capacity hint" },
    },
    {
      externalTaskId: `draft-${suffix}-002`,
      sourceType: "DAILY_CONTENT",
      title: "Synthetic content task",
      brief: "Disposable n8n content task.",
    },
  ];
}

function callSql({ planning, execution, key, hash, tasks }) {
  return `
    set role service_role;
    select public.task_ingest_n8n_drafts(
      'n8n',
      'Synthetic Planner',
      '${execution}',
      '${planning}',
      '${key}',
      '${hash}',
      '${JSON.stringify(tasks).replaceAll("'", "''")}'::jsonb
    );
    reset role;
  `;
}

function counts() {
  return psqlQuiet("select count(*) || '|' || (select count(*) from public.tasks) || '|' || (select count(*) from public.task_events) from public.automation_receipts;");
}

function psql(sql) {
  const result = psqlStatus(sql);
  if (result.status !== 0) {
    throw new Error(result.error?.message || result.stderr?.trim?.() || result.stdout?.trim?.() || "psql failed");
  }
  return result.stdout.trim();
}

function psqlQuiet(sql) {
  return psql(sql).split("\n").filter(Boolean).at(-1)?.trim() || "";
}

function psqlStatus(sql) {
  return docker([
    "exec", container, "psql", "-U", "supabase_admin", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-qAt", "-c", sql,
  ]);
}

function psqlStdin(sql) {
  const result = spawnSync("docker", [
    "exec", "-i", container, "psql", "-U", "supabase_admin", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-q",
  ], { input: sql, encoding: "utf8", maxBuffer: 20_000_000 });
  if (result.status !== 0) {
    throw new Error(result.error?.message || result.stderr?.trim?.() || result.stdout?.trim?.() || "psql stdin failed");
  }
  return result.stdout.trim();
}

function psqlConcurrent(sql) {
  return new Promise((resolve) => {
    const child = spawn("docker", [
      "exec", container, "psql", "-U", "supabase_admin", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-qAt", "-c", sql,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function run(args) {
  const result = docker(args);
  if (result.status !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `docker ${args.join(" ")} failed`);
  return result.stdout.trim();
}

function pipe(leftArgs, rightArgs) {
  const left = spawnSync("docker", leftArgs, { encoding: "buffer", maxBuffer: 20_000_000 });
  if (left.status !== 0) throw new Error(left.stderr.toString("utf8"));
  const right = spawnSync("docker", rightArgs, { input: left.stdout, encoding: "utf8", maxBuffer: 20_000_000 });
  if (right.status !== 0) throw new Error(right.stderr);
}

function cleanup() {
  const existing = docker(["ps", "-a", "--filter", `name=^/${container}$`, "--format", "{{.Names}}"]);
  if (existing.stdout.trim() !== container) return;
  const labels = docker(["inspect", container, "--format", "{{json .Config.Labels}}"]).stdout;
  if (!labels.includes("trry-n8n-foundation-disposable")) throw new Error(`Refusing to remove non-disposable container ${container}`);
  run(["rm", "-f", container]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPostgres() {
  for (let i = 0; i < 60; i += 1) {
    const result = docker(["exec", container, "psql", "-U", "supabase_admin", "-d", "postgres", "-X", "-qAt", "-c", "select 1;"]);
    if (result.status === 0 && result.stdout.trim() === "1") return;
    await sleep(1000);
  }
  throw new Error("disposable Postgres did not become ready");
}
