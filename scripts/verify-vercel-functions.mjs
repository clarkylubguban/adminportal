import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const apiRoot = join(process.cwd(), "api");
const files = await listJsFiles(apiRoot);
const entrypoints = files
  .map((file) => relative(process.cwd(), file).replaceAll("\\", "/"))
  .filter((file) => file.startsWith("api/") && !file.startsWith("api/_lib/"))
  .sort();

const taskEntrypoints = entrypoints.filter((file) => file.startsWith("api/tasks/")).sort();
assert.deepEqual(taskEntrypoints, ["api/tasks/[id].js", "api/tasks/index.js"]);
assert.ok(entrypoints.includes("api/task-views.js"), "Task views must share the consolidated view function");
assert.ok(entrypoints.includes("api/task-automation.js"), "Auto Plan and n8n ingestion must share the consolidated automation function");
assert.ok(entrypoints.length <= 12, `expected <= 12 Vercel functions, found ${entrypoints.length}: ${entrypoints.join(", ")}`);
assert.equal(files.some((file) => relative(process.cwd(), file).replaceAll("\\", "/").startsWith("api/_lib/") && entrypoints.includes(file)), false);
await assertTaskActionRewrites();

process.stdout.write(`PASS Vercel function entrypoint gate: ${entrypoints.length} functions (${entrypoints.join(", ")})\n`);

async function assertTaskActionRewrites() {
  const [vercelConfig, taskHandler] = await Promise.all([
    readFile("vercel.json", "utf8").then(JSON.parse),
    readFile("api/tasks/[id].js", "utf8"),
  ]);
  const actionMatches = [...taskHandler.matchAll(/action:\s*"([^"]+)"/g)].map((match) => match[1]);
  const expectedActions = actionMatches.filter((action) => !["history", "time-entries"].includes(action));
  const rewriteActions = new Set((vercelConfig.rewrites || [])
    .map((rewrite) => String(rewrite.destination || "").match(/[?&]_taskAction=([^&]+)/)?.[1])
    .filter(Boolean));
  const missing = expectedActions.filter((action) => !rewriteActions.has(action));
  assert.deepEqual(missing, [], `missing Vercel task action rewrites: ${missing.join(", ")}`);
}

async function listJsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...await listJsFiles(fullPath));
    if (entry.isFile() && entry.name.endsWith(".js")) results.push(fullPath);
  }
  return results;
}

