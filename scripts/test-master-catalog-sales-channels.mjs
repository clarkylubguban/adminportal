import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canonicalSalesChannelCodes,
  canonicalSalesChannels,
  catalogOptions,
} from "../src/services/adminCatalog.js";

const root = process.cwd();
const main = readFileSync(join(root, "src", "main.js"), "utf8");
const styles = readFileSync(join(root, "src", "styles.css"), "utf8");
const migration = readFileSync(join(root, "supabase", "migrations", "20260824005747_govern_canonical_sales_channels.sql"), "utf8");
const selectedChannelStyles = styles.match(/\.catalog-sales-channel-chip\.selected\s*\{[^}]+\}/)?.[0] ?? "";

assert.deepEqual(
  canonicalSalesChannels.map((channel) => [channel.code, channel.label]),
  [
    ["STLOLAB", "STLOLab"],
    ["TRRY_WEBAPP", "TRRY WebApp"],
    ["POS", "POS"],
    ["TRRY_APPAREL", "TRRY Apparel"],
  ],
  "canonical channel registry must match approved Sales Channels"
);

assert.deepEqual(
  catalogOptions.map((option) => option.channel),
  ["STLOLAB", "TRRY_WEBAPP", "POS", "TRRY_APPAREL"],
  "Product Editor options must persist canonical channel codes"
);

assert.equal(canonicalSalesChannelCodes.has("FOGHEAD"), false, "FOGHEAD remains a Brand value, not a Sales Channel");
assert.equal(main.includes("renderCatalogSalesChannels"), true, "Product Editor renders Sales Channels multi-select");
assert.equal(main.includes("data-catalog-sales-channel"), true, "Sales Channels are checkbox/chip controls");
assert.equal(main.includes("Legacy channel requires correction"), true, "legacy invalid channel warning is present");
assert.equal(main.includes("Ready for Sale sellable products require at least one Sales Channel."), true, "published/sellable validation blocks zero channels");
assert.equal(main.includes('renderCatalogField("brandId", "Brand"'), true, "Brand field remains separate");
assert.equal(main.includes('renderCatalogField("category", "Category"'), true, "Category field remains separate");
assert.equal(styles.includes(".catalog-sales-channel-chip.selected"), true, "Sales Channel selected state is styled");
assert.equal(styles.includes(".catalog-sales-channel-chip:focus-within"), true, "Sales Channel focus state reuses form focus treatment");
assert.equal(styles.includes("grid-template-columns: repeat(4, minmax(max-content, 1fr))"), true, "Sales Channels use compact four-column desktop rhythm");
assert.equal(selectedChannelStyles.includes("var(--trry-lime-soft)"), false, "Sales Channel selected state must not use promotional lime fill");
assert.equal(selectedChannelStyles.includes("var(--trry-focus)"), false, "Sales Channel selected state must not use heavy black outline");
assert.equal(styles.includes("height: 14px;"), true, "Sales Channel checkbox remains compact");

for (const code of canonicalSalesChannelCodes) {
  assert.equal(migration.includes(`'${code}'`), true, `migration allows ${code}`);
}
assert.equal(migration.includes("not valid"), true, "migration must allow staging to identify legacy rows before validation");
assert.equal(migration.includes("products_eligible_channels_canonical_values"), true, "canonical value check exists");
assert.equal(migration.includes("products_ready_sellable_requires_sales_channel"), true, "ready/sellable requires a channel");
assert.equal(migration.includes("products_eligible_channels_no_duplicates"), true, "duplicate channels are rejected");

console.log(JSON.stringify({ result: "master_catalog_sales_channels_ok", assertions: 22 }, null, 2));
