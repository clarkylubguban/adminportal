import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const preferredPort = Number(process.env.PORT || 5173);
const root = process.cwd();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const appRoutes = new Set([
  "/",
  "/orders",
  "/overview",
  "/clients",
  "/products",
  "/catalog",
  "/settings",
]);

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);
    const routePath = normalizeRoutePath(pathname);

    if (/^\/api\/inquiries\/[^/]+\/customer-actions\/?$/.test(routePath)) {
      const { default: handleCustomerActionsRequest } = await import("../api/inquiries/[id]/customer-actions.js");
      await handleCustomerActionsRequest(request, response);
      return;
    }

    if (/^\/api\/inquiries\/[^/]+\/artwork\/?$/.test(routePath)) {
      const { default: handleArtworkRequest } = await import("../api/inquiries/[id]/artwork.js");
      await handleArtworkRequest(request, response);
      return;
    }

    if (routePath === "/src/env.js") {
      response.writeHead(200, { "Content-Type": contentTypes[".js"] });
      response.end(await createEnvScript());
      return;
    }

    const requestedPath = appRoutes.has(routePath) ? "/index.html" : pathname;
    const filePath = normalize(join(root, requestedPath));

    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] ?? "text/plain",
    });
    response.end(body);
  } catch (error) {
    response.writeHead(404);
    response.end("Not found");
  }
}

function normalizeRoutePath(pathname) {
  if (pathname === "/") return "/";
  return pathname.replace(/\/+$/, "");
}

function listen(port, attempts = 0) {
  const localServer = createServer(handleRequest);

  localServer.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attempts < 10) {
      listen(port + 1, attempts + 1);
      return;
    }

    throw error;
  });

  localServer.listen(port, "127.0.0.1", () => {
    console.log(`TRRY Admin Portal running at http://127.0.0.1:${port}/orders`);
  });
}

await loadServerEnv();
listen(preferredPort);


async function loadServerEnv() {
  const env = {
    ...(await readLocalEnv(".env")),
    ...(await readLocalEnv(".env.local")),
  };

  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
async function createEnvScript() {
  const env = {
    ...(await readLocalEnv(".env")),
    ...(await readLocalEnv(".env.local")),
  };
  const publicEnv = {
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "",
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? "",
    VITE_USE_SUPABASE_DATA: process.env.VITE_USE_SUPABASE_DATA ?? env.VITE_USE_SUPABASE_DATA ?? "true",
    VITE_ADMIN_ACCESS_CODE: process.env.VITE_ADMIN_ACCESS_CODE ?? env.VITE_ADMIN_ACCESS_CODE ?? "",
  };

  return `window.TRRY_ADMIN_ENV = ${JSON.stringify(publicEnv, null, 2)};\n`;
}

async function readLocalEnv(file = ".env") {
  try {
    const contents = await readFile(file, "utf8");
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
