import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = 58173;
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

try {
  await waitForServer(port, child);
  const page = await fetch(`http://127.0.0.1:${port}/my-tasks`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes("TRRY Apparel Management"));

  const env = await fetch(`http://127.0.0.1:${port}/src/env.js`);
  assert.equal(env.status, 200);
  const envText = await env.text();
  assert.ok(envText.includes('"VITE_ENABLE_TASK_DOMAIN": "false"'));

  const api = await fetch(`http://127.0.0.1:${port}/api/my-tasks`);
  assert.equal(api.status, 401);
  const payload = await api.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "AUTH_REQUIRED");

  const command = await fetch(`http://127.0.0.1:${port}/api/tasks/10000000-0000-4000-8000-000000000001/submit-without-time`, { method: "POST" });
  assert.equal(command.status, 401);

  process.stdout.write("PASS My Tasks local HTTP route and hidden task API dispatch\n");
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