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

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);
    const requestedPath =
      pathname === "/" || pathname === "/orders" ? "/index.html" : pathname;
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

listen(preferredPort);
