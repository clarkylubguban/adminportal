import {
  getDtfApprovedPrice,
  getEmbroideryApprovedPrice,
  getScreenPrintApprovedPrice,
} from "./priceEngineV1.js";

function peso(value) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function field(label, control) {
  return `<label class="pe-field"><span>${label}</span>${control}</label>`;
}

function renderResult(result) {
  if (!result) return `<div class="pe-empty">Enter job details to see the approved price.</div>`;
  if (result.mode === "CUSTOM") {
    return `<div class="pe-result pe-result-custom"><strong>Custom pricing required</strong><span>${result.reason}</span></div>`;
  }
  return `<div class="pe-result"><div><span>Approved price</span><strong>${peso(result.pricePerPiece)} / pc</strong></div><div><span>Subtotal</span><strong>${peso(result.subtotal)}</strong></div>${result.digitizingFee ? `<div><span>Digitizing</span><strong>${peso(result.digitizingFee)}</strong></div>` : ""}${result.confidence ? `<small>${result.confidence.replaceAll("_", " ")}</small>` : ""}</div>`;
}

function readPositiveInt(form, name) {
  const value = Number(form.elements[name]?.value || 0);
  if (!Number.isInteger(value) || value <= 0) throw new Error("Use positive whole numbers only.");
  return value;
}

export function createPriceEngineV1Ui({ role = "staff" } = {}) {
  const root = document.createElement("section");
  root.className = "pe-shell";
  root.innerHTML = `
    <div class="pe-head">
      <div>
        <p class="pe-eyebrow">Standalone Employee Tool</p>
        <h1>Price Engine</h1>
        <p>Get the approved TRRY selling price before quoting a customer.</p>
      </div>
      <span class="pe-role">${role === "owner" || role === "admin" ? "Owner/Admin" : "Staff"}</span>
    </div>
    <div class="pe-methods" role="tablist" aria-label="Production method">
      <button type="button" class="active" data-method="dtf">DTF</button>
      <button type="button" data-method="embroidery">Embroidery</button>
      <button type="button" data-method="screen-print">Screen Print</button>
    </div>
    <div class="pe-grid">
      <form class="pe-card pe-form" novalidate></form>
      <aside class="pe-card pe-output" aria-live="polite"></aside>
    </div>
  `;

  const form = root.querySelector(".pe-form");
  const output = root.querySelector(".pe-output");
  const methodButtons = [...root.querySelectorAll("[data-method]")];
  let method = "dtf";

  function renderForm() {
    if (method === "dtf") {
      form.innerHTML = `
        <div class="pe-section-title"><h2>DTF Printing</h2><span>LOCKED V1</span></div>
        ${field("Quantity", '<input name="quantity" type="number" min="1" step="1" value="30" inputmode="numeric">')}
        <button class="pe-primary" type="submit">Calculate approved price</button>
        <p class="pe-help">Quantity automatically selects the approved DTF tier.</p>
      `;
    } else if (method === "embroidery") {
      form.innerHTML = `
        <div class="pe-section-title"><h2>Embroidery</h2><span>PROVISIONAL</span></div>
        ${field("Quantity", '<input name="quantity" type="number" min="1" step="1" value="30" inputmode="numeric">')}
        ${field("Stitch count", '<input name="stitchCount" type="number" min="1" step="1" value="15000" inputmode="numeric">')}
        ${field("Digitizing", '<select name="digitizing"><option value="none">Existing file / none</option><option value="simple">Simple — ₱350</option><option value="complex">Complex — ₱500</option></select>')}
        <button class="pe-primary" type="submit">Calculate approved price</button>
        <p class="pe-help">Above 35,000 stitches stays custom/manual in V1.</p>
      `;
    } else {
      form.innerHTML = `
        <div class="pe-section-title"><h2>Screen Print</h2><span>PARTIALLY VERIFIED</span></div>
        ${field("Quantity", '<input name="quantity" type="number" min="1" step="1" value="30" inputmode="numeric">')}
        ${field("Colors", '<input name="colors" type="number" min="1" step="1" value="1" inputmode="numeric">')}
        ${field("Placements", '<input name="placements" type="number" min="1" step="1" value="1" inputmode="numeric">')}
        <label class="pe-check"><input name="specialGarment" type="checkbox"><span>Special garment / unusual setup</span></label>
        <button class="pe-primary" type="submit">Calculate approved price</button>
        <p class="pe-help">Only standard 30+ pcs, 1-color, 1-placement jobs auto-price in V1.</p>
      `;
    }
    output.innerHTML = renderResult(null);
  }

  methodButtons.forEach((button) => {
    button.addEventListener("click", () => {
      method = button.dataset.method;
      methodButtons.forEach((item) => item.classList.toggle("active", item === button));
      renderForm();
    });
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      let result;
      if (method === "dtf") {
        result = getDtfApprovedPrice(readPositiveInt(form, "quantity"));
      } else if (method === "embroidery") {
        result = getEmbroideryApprovedPrice({
          quantity: readPositiveInt(form, "quantity"),
          stitchCount: readPositiveInt(form, "stitchCount"),
          digitizing: form.elements.digitizing.value,
        });
      } else {
        result = getScreenPrintApprovedPrice({
          quantity: readPositiveInt(form, "quantity"),
          colors: readPositiveInt(form, "colors"),
          placements: readPositiveInt(form, "placements"),
          specialGarment: Boolean(form.elements.specialGarment.checked),
        });
      }
      output.innerHTML = renderResult(result);
    } catch (error) {
      output.innerHTML = `<div class="pe-result pe-result-error"><strong>Check the inputs</strong><span>${error.message}</span></div>`;
    }
  });

  renderForm();
  return root;
}

export function mountPriceEngineV1(target, options = {}) {
  if (!target) throw new Error("Price Engine mount target is required.");
  target.replaceChildren(createPriceEngineV1Ui(options));
}
