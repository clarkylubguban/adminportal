import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = 58174;
const child = spawn(process.execPath, ["scripts/local-dev.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    VITE_ENABLE_TASK_DOMAIN: "false",
    VITE_ENABLE_WORKBOARD: "false",
    VITE_USE_SUPABASE_DATA: "false",
    VITE_SUPABASE_URL: "",
    VITE_SUPABASE_ANON_KEY: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitForServer(port, child);
  const page = await fetch(`http://127.0.0.1:${port}/workboard`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes("TRRY Apparel Management"));

  const env = await fetch(`http://127.0.0.1:${port}/src/env.js`);
  assert.equal(env.status, 200);
  const envText = await env.text();
  assert.ok(envText.includes('"VITE_ENABLE_TASK_DOMAIN": "false"'));
  assert.ok(envText.includes('"VITE_ENABLE_WORKBOARD": "false"'));

  for (const [path, method] of [
    ["/api/tasks", "GET"],
    ["/api/tasks", "POST"],
    ["/api/tasks/10000000-0000-4000-8000-000000000001/draft", "PATCH"],
    ["/api/tasks/10000000-0000-4000-8000-000000000001/assign", "POST"],
    ["/api/tasks/10000000-0000-4000-8000-000000000001/approve-and-assign", "POST"],
    ["/api/tasks/10000000-0000-4000-8000-000000000001/approve-draft", "POST"],
    ["/api/tasks/10000000-0000-4000-8000-000000000001/request-revision", "POST"],
    ["/api/tasks/10000000-0000-4000-8000-000000000001/approve", "POST"],
    ["/api/tasks/10000000-0000-4000-8000-000000000001/cancel", "POST"],
    ["/api/tasks/10000000-0000-4000-8000-000000000001/reopen", "POST"],
    ["/api/tasks/10000000-0000-4000-8000-000000000001/archive", "POST"],
  ]) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method });
    assert.equal(response.status, 401, `${method} ${path}`);
    const payload = await response.json();
    assert.equal(payload.ok, false, `${method} ${path} payload`);
    assert.equal(payload.error.code, "AUTH_REQUIRED", `${method} ${path} code`);
  }

  process.stdout.write("PASS Workboard local HTTP route and hidden manager task API dispatch\n");
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
