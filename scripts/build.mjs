import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

await import("./validate.mjs");

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

await cp("index.html", "dist/index.html");
await cp("src", "dist/src", { recursive: true });
await writeFile("dist/src/env.js", await createEnvScript());

const html = await readFile("dist/index.html", "utf8");
const notFoundHtml = html.replace(
  "<title>TRRY Apparel Management</title>",
  "<title>TRRY Apparel Management - Orders</title>"
);

await writeFile("dist/404.html", notFoundHtml);

console.log("Static build created in dist.");

async function createEnvScript() {
  const env = await readLocalEnv();
  const publicEnv = {
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "",
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? "",
    VITE_USE_SUPABASE_DATA: process.env.VITE_USE_SUPABASE_DATA ?? env.VITE_USE_SUPABASE_DATA ?? "true",
  };

  return `window.TRRY_ADMIN_ENV = ${JSON.stringify(publicEnv, null, 2)};\n`;
}

async function readLocalEnv() {
  try {
    const contents = await readFile(".env", "utf8");
    return Object.fromEntries(
      contents
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
        })
    );
  } catch {
    return {};
  }
}
