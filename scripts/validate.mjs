import { access, readFile } from "node:fs/promises";

const requiredFiles = [
  "index.html",
  "src/main.js",
  "src/styles.css",
  "vercel.json",
];

await Promise.all(requiredFiles.map((file) => access(file)));

const appCode = await readFile("src/main.js", "utf8");
const html = await readFile("index.html", "utf8");
const requiredCopy = [
  "TRRY Admin",
  "Overview",
  "Orders",
  "Clients",
  "Products",
  "Settings",
  "Urban Coffee",
  "Admin Polo Uniform",
  "Embroidered Staff Cap",
  "admin.trryapparel.com",
  "Pending Review",
  "Ready to Ship",
  "Completed This Month",
  "Recent Orders",
  "Today's Activity",
  "Quick Actions",
  "Search clients by name, slug, or domain...",
  "Add New Client",
  "Copy Portal Link",
  "View Products",
  "More client management tools will be connected to Supabase later.",
  "Search request no., client, or requested by...",
  "Update Status",
  "Add Internal Note",
  "Open Portal",
  "View Orders",
  "Edit Product",
  "Danger Zone",
];

for (const text of requiredCopy) {
  if (!appCode.includes(text)) {
    throw new Error(`Missing required UI text: ${text}`);
  }
}

for (const text of ["TRRY Apparel Management", "/src/styles.css", "/src/main.js"]) {
  if (!html.includes(text)) {
    throw new Error(`Root index.html is missing: ${text}`);
  }
}

const staleTemplateName = ["zen", "da"].join("");
const staleTemplatePattern = new RegExp(staleTemplateName, "i");
const disallowedCopy = [
  ["Urb", "an", "Sti", "tch", "Co."],
  ["Pe", "ak", "Perf", "ormance"],
  ["Veloc", "ity", "Spo", "rts"],
  ["Elev", "ate", "App", "arel"],
  ["Sum", "mit", "Athl", "etics"],
  ["Sal", "on", "Aur", "elia"],
  ["Cli", "nic", "Cent", "ral"],
  ["Al", "ex", "Tho", "rne"],
  ["UC", "000126"],
  ["SA", "000125"],
  ["CC", "000124"],
  ["Dr.", "Ama", "nda", "Ru", "iz"],
  ["Ma", "ya", "Pat", "el"],
  ["Cla", "rk", "Lub", "guban"],
];

if (staleTemplatePattern.test(html) || staleTemplatePattern.test(appCode)) {
  throw new Error("Found stale copy in deployable app files.");
}

for (const parts of disallowedCopy) {
  const text = parts.length === 2 && parts[0].length === 2
    ? parts.join("-")
    : parts.join("").replace("Co.", " Co.");
  if (html.includes(text) || appCode.includes(text)) {
    throw new Error(`Found disallowed placeholder copy: ${text}`);
  }
}

console.log("Build validation passed.");
