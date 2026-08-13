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
  "/inquiries",
  "/orders",
  "/order-dashboard",
  "/production",
  "/my-tasks",
  "/calendar",
  "/workboard",
  "/overview",
  "/catalog",
  "/catalog/categories",
  "/set-password",
]);

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);
    const routePath = normalizeRoutePath(pathname);

    if (/^\/api\/admin-users\/?$/.test(routePath)) {
      const { default: handleAdminUsersRequest } = await import("../api/admin-users/index.js");
      await handleAdminUsersRequest(request, response);
      return;
    }

    if (/^\/api\/admin-users\/[^/]+\/?$/.test(routePath)) {
      const { default: handleAdminUserRequest } = await import("../api/admin-users/[id].js");
      await handleAdminUserRequest(request, response);
      return;
    }

    if (/^\/api\/inquiries\/[^/]+\/customer-actions\/?$/.test(routePath)) {
      const { default: handleCustomerActionsRequest } = await import("../api/inquiries/[id]/customer-actions.js");
      await handleCustomerActionsRequest(request, response);
      return;
    }

    if (/^\/api\/inquiries\/[^/]+\/workflow\/?$/.test(routePath)) {
      const { default: handleWorkflowRequest } = await import("../api/inquiries/[id]/workflow.js");
      await handleWorkflowRequest(request, response);
      return;
    }

    if (/^\/api\/inquiries\/[^/]+\/orders\/?$/.test(routePath)) {
      const { default: handleWorkflowRequest } = await import("../api/inquiries/[id]/workflow.js");
      await handleWorkflowRequest(request, response);
      return;
    }

    if (/^\/api\/inquiries\/[^/]+\/artwork\/?$/.test(routePath)) {
      const { default: handleArtworkRequest } = await import("../api/inquiries/[id]/artwork.js");
      await handleArtworkRequest(request, response);
      return;
    }


  if (await handleTaskApiRoute(routePath, request, response)) return;
  if (await handleIntegrationApiRoute(routePath, request, response)) return;

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

async function handleTaskApiRoute(routePath, request, response) {
  if (routePath === "/api/my-tasks") {
    const { default: handleMyTasksRequest } = await import("../api/task-views.js");
    await handleMyTasksRequest(request, response);
    return true;
  }

  if (routePath === "/api/task-calendar") {
    const { default: handleTaskCalendarRequest } = await import("../api/task-views.js");
    await handleTaskCalendarRequest(request, response);
    return true;
  }

  if (routePath === "/api/planning/auto-plan-today") {
    const { default: handleAutoPlanTodayRequest } = await import("../api/task-automation.js");
    await handleAutoPlanTodayRequest(request, response);
    return true;
  }

  if (routePath === "/api/tasks") {
    const { default: handleTasksRequest } = await import("../api/tasks/index.js");
    await handleTasksRequest(request, response);
    return true;
  }

  if (routePath.startsWith("/api/tasks/")) {
    const { default: handleTaskRequest } = await import("../api/tasks/[id].js");
    await handleTaskRequest(request, response);
    return true;
  }

  return false;
}

async function handleIntegrationApiRoute(routePath, request, response) {
  if (routePath === "/api/integrations/n8n/task-drafts") {
    const { default: handleN8nTaskDraftsRequest } = await import("../api/task-automation.js");
    await handleN8nTaskDraftsRequest(request, response);
    return true;
  }
  return false;
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
    VITE_ENABLE_TASK_DOMAIN: process.env.VITE_ENABLE_TASK_DOMAIN ?? env.VITE_ENABLE_TASK_DOMAIN ?? "false",
    VITE_ENABLE_WORKBOARD: process.env.VITE_ENABLE_WORKBOARD ?? env.VITE_ENABLE_WORKBOARD ?? "false",
    VITE_ENABLE_MY_TASKS: process.env.VITE_ENABLE_MY_TASKS ?? env.VITE_ENABLE_MY_TASKS ?? "false",
    VITE_ENABLE_CALENDAR: process.env.VITE_ENABLE_CALENDAR ?? env.VITE_ENABLE_CALENDAR ?? "false",
    VITE_ENABLE_AUTO_PLAN_TODAY: process.env.VITE_ENABLE_AUTO_PLAN_TODAY ?? env.VITE_ENABLE_AUTO_PLAN_TODAY ?? "false",
    VITE_LOCAL_TASK_QA_MODE: process.env.VITE_LOCAL_TASK_QA_MODE ?? env.VITE_LOCAL_TASK_QA_MODE ?? "false",
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
