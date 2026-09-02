import assert from "node:assert/strict";
import { execFileSync, execSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const runId = `e5g-${Date.now()}`;
const password = `Local-${runId}-Pass123!`;
const appPort = 8650 + Math.floor(Math.random() * 300);
const status = getLocalSupabaseStatus();

globalThis.window = {
  TRRY_ADMIN_ENV: {
    VITE_SUPABASE_URL: status.API_URL,
    VITE_SUPABASE_ANON_KEY: status.ANON_KEY,
    VITE_USE_SUPABASE_DATA: "true",
  },
};

const { getAdminInventory } = await import("../src/services/adminInventory.js");

const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(status.API_URL, status.ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ids = {
  brand: crypto.randomUUID(),
  category: crypto.randomUUID(),
  product: crypto.randomUUID(),
  variant: crypto.randomUUID(),
  locationA: crypto.randomUUID(),
  locationB: crypto.randomUUID(),
  balanceA: crypto.randomUUID(),
  balanceB: crypto.randomUUID(),
  movementA: crypto.randomUUID(),
  movementB: crypto.randomUUID(),
};

let server;
let identities = {};
let qaRows = [];
let cleanupRevokerId = "";

try {
  ensureLocalInventoryFoundationForQa();
  applyMigration("supabase/migrations/20260826031500_employee_e5d_orders_temp_access.sql");
  applyMigration("supabase/migrations/20260826062747_employee_e5e_production_temp_access.sql");
  applyMigration("supabase/migrations/20260827011526_employee_e5f_design_artwork_temp_access.sql");
  applyMigration("supabase/migrations/20260827024500_employee_e5g_inventory_temp_access.sql");
  verifySchemaAndPolicies();

  identities = await createQaIdentities();
  qaRows = Object.values(identities).map((item) => item.profile);
  cleanupRevokerId = identities.owner.profile.id;
  await seedInventoryFixture();

  await seedGrant(identities.inventoryStaff.profile.id, "inventory", identities.owner.profile.id);
  await seedGrant(identities.calendarStaff.profile.id, "calendar", identities.owner.profile.id);
  await seedGrant(identities.workboardStaff.profile.id, "workboard", identities.owner.profile.id);
  await seedGrant(identities.catalogStaff.profile.id, "master_catalog", identities.owner.profile.id);
  await seedGrant(identities.inquiriesStaff.profile.id, "inquiries", identities.owner.profile.id);
  await seedGrant(identities.ordersStaff.profile.id, "orders", identities.owner.profile.id);
  await seedGrant(identities.productionStaff.profile.id, "production", identities.owner.profile.id);
  await seedGrant(identities.designStaff.profile.id, "design_artwork", identities.owner.profile.id);
  await seedGrant(identities.revokedStaff.profile.id, "inventory", identities.owner.profile.id, { revoked: true });
  await seedGrant(identities.expiredStaff.profile.id, "inventory", identities.owner.profile.id, { expired: true });

  server = await startLocalDevServer();

  const ownerSession = await signIn(identities.owner.email);
  const adminSession = await signIn(identities.admin.email);
  const noGrantSession = await signIn(identities.noGrantStaff.email);
  const inventorySession = await signIn(identities.inventoryStaff.email);
  const calendarSession = await signIn(identities.calendarStaff.email);
  const workboardSession = await signIn(identities.workboardStaff.email);
  const catalogSession = await signIn(identities.catalogStaff.email);
  const inquiriesSession = await signIn(identities.inquiriesStaff.email);
  const ordersSession = await signIn(identities.ordersStaff.email);
  const productionSession = await signIn(identities.productionStaff.email);
  const designSession = await signIn(identities.designStaff.email);
  const revokedSession = await signIn(identities.revokedStaff.email);
  const expiredSession = await signIn(identities.expiredStaff.email);

  await expectEffective("", "inventory", 401, undefined, "Unauthenticated effective Inventory access must be blocked.");
  await expectEffective(ownerSession.access_token, "inventory", 200, { allowed: true, source: "permanent" }, "Owner Inventory access must remain permanent.");
  await expectEffective(adminSession.access_token, "inventory", 200, { allowed: true, source: "permanent" }, "Admin Inventory access must remain permanent.");
  await expectEffective(noGrantSession.access_token, "inventory", 200, { allowed: false, source: "none" }, "Staff without Inventory grant must be denied.");
  await expectEffective(inventorySession.access_token, "inventory", 200, { allowed: true, source: "temporary" }, "Active inventory grant must allow Staff read.");
  await expectEffective(calendarSession.access_token, "inventory", 200, { allowed: false, source: "none" }, "Calendar grant must not unlock Inventory.");
  await expectEffective(workboardSession.access_token, "inventory", 200, { allowed: false, source: "none" }, "Workboard grant must not unlock Inventory.");
  await expectEffective(catalogSession.access_token, "inventory", 200, { allowed: false, source: "none" }, "Master Catalog grant must not unlock Inventory.");
  await expectEffective(inquiriesSession.access_token, "inventory", 200, { allowed: false, source: "none" }, "Inquiries grant must not unlock Inventory.");
  await expectEffective(ordersSession.access_token, "inventory", 200, { allowed: false, source: "none" }, "Orders grant must not unlock Inventory.");
  await expectEffective(productionSession.access_token, "inventory", 200, { allowed: false, source: "none" }, "Production grant must not unlock Inventory.");
  await expectEffective(designSession.access_token, "inventory", 200, { allowed: false, source: "none" }, "Design & Artwork grant must not unlock Inventory.");
  await expectEffective(revokedSession.access_token, "inventory", 200, { allowed: false, source: "none" }, "Revoked inventory grant must be denied.");
  await expectEffective(expiredSession.access_token, "inventory", 200, { allowed: false, source: "none" }, "Expired inventory grant must be denied.");

  for (const moduleCode of ["master_catalog", "orders", "production", "design_artwork"]) {
    await expectEffective(inventorySession.access_token, moduleCode, 200, { allowed: false, source: "none" }, `Inventory grant must not unlock ${moduleCode}.`);
  }
  await expectEffective(inventorySession.access_token, "purchasing_suppliers", 200, { allowed: false, source: "none" }, "Inventory grant must not unlock Purchasing & Suppliers.");
  await expectEffective(inventorySession.access_token, "pos_sales", 200, { allowed: false, source: "none" }, "Inventory grant must not unlock POS Sales.");
  for (const moduleCode of ["pricing_discounts", "people_access", "my_tasks"]) {
    const response = await effectiveRequest(inventorySession.access_token, moduleCode);
    assert.ok(response.status >= 400, `Inventory grant must not register or unlock future module ${moduleCode}.`);
  }

  const forged = await effectiveRequest(noGrantSession.access_token, "inventory", { "X-TRRY-Temp-Access": "inventory" });
  assert.equal(forged.status, 200, "Forged client Inventory state must not break authenticated API.");
  assert.equal(forged.body.access?.allowed, false, "Forged client Inventory state must be denied server-side.");

  await expectInventoryRead(ownerSession.access_token, true, "Owner direct Inventory read must be preserved.");
  await expectInventoryRead(adminSession.access_token, true, "Admin direct Inventory read must be preserved.");
  await expectInventoryRead(noGrantSession.access_token, false, "No-grant Staff direct Inventory read must be denied by RLS.");
  await expectInventoryRead(inventorySession.access_token, true, "Temporary Inventory Staff direct read must be allowed.");
  await expectInventoryRead(calendarSession.access_token, false, "Wrong-module Staff direct Inventory read must be denied.");
  await expectInventoryRead(revokedSession.access_token, false, "Revoked Inventory grant direct read must be denied.");
  await expectInventoryRead(expiredSession.access_token, false, "Expired Inventory grant direct read must be denied.");
  await expectInventoryRead("", false, "Unauthenticated Inventory read must be denied.");

  const appRead = await getAdminInventory(inventorySession);
  assert.equal(appRead.error, null, "Temporary Inventory Staff app read must not return an error.");
  assert.ok(appRead.rows.some((row) => row.variantId === ids.variant && row.onHand === 12), "Temporary Inventory Staff app read must include QA stock.");
  assert.ok(appRead.movements.some((row) => row.id === ids.movementA), "Temporary Inventory Staff app read must include QA movement history.");

  await expectOwnerAdminReceive(ownerSession.access_token, "Owner legitimate Receive Stock must be preserved.");
  await expectOwnerAdminReceive(adminSession.access_token, "Admin legitimate Receive Stock must be preserved.");

  await expectDeniedInventoryNoChange("Receive Stock", () => receiveInventory(inventorySession.access_token, 5));
  await expectDeniedInventoryNoChange("Adjustment", () => insertMovement(inventorySession.access_token, -2, "ADJUSTMENT"));
  await expectDeniedInventoryNoChange("Direct quantity update", () => directBalanceUpdate(inventorySession.access_token, { on_hand: 999, available: 999 }));
  await expectDeniedInventoryNoChange("Damage/loss write-off", () => insertMovement(inventorySession.access_token, -3, "DAMAGED_WRITE_OFF"));
  await expectDeniedInventoryNoChange("Transfer", () => transferStock(inventorySession.access_token));
  await expectDeniedInventoryNoChange("Purchase receipt", () => receivePurchaseOrder(inventorySession.access_token));
  await expectDeniedInventoryNoChange("Ledger mutation", () => directMovementUpdate(inventorySession.access_token, { quantity_delta: -99, reason: "forbidden" }));
  await expectDeniedInventoryNoChange("Product/Catalog mutation", () => directProductUpdate(inventorySession.access_token));
  await expectDeniedInventoryNoChange("POS mutation", () => insertMovement(inventorySession.access_token, -1, "POS_SALE"));

  assert.equal(await readAdminRole(identities.inventoryStaff.profile.id), "staff", "Staff role must remain staff after Inventory grant.");

  await revokeAllActiveQaGrants(identities.owner.profile.id);
  assert.equal(await readActiveQaGrantCount(), 0, "No active E5G QA grants should remain after cleanup.");
  await expectEffective(inventorySession.access_token, "inventory", 200, { allowed: false, source: "none" }, "Revoked active Inventory grant must deny effective access.");
  await expectInventoryRead(inventorySession.access_token, false, "Revoked active Inventory grant must deny subsequent direct Inventory read.");
  assert.equal(await readAdminRole(identities.inventoryStaff.profile.id), "staff", "Staff role must remain staff after revoke.");

  console.log("PASS: Employee E5G local runtime verification");
  console.log(`EVIDENCE: inventory module gate ok; temp Staff read-only verified; receive/adjust/direct quantity/transfer/purchase receipt/ledger/catalog/POS mutations denied with before=after; owner/admin reads and receive preserved; qaRun=${runId}`);
} finally {
  if (qaRows.length && cleanupRevokerId) await revokeAllActiveQaGrants(cleanupRevokerId).catch(() => {});
  await cleanupFixture().catch(() => {});
  if (server) server.kill();
}

function getLocalSupabaseStatus() {
  const output = execSync("npx --yes supabase status -o json", { encoding: "utf8" });
  const jsonStart = output.indexOf("{");
  if (jsonStart < 0) throw new Error("Unable to read local Supabase status JSON.");
  return JSON.parse(output.slice(jsonStart));
}

function applyMigration(path) {
  const sql = readFileSync(path, "utf8");
  execFileSync("docker", ["exec", "-i", "supabase_db_Admin_portal", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { input: sql });
}

function ensureLocalInventoryFoundationForQa() {
  execFileSync("docker", ["exec", "-i", "supabase_db_Admin_portal", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
    input: `
      create schema if not exists trry_api;

      create table if not exists public.inventory_locations (
        id uuid primary key default gen_random_uuid(),
        name text not null,
        code text,
        branch_name text,
        branch_code text,
        location_type text,
        active boolean not null default true,
        archived_at timestamptz,
        created_at timestamptz not null default now()
      );

      create table if not exists public.inventory_balances (
        id uuid primary key default gen_random_uuid(),
        variant_id uuid not null references public.product_variants(id) on delete cascade,
        location_id uuid not null references public.inventory_locations(id) on delete cascade,
        on_hand integer not null default 0,
        reserved integer not null default 0,
        available integer not null default 0,
        reorder_point integer,
        incoming integer,
        last_cost numeric(12,2),
        updated_at timestamptz not null default now(),
        constraint inventory_balances_variant_location_unique unique (variant_id, location_id)
      );

      create table if not exists public.stock_movements (
        id uuid primary key default gen_random_uuid(),
        product_id uuid references public.products(id) on delete cascade,
        variant_id uuid not null references public.product_variants(id) on delete cascade,
        location_id uuid not null references public.inventory_locations(id) on delete cascade,
        movement_type text not null,
        quantity_delta integer not null,
        balance_before integer,
        balance_after integer,
        source text,
        source_reference text,
        reason text,
        idempotency_key text unique,
        created_by_user_id uuid,
        created_at timestamptz not null default now()
      );

      alter table public.inventory_locations enable row level security;
      alter table public.inventory_balances enable row level security;
      alter table public.stock_movements enable row level security;

      grant select, insert, update, delete on table public.inventory_locations to authenticated;
      grant select, insert, update, delete on table public.inventory_balances to authenticated;
      grant select, insert, update, delete on table public.stock_movements to authenticated;
      grant all on table public.inventory_locations to service_role;
      grant all on table public.inventory_balances to service_role;
      grant all on table public.stock_movements to service_role;

      drop policy if exists "inventory locations read active admin" on public.inventory_locations;
      create policy "inventory locations read active admin" on public.inventory_locations for select to authenticated using (public.is_active_admin_user(array['owner','admin','staff']));
      drop policy if exists "inventory balances read active admin" on public.inventory_balances;
      create policy "inventory balances read active admin" on public.inventory_balances for select to authenticated using (public.is_active_admin_user(array['owner','admin','staff']));
      drop policy if exists "stock movements read active admin" on public.stock_movements;
      create policy "stock movements read active admin" on public.stock_movements for select to authenticated using (public.is_active_admin_user(array['owner','admin','staff']));

      drop policy if exists "inventory locations write owner admin" on public.inventory_locations;
      create policy "inventory locations write owner admin" on public.inventory_locations for all to authenticated using (public.is_active_admin_user(array['owner','admin'])) with check (public.is_active_admin_user(array['owner','admin']));
      drop policy if exists "inventory balances write owner admin" on public.inventory_balances;
      create policy "inventory balances write owner admin" on public.inventory_balances for all to authenticated using (public.is_active_admin_user(array['owner','admin'])) with check (public.is_active_admin_user(array['owner','admin']));
      drop policy if exists "stock movements write owner admin" on public.stock_movements;
      create policy "stock movements write owner admin" on public.stock_movements for all to authenticated using (public.is_active_admin_user(array['owner','admin'])) with check (public.is_active_admin_user(array['owner','admin']));

      create or replace function trry_api.receive_inventory(
        p_location_id uuid,
        p_variant_id uuid,
        p_quantity integer,
        p_idempotency_key text,
        p_source_reference text default null,
        p_reason text default null
      )
      returns jsonb
      language plpgsql
      security definer
      set search_path = ''
      as $$
      declare
        v_actor uuid := auth.uid();
        v_balance public.inventory_balances%rowtype;
        v_product_id uuid;
        v_before integer;
        v_after integer;
      begin
        if v_actor is null then
          raise exception 'Authentication is required.';
        end if;
        if not public.is_active_admin_user(array['owner','admin']) then
          raise exception 'Only Owner and Admin roles can receive inventory.';
        end if;
        if p_quantity is null or p_quantity <= 0 then
          raise exception 'Quantity must be a positive whole number.';
        end if;
        if btrim(coalesce(p_idempotency_key, '')) = '' then
          raise exception 'Receive idempotency key is required.';
        end if;

        select product_id into v_product_id from public.product_variants where id = p_variant_id;
        if v_product_id is null then
          raise exception 'Select a product variant.';
        end if;

        insert into public.inventory_balances (variant_id, location_id, on_hand, reserved, available)
        values (p_variant_id, p_location_id, 0, 0, 0)
        on conflict (variant_id, location_id) do nothing;

        select * into v_balance
        from public.inventory_balances
        where variant_id = p_variant_id and location_id = p_location_id
        for update;

        if not found then
          raise exception 'Inventory balance is required.';
        end if;

        v_before := v_balance.on_hand;
        v_after := v_before + p_quantity;

        update public.inventory_balances
        set on_hand = v_after,
            available = greatest(v_after - reserved, 0),
            updated_at = now()
        where id = v_balance.id
        returning * into v_balance;

        insert into public.stock_movements (
          product_id, variant_id, location_id, movement_type, quantity_delta,
          balance_before, balance_after, source, source_reference, reason,
          idempotency_key, created_by_user_id
        ) values (
          v_product_id, p_variant_id, p_location_id, 'RECEIVE', p_quantity,
          v_before, v_after, 'INVENTORY_RECEIVE', p_source_reference, p_reason,
          p_idempotency_key, v_actor
        );

        return jsonb_build_object('balance', to_jsonb(v_balance), 'received', p_quantity);
      end;
      $$;

      revoke execute on function trry_api.receive_inventory(uuid,uuid,integer,text,text,text) from public;
      revoke execute on function trry_api.receive_inventory(uuid,uuid,integer,text,text,text) from anon;
      grant usage on schema trry_api to authenticated;
      grant execute on function trry_api.receive_inventory(uuid,uuid,integer,text,text,text) to authenticated;
    `,
  });
}

function verifySchemaAndPolicies() {
  assert.equal(sqlValue("select exists (select 1 from information_schema.tables where table_schema='public' and table_name='employee_temporary_access_grants')"), "t", "Temporary access table must exist.");
  for (const table of ["inventory_locations", "inventory_balances", "stock_movements"]) {
    assert.equal(sqlValue(`select exists (select 1 from information_schema.tables where table_schema='public' and table_name='${table}')`), "t", `${table} table must exist locally.`);
    assert.equal(sqlValue(`select count(*) from pg_policies where schemaname='public' and tablename='${table}' and cmd='SELECT' and qual like '%inventory%'`), "1", `${table} must have active inventory temp read policy.`);
    assert.equal(sqlValue(`select count(*) from pg_policies where schemaname='public' and tablename='${table}' and cmd in ('INSERT','UPDATE','DELETE') and coalesce(qual,'') like '%inventory%'`), "0", `${table} must not have temporary inventory write policy.`);
  }
  assert.equal(sqlValue("select count(*) from pg_policies where schemaname='public' and tablename='inventory_balances' and cmd='UPDATE' and coalesce(qual,'') like '%staff%'"), "0", "Inventory balances must not have broad Staff UPDATE.");
  assert.equal(sqlValue("select exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='trry_api' and p.proname='receive_inventory')"), "t", "Canonical receive_inventory RPC must exist locally.");
}

async function createQaIdentities() {
  const specs = {
    owner: ["owner", true],
    admin: ["admin", true],
    noGrantStaff: ["staff", true],
    inventoryStaff: ["staff", true],
    calendarStaff: ["staff", true],
    workboardStaff: ["staff", true],
    catalogStaff: ["staff", true],
    inquiriesStaff: ["staff", true],
    ordersStaff: ["staff", true],
    productionStaff: ["staff", true],
    designStaff: ["staff", true],
    revokedStaff: ["staff", true],
    expiredStaff: ["staff", true],
  };
  const result = {};
  for (const [key, [role, active]] of Object.entries(specs)) {
    const email = `${runId}-${key}@local.test`;
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: `E5G ${key}`, trry_admin_role: role },
    });
    assert.ifError(createError);
    const { data: profile, error: profileError } = await service
      .from("admin_users")
      .insert({
        user_id: created.user.id,
        email,
        display_name: `E5G ${key}`,
        role,
        is_active: active,
      })
      .select("id,user_id,email,role,is_active")
      .single();
    assert.ifError(profileError);
    result[key] = { email, authUser: created.user, profile };
  }
  return result;
}

async function seedInventoryFixture() {
  assert.ifError((await service.from("brands").insert({
    id: ids.brand,
    brand_code: `E5G-${runId}`,
    name: `E5G Brand ${runId}`,
    ownership_type: "internal",
    owner_name: "TRRY QA",
    status: "active",
  })).error);
  assert.ifError((await service.from("product_categories").insert({
    id: ids.category,
    name: `E5G Category ${runId}`,
    code: `E5G-${String(Date.now()).slice(-8)}`,
    product_type: "PHYSICAL",
  })).error);
  assert.ifError((await service.from("products").insert({
    id: ids.product,
    category_id: ids.category,
    brand_id: ids.brand,
    master_product_id: `E5G-MP-${runId}`,
    product_code: `E5G-P-${String(Date.now()).slice(-8)}`,
    name: `E5G QA Product ${runId}`,
    product_type: "PHYSICAL",
    readiness_status: "READY_FOR_SALE",
    sellable: true,
    purchasable: true,
    typed_config: {},
    eligible_channels: ["retail"],
  })).error);
  assert.ifError((await service.from("product_variants").insert({
    id: ids.variant,
    product_id: ids.product,
    master_variant_id: `E5G-V-${runId}`,
    sku: `E5G-SKU-${String(Date.now()).slice(-8)}`,
    global_sku: `E5G-GSKU-${String(Date.now()).slice(-8)}`,
    size: "M",
    color: "Black",
    selling_price: 250,
    unit_cost: 100,
    active: true,
  })).error);
  assert.ifError((await service.from("inventory_locations").insert([
    { id: ids.locationA, name: `E5G Main ${runId}`, code: `E5G-A-${String(Date.now()).slice(-6)}`, branch_name: "Local QA", active: true },
    { id: ids.locationB, name: `E5G Backup ${runId}`, code: `E5G-B-${String(Date.now()).slice(-6)}`, branch_name: "Local QA", active: true },
  ])).error);
  assert.ifError((await service.from("inventory_balances").insert([
    { id: ids.balanceA, variant_id: ids.variant, location_id: ids.locationA, on_hand: 12, reserved: 2, available: 10, reorder_point: 5, incoming: 0, last_cost: 100 },
    { id: ids.balanceB, variant_id: ids.variant, location_id: ids.locationB, on_hand: 0, reserved: 0, available: 0, reorder_point: 5, incoming: 0, last_cost: 100 },
  ])).error);
  assert.ifError((await service.from("stock_movements").insert([
    { id: ids.movementA, product_id: ids.product, variant_id: ids.variant, location_id: ids.locationA, movement_type: "RECEIVE", quantity_delta: 12, balance_before: 0, balance_after: 12, source: "LOCAL_QA", source_reference: runId, reason: "E5G QA seed" },
    { id: ids.movementB, product_id: ids.product, variant_id: ids.variant, location_id: ids.locationB, movement_type: "SEED", quantity_delta: 0, balance_before: 0, balance_after: 0, source: "LOCAL_QA", source_reference: runId, reason: "E5G QA seed" },
  ])).error);
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
    reason: `E5G runtime ${moduleCode} ${runId}`,
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
    global: { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} },
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
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function expectInventoryRead(token, shouldSee, message) {
  const client = token ? createUserClient(token) : anon;
  const { data, error } = await client
    .from("inventory_balances")
    .select("id,variant_id,location_id,on_hand,available")
    .eq("id", ids.balanceA);
  if (!shouldSee) {
    assert.ok(error || (data || []).length === 0, message);
    return;
  }
  assert.equal(error, null, message);
  assert.equal((data || []).some((row) => row.id === ids.balanceA && row.on_hand === 12), true, message);
}

async function expectOwnerAdminReceive(token, message) {
  const before = await readIntegritySnapshot();
  const result = await receiveInventory(token, 1);
  assert.equal(result.denied, false, message);
  const after = await readIntegritySnapshot();
  assert.equal(after.balanceA.on_hand, before.balanceA.on_hand + 1, message);
  assert.equal(after.balanceA.available, before.balanceA.available + 1, message);
  assert.equal(after.movementCount, before.movementCount + 1, message);
}

async function expectDeniedInventoryNoChange(label, action) {
  const before = await readIntegritySnapshot();
  const result = await action();
  assert.ok(result.denied, `${label} must be denied.`);
  const after = await readIntegritySnapshot();
  assert.deepEqual(after, before, `${label} must not partially mutate on-hand, available, movement, location, purchase, product, or ledger data.`);
}

async function receiveInventory(token, quantity) {
  const actorId = jwtSub(token);
  const idempotencyKey = `e5g-receive-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    execFileSync("docker", ["exec", "-i", "supabase_db_Admin_portal", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
      input: `
        begin;
        set local role authenticated;
        set local "request.jwt.claim.sub" = '${actorId}';
        set local "request.jwt.claim.role" = 'authenticated';
        select trry_api.receive_inventory(
          p_location_id => '${ids.locationA}'::uuid,
          p_variant_id => '${ids.variant}'::uuid,
          p_quantity => ${Number(quantity)},
          p_idempotency_key => '${idempotencyKey}',
          p_source_reference => '${runId}',
          p_reason => 'E5G QA receive'
        );
        commit;
      `,
    });
    return { denied: false };
  } catch (error) {
    return { denied: true, error };
  }
}

async function insertMovement(token, quantityDelta, movementType) {
  const { data, error } = await createUserClient(token)
    .from("stock_movements")
    .insert({
      product_id: ids.product,
      variant_id: ids.variant,
      location_id: ids.locationA,
      movement_type: movementType,
      quantity_delta: quantityDelta,
      balance_before: 12,
      balance_after: 12 + quantityDelta,
      source: "FORBIDDEN_E5G",
      source_reference: runId,
      reason: "forbidden temporary inventory write",
    })
    .select("id");
  return { denied: Boolean(error) || (data || []).length === 0 };
}

async function directBalanceUpdate(token, patch) {
  const { data, error } = await createUserClient(token)
    .from("inventory_balances")
    .update(patch)
    .eq("id", ids.balanceA)
    .select("id");
  return { denied: Boolean(error) || (data || []).length === 0 };
}

async function transferStock(token) {
  const { data, error } = await createUserClient(token)
    .from("inventory_balances")
    .update({ on_hand: 1, available: 1 })
    .eq("id", ids.balanceB)
    .select("id");
  return { denied: Boolean(error) || (data || []).length === 0 };
}

async function receivePurchaseOrder(token) {
  const { data, error } = await createUserClient(token)
    .from("purchase_order_receipts")
    .insert({
      purchase_order_id: crypto.randomUUID(),
      location_id: ids.locationA,
      reference: runId,
      idempotency_key: `e5g-po-${Date.now()}`,
      received_by_user_id: identities.inventoryStaff.profile.user_id,
    })
    .select("id");
  return { denied: Boolean(error) || (data || []).length === 0 };
}

async function directMovementUpdate(token, patch) {
  const { data, error } = await createUserClient(token)
    .from("stock_movements")
    .update(patch)
    .eq("id", ids.movementA)
    .select("id");
  return { denied: Boolean(error) || (data || []).length === 0 };
}

async function directProductUpdate(token) {
  const { data, error } = await createUserClient(token)
    .from("products")
    .update({ name: `Forbidden ${runId}` })
    .eq("id", ids.product)
    .select("id");
  return { denied: Boolean(error) || (data || []).length === 0 };
}

async function readIntegritySnapshot() {
  const { data: balanceRows, error: balanceError } = await service
    .from("inventory_balances")
    .select("id,on_hand,reserved,available,location_id,variant_id,updated_at")
    .in("id", [ids.balanceA, ids.balanceB])
    .order("id");
  assert.ifError(balanceError);
  const { count: movementCount, error: movementError } = await service
    .from("stock_movements")
    .select("id", { count: "exact", head: true })
    .or(`source_reference.eq.${runId},id.in.(${ids.movementA},${ids.movementB})`);
  assert.ifError(movementError);
  const { data: product, error: productError } = await service
    .from("products")
    .select("id,name,readiness_status,sellable,purchasable,updated_at")
    .eq("id", ids.product)
    .single();
  assert.ifError(productError);
  return {
    balanceA: normalizeSnapshot(balanceRows.find((row) => row.id === ids.balanceA)),
    balanceB: normalizeSnapshot(balanceRows.find((row) => row.id === ids.balanceB)),
    movementCount: movementCount || 0,
    product: normalizeSnapshot(product),
  };
}

function normalizeSnapshot(row) {
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, value === undefined ? null : value]));
}

async function readAdminRole(id) {
  const { data, error } = await service.from("admin_users").select("role").eq("id", id).single();
  assert.ifError(error);
  return data.role;
}

async function revokeAllActiveQaGrants(revokerId) {
  const idsToRevoke = qaRows.map((row) => row.id);
  if (!idsToRevoke.length) return;
  const { error } = await service
    .from("employee_temporary_access_grants")
    .update({ revoked_at: new Date().toISOString(), revoked_by: revokerId })
    .in("employee_id", idsToRevoke)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());
  assert.ifError(error);
}

async function readActiveQaGrantCount() {
  const idsToCheck = qaRows.map((row) => row.id);
  if (!idsToCheck.length) return 0;
  const { count, error } = await service
    .from("employee_temporary_access_grants")
    .select("id", { count: "exact", head: true })
    .in("employee_id", idsToCheck)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());
  assert.ifError(error);
  return count || 0;
}

async function cleanupFixture() {
  await service.from("stock_movements").delete().or(`source_reference.eq.${runId},id.in.(${ids.movementA},${ids.movementB})`);
  await service.from("inventory_balances").delete().in("id", [ids.balanceA, ids.balanceB]);
  await service.from("inventory_locations").delete().in("id", [ids.locationA, ids.locationB]);
  await service.from("product_variants").delete().eq("id", ids.variant);
  await service.from("products").delete().eq("id", ids.product);
  await service.from("product_categories").delete().eq("id", ids.category);
  await service.from("brands").delete().eq("id", ids.brand);
}

function sqlValue(sql) {
  return execFileSync("docker", ["exec", "supabase_db_Admin_portal", "psql", "-U", "postgres", "-d", "postgres", "-tAc", sql], { encoding: "utf8" }).trim();
}

function jwtSub(token) {
  const payload = JSON.parse(Buffer.from(String(token || "").split(".")[1] || "", "base64url").toString("utf8"));
  return payload.sub;
}
