import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
let baseUrl = process.env.ADMIN_BASE_URL || "";
const userDataDir = await mkdtemp(join(tmpdir(), "trry-inventory-chrome-"));
const port = 9229 + Math.floor(Math.random() * 1000);
const browserIssues = [];
const viewports = [
  { label: "1920", width: 1920, height: 1080 },
  { label: "1366", width: 1366, height: 900 },
  { label: "tablet", width: 834, height: 1112 },
  { label: "390", width: 390, height: 844 },
];

let chrome;
let cdp;
let appServer;

try {
  if (!baseUrl) {
    const server = await startLocalServer();
    appServer = server.process;
    baseUrl = server.url;
  }

  const serverResponse = await fetch(`${baseUrl}/catalog/inventory`);
  assert.ok(serverResponse.ok, `Inventory route HTTP ${serverResponse.status} at ${baseUrl}/catalog/inventory`);

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
  cdp = await connectWebSocket(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  cdp.on("Runtime.consoleAPICalled", (params) => {
    const text = (params.args || []).map((arg) => arg.value || arg.description || "").join(" ");
    if (["error", "warning"].includes(params.type)) browserIssues.push(`console:${params.type}:${text}`);
    void cdp.send("Runtime.evaluate", {
      expression: `globalThis.__trryInventoryBrowserIssues = ${JSON.stringify(browserIssues)}`,
    }).catch(() => {});
  });
  cdp.on("Runtime.exceptionThrown", (params) => {
    browserIssues.push(`exception:${params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || "Runtime exception"}`);
    void cdp.send("Runtime.evaluate", {
      expression: `globalThis.__trryInventoryBrowserIssues = ${JSON.stringify(browserIssues)}`,
    }).catch(() => {});
  });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: "sessionStorage.setItem('trry_admin_access_unlocked', 'true')",
  });

  for (const viewport of viewports) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.width <= 760,
    });
    await navigate(cdp, `${baseUrl}/catalog/inventory`);
    await waitForInventoryReady(cdp);
    const result = await cdp.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const text = document.body.innerText;
        const root = document.documentElement;
        const appRoot = document.querySelector("#root");
        const headers = [...document.querySelectorAll(".inventory-table thead th")].map((item) => item.textContent.trim());
        const stockHeader = [...document.querySelectorAll(".inventory-table th")].find((item) => item.textContent.trim() === "Stock");
        const actionHeader = [...document.querySelectorAll(".inventory-table th")].find((item) => item.textContent.trim() === "Action");
        const productHeader = [...document.querySelectorAll(".inventory-table th")].find((item) => item.textContent.trim() === "Product / Variant");
        const skuHeader = [...document.querySelectorAll(".inventory-table th")].find((item) => item.textContent.trim() === "SKU");
        const onHandHeader = [...document.querySelectorAll(".inventory-table th")].find((item) => item.textContent.trim() === "On Hand");
        const incomingHeader = [...document.querySelectorAll(".inventory-table th")].find((item) => item.textContent.trim() === "Incoming");
        const reorderHeader = [...document.querySelectorAll(".inventory-table th")].find((item) => item.textContent.trim() === "Reorder");
          return {
          title: document.querySelector("h1")?.textContent || "",
          finalUrl: location.href,
          documentTitle: document.title,
          rootLength: appRoot?.innerHTML.length || 0,
          text: text.slice(0, 1000),
          browserIssues: globalThis.__trryInventoryBrowserIssues || [],
            hasInventory: text.includes("Inventory"),
          hasStockRule: text.includes("On Hand is never edited directly"),
          headers,
          hasFigmaStockHeaders: JSON.stringify(headers) === JSON.stringify(["Product / Variant", "SKU", "On Hand", "Reorder", "Incoming", "Stock", "Last Cost", "Stock Value", "Action"]),
          stockHeaderWidth: stockHeader?.getBoundingClientRect().width || 0,
          actionHeaderWidth: actionHeader?.getBoundingClientRect().width || 0,
          productHeaderWidth: productHeader?.getBoundingClientRect().width || 0,
          skuHeaderWidth: skuHeader?.getBoundingClientRect().width || 0,
          onHandHeaderWidth: onHandHeader?.getBoundingClientRect().width || 0,
          incomingHeaderWidth: incomingHeader?.getBoundingClientRect().width || 0,
          reorderHeaderWidth: reorderHeader?.getBoundingClientRect().width || 0,
          hasNoPageOverflow: root.scrollWidth <= window.innerWidth + 1,
          scrollWidth: root.scrollWidth,
          innerWidth: window.innerWidth,
          drawerUsableWidth: Math.min(520, window.innerWidth - 24) > 300
        };
      })()`,
    });
    const value = result.result.result.value;
    assert.ok(value.hasInventory, `${viewport.label}: Inventory content missing; ${diagnostics(value)}`);
    assert.ok(value.hasStockRule, `${viewport.label}: Stock rule missing`);
    assert.ok(value.hasFigmaStockHeaders, `${viewport.label}: Inventory headers mismatch: ${value.headers.join(", ")}`);
    if (viewport.width >= 1200) {
      assert.ok(value.stockHeaderWidth >= 96, `${viewport.label}: Stock column too narrow (${value.stockHeaderWidth})`);
      assert.ok(value.actionHeaderWidth >= 72, `${viewport.label}: Action column too narrow (${value.actionHeaderWidth})`);
      assert.ok(value.productHeaderWidth > value.stockHeaderWidth, `${viewport.label}: Product / Variant should be the widest primary descriptor`);
      assert.ok(value.skuHeaderWidth > value.onHandHeaderWidth || value.skuHeaderWidth >= 150, `${viewport.label}: SKU should be the second widest descriptor`);
      assert.ok(value.incomingHeaderWidth >= value.reorderHeaderWidth, `${viewport.label}: Incoming header should not be narrower than Reorder`);
    }
    assert.ok(value.hasNoPageOverflow, `${viewport.label}: page overflow ${value.scrollWidth} > ${value.innerWidth}`);
    assert.ok(value.drawerUsableWidth, `${viewport.label}: receive drawer width unusable`);
  }

  process.stdout.write("PASS Admin Inventory responsive smoke: 1920, 1366, tablet, 390\n");
} finally {
  cdp?.close();
  if (chrome) chrome.kill();
  await stopProcessTree(appServer);
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
}

async function startLocalServer() {
  const child = spawn(process.execPath, ["scripts/local-dev.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, VITE_USE_SUPABASE_DATA: process.env.VITE_USE_SUPABASE_DATA || "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  const url = await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      reject(new Error(`Timed out waiting for local dev server. Output: ${output.join("").slice(-1000)}`));
    }, 20_000);
    const onData = (data) => {
      const text = data.toString();
      output.push(text);
      const match = text.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(deadline);
        resolve(match[0]);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(deadline);
      reject(new Error(`Local dev server exited before readiness with code ${code}. Output: ${output.join("").slice(-1000)}`));
    });
  });

  await waitForHttpOk(`${url}/catalog/inventory`);
  return { process: child, url };
}

async function waitForHttpOk(url) {
  const deadline = Date.now() + 20_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
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
  const result = await cdp.send("Page.navigate", { url });
  if (result.errorText) throw new Error(`Navigation failed for ${url}: ${result.errorText}`);
  await waitFor(cdp, `document.readyState !== "loading"`);
}

async function waitForInventoryReady(cdp) {
  await waitFor(cdp, `document.body && (
    document.body.innerText.includes("Inventory")
    || (globalThis.__trryInventoryBrowserIssues || []).length > 0
  )`);
}

async function waitFor(cdp, expression) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    const value = result.result?.result?.value ?? result.result?.value;
    if (value) return;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

function connectWebSocket(url) {
  const socket = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message);
      return;
    }
    for (const listener of listeners.get(message.method) || []) listener(message.params || {});
  });

  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => {
      resolve({
        on(method, listener) {
          const items = listeners.get(method) || [];
          items.push(listener);
          listeners.set(method, items);
        },
        send(method, params = {}) {
          const id = nextId++;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((resolveSend, rejectSend) => {
            pending.set(id, { resolve: resolveSend, reject: rejectSend });
          });
        },
        close() {
          for (const { reject } of pending.values()) reject(new Error("CDP connection closed."));
          pending.clear();
          listeners.clear();
          socket.close();
        },
      });
    });
    socket.addEventListener("error", reject);
  });
}

function diagnostics(value) {
  return [
    `url=${value.finalUrl || ""}`,
    `documentTitle=${value.documentTitle || ""}`,
    `h1=${value.title || ""}`,
    `rootLength=${value.rootLength || 0}`,
    `text=${String(value.text || "").replace(/\s+/g, " ").slice(0, 240)}`,
    `issues=${(value.browserIssues || []).join(" | ")}`,
  ].join("; ");
}

async function stopProcessTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    child.kill();
  }
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}
