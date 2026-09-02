import assert from "node:assert/strict";
import { execFileSync, execSync, spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const runId = `e5b-${Date.now()}`;
const password = `Local-${runId}-Pass123!`;
const appPort = 7150 + Math.floor(Math.random() * 300);
const status = getLocalSupabaseStatus();
globalThis.window = {
  TRRY_ADMIN_ENV: {
    VITE_SUPABASE_URL: status.API_URL,
    VITE_SUPABASE_ANON_KEY: status.ANON_KEY,
    VITE_USE_SUPABASE_DATA: "true",
  },
};
const { getAdminCatalogProducts } = await import("../src/services/adminCatalog.js");
const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(status.API_URL, status.ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let server;
let qaRows = [];
let cleanupRevokerId = "";
let seeded = { productId: "", variantId: "", categoryId: "" };

try {
  verifySchema();
  const identities = await createQaIdentities();
  qaRows = Object.values(identities).map((item) => item.profile);
  cleanupRevokerId = identities.owner.profile.id;
  seeded = await seedCatalogRows(identities.owner.profile.user_id);

  await seedGrant(identities.catalogStaff.profile.id, "master_catalog", identities.owner.profile.id);
  await seedGrant(identities.calendarStaff.profile.id, "calendar", identities.owner.profile.id);
  await seedGrant(identities.workboardStaff.profile.id, "workboard", identities.owner.profile.id);
  await seedGrant(identities.revokedStaff.profile.id, "master_catalog", identities.owner.profile.id, { revoked: true });
  await seedGrant(identities.expiredStaff.profile.id, "master_catalog", identities.owner.profile.id, { expired: true });

  server = await startLocalDevServer();

  const ownerSession = await signIn(identities.owner.email);
  const adminSession = await signIn(identities.admin.email);
  const noGrantSession = await signIn(identities.noGrantStaff.email);
  const catalogSession = await signIn(identities.catalogStaff.email);
  const calendarSession = await signIn(identities.calendarStaff.email);
  const workboardSession = await signIn(identities.workboardStaff.email);
  const revokedSession = await signIn(identities.revokedStaff.email);
  const expiredSession = await signIn(identities.expiredStaff.email);

  await expectEffective("", "master_catalog", 401, undefined, "Unauthenticated effective Master Catalog access must be blocked.");
  await expectEffective(ownerSession.access_token, "master_catalog", 200, { allowed: true, source: "permanent" }, "Owner permanent Master Catalog access must remain allowed.");
  await expectEffective(adminSession.access_token, "master_catalog", 200, { allowed: true, source: "permanent" }, "Admin permanent Master Catalog access must remain allowed.");
  await expectEffective(noGrantSession.access_token, "master_catalog", 200, { allowed: false, source: "none" }, "Staff without grant must not receive Master Catalog effective access.");
  await expectEffective(catalogSession.access_token, "master_catalog", 200, { allowed: true, source: "temporary" }, "Active Master Catalog grant must allow Staff.");
  await expectEffective(calendarSession.access_token, "master_catalog", 200, { allowed: false, source: "none" }, "Calendar-only grant must not unlock Master Catalog.");
  await expectEffective(workboardSession.access_token, "master_catalog", 200, { allowed: false, source: "none" }, "Workboard-only grant must not unlock Master Catalog.");
  await expectEffective(revokedSession.access_token, "master_catalog", 200, { allowed: false, source: "none" }, "Revoked Master Catalog grant must not unlock Master Catalog.");
  await expectEffective(expiredSession.access_token, "master_catalog", 200, { allowed: false, source: "none" }, "Expired Master Catalog grant must not unlock Master Catalog.");
  await expectEffective(catalogSession.access_token, "calendar", 200, { allowed: false, source: "none" }, "Master Catalog grant must not unlock Calendar.");
  await expectEffective(catalogSession.access_token, "workboard", 200, { allowed: false, source: "none" }, "Master Catalog grant must not unlock Workboard.");

  const forged = await effectiveRequest(noGrantSession.access_token, "master_catalog", { "X-TRRY-Temp-Access": "master_catalog" });
  assert.equal(forged.status, 200, "Forged client Master Catalog state must not break the authenticated API.");
  assert.equal(forged.body.access?.allowed, false, "Forged client Master Catalog state must be denied server-side.");

  const catalogResult = await getAdminCatalogProducts(catalogSession);
  assert.equal(catalogResult.error, null, "Temporary Master Catalog Staff catalog read must not return an error.");
  assert.ok(catalogResult.products.some((product) => product.id === seeded.productId), "Temporary Master Catalog Staff must be able to read catalog products.");
  assert.equal(await readAdminRole(identities.catalogStaff.profile.id), "staff", "Staff role must remain staff after Master Catalog grant.");

  const catalogStaffClient = createUserClient(catalogSession.access_token);
  const productWrite = await catalogStaffClient.from("products").update({ name: `Forbidden ${runId}` }).eq("id", seeded.productId).select("id");
  assert.ok(productWrite.error || productWrite.data?.length === 0, "Temporary Master Catalog Staff must not update products.");
  const variantWrite = await catalogStaffClient.from("product_variants").update({ selling_price: 12345.67 }).eq("id", seeded.variantId).select("id");
  assert.ok(variantWrite.error || variantWrite.data?.length === 0, "Temporary Master Catalog Staff must not update variants/pricing.");

  await revokeAllActiveQaGrants(identities.owner.profile.id);
  assert.equal(await readActiveQaGrantCount(), 0, "No active E5B QA grants should remain after cleanup.");
  const afterRevoke = await effectiveRequest(catalogSession.access_token, "master_catalog");
  assert.equal(afterRevoke.body.access?.allowed, false, "Revoked Master Catalog grant must deny subsequent effective access.");
  assert.equal(await readAdminRole(identities.catalogStaff.profile.id), "staff", "Staff role must remain staff after revoke.");

  console.log("PASS: Employee E5B local runtime verification");
  console.log(`EVIDENCE: master_catalog module gate ok; staff read-only catalog ok; staff product/variant writes denied; owner/admin regression ok; calendar/workboard isolation ok; qaRun=${runId}`);
} finally {
  if (qaRows.length && cleanupRevokerId) await revokeAllActiveQaGrants(cleanupRevokerId).catch(() => {});
  await cleanupCatalogRows().catch(() => {});
  if (server) server.kill();
}

function getLocalSupabaseStatus() {
  const output = execSync("npx --yes supabase status -o json", { encoding: "utf8" });
  const jsonStart = output.indexOf("{");
  if (jsonStart < 0) throw new Error("Unable to read local Supabase status JSON.");
  return JSON.parse(output.slice(jsonStart));
}

function verifySchema() {
  assert.equal(sqlValue("select exists (select 1 from information_schema.tables where table_schema='public' and table_name='employee_temporary_access_grants')"), "t", "Temporary access table must exist.");
  assert.equal(sqlValue("select exists (select 1 from information_schema.tables where table_schema='public' and table_name='products')"), "t", "Products table must exist.");
  assert.equal(sqlValue("select exists (select 1 from information_schema.tables where table_schema='public' and table_name='product_variants')"), "t", "Product variants table must exist.");
}

async function createQaIdentities() {
  const specs = {
    owner: ["owner", true],
    admin: ["admin", true],
    noGrantStaff: ["staff", true],
    catalogStaff: ["staff", true],
    calendarStaff: ["staff", true],
    workboardStaff: ["staff", true],
    revokedStaff: ["staff", true],
    expiredStaff: ["staff", true],
  };
  const identities = {};
  for (const [key, [role, active]] of Object.entries(specs)) {
    const email = `${runId}-${key}@local.test`;
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: `E5B ${key}`, trry_admin_role: role },
    });
    assert.ifError(createError);
    const { data: profile, error: profileError } = await service
      .from("admin_users")
      .insert({
        user_id: created.user.id,
        email,
        display_name: `E5B ${key}`,
        role,
        is_active: active,
      })
      .select("id,user_id,email,role,is_active")
      .single();
    assert.ifError(profileError);
    identities[key] = { email, authUser: created.user, profile };
  }
  return identities;
}

async function seedCatalogRows(actorUserId) {
  const { data: category, error: categoryError } = await service
    .from("product_categories")
    .insert({
      name: `E5B Runtime ${runId}`,
      code: `E5B-${Date.now()}`,
      product_type: "PHYSICAL",
      active: true,
      created_by_user_id: actorUserId,
      updated_by_user_id: actorUserId,
    })
    .select("id")
    .single();
  assert.ifError(categoryError);

  const { data: product, error: productError } = await service
    .from("products")
    .insert({
      category_id: category.id,
      master_product_id: `MPRD-${runId}`,
      product_code: `PRD-${runId}`,
      name: `E5B Runtime Product ${runId}`,
      brand_id: "22222222-2222-4222-8222-222222222222",
      brand: "TRRY",
      product_type: "PHYSICAL",
      readiness_status: "DRAFT",
      sellable: true,
      purchasable: false,
      active: true,
      created_by_user_id: actorUserId,
      updated_by_user_id: actorUserId,
    })
    .select("id")
    .single();
  assert.ifError(productError);

  const { data: variant, error: variantError } = await service
    .from("product_variants")
    .insert({
      product_id: product.id,
      master_variant_id: `MVAR-${runId}`,
      sku: `SKU-${runId}`,
      global_sku: `GSKU-${runId}`,
      variant_type: "STANDARD",
      size: "QA",
      color: "BLACK",
      selling_price: 100,
      unit_cost: 40,
      active: true,
      created_by_user_id: actorUserId,
      updated_by_user_id: actorUserId,
    })
    .select("id")
    .single();
  assert.ifError(variantError);

  return { categoryId: category.id, productId: product.id, variantId: variant.id };
}

async function seedGrant(employeeId, moduleCode, grantedBy, { revoked = false, expired = false } = {}) {
  const now = Date.now();
  const startsAt = new Date(now - (expired ? 48 : 1) * 60 * 60 * 1000).toISOString();
  const expiresAt = new Date(now + (expired ? -24 : 8) * 60 * 60 * 1000).toISOString();
  const { error } = await service.from("employee_temporary_access_grants").insert({
    employee_id: employeeId,
    module_code: moduleCode,
    granted_by: grantedBy,
    starts_at: startsAt,
    expires_at: expiresAt,
    reason: `E5B runtime ${moduleCode} ${runId}`,
    revoked_at: revoked ? new Date(now - 10 * 60 * 1000).toISOString() : null,
    revoked_by: revoked ? grantedBy : null,
  });
  assert.ifError(error);
}

async function signIn(email) {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  assert.ifError(error);
  return data.session;
}

function createUserClient(accessToken) {
  return createClient(status.API_URL, status.ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

async function startLocalDevServer() {
  const child = spawn(process.platform === "win32" ? "node.exe" : "node", ["scripts/local-dev.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(appPort),
      SUPABASE_URL: status.API_URL,
      VITE_SUPABASE_URL: status.API_URL,
      VITE_SUPABASE_ANON_KEY: status.ANON_KEY,
      VITE_USE_SUPABASE_DATA: "true",
      VITE_ENABLE_TASK_DOMAIN: "true",
      VITE_ENABLE_WORKBOARD: "true",
      VITE_ENABLE_CALENDAR: "true",
      SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk.toString(); });
  child.stderr.on("data", (chunk) => { logs += chunk.toString(); });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${appPort}/src/env.js`);
      if (response.ok) return child;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (child.exitCode !== null) throw new Error(`local dev server exited early: ${logs}`);
  }
  child.kill();
  throw new Error(`Timed out waiting for local dev server: ${logs}`);
}

async function expectEffective(token, moduleCode, statusCode, expected, message) {
  const response = await effectiveRequest(token, moduleCode);
  assert.equal(response.status, statusCode, message);
  if (expected) {
    assert.equal(response.body.access?.allowed, expected.allowed, message);
    assert.equal(response.body.access?.source, expected.source, message);
    assert.equal(response.body.access?.module, moduleCode, message);
  }
}

async function effectiveRequest(token, moduleCode, extraHeaders = {}) {
  const response = await fetch(`http://127.0.0.1:${appPort}/api/admin-users/effective-access?module=${encodeURIComponent(moduleCode)}`, {
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
  });
  return { status: response.status, body: await response.json().catch(() => ({ })) };
}

async function readAdminRole(id) {
  const { data, error } = await service.from("admin_users").select("role").eq("id", id).single();
  assert.ifError(error);
  return data.role;
}

async function revokeAllActiveQaGrants(revokerId) {
  const ids = qaRows.map((row) => row.id);
  if (!ids.length) return;
  const { error } = await service
    .from("employee_temporary_access_grants")
    .update({ revoked_at: new Date().toISOString(), revoked_by: revokerId })
    .in("employee_id", ids)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());
  assert.ifError(error);
}

async function readActiveQaGrantCount() {
  const ids = qaRows.map((row) => row.id);
  if (!ids.length) return 0;
  const { count, error } = await service
    .from("employee_temporary_access_grants")
    .select("id", { count: "exact", head: true })
    .in("employee_id", ids)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());
  assert.ifError(error);
  return count || 0;
}

async function cleanupCatalogRows() {
  if (seeded.variantId) await service.from("product_variants").delete().eq("id", seeded.variantId);
  if (seeded.productId) await service.from("products").delete().eq("id", seeded.productId);
  if (seeded.categoryId) await service.from("product_categories").delete().eq("id", seeded.categoryId);
}

function sqlValue(sql) {
  return execFileSync("docker", ["exec", "supabase_db_Admin_portal", "psql", "-U", "postgres", "-d", "postgres", "-tAc", sql], { encoding: "utf8" }).trim();
}
