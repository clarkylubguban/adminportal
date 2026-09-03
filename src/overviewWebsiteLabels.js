let activeCard = null;

function applyWebsiteLabels() {
  const card = document.querySelector(".ov2-website-card");
  if (!card || card === activeCard) return;
  activeCard = card;

  const description = card.querySelector(".ov2-section-head > div:first-child p");
  if (description) description.textContent = "Page view → start order → product open → inquiry";

  const labels = ["PAGE VIEWS", "START ORDER", "PRODUCT OPENS", "INQUIRY SUBMITTED"];
  const metrics = [...card.querySelectorAll(".ov2-web-metric")];
  metrics.forEach((metric, index) => {
    const label = metric.querySelector("small");
    if (label && labels[index]) label.textContent = labels[index];
    if (index < 3) {
      const value = metric.querySelector(":scope > strong");
      const note = metric.querySelector(":scope > span");
      if (value) value.textContent = "—";
      if (note) note.textContent = "Pending free reporting source";
    }
  });

  const reporting = card.querySelector(".ov2-change > strong");
  const reportingLabel = card.querySelector(".ov2-change > span");
  if (reporting) reporting.textContent = "FREE ONLY";
  if (reportingLabel) reportingLabel.textContent = "NO PAID ANALYTICS";

  const tableMeta = card.querySelector(".ov2-table-title > span");
  if (tableMeta) tableMeta.textContent = "Product opens · Inquiries · Conversion";

  const table = card.querySelector(".ov2-product-table");
  if (table) {
    table.innerHTML = `
      <div class="ov2-product-row header"><span>PRODUCT</span><span>OPENS</span><span>INQ.</span><span>CONV.</span></div>
      <div class="ov2-product-row unavailable"><strong>Product intent reporting pending</strong><span>—</span><span>—</span><span>—</span></div>
    `;
  }
}

const observer = new MutationObserver(applyWebsiteLabels);

function start() {
  applyWebsiteLabels();
  const root = document.getElementById("root");
  if (root) observer.observe(root, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
