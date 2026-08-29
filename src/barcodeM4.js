import { getCurrentAdminAuthSession } from "./lib/supabaseClient.js";
import { getApprovedAdminUser } from "./services/adminUsers.js";
import {
  canManageBarcodesForRole,
  canPrintBarcodesForRole,
  generateVariantBarcode,
  getBarcodeManagerRows,
  lookupVariantByBarcode,
  normalizeBarcode,
} from "./services/adminBarcodes.js";
import { createBarcodeScanner } from "./shared/barcodeScanner.js";
import { renderCode128Svg } from "./shared/code128.js";
import { renderEan8Svg } from "./shared/ean8.js";

const LABEL_SIZE = { width: 30, height: 20 };
const INVENTORY_SEARCH_PLACEHOLDER = "Search product, variant, SKU, or scan barcode...";
const INVENTORY_DEFAULT_FEEDBACK = "Inventory scan is read-only.";
const STOCK_COUNT_SCANNER_TITLE = "STOCK COUNT SCANNER READY / POSTING BLOCKED BY MISSING COUNT AUTHORITY";

let enhancementFrameId = 0;
let enhancementRunning = false;
let enhancementQueued = false;
let enhancementForce = false;

const state = {
  session: null,
  user: null,
  rows: [],
  loadState: "idle",
  error: "",
  selected: new Set(),
  labelQty: "1",
  feedback: "",
  savingVariantId: "",
  inventoryFeedback: "",
};

const root = document.querySelector("#root");
if (root) {
  new MutationObserver(() => scheduleEnhance()).observe(root, { childList: true, subtree: true });
}
window.addEventListener("popstate", () => scheduleEnhance(true));
window.addEventListener("focus", () => scheduleEnhance(true));
scheduleEnhance(true);

createBarcodeScanner({
  enabled: () => Boolean(document.querySelector(".inventory-page")),
  onScan: (code) => handleInventoryScan(code),
  minLength: 4,
});

function scheduleEnhance(force = false) {
  enhancementForce = enhancementForce || force;
  if (enhancementRunning) {
    enhancementQueued = true;
    return;
  }
  if (enhancementFrameId) return;

  const requestFrame = globalThis.requestAnimationFrame || ((callback) => globalThis.setTimeout(callback, 16));
  enhancementFrameId = requestFrame(() => {
    enhancementFrameId = 0;
    const shouldForce = enhancementForce;
    enhancementForce = false;
    runEnhancement(shouldForce);
  });
}

async function runEnhancement(force = false) {
  if (enhancementRunning) {
    enhancementQueued = true;
    enhancementForce = enhancementForce || force;
    return;
  }

  enhancementRunning = true;
  try {
    await enhanceM4(force);
  } catch (error) {
    console.warn("M4 barcode enhancement unavailable.", error);
  } finally {
    enhancementRunning = false;
    if (enhancementQueued) {
      enhancementQueued = false;
      scheduleEnhance(enhancementForce);
    }
  }
}

async function enhanceM4(force = false) {
  const catalogPage = document.querySelector(".catalog-page:not(.inventory-page):not(.purchasing-page):not(.suppliers-page):not(.po-detail-page)");
  const inventoryPage = document.querySelector(".inventory-page");
  if (!catalogPage && !inventoryPage) return;

  await ensureData(force && Boolean(document.querySelector(".m4-barcode-modal")));
  if (catalogPage) patchCatalog(catalogPage);
  if (inventoryPage) patchInventory(inventoryPage);
}

async function ensureData(force = false) {
  if (!force && state.loadState === "success" && state.rows.length >= 0) return;
  state.loadState = "loading";
  state.error = "";
  const session = await getCurrentAdminAuthSession();
  state.session = session;
  if (!session?.access_token) {
    state.user = null;
    state.rows = [];
    state.loadState = "empty";
    return;
  }
  const [user, result] = await Promise.all([
    getApprovedAdminUser(session),
    getBarcodeManagerRows(session),
  ]);
  state.user = user;
  state.rows = result.rows ?? [];
  state.loadState = result.status === "missing" ? "missing" : "success";
  state.error = result.error?.message ?? "";
}

function patchCatalog(page) {
  if (page.querySelector("[data-m4-open-barcodes]")) return;
  const heading = page.querySelector(".catalog-heading");
  if (!heading) return;
  const actionHost = heading.querySelector(".catalog-add-button")?.parentElement || heading;
  const button = document.createElement("button");
  button.className = "note-button m4-barcode-open-button";
  button.type = "button";
  button.dataset.m4OpenBarcodes = "true";
  button.textContent = "Barcode & Labels";
  button.addEventListener("click", openBarcodeManager);
  actionHost.appendChild(button);
}

function patchInventory(page) {
  const input = page.querySelector("#inventory-search");
  if (input && input.placeholder !== INVENTORY_SEARCH_PLACEHOLDER) {
    input.placeholder = INVENTORY_SEARCH_PLACEHOLDER;
  }

  const nextFeedback = state.inventoryFeedback || INVENTORY_DEFAULT_FEEDBACK;
  if (!page.querySelector(".m4-inventory-scanner")) {
    const tabs = page.querySelector(".inventory-tabs");
    tabs?.insertAdjacentHTML("afterend", `
      <section class="m4-inventory-scanner" aria-label="Inventory barcode scanner">
        <strong>USB SCANNER READY</strong>
        <span data-m4-inventory-feedback>${escapeHtml(nextFeedback)}</span>
      </section>
    `);
  } else {
    const feedback = page.querySelector("[data-m4-inventory-feedback]");
    if (feedback && feedback.textContent !== nextFeedback) {
      feedback.textContent = nextFeedback;
    }
  }
  const stockCount = page.querySelector('[data-inventory-parked="stock-count"]');
  if (stockCount && stockCount.title !== STOCK_COUNT_SCANNER_TITLE) {
    stockCount.title = STOCK_COUNT_SCANNER_TITLE;
  }
}

async function openBarcodeManager() {
  await ensureData(true);
  closeBarcodeManager();
  const canManage = canManageBarcodesForRole(state.user?.role);
  const canPrint = canPrintBarcodesForRole(state.user?.role);
  const overlay = document.createElement("div");
  overlay.className = "m4-barcode-overlay";
  overlay.innerHTML = `
    <div class="m4-barcode-backdrop" data-m4-close></div>
    <section class="m4-barcode-modal" role="dialog" aria-modal="true" aria-label="Barcode and labels">
      <header class="m4-barcode-header">
        <div>
          <span>MASTER CATALOG · BARCODE & LABELS</span>
          <h2>Barcode & Labels</h2>
          <p>XPrinter XP-236B · EAN-8 / RCN-8 · browser print through Windows driver</p>
        </div>
        <button class="m4-icon-button" data-m4-close type="button" aria-label="Close">X</button>
      </header>
      ${state.feedback ? `<div class="catalog-notice ${state.feedback.includes("failed") || state.feedback.includes("BLOCK") ? "error" : "success"}">${escapeHtml(state.feedback)}</div>` : ""}
      ${state.loadState === "missing" ? `<div class="catalog-notice error">Barcode schema is not applied yet. Remote migration applied: NO.</div>` : ""}
      <div class="m4-barcode-toolbar">
        <label><span>Copies</span><select data-m4-label-qty>${["1", "2", "3", "6", "12"].map((qty) => `<option value="${qty}" ${state.labelQty === qty ? "selected" : ""}>${qty}</option>`).join("")}<option value="custom" ${!["1", "2", "3", "6", "12"].includes(state.labelQty) ? "selected" : ""}>Custom</option></select></label>
        <input data-m4-custom-qty type="number" min="1" step="1" value="${escapeHtml(state.labelQty)}" ${["1", "2", "3", "6", "12"].includes(state.labelQty) ? "hidden" : ""}>
        <button class="note-button" data-m4-generate-missing type="button" ${canManage ? "" : "disabled"}>Generate Missing</button>
        <button class="primary-button" data-m4-print-selected type="button" ${canPrint ? "" : "disabled"}>Print Selected</button>
      </div>
      <div class="m4-barcode-rule"><strong>STOCK RULE</strong><span>Generate, scan, print, and reprint never change inventory.</span></div>
      <div class="m4-barcode-table-wrap">
        <table class="products-table catalog-table m4-barcode-table">
          <thead><tr><th></th><th>Product / Variant</th><th>SKU</th><th>Barcode</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>${state.rows.map((row) => renderBarcodeRow(row, canManage, canPrint)).join("")}</tbody>
        </table>
      </div>
    </section>
  `;
  document.body.appendChild(overlay);
  bindBarcodeManager(overlay);
}

function renderBarcodeRow(row, canManage, canPrint) {
  const checked = state.selected.has(row.variantId) ? "checked" : "";
  const disabled = state.savingVariantId === row.variantId;
  return `
    <tr data-m4-variant="${escapeHtml(row.variantId)}">
      <td><input data-m4-select="${escapeHtml(row.variantId)}" type="checkbox" ${checked} ${row.barcode ? "" : "disabled"}></td>
      <td><div class="catalog-name-stack"><strong>${escapeHtml(row.productName)} · ${escapeHtml(row.variantLabel)}</strong><span>${escapeHtml(row.physical ? "Physical product" : "Not physical")}</span></div></td>
      <td><span class="mono-value">${escapeHtml(row.sku || "-")}</span></td>
      <td><span class="mono-value m4-barcode-code">${escapeHtml(row.barcode?.code || "Not generated")}</span></td>
      <td><span class="status-pill m4-status-${statusClass(row.status)}">${escapeHtml(row.status)}</span></td>
      <td><div class="m4-row-actions">
        ${row.barcode
          ? `<button class="primary-button compact-action" data-m4-reprint="${escapeHtml(row.variantId)}" type="button" ${canPrint ? "" : "disabled"}>Reprint Label</button>`
          : `<button class="note-button compact-action" data-m4-generate="${escapeHtml(row.variantId)}" type="button" ${canManage && !disabled ? "" : "disabled"}>Generate Barcode</button>`}
      </div></td>
    </tr>
  `;
}

function bindBarcodeManager(overlay) {
  overlay.querySelectorAll("[data-m4-close]").forEach((button) => button.addEventListener("click", closeBarcodeManager));
  overlay.querySelector("[data-m4-label-qty]")?.addEventListener("change", (event) => {
    state.labelQty = event.target.value === "custom" ? "1" : event.target.value;
    openBarcodeManager();
  });
  overlay.querySelector("[data-m4-custom-qty]")?.addEventListener("input", (event) => {
    state.labelQty = String(Math.max(1, Number.parseInt(event.target.value || "1", 10) || 1));
  });
  overlay.querySelectorAll("[data-m4-select]").forEach((input) => input.addEventListener("change", () => {
    if (input.checked) state.selected.add(input.dataset.m4Select);
    else state.selected.delete(input.dataset.m4Select);
  }));
  overlay.querySelectorAll("[data-m4-generate]").forEach((button) => button.addEventListener("click", () => withBarcodeSave(button.dataset.m4Generate, () => generateVariantBarcode(button.dataset.m4Generate, state.session))));
  overlay.querySelector("[data-m4-generate-missing]")?.addEventListener("click", generateMissingBarcodes);
  overlay.querySelectorAll("[data-m4-reprint]").forEach((button) => button.addEventListener("click", () => printRows([button.dataset.m4Reprint])));
  overlay.querySelector("[data-m4-print-selected]")?.addEventListener("click", () => printRows([...state.selected]));
}

async function withBarcodeSave(variantId, action) {
  state.savingVariantId = variantId;
  state.feedback = "";
  openBarcodeManager();
  try {
    await action();
    await ensureData(true);
    state.selected.add(variantId);
    state.feedback = "Barcode saved. Inventory unchanged.";
  } catch (error) {
    state.feedback = getBarcodeErrorMessage(error);
  } finally {
    state.savingVariantId = "";
    openBarcodeManager();
  }
}

async function generateMissingBarcodes() {
  const missing = state.rows.filter((row) => row.status === "MISSING");
  for (const row of missing) {
    await generateVariantBarcode(row.variantId, state.session);
  }
  await ensureData(true);
  state.feedback = `Generated ${missing.length} missing barcode${missing.length === 1 ? "" : "s"}. Inventory unchanged.`;
  openBarcodeManager();
}

function printRows(variantIds) {
  const qty = Math.max(1, Number.parseInt(state.labelQty || "1", 10) || 1);
  const rows = variantIds.map((id) => state.rows.find((row) => row.variantId === id)).filter((row) => row?.barcode?.code);
  if (!rows.length) {
    state.feedback = "Select at least one assigned barcode to print.";
    openBarcodeManager();
    return;
  }
  const labels = rows.flatMap((row) => Array.from({ length: qty }, () => row));
  const printWindow = window.open("", "trry-m4-labels", "width=820,height=640");
  if (!printWindow) return;
  printWindow.document.write(`
    <!doctype html><html><head><title>TRRY Barcode Labels</title>
    <style>
      @page { size: 30mm 20mm; margin: 0; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #111; font-family: Arial, sans-serif; }
      .label { width: ${LABEL_SIZE.width}mm; height: ${LABEL_SIZE.height}mm; page-break-after: always; padding: 1mm; display: flex; flex-direction: column; justify-content: center; overflow: hidden; }
      .label strong { font-size: 6px; line-height: 1; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .label span { font-size: 5px; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .label .barcode { margin: 0.7mm 0 0.3mm; width: 100%; }
      .label svg { width: 100%; height: 9mm; display: block; }
    </style></head><body>${labels.map((row) => `
      <section class="label">
        <strong>${escapeHtml(row.productName)}</strong>
        <span>${escapeHtml(row.variantLabel)}</span>
        <div class="barcode">${renderBarcodeSvg(row.barcode)}</div>
      </section>
    `).join("")}</body></html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function renderBarcodeSvg(barcode) {
  const symbology = String(barcode?.symbology || "").trim().toUpperCase();
  if (symbology === "EAN8" || symbology === "EAN-8") {
    return renderEan8Svg(barcode.code, { width: 260, height: 54, showText: true });
  }
  return renderCode128Svg(barcode?.code || "", { width: 260, height: 54, showText: true });
}

async function handleInventoryScan(code) {
  try {
    const found = await lookupVariantByBarcode(code, state.session || await getCurrentAdminAuthSession());
    if (!found) {
      state.inventoryFeedback = "BARCODE NOT FOUND";
      scheduleEnhance();
      return;
    }
    if (!found.productActive || !found.variantActive) {
      state.inventoryFeedback = "ARCHIVED / INACTIVE";
      scheduleEnhance();
      return;
    }
    const input = document.querySelector("#inventory-search");
    if (input) {
      input.value = found.sku || found.barcode;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    state.inventoryFeedback = `${found.productName} · ${found.variantLabel} · read only`;
    window.setTimeout(() => highlightInventoryRow(found), 80);
  } catch (error) {
    state.inventoryFeedback = getBarcodeErrorMessage(error);
    scheduleEnhance();
  }
}

function highlightInventoryRow(found) {
  document.querySelectorAll(".m4-inventory-highlight").forEach((row) => row.classList.remove("m4-inventory-highlight"));
  const row = [...document.querySelectorAll(".inventory-table tbody tr")].find((item) => item.textContent.includes(found.sku));
  row?.classList.add("m4-inventory-highlight");
  scheduleEnhance();
}

function closeBarcodeManager() {
  document.querySelectorAll(".m4-barcode-overlay").forEach((node) => node.remove());
}

function getBarcodeErrorMessage(error) {
  const message = String(error?.message || error || "");
  if (message.includes("Barcode already assigned")) return "Barcode already assigned to another Product / Variant.";
  return message || "Barcode action failed.";
}

function statusClass(status) {
  return String(status || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
