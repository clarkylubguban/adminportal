import { access, readFile } from "node:fs/promises";

const requiredFiles = [
  "index.html",
  "server.mjs",
  "src/main.js",
  "src/styles.css",
];

await Promise.all(requiredFiles.map((file) => access(file)));

const appCode = await readFile("src/main.js", "utf8");
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

console.log("Build validation passed.");
