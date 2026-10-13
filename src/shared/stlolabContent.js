// Storefront fields are owned by the existing Master Catalog product editor.
export const garmentGuides = {
  hoodie: { title: "Hoodie", columns: ["Chest width", "Body length", "Sleeve"] },
  shorts: { title: "Shorts", columns: ["Waist relaxed", "Waist stretched", "Hip width", "Outseam"] },
  tee: { title: "Regular tee", columns: ["Chest width", "Body length", "Shoulder"] },
  "box-tee": { title: "Box tee", columns: ["Chest width", "Body length", "Shoulder"] },
};
const text = (value, max = 2000) => typeof value === "string" ? value.trim().slice(0, max) : "";
export function httpsUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : ""; } catch { return ""; }
}
export function stlolabDraftFields(content = {}) {
  const guide = content?.guide;
  const hero = content?.hero;
  return {
    stloContent: content || {}, stloCollection: content?.collection || "",
    stloGarment: guide?.garment || "", stloMeasurements: Object.fromEntries((guide?.rows || []).map(row => [row.size, [...row.cm]])),
    stloGuideVerified: guide?.verified === true, stloGuideNotes: (guide?.notes || []).join("\n"),
    stloCare: content?.care || "", stloConstruction: content?.construction || "",
    stloModel: content?.model || "", stloVideo: content?.video || "",
    stloHeroImage: hero?.image || "", stloHeroAlt: hero?.alt || "", stloHeroEyebrow: hero?.eyebrow || "",
    stloHeroTitle: (hero?.title || []).join("\n"), stloHeroSubtitle: hero?.subtitle || "",
    stloHeroButton: hero?.buttonLabel || "", stloHeroMobile: hero?.mobilePosition || "50% 50%",
    stloHeroDesktop: hero?.desktopPosition || "50% 50%",
  };
}
export function contentFromDraft(product) {
  // Quick edits and other clients that do not own these fields preserve the blob.
  if (!Object.hasOwn(product, "stloGarment")) return product.stloContent || {};
  const spec = garmentGuides[product.stloGarment];
  const sizes = [...new Set(product.availableSizes || [])].slice(0, 30);
  let guide = null;
  if (spec) {
    const rows = sizes.map(size => ({ size: text(size, 32), cm: spec.columns.map((_, i) => {
      const value = product.stloMeasurements?.[size]?.[i];
      if (value === "" || value === null || value === undefined) return null;
      const number = Number(value);
      if (!Number.isFinite(number) || number <= 0 || number > 300) throw new Error("Measurements must be between 0 and 300 cm, or left blank.");
      return Math.round(number * 10) / 10;
    }) }));
    if (product.stloGuideVerified && (!rows.length || rows.some(row => row.cm.includes(null)))) throw new Error("Complete every measurement before confirming the size guide.");
    guide = { garment: product.stloGarment, title: spec.title, columns: spec.columns, rows,
      notes: text(product.stloGuideNotes).split("\n").map(line => line.trim()).filter(Boolean).slice(0, 10), verified: product.stloGuideVerified === true };
    const { revision = 0, ...previous } = product.stloContent?.guide || {};
    const fingerprint = g => JSON.stringify([g.garment, g.title, g.columns, g.rows?.map(r => [r.size, r.cm]), g.notes, g.verified]);
    guide.revision = fingerprint(previous) === fingerprint(guide) ? revision : Number(revision || 0) + 1;
  }
  const image = text(product.stloHeroImage);
  const video = text(product.stloVideo);
  if (image && !httpsUrl(image)) throw new Error("Hero image must use an HTTPS URL.");
  if (video && !httpsUrl(video)) throw new Error("Fit video must use an HTTPS URL.");
  const position = value => /^\d{1,3}% \d{1,3}%$/.test(value || "") && value.split(" ").every(part => Number(part.slice(0, -1)) <= 100);
  if (image && (!position(product.stloHeroMobile) || !position(product.stloHeroDesktop))) throw new Error("Hero crop must use two percentages from 0% to 100%, such as 50% 45%.");
  return { version: 1, collection: text(product.stloCollection, 80), guide,
    care: text(product.stloCare), construction: text(product.stloConstruction), model: text(product.stloModel, 200), video: httpsUrl(video),
    hero: image ? { image: httpsUrl(image), alt: text(product.stloHeroAlt, 300), eyebrow: text(product.stloHeroEyebrow, 80),
      title: text(product.stloHeroTitle, 100).split("\n").filter(Boolean).slice(0, 3), subtitle: text(product.stloHeroSubtitle, 300),
      buttonLabel: text(product.stloHeroButton, 50), mobilePosition: product.stloHeroMobile, desktopPosition: product.stloHeroDesktop } : null };
}
