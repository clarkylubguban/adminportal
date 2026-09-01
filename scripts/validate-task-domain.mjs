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
const phase82Path = join(
  root,
  "supabase",
  "migrations",
  "202608030001_add_task_approve_and_assign.sql",
);
const phase83Path = join(
  root,
  "supabase",
  "migrations",
  "20260803033131_phase_8_3_n8n_foundation.sql",
);
const phase87Path = join(
  root,
  "supabase",
  "migrations",
  "20260803033132_phase_8_7_auto_plan_today.sql",
);
const phase88AiActivationPath = join(
  root,
  "supabase",
  "migrations",
  "20260803033201_phase_8_8_allow_ai_task_activation.sql",
);
const phase88DraftCompletenessPath = join(
  root,
  "supabase",
  "migrations",
  "20260803033302_phase_8_8_auto_plan_draft_completeness.sql",
);
const phase88DropLegacyDraftPath = join(
  root,
  "supabase",
  "migrations",
  "20260803033303_phase_8_8_drop_legacy_task_update_draft.sql",
);
const phase85Path = join(
  root,
  "supabase",
  "migrations",
  "202608030002_enable_none_task_start.sql",
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
  aiActivation: join(testsRoot, "phase_8_8_ai_task_activation.sql"),
};
const concurrencyHarnessPath = join(root, "scripts", "verify-task-concurrency.mjs");
const n8nApiPath = join(root, "api", "_lib", "n8nTaskIngestion.js");
const n8nRoutePath = join(root, "api", "task-automation.js");
const n8nApiTestPath = join(root, "scripts", "test-n8n-ingestion-api.mjs");
const n8nDbVerifierPath = join(root, "scripts", "verify-n8n-ingestion-db.mjs");
const autoPlanApiPath = join(root, "api", "_lib", "autoPlanToday.js");
const autoPlanRoutePath = join(root, "api", "task-automation.js");
const autoPlanUiTestPath = join(root, "scripts", "test-auto-plan-ui.mjs");
const autoPlanApiTestPath = join(root, "scripts", "test-auto-plan-api.mjs");
const autoPlanBrowserTestPath = join(root, "scripts", "test-auto-plan-browser.mjs");

const [
  schema,
  functions,
  alignment,
  phase82,
  phase83,
  phase87,
  phase88AiActivation,
  phase88DraftCompleteness,
  phase88DropLegacyDraft,
  phase85,
  foundationTest,
  schemaTest,
  lifecycleTest,
  rlsTest,
  concurrencyTest,
  apiTest,
  noTimeTest,
  aiActivationTest,
  concurrencyHarness,
  n8nApi,
  n8nRoute,
  n8nApiTest,
  n8nDbVerifier,
  autoPlanApi,
  autoPlanRoute,
  autoPlanUiTest,
  autoPlanApiTest,
  autoPlanBrowserTest,
] = await Promise.all([
    readFile(schemaPath, "utf8"),
    readFile(functionsPath, "utf8"),
    readFile(alignmentPath, "utf8"),
    readFile(phase82Path, "utf8"),
    readFile(phase83Path, "utf8"),
    readFile(phase87Path, "utf8"),
    readFile(phase88AiActivationPath, "utf8"),
    readFile(phase88DraftCompletenessPath, "utf8"),
    readFile(phase88DropLegacyDraftPath, "utf8"),
    readFile(phase85Path, "utf8"),
    readFile(testPaths.foundation, "utf8"),
    readFile(testPaths.schema, "utf8"),
    readFile(testPaths.lifecycle, "utf8"),
    readFile(testPaths.rls, "utf8"),
    readFile(testPaths.concurrency, "utf8"),
    readFile(testPaths.api, "utf8"),
    readFile(testPaths.noTime, "utf8"),
    readFile(testPaths.aiActivation, "utf8"),
    readFile(concurrencyHarnessPath, "utf8"),
    readFile(n8nApiPath, "utf8"),
    readFile(n8nRoutePath, "utf8"),
    readFile(n8nApiTestPath, "utf8"),
    readFile(n8nDbVerifierPath, "utf8"),
    readFile(autoPlanApiPath, "utf8"),
    readFile(autoPlanRoutePath, "utf8"),
    readFile(autoPlanUiTestPath, "utf8"),
    readFile(autoPlanApiTestPath, "utf8"),
    readFile(autoPlanBrowserTestPath, "utf8"),
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
  "task_approve_and_assign",
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
    `${functions}\n${phase82}`,
    `create or replace function public.${command}(`,
    `command ${command}`,
  );
  requireText(
    `${functions}\n${phase82}`,
    `grant execute on function public.${command}(`,
    `authenticated grant for ${command}`,
  );
}

for (const command of ["task_start_work", "task_start_revision", "task_submit_for_review"]) {
  requireText(
    phase85,
    `create or replace function public.${command}(`,
    `phase 8.5 override for ${command}`,
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
requireText(phase85, "v_task.time_tracking_mode = 'NONE'", "NONE timer-free start branch");
requireText(phase85, "v_task.status not in ('TO_DO', 'IN_PROGRESS', 'NEEDS_REVISION')", "NONE submit from started state");
requireText(phase85, "'timeTrackingMode', v_task.time_tracking_mode", "NONE start audit trace");
requireText(phase82, "assigned_user_id = p_assigned_user_id", "approve-and-assign assignment write");
requireText(phase82, "status = 'TO_DO'", "approve-and-assign activation");
requireText(apiTest, "admin activated a daily content draft", "AI/daily admin activation denial");
requireText(phase88AiActivation, "status in ('TO_DO', 'IN_PROGRESS', 'FOR_REVIEW', 'NEEDS_REVISION', 'DONE')", "AI/Daily approved lifecycle statuses");
requireText(phase88AiActivation, "assigned_user_id is not null", "AI/Daily activated assignee invariant");
requireText(phase88AiActivation, "reviewer_user_id is not null", "AI/Daily activated reviewer invariant");
requireText(phase88DraftCompleteness, "draft activation missing required fields", "AI/Daily draft completeness guard");
requireText(phase88DraftCompleteness, "v_task.source_type in ('AI_MARKETING', 'DAILY_CONTENT') then null", "non-authoritative AI/Daily draft assignment");
requireText(phase88DraftCompleteness, "source_type in ('AI_MARKETING', 'DAILY_CONTENT')", "AI/Daily owner activation gate");
requireText(phase88DropLegacyDraft, "drop function if exists public.task_update_draft(uuid, bigint, text, text, text, uuid, uuid, boolean, date, timestamptz, timestamptz, timestamptz, text, text)", "legacy draft-update overload removal");
requireText(phase83, "create table if not exists public.planning_requests", "planning request table");
requireText(phase83, "create table if not exists public.automation_receipts", "automation receipt table");
requireText(phase83, "planning_request_id uuid references public.planning_requests", "task planning traceability");
requireText(phase83, "automation_receipt_id uuid references public.automation_receipts", "task receipt traceability");
requireText(phase83, "external_task_id text", "external task traceability");
requireText(phase83, "tasks_automation_receipt_external_task_uidx", "external task duplicate guard");
requireText(phase83, "automation_receipts_execution_key unique", "execution duplicate guard");
requireText(phase83, "automation_receipts_idempotency_key unique", "automation idempotency guard");
requireText(phase83, "task_ingest_n8n_drafts", "n8n ingestion RPC");
requireText(phase83, "grant execute on function public.task_ingest_n8n_drafts", "service role ingestion grant");
requireText(phase83, "to service_role", "service role explicit authorization");
requireText(phase83, "revoke all on function public.task_ingest_n8n_drafts", "n8n RPC public revocation");
requireText(phase83, "'N8N_FOUNDATION', false", "n8n feature default off");
requireText(phase83, "'AUTO_PLAN_TODAY', false", "auto plan feature default off");
requireText(phase83, "'WORKBOARD', false", "workboard feature default off");
requireText(phase83, "'MY_TASKS', false", "my tasks feature default off");
requireText(phase83, "'CALENDAR', false", "calendar feature default off");
requireText(phase83, "'AUTOMATION'", "automation audit actor");
requireText(phase87, "between 0 and 2000", "optional Quick Direction schema repair");
requireText(n8nApi, "createHmac", "HMAC signature verification");
requireText(n8nApi, "timingSafeEqual", "timing-safe signature comparison");
requireText(n8nApi, "x-trry-request-timestamp", "signed request timestamp header");
requireText(n8nApi, "x-trry-request-expires-at", "signed request expiry header");
requireText(n8nApi, "hashCanonicalPayload", "payload hash verification");
requireText(n8nApiTest, "missing and invalid signatures", "n8n signature tests");
requireText(n8nApiTest, "public, admin, and staff bearer callers cannot bypass", "n8n bearer bypass test");
requireText(n8nDbVerifier, "concurrent identical requests", "n8n concurrency verifier");
requireText(n8nDbVerifier, "operational records changed", "operational unchanged assertion");
requireText(autoPlanRoute, "handleAutoPlanToday", "Auto Plan Today route");
requireText(autoPlanApi, "actor.role !== \"owner\"", "Auto Plan server Owner-only gate");
requireText(autoPlanApi, "ENABLE_AUTO_PLAN_TODAY", "Auto Plan server feature gate");
requireText(autoPlanApi, "N8N_AUTO_PLAN_TODAY_URL", "Auto Plan server endpoint config");
requireText(autoPlanApi, "Browser may not choose planning authority", "Auto Plan browser authority denial");
requireText(autoPlanApi, "maximumTasks: config.maximumTasks", "Auto Plan trusted maximum task count");
requireText(autoPlanApi, "payment_information", "Auto Plan private data exclusion");
requireText(autoPlanApiTest, "Auto Plan Today API", "Auto Plan API test");
requireText(autoPlanUiTest, "Auto Plan Today static UI", "Auto Plan UI test");
requireText(autoPlanBrowserTest, "duplicate clicks should not create duplicate planning requests", "Auto Plan duplicate-click browser test");
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
requireText(noTimeTest, "NONE Start Work did not reach IN_PROGRESS", "NONE mode Start Work transition");
requireText(noTimeTest, "NONE Start Work created a timer", "NONE mode timer-free Start Work");
requireText(noTimeTest, "fallback replay duplicated submission or event", "no-time replay test");
requireText(aiActivationTest, "AI ingestion creates unassigned traceable DRAFT tasks", "AI/Daily activation regression test");
requireText(aiActivationTest, "admin cannot activate AI/Daily drafts", "AI/Daily admin activation denial test");
requireText(aiActivationTest, "owner cannot activate incomplete AI/Daily draft", "AI/Daily completeness test");
requireText(aiActivationTest, "rollback;", "AI/Daily activation rollback-only test");
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
  aiActivationTest,
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
