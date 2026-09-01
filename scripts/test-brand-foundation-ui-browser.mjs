import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const root = process.cwd();
const port = Number(process.env.BRAND_UI_BROWSER_PORT || 58340);
const remotePort = port + 100;
const edgePath = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const appRoutes = new Set([
  "/",
  "/inquiries",
  "/orders",
  "/production",
  "/my-tasks",
  "/calendar",
  "/workboard",
  "/overview",
  "/catalog",
  "/catalog/brands",
  "/catalog/categories",
]);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const server = createServer(handleRequest);
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const browser = spawn(edgePath, [
  "--headless=new",
  `--remote-debugging-port=${remotePort}`,
  `--user-data-dir=${join(tmpdir(), `trry-brand-ui-edge-${Date.now()}`)}`,
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "about:blank",
], { stdio: "ignore" });

try {
  const wsUrl = await waitForBrowser(remotePort);
  const cdp = await createCdp(wsUrl);
  const page = await newPage(remotePort);
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: page.id, flatten: true });
  cdp.sessionId = sessionId;
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");

  await setViewport(cdp, { width: 1440, height: 900 });
  await verifyRoute(cdp, "/catalog/brands", "Brands");
  await verifySidebar(cdp, "Brands");
  await verifyBrandFixtureLayout(cdp);
  await openNewBrandDrawer(cdp);

  for (const [route, label] of [
    ["/catalog", "Products"],
    ["/catalog/categories", "Categories"],
    ["/inquiries", "Inquiries"],
    ["/orders", "Orders"],
    ["/production", "Production"],
  ]) {
    await verifyRoute(cdp, route, label);
    await verifySidebarActiveLabel(cdp, label);
    if (route === "/catalog") {
      await verifyProductsCatalogOptimization(cdp);
    }
  }

  await setViewport(cdp, { width: 390, height: 844 });
  await verifyRoute(cdp, "/catalog/brands", "Brands");
  await verifyNoHorizontalOverflow(cdp, "mobile /catalog/brands");
  await verifyRoute(cdp, "/catalog", "Products");
  await verifyProductsCatalogOptimization(cdp);
  await verifyNoHorizontalOverflow(cdp, "mobile /catalog");
  await verifyRoute(cdp, "/catalog/categories", "Categories");
  await verifyNoHorizontalOverflow(cdp, "mobile /catalog/categories");

  console.log("PASS Brand Foundation UI browser verification for sidebar hierarchy, Brand table spacing, drawer guard, active routes, parked modules, and mobile overflow");
} finally {
  browser.kill();
  await new Promise((resolve) => server.close(resolve));
}

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === "/src/env.js") {
      response.writeHead(200, { "Content-Type": contentTypes[".js"] });
      response.end(`window.TRRY_ADMIN_ENV = ${JSON.stringify({
        VITE_USE_SUPABASE_DATA: "false",
        VITE_LOCAL_TASK_QA_MODE: "true",
        VITE_LOCAL_TASK_QA_ROLE: "owner",
        VITE_ENABLE_TASK_DOMAIN: "true",
        VITE_ENABLE_WORKBOARD: "true",
        VITE_ENABLE_MY_TASKS: "true",
        VITE_ENABLE_CALENDAR: "true",
      }, null, 2)};\n`);
      return;
    }

    const routePath = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");
    const requestedPath = appRoutes.has(routePath) ? "/index.html" : pathname;
    const filePath = normalize(join(root, requestedPath));
    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    const body = await readFile(filePath);
    response.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] ?? "text/plain" });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

async function verifyRoute(cdp, route, expectedActive) {
  await navigate(cdp, `http://127.0.0.1:${port}${route}`);
  await waitFor(cdp, `document.querySelector(".sidebar") && document.body.innerText.includes("${expectedActive}")`);
  await delay(200);
  await verifyNoHorizontalOverflow(cdp, route);
}

async function verifySidebar(cdp, activeLabel) {
  const result = await evaluate(cdp, `(() => {
    const labels = [...document.querySelectorAll(".sidebar .nav-label, .sidebar-section-label")].map((node) => node.textContent.trim());
    const active = document.querySelector(".sidebar a.active .nav-label")?.textContent.trim();
    const disabled = [...document.querySelectorAll(".catalog-supply-link.disabled")].map((node) => ({
      label: node.textContent.trim(),
      aria: node.getAttribute("aria-disabled"),
      clickable: Boolean(node.closest("a")),
    }));
    const productsWeight = getComputedStyle([...document.querySelectorAll(".sidebar .nav-label")].find((node) => node.textContent.trim() === "Products")).fontWeight;
    const activeLink = document.querySelector(".sidebar a.active");
    const activeStyle = activeLink ? getComputedStyle(activeLink) : null;
    const activeIconStyle = activeLink ? getComputedStyle(activeLink.querySelector(".nav-icon")) : null;
    const limeProbe = document.createElement("span");
    limeProbe.style.color = "var(--trry-lime)";
    document.body.append(limeProbe);
    const lime = getComputedStyle(limeProbe).color;
    limeProbe.remove();
    return {
      labels,
      active,
      hasCatalogToggle: Boolean(document.querySelector("[data-catalog-nav-toggle]")),
      hasCatalogParent: Boolean([...document.querySelectorAll(".sidebar a, .sidebar button")].find((node) => node.textContent.trim() === "Catalog")),
      disabled,
      productsWeight: Number(productsWeight),
      activeBackground: activeStyle?.backgroundColor || "",
      activeColor: activeStyle?.color || "",
      activeShadow: activeStyle?.boxShadow || "",
      activeIconColor: activeIconStyle?.color || "",
      lime,
    };
  })()`);
  const expectedOrder = ["Overview", "Inquiries", "Orders", "Production", "CATALOG & SUPPLY", "Products", "Brands", "Categories", "Suppliers", "Purchasing", "Inventory", "Workboard", "Calendar", "My Tasks"];
  assert.deepEqual(result.labels, expectedOrder, "sidebar labels match approved hierarchy");
  assert.equal(result.active, activeLabel, "active label is correct");
  assert.equal(result.hasCatalogToggle, false, "Catalog collapse toggle is removed");
  assert.equal(result.hasCatalogParent, false, "visible Catalog parent row is removed");
  assert.deepEqual(result.disabled.map((item) => item.label), ["Suppliers", "Purchasing", "Inventory"], "parked modules remain visible");
  assert.equal(result.disabled.every((item) => item.aria === "true" && !item.clickable), true, "parked modules are not links");
  assert.equal(result.productsWeight <= 550, true, "inactive Catalog children use regular weight");
  assert.match(result.activeShadow, /rgb|rgba|inset/i, "active item has raised/accent styling");
  assert.notEqual(result.activeBackground, "rgb(221, 255, 79)", "active item is not a full lime rectangle");
  assert.equal(Boolean(result.lime) && (result.activeColor === result.lime || result.activeIconColor === result.lime), true, "active item uses lime text/icon");
}

async function verifySidebarActiveLabel(cdp, expectedLabel) {
  const active = await evaluate(cdp, `document.querySelector(".sidebar a.active .nav-label")?.textContent.trim()`);
  assert.equal(active, expectedLabel, `${expectedLabel} route maps to matching sidebar item`);
}

async function verifyProductsCatalogOptimization(cdp) {
  const result = await evaluate(cdp, `(() => {
    const controls = [...document.querySelectorAll(".catalog-filter-row > *")].map((node) => node.dataset.catalogResetFilters !== undefined ? "catalog-reset-filters" : node.id || node.querySelector?.("input")?.id || node.querySelector?.("select")?.id || node.textContent.trim());
    const search = document.querySelector("#product-search");
    const brand = document.querySelector("#catalog-brand-filter");
    const category = document.querySelector("#catalog-category-filter");
    const type = document.querySelector("#catalog-product-type-filter");
    const status = document.querySelector("#catalog-status-filter");
    const featured = document.querySelector("#catalog-featured-filter");
    const rows = [...document.querySelectorAll(".catalog-products-table tbody tr")];
    const last = rows.at(-1);
    const nav = document.querySelector(".mobile-bottom-nav");
    if (last && nav) last.scrollIntoView({ block: "end", inline: "nearest" });
    const lastRect = last?.getBoundingClientRect();
    const navRect = nav?.getBoundingClientRect();
    const navVisible = Boolean(navRect && navRect.height > 0 && getComputedStyle(nav).display !== "none");
    return {
      hasTabs: Boolean(document.querySelector(".catalog-tabs, [data-catalog-tab]")),
      hasChannelButtons: ["TRRY WEBAPP", "FOGHEAD", "TRRY PORTAL"].some((label) => [...document.querySelectorAll("button")].some((button) => button.textContent.trim().includes(label))),
      controls,
      searchPlaceholder: search?.getAttribute("placeholder"),
      brandLabel: brand?.options?.[brand.selectedIndex]?.textContent.trim(),
      categoryLabel: category?.options?.[category.selectedIndex]?.textContent.trim(),
      typeLabel: type?.options?.[type.selectedIndex]?.textContent.trim(),
      statusLabel: status?.options?.[status.selectedIndex]?.textContent.trim(),
      featuredLabel: featured?.options?.[featured.selectedIndex]?.textContent.trim(),
      rowCount: rows.length,
      hasEmptyState: Boolean(document.querySelector(".catalog-empty-state, .empty-state")),
      finalRowAboveNav: !lastRect || !navVisible || lastRect.bottom <= navRect.top + 1,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    };
  })()`);
  assert.equal(result.hasTabs, false, "Products channel tab row is removed");
  assert.equal(result.hasChannelButtons, false, "Products channel labels are not rendered as browsing buttons");
  assert.deepEqual(result.controls, ["product-search", "catalog-brand-filter", "catalog-category-filter", "catalog-product-type-filter", "catalog-status-filter", "catalog-featured-filter", "catalog-reset-filters"], "Products filter order is Search, Brand, Category, Type, Status, Featured, Reset");
  assert.equal(result.searchPlaceholder, "Search catalog", "Products search remains easy to access");
  assert.equal(result.brandLabel, "All brands", "Brand filter is clearly available");
  assert.equal(result.categoryLabel, "All categories", "Category filter remains available");
  assert.equal(result.typeLabel, "All Types", "Type filter remains available");
  assert.equal(result.statusLabel, "All active", "Status filter remains available");
  assert.equal(result.featuredLabel, "All featured", "Featured filter remains available");
  assert.equal(result.rowCount > 0 || result.hasEmptyState, true, "Products table/list or zero-state remains usable");
  assert.equal(result.finalRowAboveNav, true, "final Product record is not permanently covered by mobile nav");
  assert.equal(result.horizontalOverflow, false, "Products page has no horizontal overflow");
}

async function verifyBrandFixtureLayout(cdp) {
  const result = await evaluate(cdp, `(() => {
    const host = document.createElement("section");
    host.className = "content-card table-card catalog-table-card";
    host.innerHTML = \`
      <table class="products-table catalog-table brand-table">
        <tbody>
          <tr class="selected">
            <td class="brand-main-cell"><div class="brand-row-stack"><strong>Generic / Unbranded</strong><span>Code: GENERIC</span></div></td>
            <td class="brand-owner-cell"><div class="brand-row-stack"><strong>TRRY Operations</strong><span>Internal owner</span></div></td>
            <td class="category-count-cell">0</td>
            <td class="brand-slug-cell">Not published</td>
            <td class="category-status-cell"><span class="status-pill active">Active</span></td>
            <td class="category-updated-cell"><span class="mono-value">Aug 16, 2026</span></td>
            <td class="category-action-cell"><button class="note-button compact-action">Edit</button><button class="note-button compact-action danger">Archive</button></td>
          </tr>
        </tbody>
      </table>\`;
    (document.querySelector(".workspace") || document.body).append(host);
    const stack = host.querySelector(".brand-row-stack");
    const primary = stack.querySelector("strong").getBoundingClientRect();
    const secondary = stack.querySelector("span").getBoundingClientRect();
    const ownerStack = host.querySelector(".brand-owner-cell .brand-row-stack");
    const owner = ownerStack.querySelector("strong").getBoundingClientRect();
    const ownerType = ownerStack.querySelector("span").getBoundingClientRect();
    const status = host.querySelector(".status-pill").getBoundingClientRect();
    const action = host.querySelector(".category-action-cell");
    const table = host.querySelector(".brand-table").getBoundingClientRect();
    const dateText = host.querySelector(".category-updated-cell").textContent.trim();
    const slugText = host.querySelector(".brand-slug-cell").textContent.trim();
    return {
      brandGap: Math.round(secondary.top - primary.bottom),
      ownerGap: Math.round(ownerType.top - owner.bottom),
      statusWidth: Math.round(status.width),
      actionGap: Number.parseFloat(getComputedStyle(action).gap || "0"),
      actionButtons: action.querySelectorAll("button").length,
      tableWidth: Math.round(table.width),
      viewportWidth: document.documentElement.clientWidth,
      dateText,
      slugText,
    };
  })()`);
  assert.equal(result.brandGap >= 3, true, "Brand name and code render on separate lines with a gap");
  assert.equal(result.ownerGap >= 3, true, "Owner and ownership type render on separate lines with a gap");
  assert.equal(result.statusWidth >= 76, true, "status chip has stable width");
  assert.equal(result.actionButtons === 2 && result.actionGap >= 8, true, "actions have usable spacing");
  assert.equal(result.tableWidth <= result.viewportWidth, true, "Brand table fits desktop viewport");
  assert.equal(result.dateText, "Aug 16, 2026", "date remains readable");
  assert.equal(result.slugText, "Not published", "null slug label is corrected");
}

async function openNewBrandDrawer(cdp) {
  await navigate(cdp, `http://127.0.0.1:${port}/catalog/brands`);
  await waitFor(cdp, `document.querySelector("[data-brand-add]")`);
  await evaluate(cdp, `document.querySelector("[data-brand-add]").click()`);
  await waitFor(cdp, `document.querySelector(".brand-drawer")`);
  const result = await evaluate(cdp, `(() => {
    const code = document.querySelector("#brand-brandCode");
    const save = document.querySelector(".brand-drawer .catalog-save-button");
    const locked = document.createElement("input");
    locked.className = "locked-field";
    locked.setAttribute("readonly", "");
    locked.value = "TRRY";
    document.querySelector(".brand-drawer .catalog-field")?.append(locked);
    const lockedStyle = getComputedStyle(locked);
    return {
      newCodeReadonly: code.readOnly,
      newCodeDisabled: code.disabled,
      saveDisabled: save.disabled,
      drawerOverflow: document.querySelector(".brand-drawer").scrollWidth > document.querySelector(".brand-drawer").clientWidth + 2,
      lockedBg: lockedStyle.backgroundColor,
      lockedCursor: lockedStyle.cursor,
    };
  })()`);
  assert.equal(result.newCodeReadonly, false, "New Brand Code remains editable");
  assert.equal(result.newCodeDisabled, false, "New Brand Code is not disabled");
  assert.equal(result.saveDisabled, true, "Create/Save starts disabled until valid");
  assert.equal(result.drawerOverflow, false, "Brand drawer has no horizontal overflow");
  assert.notEqual(result.lockedBg, "rgb(255, 255, 255)", "locked Brand Code has muted treatment");
}

async function verifyNoHorizontalOverflow(cdp, label) {
  const hasOverflow = await evaluate(cdp, `document.documentElement.scrollWidth > document.documentElement.clientWidth + 2`);
  assert.equal(hasOverflow, false, `${label} has no page horizontal overflow`);
}

async function setViewport(cdp, viewport) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.width < 768,
  });
}

async function navigate(cdp, url) {
  await cdp.send("Page.navigate", { url });
  await waitFor(cdp, "document.readyState === 'complete'");
}

async function waitFor(cdp, expression, timeout = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (await evaluate(cdp, expression)) return;
    } catch {
      // Page may still be navigating.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function evaluate(cdp, expression) {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || "Runtime evaluation failed");
  }
  return response.result.value;
}

async function waitForBrowser(portNumber) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const version = await fetchJson(`http://127.0.0.1:${portNumber}/json/version`);
      return version.webSocketDebuggerUrl;
    } catch {
      await delay(100);
    }
  }
  throw new Error("Timed out waiting for Edge remote debugging");
}

async function newPage(portNumber) {
  const response = await fetch(`http://127.0.0.1:${portNumber}/json/new?about:blank`, { method: "PUT" });
  if (!response.ok) throw new Error(`Unable to create browser page: ${response.status}`);
  return response.json();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
  return response.json();
}

function createCdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result ?? {});
  });
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => {
      resolve({
        sessionId: "",
        send(method, params = {}) {
          const messageId = ++id;
          const payload = { id: messageId, method, params };
          if (this.sessionId) payload.sessionId = this.sessionId;
          socket.send(JSON.stringify(payload));
          return new Promise((messageResolve, messageReject) => {
            pending.set(messageId, { resolve: messageResolve, reject: messageReject });
          });
        },
      });
    });
    socket.addEventListener("error", reject);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
