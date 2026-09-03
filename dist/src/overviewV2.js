const overviewSample = {
  salesToday: { value: "₱18,450", note: "14 transactions · AOV ₱1,318", tone: "green" },
  newInquiries: { value: "7", note: "5 need action · 2 from website", tone: "purple" },
  activeOrders: { value: "18", note: "6 due today · 2 overdue", tone: "blue" },
  readyToRelease: { value: "7", note: "4 pickup · 3 delivery", tone: "teal" },
  attention: [
    { label: "QUOTES WAITING", value: "5", note: ">24h", tone: "danger" },
    { label: "PRODUCTION BLOCKED", value: "2", note: "jobs", tone: "danger" },
    { label: "ORDERS DUE TODAY", value: "6", note: "orders", tone: "warning" },
    { label: "LOW STOCK", value: "4", note: "SKUs", tone: "warning" },
  ],
  sales: [
    { day: "SAT", value: 12.4 },
    { day: "SUN", value: 15.8 },
    { day: "MON", value: 13.9 },
    { day: "TUE", value: 18.6 },
    { day: "WED", value: 16.7 },
    { day: "THU", value: 21.5 },
    { day: "FRI", value: 18.5 },
  ],
  funnel: [
    { label: "New inquiries", value: 63, tone: "blue" },
    { label: "Qualified", value: 41, tone: "teal" },
    { label: "Quote sent", value: 32, tone: "purple" },
    { label: "Order confirmed", value: 18, tone: "green" },
    { label: "In production", value: 14, tone: "orange" },
  ],
  website: {
    change: "+18.2%",
    metrics: [
      { label: "PRODUCT VIEWS", value: "1,284", note: "last 7 days", tone: "teal" },
      { label: "ADD TO CART", value: "96", note: "7.5% view → cart", tone: "purple" },
      { label: "CHECKOUT STARTED", value: "41", note: "42.7% cart → checkout", tone: "blue" },
      { label: "INQUIRY SUBMITTED", value: "27", note: "2.1% view → inquiry", tone: "green" },
    ],
    products: [
      { name: "Premium Cotton Tee", views: 428, carts: 41, inquiries: 12 },
      { name: "Box Tee Oversize", views: 356, carts: 33, inquiries: 9 },
      { name: "Embroidery Cap", views: 211, carts: 14, inquiries: 4 },
    ],
  },
  operations: [
    { group: "PRODUCTION", value: "9", note: "in production", tone: "blue" },
    { group: "PRODUCTION", value: "7", note: "ready to release", tone: "green" },
    { group: "PRODUCTION", value: "2", note: "overdue", tone: "danger" },
    { group: "INVENTORY", value: "4", note: "low stock SKUs", tone: "warning" },
    { group: "PURCHASING", value: "3", note: "open POs", tone: "teal" },
    { group: "PURCHASING", value: "1", note: "partial receive", tone: "purple" },
  ],
};

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

function lineChart(rows) {
  const width = 760;
  const height = 150;
  const left = 36;
  const right = 20;
  const top = 20;
  const bottom = 34;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const min = Math.min(...rows.map((row) => row.value)) - 1.4;
  const max = Math.max(...rows.map((row) => row.value)) + 1.2;
  const step = innerW / (rows.length - 1);
  const points = rows.map((row, index) => {
    const x = left + (step * index);
    const y = top + ((max - row.value) / (max - min)) * innerH;
    return { ...row, x, y };
  });
  const path = points.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const grids = [28, 58, 88, 118].map((y) => `<line class="ov2-chart-grid" x1="${left}" y1="${y}" x2="${width-right}" y2="${y}" />`).join("");
  const labels = points.map((point) => `
    <g>
      <circle class="ov2-chart-point" cx="${point.x}" cy="${point.y}" r="4.5" />
      <text class="ov2-chart-value" x="${point.x}" y="${Math.max(12, point.y - 10)}" text-anchor="middle">₱${point.value.toFixed(1)}k</text>
      <text class="ov2-chart-day" x="${point.x}" y="143" text-anchor="middle">${esc(point.day)}</text>
    </g>`).join("");
  return `<svg class="ov2-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Seven day sales trend">
    ${grids}
    <path class="ov2-chart-line" d="${path}" />
    ${labels}
  </svg>`;
}

function funnelRows(rows) {
  const max = Math.max(...rows.map((row) => row.value));
  return rows.map((row) => `
    <div class="ov2-funnel-row">
      <div><span>${esc(row.label)}</span><strong>${esc(row.value)}</strong></div>
      <div class="ov2-funnel-track"><span class="${row.tone}" style="width:${Math.max(7, (row.value / max) * 100).toFixed(1)}%"></span></div>
    </div>`).join("");
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

function overviewMarkup() {
  const sample = overviewSample;
  const conversion = ((sample.funnel.find((row) => row.label === "Order confirmed")?.value || 0) / sample.funnel[0].value) * 100;
  return `
    <div class="ov2-shell">
      <header class="ov2-header">
        <div>
          <nav>Home <span>›</span> Overview</nav>
          <h1>Overview</h1>
          <p>Your command center — what needs attention today across sales, inquiries, production and stock.</p>
        </div>
        <div class="ov2-header-actions">
          <span class="ov2-preview-pill">UI PREVIEW</span>
          <span class="ov2-date-pill">SEP 3 · TODAY</span>
          <a class="ov2-open-pos" href="/pos">OPEN POS</a>
        </div>
      </header>

      <section class="ov2-kpi-grid" aria-label="Today KPIs">
        ${metricCard("SALES TODAY", sample.salesToday)}
        ${metricCard("NEW INQUIRIES", sample.newInquiries)}
        ${metricCard("ACTIVE ORDERS", sample.activeOrders)}
        ${metricCard("READY TO RELEASE", sample.readyToRelease)}
      </section>

      <section class="ov2-card ov2-attention">
        <div class="ov2-section-head">
          <div class="ov2-title-inline"><h2>Needs your attention</h2><span>6 OPEN</span></div>
          <small>Highest-impact items first · click through to resolve</small>
        </div>
        <div class="ov2-attention-grid">${sample.attention.map(attentionCard).join("")}</div>
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
            <div class="ov2-range"><button type="button" class="active">7 DAYS</button><button type="button">30 DAYS</button></div>
          </div>
          <div class="ov2-chart-summary">
            <span><i></i> DAILY SALES</span>
            <strong>₱117.4K this week · +12.4%</strong>
          </div>
          ${lineChart(sample.sales)}
        </article>

        <article class="ov2-card ov2-funnel-card">
          <div class="ov2-section-head">
            <div><h2>Inquiry → order funnel</h2><p>Last 30 days · conversion visibility</p></div>
            <div class="ov2-conversion"><strong>${conversion.toFixed(1)}%</strong><span>QUOTE → ORDER</span></div>
          </div>
          <div class="ov2-funnel-list">${funnelRows(sample.funnel)}</div>
        </article>
      </section>

      <section class="ov2-two-col ov2-bottom-row">
        <article class="ov2-card ov2-website-card">
          <div class="ov2-section-head">
            <div><h2>Website performance</h2><p>Traffic → cart → checkout → inquiry intent</p></div>
            <div class="ov2-change"><strong>${sample.website.change}</strong><span>VS PREV. 7 DAYS</span></div>
          </div>
          <div class="ov2-web-metrics">${sample.website.metrics.map(websiteMetric).join("")}</div>
          <div class="ov2-table-title"><strong>TOP PRODUCTS BY INTENT</strong><span>Views · Add to cart · Inquiries</span></div>
          <div class="ov2-product-table">
            <div class="ov2-product-row header"><span>PRODUCT</span><span>VIEWS</span><span>CART</span><span>INQ.</span></div>
            ${sample.website.products.map((product) => `<div class="ov2-product-row"><strong>${esc(product.name)}</strong><span>${product.views}</span><span class="cart">${product.carts}</span><span class="inq">${product.inquiries}</span></div>`).join("")}
          </div>
        </article>

        <article class="ov2-card ov2-ops-card">
          <div class="ov2-section-head">
            <div><h2>Operations snapshot</h2><p>Production · inventory · purchasing</p></div>
            <span class="ov2-flags">6 FLAGS</span>
          </div>
          <div class="ov2-ops-grid">${sample.operations.map(operationsMetric).join("")}</div>
          <div class="ov2-ops-footer"><span>Click a metric to open its module.</span><div><a href="/production">PRODUCTION</a><a href="/catalog/inventory">INVENTORY</a><a href="/catalog/purchasing">PURCHASING</a></div></div>
        </article>
      </section>

      <footer class="ov2-data-note"><span></span> UI PROTOTYPE · SAMPLE VALUES ONLY · Data-source wiring and final metric definitions after UI approval.</footer>
    </div>`;
}

function mountOverviewV2() {
  const page = document.querySelector(".mvp-overview-page");
  if (!page || page.dataset.overviewV2Mounted === "true") return;
  page.dataset.overviewV2Mounted = "true";
  page.innerHTML = overviewMarkup();
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
