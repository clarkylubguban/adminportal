import { garmentGuides, httpsUrl } from "../../src/shared/stlolabContent.js";

export const STAGING_REF = "fszkypwovpdthqfobxrk";
const short = (value, max = 2000) => typeof value === "string" ? value.trim().slice(0, max) : "";
export function eligibleProduct(row) {
  return row.product_type === "PHYSICAL" && row.active === true && row.sellable === true && row.readiness_status === "READY_FOR_SALE" && !row.archived_at && row.eligible_channels?.includes("STLOLAB");
}
export function publicProduct(row, variants, images) {
  if (!eligibleProduct(row)) return null;
  const cleanVariants = variants.filter(v => v.product_id === row.id && v.active === true && !v.archived_at).flatMap(v => {
    const minor = Math.round(Number(v.selling_price) * 100);
    return Number.isSafeInteger(minor) && minor > 0 ? [{ id: v.id, size: short(v.size, 32), color: short(v.color, 80), priceMinor: minor, availability: "unknown" }] : [];
  });
  const media = images.filter(i => i.product_id === row.id && i.active === true && !i.archived_at && httpsUrl(i.public_url))
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map(i => ({ key: i.id, label: i.is_primary ? "Primary" : "Photo", src: httpsUrl(i.public_url), alt: short(i.alt_text, 300) || short(row.name, 200), kind: "image" }));
  if (!cleanVariants.length || !media.length) return null;
  const config = row.typed_config || {};
  const content = config.stlolab || {};
  const rawGuide = content.guide;
  const spec = garmentGuides[rawGuide?.garment];
  let sizeGuide;
  if (spec && Array.isArray(rawGuide.rows)) {
    const rows = rawGuide.rows.slice(0, 30).map(r => ({ size: short(r.size, 32), cm: spec.columns.map((_, i) => typeof r.cm?.[i] === "number" && r.cm[i] > 0 && r.cm[i] <= 300 ? r.cm[i] : null) }));
    const coversVariants = cleanVariants.every(v => rows.some(r => r.size === v.size));
    const verified = rawGuide.verified === true && rows.length > 0 && coversVariants && rows.every(r => r.cm.every(v => v !== null));
    sizeGuide = { id: `${row.id}:fit:${Number(rawGuide.revision) || 1}`, garment: rawGuide.garment, title: spec.title, columns: spec.columns,
      rows: verified ? rows : rows.map(r => ({ ...r, cm: r.cm.map(() => null) })), verified,
      notes: Array.isArray(rawGuide.notes) ? rawGuide.notes.slice(0, 10).map(v => short(v, 300)) : [] };
  }
  if (httpsUrl(content.video)) media.push({ key: `${row.id}:video`, label: "Fit video", src: httpsUrl(content.video), alt: "", kind: "video" });
  return { id: row.id, slug: row.product_code, name: short(row.name, 200), collection: short(content.collection, 80),
    description: short(row.description), garment: spec ? rawGuide.garment : null, variants: cleanVariants, media,
    primaryMediaKey: images.find(i => i.product_id === row.id && i.active && !i.archived_at && i.is_primary && media.some(m => m.key === i.id))?.id || media[0].key,
    sizeGuideId: sizeGuide?.id || "", ...(sizeGuide ? { sizeGuide } : {}), preview: false,
    details: { material: short(config.material), weight: short(String(config.weight_gsm || ""), 80), fit: short(config.fit_cut), care: short(content.care), construction: short(content.construction), model: short(content.model, 200) } };
}
export function publicHero(row, product) {
  const h = row?.typed_config?.stlolab?.hero;
  if (!product || row?.typed_config?.is_featured !== true || !h || !httpsUrl(h.image) || !Array.isArray(h.title) || !h.title.length || !short(h.buttonLabel)) return null;
  const position = value => /^\d{1,3}% \d{1,3}%$/.test(value || "") && value.split(" ").every(p => Number(p.slice(0, -1)) <= 100) ? value : "50% 50%";
  return { productId: product.id, image: httpsUrl(h.image), alt: short(h.alt, 300) || product.name, title: h.title.slice(0, 3).map(v => short(v, 60)),
    eyebrow: short(h.eyebrow, 80), subtitle: short(h.subtitle, 300), buttonLabel: short(h.buttonLabel, 50),
    href: `/product/${encodeURIComponent(product.slug)}`, mobilePosition: position(h.mobilePosition), desktopPosition: position(h.desktopPosition) };
}
export async function readStlolabCatalog(supabase, { slug = "", offset = 0 } = {}) {
  let query = supabase.from("products").select("id,product_code,name,description,product_type,active,sellable,readiness_status,archived_at,eligible_channels,typed_config")
    .eq("product_type", "PHYSICAL").eq("active", true).eq("sellable", true).eq("readiness_status", "READY_FOR_SALE").is("archived_at", null).contains("eligible_channels", ["STLOLAB"]);
  if (slug) query = query.eq("product_code", slug);
  const result = await query.order("product_code").range(offset, offset + 49);
  if (result.error) throw new Error("Catalog query failed");
  const rows = result.data || [];
  if (!rows.length) return { products: [], hero: null, nextOffset: null };
  const ids = rows.map(r => r.id);
  const [variants, images] = await Promise.all([
    supabase.from("product_variants").select("id,product_id,size,color,selling_price,active,archived_at").in("product_id", ids).eq("active", true).is("archived_at", null).order("created_at").limit(5000),
    supabase.from("product_images").select("id,product_id,public_url,alt_text,position,is_primary,active,archived_at").in("product_id", ids).eq("active", true).is("archived_at", null).order("position").limit(1000),
  ]);
  if (variants.error || images.error) throw new Error("Catalog details query failed");
  if (variants.data?.length >= 1000 || images.data?.length >= 1000) throw new Error("Catalog detail window exceeded");
  const products = rows.map(r => publicProduct(r, variants.data || [], images.data || [])).filter(Boolean);
  const hero = rows.map(r => publicHero(r, products.find(p => p.id === r.id))).find(Boolean) || null;
  return { products, hero, nextOffset: !slug && rows.length === 50 ? offset + 50 : null };
}
