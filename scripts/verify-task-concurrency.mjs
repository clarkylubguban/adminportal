import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

const container = process.env.TASK_TEST_CONTAINER ?? "codex-trry-task-verify-20260725";
const docker = (args, options = {}) =>
  spawnSync("docker", args, { encoding: "utf8", maxBuffer: 4_000_000, ...options });

const isolation = docker([
  "inspect",
  container,
  "--format",
  '{{index .Config.Labels "codex.production"}}|{{index .Config.Labels "codex.purpose"}}|{{json .HostConfig.PortBindings}}',
]);
if (isolation.status !== 0) throw new Error("Disposable container is unavailable.");
const isolationProof = isolation.stdout.trim();
if (
  !isolationProof.startsWith("false|trry-task-domain-disposable|") ||
  !isolationProof.includes('"HostIp":"127.0.0.1"')
) {
  throw new Error("Container failed the disposable, loopback-only isolation gate.");
}

const psqlArgs = (sql) => [
  "exec",
  container,
  "psql",
  "-U",
  "supabase_admin",
  "-d",
  "postgres",
  "-X",
  "-v",
  "ON_ERROR_STOP=1",
  "-qAt",
  "-c",
  sql,
];
const psql = (sql) => {
  const result = docker(psqlArgs(sql));
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "psql command failed");
  }
  return result.stdout.trim();
};
const psqlConcurrent = (sql) =>
  new Promise((resolve) => {
    const child = spawn("docker", psqlArgs(sql), { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
const actorSql = (actor, command) =>
  `set role authenticated; select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub','${actor}',true); select ${command};`;
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const runRace = async (name, left, right, verificationSql) => {
  const results = await Promise.all([psqlConcurrent(left), psqlConcurrent(right)]);
  const winners = results.filter((result) => result.code === 0);
  assert(winners.length === 1, `${name}: expected one winner, received ${winners.length}`);
  assert(psql(verificationSql) === "PASS", `${name}: canonical database assertion failed`);
  console.log(`PASS ${name}`);
};

const owner = "95000000-0000-4000-8000-000000000001";
const admin = "95000000-0000-4000-8000-000000000002";
const staff = Array.from(
  { length: 9 },
  (_, index) => `95000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
);
const task = Array.from(
  { length: 13 },
  (_, index) => `95100000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);

const authRows = [owner, admin, ...staff]
  .map(
    (id, index) =>
      `('00000000-0000-0000-0000-000000000000','${id}','authenticated','authenticated','race-${index}@invalid.example','',clock_timestamp(),'{}'::jsonb,'{}'::jsonb,clock_timestamp(),clock_timestamp())`,
  )
  .join(",");
const adminRows = [
  `('${owner}','race-owner@invalid.example','owner','Synthetic Race Owner',true,false)`,
  `('${admin}','race-admin@invalid.example','admin','Synthetic Race Admin',true,false)`,
  ...staff.map(
    (id, index) =>
      `('${id}','race-staff-${index}@invalid.example','staff','Synthetic Race Staff ${index}',true,${index === 0 ? "true" : "false"})`,
  ),
].join(",");
const taskRows = [
  [task[0], "TSK-951001", "TO_DO", staff[0], owner],
  [task[1], "TSK-951002", "TO_DO", staff[1], owner],
  [task[2], "TSK-951003", "TO_DO", staff[1], owner],
  [task[3], "TSK-951004", "IN_PROGRESS", staff[2], owner],
  [task[4], "TSK-951005", "TO_DO", staff[3], owner],
  [task[5], "TSK-951006", "IN_PROGRESS", staff[4], owner],
  [task[6], "TSK-951007", "FOR_REVIEW", staff[5], owner],
  [task[7], "TSK-951008", "FOR_REVIEW", staff[6], admin],
  [task[8], "TSK-951009", "DRAFT", staff[7], owner],
  [task[9], "TSK-951010", "DRAFT", staff[8], owner],
  [task[10], "TSK-951011", "DRAFT", staff[8], owner],
  [task[11], "TSK-951012", "TO_DO", staff[7], owner],
  [task[12], "TSK-951013", "TO_DO", staff[8], owner],
]
  .map(
    ([id, code, status, assignee, reviewer], index) =>
      `('${id}','${code}','Synthetic race ${index + 1}','Disposable.','MANUAL','${status}','MEDIUM','${assignee}','${reviewer}','${owner}',false,1)`,
  )
  .join(",");

psql(`
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values ${authRows};
  insert into public.admin_users (user_id,email,role,display_name,is_active,is_test) values ${adminRows};
  update public.task_feature_flags set enabled=true where feature='TASK_DOMAIN';
  insert into public.tasks (id,task_code,title,brief,source_type,status,priority,assigned_user_id,reviewer_user_id,created_by_user_id,draft_approval_required,version) values ${taskRows};
  insert into public.task_time_entries (task_id,user_id,cycle_number,started_at) values
    ('${task[3]}','${staff[2]}',1,clock_timestamp()-interval '5 minutes'),
    ('${task[5]}','${staff[4]}',1,clock_timestamp()-interval '5 minutes');
  insert into public.task_submissions (task_id,cycle_number,submitted_by_user_id,submission_note) values
    ('${task[6]}',1,'${staff[5]}','Synthetic pending review.'),
    ('${task[7]}',1,'${staff[6]}','Synthetic pending review.');
`);

await runRace(
  "same-task simultaneous Start",
  actorSql(staff[0], `public.task_start_work('${task[0]}',1,'race-1-left')`),
  actorSql(staff[0], `public.task_start_work('${task[0]}',1,'race-1-right')`),
  `select case when (select status='IN_PROGRESS' and version=2 from public.tasks where id='${task[0]}') and (select count(*)=1 from public.task_time_entries where task_id='${task[0]}' and ended_at is null) and (select count(*)=1 from public.task_events where task_id='${task[0]}' and event_type='STARTED') then 'PASS' else 'FAIL' end;`,
);

await runRace(
  "same-user different-task simultaneous Start",
  actorSql(staff[1], `public.task_start_work('${task[1]}',1,'race-2-left')`),
  actorSql(staff[1], `public.task_start_work('${task[2]}',1,'race-2-right')`),
  `select case when (select count(*)=1 from public.task_time_entries where user_id='${staff[1]}' and ended_at is null) and (select count(*)=1 from public.task_events where task_id in ('${task[1]}','${task[2]}') and event_type='STARTED') then 'PASS' else 'FAIL' end;`,
);

await runRace(
  "simultaneous Submit",
  actorSql(staff[2], `public.task_submit_for_review('${task[3]}',1,'Synthetic submit.',null,'race-3-left')`),
  actorSql(staff[2], `public.task_submit_for_review('${task[3]}',1,'Synthetic submit.',null,'race-3-right')`),
  `select case when (select status='FOR_REVIEW' and version=2 from public.tasks where id='${task[3]}') and (select count(*)=1 from public.task_submissions where task_id='${task[3]}') and (select count(*)=0 from public.task_time_entries where task_id='${task[3]}' and ended_at is null) and (select count(*)=1 from public.task_events where task_id='${task[3]}' and event_type='SUBMITTED') then 'PASS' else 'FAIL' end;`,
);

await runRace(
  "simultaneous Assign and Start",
  actorSql(owner, `public.task_assign('${task[4]}',1,'${staff[8]}','race-4-assign')`),
  actorSql(staff[3], `public.task_start_work('${task[4]}',1,'race-4-start')`),
  `select case when (select version=2 and ((status='IN_PROGRESS' and assigned_user_id='${staff[3]}') or (status='TO_DO' and assigned_user_id='${staff[8]}')) from public.tasks where id='${task[4]}') and (select count(*)=1 from public.task_events where task_id='${task[4]}' and event_type in ('STARTED','REASSIGNED')) then 'PASS' else 'FAIL' end;`,
);

await runRace(
  "simultaneous Cancel and Submit",
  actorSql(owner, `public.task_cancel('${task[5]}',1,'Synthetic cancellation.','race-5-cancel')`),
  actorSql(staff[4], `public.task_submit_for_review('${task[5]}',1,'Synthetic submit.',null,'race-5-submit')`),
  `select case when (select version=2 and status in ('CANCELLED','FOR_REVIEW') from public.tasks where id='${task[5]}') and (select count(*)=0 from public.task_time_entries where task_id='${task[5]}' and ended_at is null) and (select count(*)=1 from public.task_events where task_id='${task[5]}' and event_type in ('CANCELLED','SUBMITTED')) then 'PASS' else 'FAIL' end;`,
);

await runRace(
  "simultaneous Revision and Approve",
  actorSql(owner, `public.task_request_revision('${task[6]}',1,'Synthetic revision.','race-6-revision')`),
  actorSql(owner, `public.task_approve_work('${task[6]}',1,'Synthetic approval.','race-6-approve')`),
  `select case when (select version=2 and status in ('NEEDS_REVISION','DONE') from public.tasks where id='${task[6]}') and (select count(*)=1 and max(review_decision) in ('REVISION_REQUESTED','APPROVED') from public.task_submissions where task_id='${task[6]}') then 'PASS' else 'FAIL' end;`,
);

await runRace(
  "two simultaneous reviewers",
  actorSql(owner, `public.task_approve_work('${task[7]}',1,'Owner approval.','race-7-owner')`),
  actorSql(admin, `public.task_approve_work('${task[7]}',1,'Admin approval.','race-7-admin')`),
  `select case when (select status='DONE' and version=2 from public.tasks where id='${task[7]}') and (select review_decision='APPROVED' from public.task_submissions where task_id='${task[7]}') and (select count(*)=1 from public.task_events where task_id='${task[7]}' and event_type='WORK_APPROVED') then 'PASS' else 'FAIL' end;`,
);

await runRace(
  "stale-version draft mutation",
  actorSql(owner, `public.task_update_draft('${task[8]}',1,'Race updated','Disposable updated.','HIGH','${staff[7]}','${owner}',false,null,null,null,null,'race-8-update')`),
  actorSql(owner, `public.task_assign('${task[8]}',1,'${staff[8]}','race-8-assign')`),
  `select case when (select status='DRAFT' and version=2 from public.tasks where id='${task[8]}') and (select count(*)=1 from public.task_events where task_id='${task[8]}' and event_type in ('DRAFT_UPDATED','REASSIGNED')) then 'PASS' else 'FAIL' end;`,
);

await runRace(
  "same-key different-task mutation",
  actorSql(owner, `public.task_assign('${task[9]}',1,'${staff[7]}','race-9-global-key')`),
  actorSql(owner, `public.task_assign('${task[10]}',1,'${staff[7]}','race-9-global-key')`),
  `select case when (select count(*)=1 from public.tasks where id in ('${task[9]}','${task[10]}') and version=2) and (select count(*)=1 from public.tasks where id in ('${task[9]}','${task[10]}') and version=1) and (select count(*)=1 from public.task_events where idempotency_key='race-9-global-key') then 'PASS' else 'FAIL' end;`,
);

await runRace(
  "simultaneous no-time fallback",
  actorSql(staff[7], `public.task_submit_without_time('${task[11]}',1,'Synthetic fallback.','Forgot timer.','race-10-left')`),
  actorSql(staff[7], `public.task_submit_without_time('${task[11]}',1,'Synthetic fallback.','Forgot timer.','race-10-right')`),
  `select case when (select status='FOR_REVIEW' and version=2 from public.tasks where id='${task[11]}') and (select count(*)=1 from public.task_submissions where task_id='${task[11]}' and time_recording_status='NOT_RECORDED') and (select count(*)=0 from public.task_time_entries where task_id='${task[11]}') and (select count(*)=1 from public.task_events where task_id='${task[11]}' and event_type='SUBMITTED_WITHOUT_TIME') then 'PASS' else 'FAIL' end;`,
);

await runRace(
  "simultaneous Start and no-time fallback",
  actorSql(staff[8], `public.task_start_work('${task[12]}',1,'race-11-start')`),
  actorSql(staff[8], `public.task_submit_without_time('${task[12]}',1,'Synthetic fallback.','Forgot timer.','race-11-fallback')`),
  `select case when (select version=2 and status in ('IN_PROGRESS','FOR_REVIEW') from public.tasks where id='${task[12]}') and (((select status='IN_PROGRESS' from public.tasks where id='${task[12]}') and (select count(*)=1 from public.task_time_entries where task_id='${task[12]}' and ended_at is null) and (select count(*)=0 from public.task_submissions where task_id='${task[12]}') and (select count(*)=1 from public.task_events where task_id='${task[12]}' and event_type='STARTED')) or ((select status='FOR_REVIEW' from public.tasks where id='${task[12]}') and (select count(*)=0 from public.task_time_entries where task_id='${task[12]}') and (select count(*)=1 from public.task_submissions where task_id='${task[12]}' and time_recording_status='NOT_RECORDED') and (select count(*)=1 from public.task_events where task_id='${task[12]}' and event_type='SUBMITTED_WITHOUT_TIME'))) then 'PASS' else 'FAIL' end;`,
);

console.log("Task-domain concurrency verification passed (11 genuine two-session races).");