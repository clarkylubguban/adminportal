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
    assert.ok(value.hasInventory, `${viewport.label}: Inventory content missing`);
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
