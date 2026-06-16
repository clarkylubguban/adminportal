import { access, readFile } from "node:fs/promises";

const requiredFiles = [
  "index.html",
  "server.mjs",
  "src/main.js",
  "src/styles.css",
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

if (/zenda/i.test(html) || /zenda/i.test(appCode)) {
  throw new Error("Found stale Zenda copy in deployable app files.");
}

console.log("Build validation passed.");
