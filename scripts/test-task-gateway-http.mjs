import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = 58176;
const taskId = "10000000-0000-4000-8000-000000000001";
const entryId = "20000000-0000-4000-8000-000000000001";
const child = spawn(process.execPath, ["scripts/local-dev.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    VITE_ENABLE_TASK_DOMAIN: "false",
    VITE_USE_SUPABASE_DATA: "false",
    VITE_SUPABASE_URL: "",
    VITE_SUPABASE_ANON_KEY: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

const preservedRoutes = [
  ["GET", "/api/tasks"],
  ["POST", "/api/tasks"],
  ["GET", "/api/my-tasks"],
  ["GET", `/api/tasks/${taskId}`],
  ["GET", `/api/tasks/${taskId}/history`],
  ["GET", `/api/tasks/${taskId}/time-entries`],
  ["PATCH", `/api/tasks/${taskId}/draft`],
  ["POST", `/api/tasks/${taskId}/assign`],
  ["POST", `/api/tasks/${taskId}/approve-draft`],
  ["POST", `/api/tasks/${taskId}/start`],
  ["POST", `/api/tasks/${taskId}/submit`],
  ["POST", `/api/tasks/${taskId}/submit-without-time`],
  ["POST", `/api/tasks/${taskId}/request-revision`],
  ["POST", `/api/tasks/${taskId}/start-revision`],
  ["POST", `/api/tasks/${taskId}/approve`],
  ["POST", `/api/tasks/${taskId}/cancel`],
  ["POST", `/api/tasks/${taskId}/reopen`],
  ["POST", `/api/tasks/${taskId}/archive`],
  ["POST", `/api/tasks/${taskId}/time-entries/${entryId}/correct`],
];

try {
  await waitForServer(port, child);
  for (const [method, path] of preservedRoutes) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method });
    assert.equal(response.status, 401, `${method} ${path}`);
    const payload = await response.json();
    assert.equal(payload.ok, false, `${method} ${path} payload`);
    assert.equal(payload.error.code, "AUTH_REQUIRED", `${method} ${path} code`);
  }

  const wrongMethod = await fetch(`http://127.0.0.1:${port}/api/tasks/${taskId}/start`, { method: "GET" });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "POST");

  const unknown = await fetch(`http://127.0.0.1:${port}/api/tasks/${taskId}/unsupported`, { method: "GET" });
  assert.equal(unknown.status, 404);
  const unknownPayload = await unknown.json();
  assert.equal(unknownPayload.error.code, "NOT_FOUND");

  process.stdout.write(`PASS local HTTP task gateway preserved ${preservedRoutes.length} URLs with safe 404/405 responses\n`);
} finally {
  child.kill("SIGTERM");
}

async function waitForServer(port, child) {
  const started = Date.now();
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });

  while (Date.now() - started < 10000) {
    if (child.exitCode !== null) throw new Error(`local dev server exited early: ${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/src/env.js`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`local dev server did not start: ${output}`);
}
