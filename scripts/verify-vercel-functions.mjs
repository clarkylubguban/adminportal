import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const apiRoot = join(process.cwd(), "api");
const files = await listJsFiles(apiRoot);
const entrypoints = files
  .map((file) => relative(process.cwd(), file).replaceAll("\\", "/"))
  .filter((file) => file.startsWith("api/") && !file.startsWith("api/_lib/"))
  .sort();

const taskEntrypoints = entrypoints.filter((file) => file.startsWith("api/tasks/")).sort();
assert.deepEqual(taskEntrypoints, ["api/tasks/[id].js", "api/tasks/index.js"]);
assert.ok(entrypoints.includes("api/my-tasks.js"), "api/my-tasks.js must remain a separate function");
assert.ok(entrypoints.length <= 10, `expected <= 10 Vercel functions, found ${entrypoints.length}: ${entrypoints.join(", ")}`);
assert.equal(files.some((file) => relative(process.cwd(), file).replaceAll("\\", "/").startsWith("api/_lib/") && entrypoints.includes(file)), false);

process.stdout.write(`PASS Vercel function entrypoint gate: ${entrypoints.length} functions (${entrypoints.join(", ")})\n`);

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

