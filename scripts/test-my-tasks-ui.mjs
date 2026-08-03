import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile("src/main.js", "utf8");
const css = await readFile("src/styles.css", "utf8");
const service = await readFile("src/services/tasks.js", "utf8");
const localDev = await readFile("scripts/local-dev.mjs", "utf8");
const build = await readFile("scripts/build.mjs", "utf8");

for (const required of [
  "function isTaskFeatureUiEnabled",
  "VITE_ENABLE_TASK_DOMAIN",
  "VITE_ENABLE_MY_TASKS",
  "canViewMyTasksRoute() ? [{ label: \"My Tasks\"",
  "currentRoute === \"My Tasks\"",
  "getMyTasks(adminAuthSession",
  "allowedActions",
  "NO WORK TIME RECORDED",
  "SUBMIT WITHOUT RECORDED TIME",
  "START WORK NOW",
  "START REVISION",
  "TIME NOT RECORDED",
  "TIME NOT REQUIRED",
  "task.timeTrackingMode === \"NONE\"",
  "VITE_ENABLE_WORKBOARD",
  "validateTaskSubmit(\"submit-no-time\")",
  "createIdempotencyKey",
  "expectedVersion",
  "!canViewMyTasksRoute()) return defaultRoutePath",
]) {
  assert.ok(main.includes(required), `missing My Tasks UI contract: ${required}`);
}

for (const forbidden of [
  "Auto Plan Today",
  "Open Workboard",
  "data-route-target=\"/workboard\"",
  "n8n",
]) {
  assert.equal(main.includes(forbidden), false, `unexpected future module exposure: ${forbidden}`);
}

assert.ok(css.includes("Phase 10 My Tasks MVP"));
assert.ok(css.includes("@media (max-width: 768px)"));
assert.ok(service.includes("/api/my-tasks"));
assert.ok(service.includes("submit-without-time"));
assert.ok(service.includes("Idempotency-Key"));
assert.ok(localDev.includes("handleTaskApiRoute"));
assert.ok(localDev.includes("/api/my-tasks"));
assert.ok(localDev.includes("../api/task-views.js"));
assert.ok(localDev.includes("../api/tasks/[id].js"));
assert.ok(localDev.includes("VITE_ENABLE_TASK_DOMAIN"));
assert.ok(localDev.includes("VITE_ENABLE_MY_TASKS"));
assert.ok(build.includes("VITE_ENABLE_TASK_DOMAIN"));
assert.ok(build.includes("VITE_ENABLE_MY_TASKS"));
assert.ok(build.includes("VITE_ENABLE_WORKBOARD"));

process.stdout.write("PASS My Tasks frontend gate, route, action, fallback, and local router contracts\n");
