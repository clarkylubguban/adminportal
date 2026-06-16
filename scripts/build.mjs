import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

await import("./validate.mjs");

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

await cp("index.html", "dist/index.html");
await cp("src", "dist/src", { recursive: true });

const html = await readFile("dist/index.html", "utf8");
const notFoundHtml = html.replace(
  "<title>TRRY Apparel Management</title>",
  "<title>TRRY Apparel Management - Orders</title>"
);

await writeFile("dist/404.html", notFoundHtml);

console.log("Static build created in dist.");
