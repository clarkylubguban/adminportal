import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile("src/main.js", "utf8");
const css = await readFile("src/styles.css", "utf8");
const service = await readFile("src/services/tasks.js", "utf8");
const localDev = await readFile("scripts/local-dev.mjs", "utf8");

for (const required of [
  "function canViewWorkboardRoute",
  "currentRoute === \"Workboard\"",
  "renderWorkboardPage()",
  "canViewWorkboardRoute() ? [{ label: \"Workboard\"",
  "path === \"/workboard\" && !canViewWorkboardRoute()",
  "getWorkboardTasks(adminAuthSession",
  "CREATE TASK",
  "CREATE DRAFT",
  "SAVE DRAFT",
  "APPROVE DRAFT",
  "REQUEST REVISION",
  "APPROVE WORK",
  "CANCEL",
  "REOPEN",
  "ARCHIVE",
  "TIME NOT RECORDED",
  "TIME NOT REQUIRED",
  "allowedActions",
  "expectedVersion",
  "Idempotency-Key",
]) {
  assert.ok(main.includes(required) || service.includes(required), `missing Workboard contract: ${required}`);
}

for (const required of [
  "getWorkboardTasks",
  "createTaskDraft",
  "updateTaskDraft",
  "assignTask",
  "approveTaskDraft",
  "requestTaskRevision",
  "approveTaskWork",
  "cancelTask",
  "reopenTask",
  "archiveTask",
  "/api/tasks",
]) {
  assert.ok(service.includes(required), `missing Workboard service helper: ${required}`);
}

for (const required of [
  "/api/tasks/[id]/draft.js",
  "/api/tasks/[id]/assign.js",
  "/api/tasks/[id]/approve-draft.js",
  "/api/tasks/[id]/request-revision.js",
  "/api/tasks/[id]/approve.js",
  "/api/tasks/[id]/cancel.js",
  "/api/tasks/[id]/reopen.js",
  "/api/tasks/[id]/archive.js",
]) {
  assert.ok(localDev.includes(required), `missing local task dispatch: ${required}`);
}

for (const forbidden of [
  "Auto Plan Today",
  "Calendar Quick Direction",
  "n8n",
  "READY_TO_POST",
  "POSTED",
]) {
  assert.equal(main.includes(forbidden), false, `unexpected future module exposure: ${forbidden}`);
}

assert.ok(css.includes(".workboard-page"));
assert.ok(css.includes(".workboard-table"));
assert.ok(css.includes("@media (max-width: 980px)"));

process.stdout.write("PASS Workboard frontend gate, route, manager actions, and local router contracts\n");