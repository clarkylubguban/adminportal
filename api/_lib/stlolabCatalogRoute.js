import { configuredCatalogEnvironment, readStlolabCatalog } from "./stlolabCatalog.js";
const createServerSupabaseClient = async () => (await import("./supabaseServer.js")).createServerSupabaseClient();

export function createCatalogHandler({ env = process.env, createClient = createServerSupabaseClient } = {}) {
  return async function handler(request, response) {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const send = (status, body) => { response.statusCode = status; response.end(JSON.stringify(body)); };
    if (request.method !== "GET") { response.setHeader("Allow", "GET"); return send(405, { error: "Method not allowed" }); }
    const environment = configuredCatalogEnvironment(env);
    if (env.STLO_CATALOG_ENABLED !== "true" || !environment) return send(503, { error: "Catalog unavailable" });
    const params = new URL(request.url, "https://admin.invalid").searchParams;
    const slug = params.get("slug") || "";
    const offset = Number(params.get("offset") || 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > 5000 || slug.length > 100 || (slug && !/^[a-zA-Z0-9_-]+$/.test(slug))) return send(400, { error: "Invalid catalog request" });
    try {
      const catalog = await readStlolabCatalog(await createClient(), { slug, offset, environment, env });
      return send(200, { version: 1, environment, ...catalog });
    } catch { return send(503, { error: "Catalog temporarily unavailable" }); }
  };
}
export default createCatalogHandler();
