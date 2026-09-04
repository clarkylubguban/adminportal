import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, ui, css] = await Promise.all([
  readFile(new URL("../price-engine.html", import.meta.url), "utf8"),
  readFile(new URL("../src/priceEngineV1Ui.js", import.meta.url), "utf8"),
  readFile(new URL("../src/priceEngineV1.css", import.meta.url), "utf8"),
]);

assert.match(html, /id="price-engine-root"/);
assert.match(html, /mountPriceEngineV1/);
assert.match(html, /role:\s*"staff"/);
assert.match(html, /priceEngineV1\.css/);

for (const label of ["DTF", "Embroidery", "Screen Print"]) {
  assert.match(ui, new RegExp(label.replace(" ", "\\s*"), "i"));
}

assert.match(ui, /Standalone Employee Tool/);
assert.match(ui, /Calculate approved price/);
assert.match(ui, /Above 35,000 stitches stays custom\/manual in V1/);
assert.match(ui, /Only standard 30\+ pcs, 1-color, 1-placement jobs auto-price in V1/);
assert.doesNotMatch(ui, /customer_id|Customer C1|supplier|inventory consumption|bill of materials/i);

assert.match(css, /@media\(max-width:760px\)/);
assert.match(css, /\.pe-grid/);
assert.match(css, /min-height:44px/);

console.log("PRICE_ENGINE_V1_UI_CONTRACT_OK");
