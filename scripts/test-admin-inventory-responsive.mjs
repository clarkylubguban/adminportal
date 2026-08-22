import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const baseUrl = process.env.ADMIN_BASE_URL || "http://127.0.0.1:5173";
const userDataDir = await mkdtemp(join(tmpdir(), "trry-inventory-chrome-"));
const port = 9229 + Math.floor(Math.random() * 1000);
const viewports = [
  { label: "1920", width: 1920, height: 1080 },
  { label: "1366", width: 1366, height: 900 },
  { label: "tablet", width: 834, height: 1112 },
  { label: "390", width: 390, height: 844 },
];

let chrome;

try {
  chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ], { stdio: "ignore" });

  await waitForChrome(port);
  const page = await createPage(port);
  const cdp = await connectWebSocket(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  await navigate(cdp, `${baseUrl}/overview`);
  await cdp.send("Runtime.evaluate", {
    expression: "sessionStorage.setItem('trry_admin_access_unlocked', 'true')",
  });

  for (const viewport of viewports) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.width <= 760,
    });
    await navigate(cdp, `${baseUrl}/catalog/inventory`);
    const result = await cdp.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const text = document.body.innerText;
        const root = document.documentElement;
        return {
          title: document.querySelector("h1")?.textContent || "",
          hasInventory: text.includes("Inventory"),
          hasStockRule: text.includes("On Hand is never edited directly"),
          hasNoPageOverflow: root.scrollWidth <= window.innerWidth + 1,
          scrollWidth: root.scrollWidth,
          innerWidth: window.innerWidth,
          drawerUsableWidth: Math.min(520, window.innerWidth - 24) > 300
        };
      })()`,
    });
    const value = result.result.result.value;
    assert.ok(value.hasInventory, `${viewport.label}: Inventory content missing`);
    assert.ok(value.hasStockRule, `${viewport.label}: Stock rule missing`);
    assert.ok(value.hasNoPageOverflow, `${viewport.label}: page overflow ${value.scrollWidth} > ${value.innerWidth}`);
    assert.ok(value.drawerUsableWidth, `${viewport.label}: receive drawer width unusable`);
  }

  process.stdout.write("PASS Admin Inventory responsive smoke: 1920, 1366, tablet, 390\n");
} finally {
  if (chrome) chrome.kill();
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
}

async function waitForChrome(debugPort) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("Timed out waiting for Chrome DevTools.");
}

async function createPage(debugPort) {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" });
  if (!response.ok) throw new Error(`Unable to create Chrome page: ${response.status}`);
  return response.json();
}

async function navigate(cdp, url) {
  await cdp.send("Page.navigate", { url });
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

function connectWebSocket(url) {
  const socket = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message);
  });

  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((resolveSend, rejectSend) => {
            pending.set(id, { resolve: resolveSend, reject: rejectSend });
          });
        },
      });
    });
    socket.addEventListener("error", reject);
  });
}
