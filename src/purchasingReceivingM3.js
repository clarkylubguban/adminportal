import { getCurrentAdminAuthSession } from "./lib/supabaseClient.js";
import { getApprovedAdminUser } from "./services/adminUsers.js";
import { getAdminInventory } from "./services/adminInventory.js";
import {
  M3_RECEIVABLE_PURCHASE_ORDER_STATUSES,
  canReceivePurchaseOrdersForRole,
  createPurchaseOrderReceiptIdempotencyKey,
  getPurchaseOrders,
  receivePurchaseOrder,
  validatePurchaseOrderReceipt,
} from "./services/adminPurchasing.js";

const M3_FLASH_KEY = "trry-admin-m3-receive-success";
const state = {
  session: null,
  user: null,
  orders: [],
  locations: [],
  loadedAt: 0,
  loading: null,
  enhancing: false,
};

const root = document.querySelector("#root");
if (root) {
  const observer = new MutationObserver(() => scheduleEnhance());
  observer.observe(root, { childList: true, subtree: true });
}
window.addEventListener("popstate", () => scheduleEnhance(true));
window.addEventListener("focus", () => scheduleEnhance(true));
scheduleEnhance();

function scheduleEnhance(force = false) {
  if (state.enhancing) return;
  queueMicrotask(async () => {
    if (state.enhancing) return;
    state.enhancing = true;
    try {
      await enhanceM3(force);
    } catch (error) {
      console.warn("M3 purchasing enhancement unavailable.", error);
    } finally {
      state.enhancing = false;
    }
  });
}

async function enhanceM3(force = false) {
  const purchasingPage = document.querySelector(".purchasing-page");
  const suppliersPage = document.querySelector(".suppliers-page");
  if (!purchasingPage && !suppliersPage) return;

  await ensureM3Data(force);
  enableReceivingHistoryButtons();
  showM3Flash();

  if (!purchasingPage) return;
  patchPurchasingCopy();
  patchPurchaseOrderList();
  patchPurchaseOrderDetail();
}

async function ensureM3Data(force = false) {
  const fresh = Date.now() - state.loadedAt < 5000;
  if (!force && fresh && state.orders.length >= 0) return;
  if (state.loading) return state.loading;

  state.loading = (async () => {
    const session = await getCurrentAdminAuthSession();
    state.session = session;
    if (!session?.access_token) {
      state.user = null;
      state.orders = [];
      state.locations = [];
      state.loadedAt = Date.now();
      return;
    }

    const [user, purchasingResult, inventoryResult] = await Promise.all([
      getApprovedAdminUser(session),
      getPurchaseOrders(session),
      getAdminInventory(session),
    ]);
    state.user = user;
    state.orders = purchasingResult.purchaseOrders ?? [];
    state.locations = inventoryResult.locations ?? [];
    state.loadedAt = Date.now();
  })();

  try {
    await state.loading;
  } finally {
    state.loading = null;
  }
}

function patchPurchasingCopy() {
  const subtitle = document.querySelector(".purchasing-page .purchasing-heading .subtitle");
  if (subtitle?.textContent?.includes("Receiving remains parked")) {
    subtitle.textContent = "Create supplier purchase orders, receive delivered quantities, and post confirmed stock into the inventory ledger.";
  }

  const statusFilter = document.querySelector("#purchase-order-status-filter");
  if (statusFilter) {
    for (const [value, label] of [["PARTIALLY_RECEIVED", "Partially Received"], ["RECEIVED", "Received"]]) {
      if (![...statusFilter.options].some((option) => option.value === value)) {
        statusFilter.add(new Option(label, value));
      }
    }
  }

  document.querySelectorAll(".po-detail-page .purchasing-summary-grid small").forEach((helper) => {
    if (helper.textContent?.trim() === "M2 order lifecycle") helper.textContent = "Receiving lifecycle";
  });
  patchPurchaseOrderSummary();
}

function patchPurchaseOrderSummary() {
  const grid = document.querySelector(".purchasing-page:not(.po-detail-page) .purchasing-summary-grid");
  if (!grid) return;
  const openOrders = state.orders.filter((order) => ["ORDERED", "PARTIALLY_RECEIVED"].includes(String(order.status || "").toUpperCase()));
  const awaiting = state.orders.filter((order) => String(order.status || "").toUpperCase() === "ORDERED");
  const partial = state.orders.filter((order) => String(order.status || "").toUpperCase() === "PARTIALLY_RECEIVED");
  const openValue = openOrders.reduce((sum, order) => sum + Number(order.totalCost || 0), 0);
  const receivedValue = state.orders.reduce((sum, order) => sum + (order.receipts ?? []).reduce((receiptSum, receipt) => (
    receiptSum + (receipt.lines ?? []).reduce((lineSum, line) => lineSum + Number(line.quantity || 0) * Number(line.unitCost || 0), 0)
  ), 0), 0);

  patchSummaryCard(grid, "Open POs", String(openOrders.length), formatMoney(openValue));
  patchSummaryCard(grid, "Awaiting Delivery", String(awaiting.length), awaiting.length === 1 ? "1 ordered PO" : `${awaiting.length} ordered POs`);
  patchSummaryCard(grid, "Partially Received", String(partial.length), partial.length ? "Needs remaining delivery" : "No partial receipts");
  patchSummaryCard(grid, "Stock Received Value", formatMoney(receivedValue), "Confirmed receipt line cost");
}

function patchSummaryCard(grid, label, value, helper) {
  const card = [...grid.querySelectorAll(".catalog-summary-card")].find((item) => item.querySelector("span")?.textContent?.trim() === label);
  if (!card) return;
  const valueNode = card.querySelector("strong");
  const helperNode = card.querySelector("small");
  if (valueNode) valueNode.textContent = value;
  if (helperNode) helperNode.textContent = helper;
}

function patchPurchaseOrderList() {
  document.querySelectorAll("[data-purchase-order-row]").forEach((row) => {
    const order = state.orders.find((item) => item.id === row.dataset.purchaseOrderRow);
    if (!order) return;
    const receivingCell = row.querySelector('td[data-mobile-label="Receiving"]');
    const status = String(order.status || "").toUpperCase();
    if (receivingCell) receivingCell.textContent = ["DRAFT", "CANCELLED"].includes(status) ? "—" : `${order.receivedUnits} / ${order.orderedUnits} pcs`;
    const statusPill = row.querySelector('td[data-mobile-label="Status"] .status-pill');
    if (statusPill) statusPill.textContent = formatStatus(order.status);
  });
}

function patchPurchaseOrderDetail() {
  const detail = document.querySelector(".po-detail-page");
  if (!detail) return;
  const order = getVisiblePurchaseOrder();
  if (!order) return;

  const canReceive = canReceivePurchaseOrdersForRole(state.user?.role)
    && M3_RECEIVABLE_PURCHASE_ORDER_STATUSES.includes(String(order.status || "").toUpperCase());

  const headingButton = detail.querySelector(".purchasing-heading-actions [data-receive-stock-parked]");
  if (headingButton) {
    headingButton.disabled = !canReceive || order.remainingUnits <= 0;
    headingButton.textContent = order.remainingUnits <= 0 ? "Received" : "Receive Stock";
    headingButton.removeAttribute("data-receive-stock-parked");
    headingButton.dataset.m3ReceiveOrder = order.id;
    bindOnce(headingButton, "m3ReceiveBound", "click", () => openReceiveDrawer(order));
  }

  const tableRows = [...detail.querySelectorAll(".po-detail-table tbody tr")];
  tableRows.forEach((row, index) => {
    const line = order.lines[index];
    if (!line) return;
    const receivedCell = row.querySelector('td[data-mobile-label="Received"]');
    const remainingCell = row.querySelector('td[data-mobile-label="Remaining"]');
    const lastReceiptCell = row.querySelector('td[data-mobile-label="Last Receipt"]');
    const statusPill = row.querySelector('td[data-mobile-label="Status"] .status-pill');
    const action = row.querySelector("button[data-receive-stock-parked], button[data-m3-receive-line]");
    if (receivedCell) receivedCell.textContent = String(line.receivedQuantity);
    if (remainingCell) remainingCell.textContent = String(line.remainingQuantity);
    if (lastReceiptCell) lastReceiptCell.textContent = formatDateTime(line.lastReceivedAt);
    if (statusPill) statusPill.textContent = formatStatus(line.status);
    if (action) {
      action.disabled = !canReceive || line.remainingQuantity <= 0;
      action.textContent = line.remainingQuantity <= 0 ? "Received" : "Receive";
      action.removeAttribute("data-receive-stock-parked");
      action.dataset.m3ReceiveLine = line.id;
      bindOnce(action, "m3ReceiveBound", "click", () => openReceiveDrawer(order, line.id));
    }
  });
}

function enableReceivingHistoryButtons() {
  document.querySelectorAll("[data-receiving-history-parked], [data-m3-receiving-history]").forEach((button) => {
    button.disabled = false;
    button.removeAttribute("data-receiving-history-parked");
    button.dataset.m3ReceivingHistory = "true";
    bindOnce(button, "m3HistoryBound", "click", () => openReceivingHistory());
  });
}

function showM3Flash() {
  const message = sessionStorage.getItem(M3_FLASH_KEY);
  if (!message || document.querySelector(".m3-receive-flash")) return;
  sessionStorage.removeItem(M3_FLASH_KEY);
  const host = document.querySelector(".purchasing-page .supplier-tabs") || document.querySelector(".purchasing-page .page-heading");
  if (!host) return;
  const notice = document.createElement("div");
  notice.className = "catalog-notice success m3-receive-flash";
  notice.textContent = message;
  host.insertAdjacentElement("afterend", notice);
}

function getVisiblePurchaseOrder() {
  const subtitle = document.querySelector(".po-detail-page .purchasing-heading .subtitle")?.textContent || "";
  const poNumber = subtitle.split("·")[0]?.trim();
  return state.orders.find((order) => order.poNumber === poNumber) ?? null;
}

async function openReceiveDrawer(order, selectedLineId = "") {
  await ensureM3Data(true);
  const freshOrder = state.orders.find((item) => item.id === order.id) ?? order;
  if (!canReceivePurchaseOrdersForRole(state.user?.role)) return;
  if (!M3_RECEIVABLE_PURCHASE_ORDER_STATUSES.includes(String(freshOrder.status || "").toUpperCase())) return;

  const availableLines = freshOrder.lines.filter((line) => line.remainingQuantity > 0 && (!selectedLineId || line.id === selectedLineId));
  if (!availableLines.length) return;

  closeM3Overlay();
  const overlay = document.createElement("div");
  overlay.className = "m3-overlay";
  overlay.innerHTML = `
    <div class="m3-backdrop" data-m3-close></div>
    <aside class="m3-receive-drawer" role="dialog" aria-modal="true" aria-label="Receive purchase order">
      <header class="m3-drawer-header">
        <div>
          <span class="m3-kicker">PURCHASING · RECEIVE STOCK</span>
          <h2>Receive ${escapeHtml(freshOrder.poNumber)}</h2>
          <p>${escapeHtml(freshOrder.supplierName || "Supplier")} · ${freshOrder.receivedUnits} / ${freshOrder.orderedUnits} pcs received</p>
        </div>
        <button class="m3-icon-button" data-m3-close type="button" aria-label="Close">×</button>
      </header>
      <form class="m3-receive-form" data-m3-receive-form>
        <div class="m3-form-error" data-m3-form-error hidden></div>
        <section class="m3-section">
          <h3>Receive Details</h3>
          <label class="m3-field">
            <span>Inventory Location</span>
            <select data-m3-location required>
              <option value="">Select location</option>
              ${state.locations.map((location) => `<option value="${escapeAttr(location.id)}">${escapeHtml(formatLocation(location))}</option>`).join("")}
            </select>
          </label>
          <div class="m3-two-col">
            <label class="m3-field"><span>Supplier / Delivery Reference</span><input data-m3-reference placeholder="Invoice, DR, or supplier reference"></label>
            <label class="m3-field"><span>Internal Note</span><input data-m3-note placeholder="Optional receiving note"></label>
          </div>
        </section>
        <section class="m3-section">
          <div class="m3-section-heading">
            <div><h3>Items Received Now</h3><p>Enter only the physical quantity you are confirming now.</p></div>
            <span class="m3-manual-chip">MANUAL QUANTITY · M3</span>
          </div>
          <div class="m3-receive-lines">
            ${availableLines.map((line) => renderReceiveLine(line, selectedLineId === line.id)).join("")}
          </div>
        </section>
        <div class="m3-receive-rule"><strong>STOCK RULE</strong><span>Only Confirm Receive posts inventory. PO creation and editing never change On Hand.</span></div>
        <footer class="m3-drawer-footer">
          <span data-m3-receive-summary>Receiving 0 pcs across 0 SKUs</span>
          <div>
            <button class="note-button" data-m3-close type="button">Cancel</button>
            <button class="primary-button" data-m3-confirm type="submit" disabled>Confirm Receive</button>
          </div>
        </footer>
        <p class="m3-phase-note">Barcode / scanner stays outside M3.</p>
      </form>
    </aside>
  `;
  document.body.appendChild(overlay);
  overlay.querySelectorAll("[data-m3-close]").forEach((button) => button.addEventListener("click", closeM3Overlay));
  overlay.querySelectorAll("[data-m3-fill-remaining]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = overlay.querySelector(`[data-m3-qty="${cssEscape(button.dataset.m3FillRemaining)}"]`);
      if (input) input.value = button.dataset.remaining || "";
      updateReceiveSummary(overlay);
    });
  });
  overlay.querySelectorAll("[data-m3-qty]").forEach((input) => {
    input.addEventListener("input", () => updateReceiveSummary(overlay));
  });
  overlay.querySelector("[data-m3-receive-form]")?.addEventListener("submit", (event) => submitReceipt(event, freshOrder, overlay));
  updateReceiveSummary(overlay);
  overlay.querySelector("[data-m3-location]")?.focus();
}

function renderReceiveLine(line, prefill) {
  return `
    <article class="m3-receive-line">
      <div class="m3-line-main">
        <strong>${escapeHtml(line.productName || "Product")}</strong>
        <span>${escapeHtml([line.sku, line.variantLabel].filter(Boolean).join(" · ") || "-")}</span>
      </div>
      <div class="m3-line-facts">
        <span>Ordered <strong>${line.orderedQuantity}</strong></span>
        <span>Received <strong>${line.receivedQuantity}</strong></span>
        <span>Remaining <strong>${line.remainingQuantity}</strong></span>
      </div>
      <label class="m3-qty-field">
        <span>Receive Now</span>
        <input data-m3-qty="${escapeAttr(line.id)}" data-remaining="${line.remainingQuantity}" type="number" min="0" max="${line.remainingQuantity}" step="1" inputmode="numeric" value="${prefill ? line.remainingQuantity : ""}" placeholder="0">
      </label>
      <button class="note-button m3-fill-button" data-m3-fill-remaining="${escapeAttr(line.id)}" data-remaining="${line.remainingQuantity}" type="button">Fill Remaining</button>
    </article>
  `;
}

async function submitReceipt(event, order, overlay) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorBox = overlay.querySelector("[data-m3-form-error]");
  const confirmButton = overlay.querySelector("[data-m3-confirm]");
  const parsed = parseReceiveInputs(order, overlay);
  if (parsed.error) {
    setFormError(errorBox, parsed.error);
    return;
  }
  const lines = parsed.lines
    .map((line) => ({
      purchaseOrderLineId: line.id,
      quantity: line.quantity,
    }))
    .filter((line) => line.quantity > 0);
  const payload = {
    purchaseOrderId: order.id,
    locationId: form.querySelector("[data-m3-location]")?.value || "",
    reference: form.querySelector("[data-m3-reference]")?.value?.trim() || "",
    note: form.querySelector("[data-m3-note]")?.value?.trim() || "",
    idempotencyKey: createPurchaseOrderReceiptIdempotencyKey(),
    lines,
  };
  const validationError = validatePurchaseOrderReceipt(order, payload);
  if (validationError) {
    setFormError(errorBox, validationError);
    return;
  }

  confirmButton.disabled = true;
  confirmButton.textContent = "Receiving...";
  setFormError(errorBox, "");

  try {
    const savedOrder = await receivePurchaseOrder(payload, state.session);
    const receiptNumber = savedOrder?.receipts?.[0]?.receiptNumber || "Receipt posted";
    sessionStorage.setItem(M3_FLASH_KEY, `${receiptNumber} confirmed. Inventory and PO receiving status were updated atomically.`);
    closeM3Overlay();
    state.loadedAt = 0;
    window.location.reload();
  } catch (error) {
    console.error("Unable to receive purchase order.", error);
    confirmButton.disabled = false;
    confirmButton.textContent = "Confirm Receive";
    setFormError(errorBox, error.message || "Receive Stock failed.");
  }
}

function updateReceiveSummary(overlay) {
  const order = getVisiblePurchaseOrder();
  const summary = overlay.querySelector("[data-m3-receive-summary]");
  const confirmButton = overlay.querySelector("[data-m3-confirm]");
  if (!summary || !order) return;

  const parsed = parseReceiveInputs(order, overlay);
  const units = parsed.lines.reduce((sum, line) => sum + Math.max(line.quantity, 0), 0);
  const skuCount = parsed.lines.filter((line) => line.quantity > 0).length;
  summary.textContent = `Receiving ${units} pcs across ${skuCount} ${skuCount === 1 ? "SKU" : "SKUs"}`;
  if (confirmButton) confirmButton.disabled = Boolean(parsed.error) || units <= 0;
}

function parseReceiveInputs(order, overlay) {
  const lines = [];
  for (const line of order.lines ?? []) {
    const input = overlay.querySelector(`[data-m3-qty="${cssEscape(line.id)}"]`);
    if (!input) continue;
    const rawValue = String(input.value || "").trim();
    if (!rawValue) {
      lines.push({ ...line, quantity: 0 });
      continue;
    }
    const quantity = Number(rawValue);
    if (!Number.isInteger(quantity)) return { lines, error: `${line.sku || line.productName || "Line"}: Received Now must be a whole number.` };
    if (quantity < 0) return { lines, error: `${line.sku || line.productName || "Line"}: Received Now cannot be negative.` };
    if (quantity > Number(line.remainingQuantity || 0)) return { lines, error: `${line.sku || line.productName || "Line"}: Received Now cannot exceed ${line.remainingQuantity} remaining.` };
    lines.push({ ...line, quantity });
  }
  return { lines, error: "" };
}

async function openReceivingHistory() {
  await ensureM3Data(true);
  closeM3Overlay();
  const receipts = state.orders
    .flatMap((order) => (order.receipts ?? []).map((receipt) => ({ ...receipt, order })))
    .sort((a, b) => String(b.receivedAt || "").localeCompare(String(a.receivedAt || "")));
  const locationById = new Map(state.locations.map((location) => [location.id, location]));
  const overlay = document.createElement("div");
  overlay.className = "m3-overlay";
  overlay.innerHTML = `
    <div class="m3-backdrop" data-m3-close></div>
    <section class="m3-history-modal" role="dialog" aria-modal="true" aria-label="Receiving history">
      <header class="m3-history-header">
        <div><span class="m3-kicker">PURCHASING</span><h2>Receiving History</h2><p>Append-only PO receipts linked to inventory movements.</p></div>
        <button class="m3-icon-button" data-m3-close type="button" aria-label="Close">×</button>
      </header>
      <div class="m3-history-body">
        ${receipts.length ? `
          <div class="m3-history-scroll">
            <table class="m3-history-table">
              <thead><tr><th>Receipt</th><th>Date / Time</th><th>PO</th><th>Supplier</th><th>Location</th><th>Qty</th><th>Received By</th><th>Reference</th><th>Note</th></tr></thead>
              <tbody>${receipts.map((item) => {
                const units = item.lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
                const location = locationById.get(item.locationId);
                return `<tr>
                  <td><strong>${escapeHtml(item.receiptNumber || "-")}</strong></td>
                  <td>${escapeHtml(formatDateTime(item.receivedAt))}</td>
                  <td>${escapeHtml(item.order.poNumber || "-")}</td>
                  <td>${escapeHtml(item.order.supplierName || "-")}</td>
                  <td>${escapeHtml(location ? formatLocation(location) : item.locationId || "-")}</td>
                  <td><strong>+${units}</strong></td>
                  <td>${escapeHtml(item.receivedByUserId || "-")}</td>
                  <td>${escapeHtml(item.reference || "-")}</td>
                  <td>${escapeHtml(item.note || "-")}</td>
                </tr>`;
              }).join("")}</tbody>
            </table>
          </div>
        ` : `<div class="m3-empty"><strong>No receiving history yet</strong><span>Confirmed PO receipts will appear here after M3 receiving is used.</span></div>`}
      </div>
      <footer class="m3-history-footer"><span>Receipt history is read-only.</span><button class="note-button" data-m3-close type="button">Close</button></footer>
    </section>
  `;
  document.body.appendChild(overlay);
  overlay.querySelectorAll("[data-m3-close]").forEach((button) => button.addEventListener("click", closeM3Overlay));
}

function closeM3Overlay() {
  document.querySelectorAll(".m3-overlay").forEach((node) => node.remove());
}

function bindOnce(node, key, eventName, handler) {
  if (!node || node.dataset[key] === "true") return;
  node.dataset[key] = "true";
  node.addEventListener(eventName, handler);
}

function setFormError(node, message) {
  if (!node) return;
  node.hidden = !message;
  node.textContent = message || "";
}

function formatStatus(value) {
  return String(value || "").replace(/_/g, " ");
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-PH", { month: "short", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return `₱${amount.toLocaleString("en-PH", { maximumFractionDigits: 2, minimumFractionDigits: amount % 1 ? 2 : 0 })}`;
}

function formatLocation(location) {
  return [location.branchName || location.branchCode, location.name].filter(Boolean).join(" / ") || location.code || location.id;
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return CSS.escape(String(value || ""));
  return String(value || "").replace(/(["\\])/g, "\\$1");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
