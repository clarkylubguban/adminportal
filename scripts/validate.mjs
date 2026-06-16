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
  "UC-000126",
  "SA-000125",
  "CC-000124",
  "Update Status",
  "Pending Review",
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

if (staleTemplatePattern.test(html) || staleTemplatePattern.test(appCode)) {
  throw new Error("Found stale copy in deployable app files.");
}

console.log("Build validation passed.");
