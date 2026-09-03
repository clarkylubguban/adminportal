import { getAdminOverviewSnapshot } from "./services/adminOverview.js";

const loadingOverview = {
  status: "loading",
  sourceStates: {},
  salesToday: { value: "…", note: "Loading sales", tone: "green", available: false },
  newInquiries: { value: "…", note: "Loading inquiries", tone: "purple", available: false },
  activeOrders: { value: "…", note: "Loading orders", tone: "blue", available: false },
  readyToRelease: { value: "…", note: "Loading production", tone: "teal", available: false },
  attention: [
    { label: "QUOTES WAITING", value: "…", note: "loading", tone: "danger", available: false },
    { label: "PRODUCTION BLOCKED", value: "…", note: "loading", tone: "danger", available: false },
    { label: "ORDERS DUE TODAY", value: "…", note: "loading", tone: "warning", available: false },
    { label: "LOW STOCK", value: "…", note: "loading", tone: "warning", available: false },
  ],
  attentionOpen: 0,
  sales: { available: false, rows: [], weekTotal: 0, change: "…" },
  funnel: {
    available: false,
    conversion: null,
    rows: [
      { label: "New inquiries", value: 0, tone: "blue" },
      { label: "Qualified", value: 0, tone: "teal" },
      { label: "Quote sent", value: 0, tone: "purple" },
      { label: "Order confirmed", value: 0, tone: "green" },
      { label: "In production", value: 0, tone: "orange" },
    ],
  },
  website: {
    connected: false,
    change: "NOT CONNECTED",
    metrics: [
      { label: "PRODUCT VIEWS", value: "—", note: "Reporting source not connected", tone: "teal", available: false },
      { label: "ADD TO CART", value: "—", note: "Reporting source not connected", tone: "purple", available: false },
      { label: "CHECKOUT STARTED", value: "—", note: "Reporting source not connected", tone: "blue", available: false },
      { label: "INQUIRY SUBMITTED", value: "…", note: "Loading inquiry source", tone: "green", available: false },
    ],
    products: [],
    note: "Meta Pixel events exist, but no dashboard reporting source is connected yet.",
  },
  operations: [
    { group: "PRODUCTION", value: "…", note: "in production", tone: "blue", available: false },
    { group: "PRODUCTION", value: "…", note: "ready to release", tone: "green", available: false },
    { group: "PRODUCTION", value: "…", note: "overdue", tone: "danger", available: false },
    { group: "INVENTORY", value: "…", note: "stock risk SKUs", tone: "warning", available: false },
    { group: "PURCHASING", value: "…", note: "open POs", tone: "teal", available: false },
    { group: "PURCHASING", value: "…", note: "partial receive", tone: "purple", available: false },
  ],
  operationsFlags: 0,
};

let overviewDataPromise = null;

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function metricCard(label, metric) {
  return `
    <article class="ov2-kpi-card">
      <div class="ov2-kpi-label"><span class="ov2-dot ${metric.tone}"></span>${esc(label)}</div>
      <strong>${esc(metric.value)}</strong>
      <small>${esc(metric.note)}</small>
    </article>`;
}

function attentionCard(item) {
  return `
    <article class="ov2-attention-card">
      <div><span class="ov2-dot ${item.tone}"></span><small>${esc(item.label)}</small></div>
      <strong>${esc(item.value)}</strong><span>${esc(item.note)}</span>
    </article>`;
}

function formatCompactMoney(value) {
  const amount = Number(value) || 0;
  if (Math.abs(amount) >= 1000) return `₱${(amount / 1000).toFixed(amount >= 10000 ? 1 : 2).replace(/\.0+$/, "")}k`;
  return `₱${Math.round(amount).toLocaleString("en-PH")}`;
}

function formatMoney(value) {
  return `₱${Math.round(Number(value) || 0).toLocaleString("en-PH")}`;
}

function lineChart(rows, available) {
  if (!available) {
    return `<svg class="ov2-line-chart" viewBox="0 0 760 150" role="img" aria-label="Sales data unavailable">
      <text x="380" y="82" text-anchor="middle" fill="#718096" font-size="11" font-weight="700">SALES DATA UNAVAILABLE FOR THIS ACCOUNT</text>
    </svg>`;
  }

  const normalized = Array.isArray(rows) && rows.length
    ? rows
    : Array.from({ length: 7 }, (_, index) => ({ day: String(index + 1), value: 0 }));
  const width = 760;
  const height = 150;
  const left = 36;
  const right = 20;
  const top = 20;
  const bottom = 34;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const maxValue = Math.max(...normalized.map((row) => Number(row.value) || 0), 1);
  const max = maxValue * 1.12;
  const min = 0;
  const step = normalized.length > 1 ? innerW / (normalized.length - 1) : 0;
  const points = normalized.map((row, index) => {
    const value = Number(row.value) || 0;
    const x = left + (step * index);
    const y = top + ((max - value) / (max - min)) * innerH;
    return { ...row, value, x, y };
  });
  const path = points.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const grids = [28, 58, 88, 118].map((y) => `<line class="ov2-chart-grid" x1="${left}" y1="${y}" x2="${width-right}" y2="${y}" />`).join("");
  const labels = points.map((point) => `
    <g>
      <circle class="ov2-chart-point" cx="${point.x}" cy="${point.y}" r="4.5" />
      <text class="ov2-chart-value" x="${point.x}" y="${Math.max(12, point.y - 10)}" text-anchor="middle">${esc(formatCompactMoney(point.value))}</text>
      <text class="ov2-chart-day" x="${point.x}" y="143" text-anchor="middle">${esc(point.day)}</text>
    </g>`).join("");
  return `<svg class="ov2-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Seven day sales trend">
    ${grids}
    <path class="ov2-chart-line" d="${path}" />
    ${labels}
  </svg>`;
}

function funnelRows(rows, available) {
  if (!available) {
    return `<div style="min-height:150px;display:flex;align-items:center;justify-content:center;color:#718096;font-size:10px;font-weight:800;">INQUIRY FUNNEL DATA UNAVAILABLE FOR THIS ACCOUNT</div>`;
  }
  const max = Math.max(...rows.map((row) => Number(row.value) || 0), 1);
  return rows.map((row) => {
    const value = Number(row.value) || 0;
    const width = value > 0 ? Math.max(4, (value / max) * 100) : 0;
    return `
      <div class="ov2-funnel-row">
        <div><span>${esc(row.label)}</span><strong>${esc(value)}</strong></div>
        <div class="ov2-funnel-track"><span class="${row.tone}" style="width:${width.toFixed(1)}%"></span></div>
      </div>`;
  }).join("");
}

function websiteMetric(metric) {
  return `
    <article class="ov2-web-metric">
      <div><span class="ov2-dot ${metric.tone}"></span><small>${esc(metric.label)}</small></div>
      <strong>${esc(metric.value)}</strong>
      <span>${esc(metric.note)}</span>
    </article>`;
}

function operationsMetric(metric) {
  return `
    <article class="ov2-ops-metric">
      <div><span class="ov2-dot ${metric.tone}"></span><small>${esc(metric.group)}</small></div>
      <strong>${esc(metric.value)}</strong>
      <span>${esc(metric.note)}</span>
    </article>`;
}

function quickLink(label, href, primary = false) {
  return `<a class="ov2-action ${primary ? "primary" : ""}" href="${href}">${esc(label)}</a>`;
}

function productIntentTable(website) {
  if (!website?.products?.length) {
    return `
      <div class="ov2-product-table">
        <div class="ov2-product-row header"><span>PRODUCT</span><span>VIEWS</span><span>CART</span><span>INQ.</span></div>
        <div class="ov2-product-row unavailable"><strong>Product-intent reporting not connected</strong><span>—</span><span>—</span><span>—</span></div>
      </div>`;
  }
  return `
    <div class="ov2-product-table">
      <div class="ov2-product-row header"><span>PRODUCT</span><span>VIEWS</span><span>CART</span><span>INQ.</span></div>
      ${website.products.map((product) => `<div class="ov2-product-row"><strong>${esc(product.name)}</strong><span>${esc(product.views)}</span><span class="cart">${esc(product.carts)}</span><span class="inq">${esc(product.inquiries)}</span></div>`).join("")}
    </div>`;
}

function datePill() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
  }).formatToParts(new Date());
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";
  return `${month.toUpperCase()} ${day} · TODAY`;
}

function dataBadge(data) {
  if (data.status === "loading") return "LOADING DATA";
  return window.location.hostname.includes("staging") ? "STAGING DATA" : "LIVE DATA";
}

function sourceNote(data) {
  if (data.status === "loading") return "Loading authoritative TRRY sources…";
  const states = data.sourceStates || {};
  const unavailable = Object.entries(states)
    .filter(([key, state]) => key !== "websiteAnalytics" && state !== "success")
    .map(([key]) => key);
  const systemLabel = window.location.hostname.includes("staging") ? "STAGING SYSTEM DATA" : "LIVE SYSTEM DATA";
  if (!unavailable.length) {
    return `${systemLabel} · Website views/cart/checkout reporting is not connected yet.`;
  }
  return `${systemLabel} · Unavailable: ${unavailable.join(", ")} · Website views/cart/checkout reporting is not connected yet.`;
}

function overviewMarkup(data) {
  const conversion = data.funnel?.conversion;
  const conversionLabel = Number.isFinite(conversion) ? `${conversion.toFixed(1)}%` : "—";
  const attentionLabel = `${Number(data.attentionOpen || 0)} OPEN`;
  const salesSummary = data.sales?.available
    ? `${formatMoney(data.sales.weekTotal)} this week · ${data.sales.change}`
    : "SALES SOURCE UNAVAILABLE";
  const website = data.website || loadingOverview.website;
  return `
    <div class="ov2-shell">
      <header class="ov2-header">
        <div>
          <nav>Home <span>›</span> Overview</nav>
          <h1>Overview</h1>
          <p>Your command center — what needs attention today across sales, inquiries, production and stock.</p>
        </div>
        <div class="ov2-header-actions">
          <span class="ov2-preview-pill">${esc(dataBadge(data))}</span>
          <span class="ov2-date-pill">${esc(datePill())}</span>
          <a class="ov2-open-pos" href="/pos">OPEN POS</a>
        </div>
      </header>

      <section class="ov2-kpi-grid" aria-label="Today KPIs">
        ${metricCard("SALES TODAY", data.salesToday)}
        ${metricCard("NEW INQUIRIES", data.newInquiries)}
        ${metricCard("ACTIVE ORDERS", data.activeOrders)}
        ${metricCard("READY TO RELEASE", data.readyToRelease)}
      </section>

      <section class="ov2-card ov2-attention">
        <div class="ov2-section-head">
          <div class="ov2-title-inline"><h2>Needs your attention</h2><span>${esc(attentionLabel)}</span></div>
          <small>Highest-impact items first · click through to resolve</small>
        </div>
        <div class="ov2-attention-grid">${data.attention.map(attentionCard).join("")}</div>
      </section>

      <section class="ov2-card ov2-quick-actions">
        <div><h3>Quick actions</h3><p>Start the common owner workflows.</p></div>
        <div>
          ${quickLink("+ INQUIRY", "/inquiries", true)}
          ${quickLink("+ SALE", "/pos")}
          ${quickLink("+ RECEIVE", "/catalog/inventory")}
          ${quickLink("+ PURCHASE ORDER", "/catalog/purchasing")}
        </div>
      </section>

      <section class="ov2-two-col ov2-performance-row">
        <article class="ov2-card ov2-sales-card">
          <div class="ov2-section-head">
            <div><h2>Sales performance</h2><p>POS sales · last 7 days</p></div>
            <div class="ov2-range"><button type="button" class="active">7 DAYS</button><button type="button" disabled title="30-day range is not wired yet">30 DAYS</button></div>
          </div>
          <div class="ov2-chart-summary">
            <span><i></i> DAILY SALES</span>
            <strong>${esc(salesSummary)}</strong>
          </div>
          ${lineChart(data.sales?.rows || [], Boolean(data.sales?.available))}
        </article>

        <article class="ov2-card ov2-funnel-card">
          <div class="ov2-section-head">
            <div><h2>Inquiry → order funnel</h2><p>Last 30 days · conversion visibility</p></div>
            <div class="ov2-conversion"><strong>${esc(conversionLabel)}</strong><span>QUOTE → ORDER</span></div>
          </div>
          <div class="ov2-funnel-list">${funnelRows(data.funnel?.rows || [], Boolean(data.funnel?.available))}</div>
        </article>
      </section>

      <section class="ov2-two-col ov2-bottom-row">
        <article class="ov2-card ov2-website-card">
          <div class="ov2-section-head">
            <div><h2>Website performance</h2><p>Traffic → cart → checkout → inquiry intent</p></div>
            <div class="ov2-change"><strong>${esc(website.change)}</strong><span>REPORTING</span></div>
          </div>
          <div class="ov2-web-metrics">${website.metrics.map(websiteMetric).join("")}</div>
          <div class="ov2-table-title"><strong>TOP PRODUCTS BY INTENT</strong><span>Views · Add to cart · Inquiries</span></div>
          ${productIntentTable(website)}
        </article>

        <article class="ov2-card ov2-ops-card">
          <div class="ov2-section-head">
            <div><h2>Operations snapshot</h2><p>Production · inventory · purchasing</p></div>
            <span class="ov2-flags">${esc(data.operationsFlags || 0)} FLAGS</span>
          </div>
          <div class="ov2-ops-grid">${data.operations.map(operationsMetric).join("")}</div>
          <div class="ov2-ops-footer"><span>Click a metric to open its module.</span><div><a href="/production">PRODUCTION</a><a href="/catalog/inventory">INVENTORY</a><a href="/catalog/purchasing">PURCHASING</a></div></div>
        </article>
      </section>

      <footer class="ov2-data-note"><span></span> ${esc(sourceNote(data))}</footer>
    </div>`;
}

function getOverviewData() {
  if (!overviewDataPromise) {
    overviewDataPromise = getAdminOverviewSnapshot().catch((error) => {
      console.error("Unable to load Overview V2 data.", error);
      return {
        ...loadingOverview,
        status: "error",
        salesToday: { value: "—", note: "Data unavailable", tone: "green", available: false },
        newInquiries: { value: "—", note: "Data unavailable", tone: "purple", available: false },
        activeOrders: { value: "—", note: "Data unavailable", tone: "blue", available: false },
        readyToRelease: { value: "—", note: "Data unavailable", tone: "teal", available: false },
      };
    });
  }
  return overviewDataPromise;
}

async function loadOverviewInto(page) {
  const data = await getOverviewData();
  if (!page.isConnected || page.dataset.overviewV2Mounted !== "true") return;
  page.innerHTML = overviewMarkup(data);
}

function mountOverviewV2() {
  const page = document.querySelector(".mvp-overview-page");
  if (!page || page.dataset.overviewV2Mounted === "true") return;
  page.dataset.overviewV2Mounted = "true";
  page.innerHTML = overviewMarkup(loadingOverview);
  void loadOverviewInto(page);
}

const observer = new MutationObserver(() => mountOverviewV2());

function startOverviewV2() {
  mountOverviewV2();
  const root = document.getElementById("root");
  if (root) observer.observe(root, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startOverviewV2, { once: true });
} else {
  startOverviewV2();
}
