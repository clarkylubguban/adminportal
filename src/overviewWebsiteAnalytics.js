import { getCurrentAdminAuthSession } from "./lib/supabaseClient.js";

let activeCard = null;
let requestId = 0;

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatCount(value) {
  return Math.max(0, Number(value) || 0).toLocaleString("en-PH");
}

function formatChange(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const rounded = Math.round(number * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`;
}

function rate(part, whole) {
  const numerator = Number(part) || 0;
  const denominator = Number(whole) || 0;
  return denominator ? `${((numerator / denominator) * 100).toFixed(1)}%` : "0.0%";
}

function metricNodes(card) {
  return [...card.querySelectorAll(".ov2-web-metric")];
}

function applyWebsiteLabels(card) {
  const description = card.querySelector(".ov2-section-head > div:first-child p");
  if (description) description.textContent = "Page view → start order → product open → inquiry";

  const labels = ["PAGE VIEWS", "START ORDER", "PRODUCT OPENS", "INQUIRY SUBMITTED"];
  metricNodes(card).forEach((metric, index) => {
    const label = metric.querySelector("small");
    if (label && labels[index]) label.textContent = labels[index];
  });

  const tableMeta = card.querySelector(".ov2-table-title > span");
  if (tableMeta) tableMeta.textContent = "Product opens · Inquiries · Conversion";

  const header = card.querySelector(".ov2-product-row.header");
  if (header) header.innerHTML = "<span>PRODUCT</span><span>OPENS</span><span>INQ.</span><span>CONV.</span>";
}

function setMetric(card, index, value, note) {
  const metric = metricNodes(card)[index];
  if (!metric) return;
  const valueNode = metric.querySelector(":scope > strong");
  const noteNode = metric.querySelector(":scope > span");
  if (valueNode) valueNode.textContent = value;
  if (noteNode) noteNode.textContent = note;
}

function setReportingStatus(card, headline, subline) {
  const value = card.querySelector(".ov2-change > strong");
  const label = card.querySelector(".ov2-change > span");
  if (value) value.textContent = headline;
  if (label) label.textContent = subline;
}

function renderProducts(card, products) {
  const table = card.querySelector(".ov2-product-table");
  if (!table) return;

  const rows = Array.isArray(products) ? products : [];
  table.innerHTML = `
    <div class="ov2-product-row header"><span>PRODUCT</span><span>OPENS</span><span>INQ.</span><span>CONV.</span></div>
    ${rows.length ? rows.map((product) => `
      <div class="ov2-product-row">
        <strong>${esc(product.name)}</strong>
        <span>${esc(formatCount(product.opens))}</span>
        <span class="inq">${esc(formatCount(product.inquiries))}</span>
        <span>${esc(`${Number(product.conversion || 0).toFixed(1)}%`)}</span>
      </div>`).join("") : `
      <div class="ov2-product-row unavailable">
        <strong>No tracked product opens yet</strong><span>0</span><span>0</span><span>0.0%</span>
      </div>`}
  `;
}

function showReportingUnavailable(card, reason = "Reporting credential needed") {
  setMetric(card, 0, "—", reason);
  setMetric(card, 1, "—", reason);
  setMetric(card, 2, "—", reason);
  setReportingStatus(card, "TRACKING", "REPORTING PENDING");
  renderProducts(card, []);
}

async function hydrateWebsiteAnalytics(card) {
  const currentRequest = ++requestId;
  activeCard = card;
  applyWebsiteLabels(card);

  const session = await getCurrentAdminAuthSession();
  if (card !== activeCard || currentRequest !== requestId) return;
  if (!session?.access_token) {
    showReportingUnavailable(card, "Admin session required");
    return;
  }

  try {
    const response = await fetch("/api/task-views?view=website-analytics", {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (card !== activeCard || currentRequest !== requestId) return;

    if (!response.ok || !payload?.connected) {
      const reason = payload?.status === "credential_invalid"
        ? "Reporting credential invalid"
        : payload?.status === "credential_required"
          ? "Reporting credential needed"
          : "Reporting source unavailable";
      showReportingUnavailable(card, reason);
      return;
    }

    const pageViews = Number(payload.metrics?.pageViews) || 0;
    const startOrders = Number(payload.metrics?.startOrders) || 0;
    const productOpens = Number(payload.metrics?.productOpens) || 0;

    setMetric(card, 0, formatCount(pageViews), "last 7 days");
    setMetric(card, 1, formatCount(startOrders), `${rate(startOrders, pageViews)} page view → start`);
    setMetric(card, 2, formatCount(productOpens), `${rate(productOpens, startOrders)} start → product`);
    setReportingStatus(card, formatChange(payload.pageViewChange), "VS PREV. 7 DAYS");
    renderProducts(card, payload.products || []);
  } catch {
    if (card !== activeCard || currentRequest !== requestId) return;
    showReportingUnavailable(card, "Reporting source unavailable");
  }
}

function mountWebsiteAnalytics() {
  const card = document.querySelector(".ov2-website-card");
  if (!card || card === activeCard) return;
  void hydrateWebsiteAnalytics(card);
}

const observer = new MutationObserver(mountWebsiteAnalytics);

function startWebsiteAnalytics() {
  mountWebsiteAnalytics();
  const root = document.getElementById("root");
  if (root) observer.observe(root, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startWebsiteAnalytics, { once: true });
} else {
  startWebsiteAnalytics();
}
