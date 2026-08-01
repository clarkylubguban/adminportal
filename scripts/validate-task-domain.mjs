import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

const root = process.cwd();
const schemaPath = join(
  root,
  "supabase",
  "migrations",
  "202607250001_create_task_domain_schema.sql",
);
const functionsPath = join(
  root,
  "supabase",
  "migrations",
  "202607250002_create_task_domain_functions.sql",
);
const alignmentPath = join(
  root,
  "supabase",
  "migrations",
  "202608010001_align_task_foundation_phase_8_1.sql",
);
const testsRoot = join(root, "supabase", "tests");
const testPaths = {
  foundation: join(testsRoot, "task_domain_foundation.sql"),
  schema: join(testsRoot, "task_domain_schema_constraints.sql"),
  lifecycle: join(testsRoot, "task_domain_lifecycle_branches.sql"),
  rls: join(testsRoot, "task_domain_rls_contract.sql"),
  concurrency: join(testsRoot, "task_domain_concurrency.sql"),
  api: join(testsRoot, "task_domain_api_contract.sql"),
  noTime: join(testsRoot, "task_domain_no_time_submission.sql"),
};
const concurrencyHarnessPath = join(root, "scripts", "verify-task-concurrency.mjs");

const [
  schema,
  functions,
  alignment,
  foundationTest,
  schemaTest,
  lifecycleTest,
  rlsTest,
  concurrencyTest,
  apiTest,
  noTimeTest,
  concurrencyHarness,
] = await Promise.all([
    readFile(schemaPath, "utf8"),
    readFile(functionsPath, "utf8"),
    readFile(alignmentPath, "utf8"),
    readFile(testPaths.foundation, "utf8"),
    readFile(testPaths.schema, "utf8"),
    readFile(testPaths.lifecycle, "utf8"),
    readFile(testPaths.rls, "utf8"),
    readFile(testPaths.concurrency, "utf8"),
    readFile(testPaths.api, "utf8"),
    readFile(testPaths.noTime, "utf8"),
    readFile(concurrencyHarnessPath, "utf8"),
  ]);

const failures = [];
const requireText = (source, text, label = text) => {
  if (!source.includes(text)) failures.push(`Missing: ${label}`);
};
const forbid = (source, pattern, label) => {
  if (pattern.test(source)) failures.push(`Forbidden: ${label}`);
};

for (const table of [
  "task_feature_flags",
  "tasks",
  "task_time_entries",
  "task_submissions",
  "task_events",
]) {
  requireText(schema, `public.${table}`, `table ${table}`);
}

for (const status of [
  "DRAFT",
  "TO_DO",
  "IN_PROGRESS",
  "FOR_REVIEW",
  "NEEDS_REVISION",
  "DONE",
  "CANCELLED",
]) {
  requireText(schema, `'${status}'`, `canonical status ${status}`);
}

forbid(
  schema.match(/constraint tasks_status_check[\s\S]*?\);/)?.[0] ?? "",
  /APPROVED|READY_TO_POST|POSTED/,
  "noncanonical persistent task status",
);
requireText(
  schema,
  "values ('TASK_DOMAIN', false)",
  "default-off TASK_DOMAIN feature flag",
);
requireText(
  schema,
  "task_time_entries_one_open_task_uidx",
  "one open timer per task",
);
requireText(
  schema,
  "task_time_entries_one_open_user_uidx",
  "one open timer per user",
);
requireText(schema, "task_events_immutable", "immutable event trigger");
requireText(schema, "time_tracking_mode", "task time-tracking mode");
requireText(schema, "time_recording_status", "submission time-recording status");
requireText(schema, "SUBMITTED_WITHOUT_TIME", "no-time audit event type");
requireText(schema, "enable row level security", "RLS");
requireText(
  schema,
  "revoke all on table public.tasks",
  "revoked direct task mutation",
);
requireText(alignment, "coalesce(actor.is_test, false) = false", "is_test actor filtering");
requireText(alignment, "coalesce(account.is_test, false) = false", "is_test assignment filtering");
requireText(alignment, "tasks_active_assignee_check", "active task assignee invariant");
requireText(alignment, "'DISCARDED'", "discard audit event");
requireText(alignment, "v_next_status := 'DRAFT'", "CANCELLED reopen to DRAFT");
requireText(alignment, "perform public.task_active_user_role(v_task.assigned_user_id);", "DONE reopen assignee eligibility");
forbid(
  `${schema}\n${functions}`,
  /set search_path = pg_catalog, public/,
  "mutable public schema in security-definer search path",
);
requireText(
  schema,
  "revoke all on function public.task_domain_enabled() from public, anon, authenticated, service_role;",
  "feature helper execute revocation",
);
forbid(
  schema,
  /grant execute on function public\.task_domain_enabled\(\) to authenticated, service_role/,
  "service-role feature helper execution",
);

const commands = [
  "task_create",
  "task_update_draft",
  "task_assign",
  "task_approve_draft",
  "task_start_work",
  "task_submit_for_review",
  "task_submit_without_time",
  "task_request_revision",
  "task_start_revision",
  "task_approve_work",
  "task_cancel",
  "task_reopen",
  "task_correct_time_entry",
  "task_archive",
];

for (const command of commands) {
  requireText(
    functions,
    `create or replace function public.${command}(`,
    `command ${command}`,
  );
  requireText(
    functions,
    `grant execute on function public.${command}(`,
    `authenticated grant for ${command}`,
  );
}

requireText(functions, "for update", "transactional row locking");
requireText(functions, "task version conflict", "optimistic concurrency");
requireText(functions, "task_idempotency_replay", "idempotent command replay");
requireText(
  functions,
  "task_assert_replay_fingerprint",
  "conflicting idempotency payload guard",
);
requireText(functions, "_requestFingerprint", "immutable request fingerprint");
requireText(functions, "'replayed', p_replayed", "explicit command replay response");
requireText(functions, "pg_advisory_xact_lock", "cross-command idempotency serialization");
requireText(functions, "clock_timestamp()", "server timestamps");
requireText(functions, "task_write_event", "audit event writes");
requireText(
  functions,
  "correction cannot open or close a timer",
  "time correction lifecycle guard",
);
forbid(functions, /\bis_test\s*=\s*(?:true|false)\b/i, "is_test assignment filtering");
forbid(
  `${schema}\n${functions}`,
  /alter\s+table\s+public\.(?:ops_|inquir|order|production|payment|artwork)/i,
  "alteration of an existing operational table",
);

requireText(foundationTest, "rollback;", "rollback-only isolated SQL test");
requireText(foundationTest, "@invalid.example", "synthetic test identities");
requireText(
  foundationTest,
  "direct authenticated task mutation was accepted",
  "direct mutation denial assertion",
);
requireText(schemaTest, "invalid status was accepted", "invalid status test");
requireText(schemaTest, "half-present source reference", "source pair test");
requireText(lifecycleTest, "TO_DO to DONE shortcut", "forbidden shortcut test");
requireText(lifecycleTest, "admin bypassed owner-required approval", "owner gate test");
requireText(lifecycleTest, "disabled account mutation", "disabled account test");
requireText(lifecycleTest, "TIME_ENTRY_CORRECTED", "time correction audit test");
requireText(rlsTest, "active is_test account was assignment eligible", "is_test assignment test");
requireText(rlsTest, "manager-only draft events leaked", "staff event visibility test");
requireText(rlsTest, "feature-off RLS exposed", "feature-off RLS test");
requireText(concurrencyTest, "SIMULTANEOUS SUBMIT", "submit concurrency test");
requireText(concurrencyTest, "SIMULTANEOUS REVIEWER DECISIONS", "review concurrency test");
requireText(apiTest, "one idempotency key mutated two tasks", "cross-task idempotency test");
requireText(apiTest, "first command incorrectly reported replay", "explicit replay flag test");
requireText(noTimeTest, "direct TO_DO fallback contract failed", "direct no-time fallback test");
requireText(noTimeTest, "NONE task allowed Start Work", "NONE mode Start Work denial");
requireText(noTimeTest, "fallback replay duplicated submission or event", "no-time replay test");
requireText(concurrencyHarness, "runRace", "actual two-session race harness");
requireText(
  concurrencyHarness,
  "trry-task-domain-disposable",
  "concurrency isolation gate",
);
requireText(
  concurrencyHarness,
  "11 genuine two-session races",
  "eleven-case concurrency completion",
);
for (const [name, sql] of Object.entries({
  foundationTest,
  schemaTest,
  lifecycleTest,
  rlsTest,
  apiTest,
  noTimeTest,
})) {
  requireText(sql, "rollback;", `${name} rollback`);
  forbid(sql, /@(?!invalid\.example)/, `${name} non-synthetic email domain`);
  forbid(sql, /[^_]confirmed_at/, `${name} generated Auth fixture column`);
}

const appFiles = await readdir(join(root, "src"), { recursive: true }).catch(
  () => [],
);
const prohibitedUiNames = appFiles.filter((name) =>
  /(?:workboard|my[-_ ]?tasks)/i.test(String(name)),
);
if (prohibitedUiNames.length > 0) {
  failures.push(
    `Phase 9B unexpectedly contains task UI paths: ${prohibitedUiNames.join(", ")}`,
  );
}

if (failures.length > 0) {
  console.error("Task-domain static validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Task-domain static validation passed (${commands.length} commands, feature default OFF).`,
  );
}
