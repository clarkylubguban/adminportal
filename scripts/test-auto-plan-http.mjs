import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = 58271;
const child = spawn(process.execPath, ["scripts/local-dev.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    VITE_USE_SUPABASE_DATA: "false",
    VITE_SUPABASE_URL: "",
    VITE_SUPABASE_ANON_KEY: "",
    VITE_ENABLE_TASK_DOMAIN: "false",
    VITE_ENABLE_WORKBOARD: "false",
    VITE_ENABLE_AUTO_PLAN_TODAY: "false",
    ENABLE_AUTO_PLAN_TODAY: "false",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitForServer(port, child);
  const page = await fetch(`http://127.0.0.1:${port}/workboard`);
  assert.equal(page.status, 200);

  const response = await fetch(`http://127.0.0.1:${port}/api/planning/auto-plan-today`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "phase-8-7-http" },
    body: JSON.stringify({ quickDirection: "" }),
  });
  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "AUTH_REQUIRED");

  const method = await fetch(`http://127.0.0.1:${port}/api/planning/auto-plan-today`);
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "POST");

  process.stdout.write("PASS Auto Plan Today local HTTP route and auth gate\n");
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
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`local dev server did not start: ${output}`);
}
