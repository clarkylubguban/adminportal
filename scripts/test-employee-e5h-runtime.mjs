import assert from "node:assert/strict";
import { execFileSync, execSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const runId = `e5h-${Date.now()}`;
const password = `Local-${runId}-Pass123!`;
const appPort = 8950 + Math.floor(Math.random() * 250);
const status = getLocalSupabaseStatus();

globalThis.window = {
  TRRY_ADMIN_ENV: {
    VITE_SUPABASE_URL: status.API_URL,
    VITE_SUPABASE_ANON_KEY: status.ANON_KEY,
    VITE_USE_SUPABASE_DATA: "true",
  },
};

const {
  createPurchaseOrder,
  markPurchaseOrderOrdered,
  receivePurchaseOrder,
  getPurchaseOrders,
} = await import("../src/services/adminPurchasing.js");
const {
  createAdminSupplier,
  getAdminSuppliers,
  updateAdminSupplier,
} = await import("../src/services/adminSuppliers.js");

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
  location: crypto.randomUUID(),
  balance: crypto.randomUUID(),
  movement: crypto.randomUUID(),
  supplierA: crypto.randomUUID(),
  supplierB: crypto.randomUUID(),
};

let server;
let identities = {};
let qaRows = [];
let cleanupRevokerId = "";
let orderedPo;
let orderedLineId = "";
let draftPo;

try {
  applyMigration("supabase/migrations/202608240001_add_supplier_master_m1.sql");
  applyMigration("supabase/migrations/202608240002_add_purchase_orders_m2.sql");
  ensureLocalInventoryFoundationForQa();
  applyMigration("supabase/migrations/202608240003_add_purchase_order_receiving_m3.sql");
  applyMigration("supabase/migrations/20260826031500_employee_e5d_orders_temp_access.sql");
  applyMigration("supabase/migrations/20260826062747_employee_e5e_production_temp_access.sql");
  applyMigration("supabase/migrations/20260827011526_employee_e5f_design_artwork_temp_access.sql");
  applyMigration("supabase/migrations/20260827024500_employee_e5g_inventory_temp_access.sql");
  applyMigration("supabase/migrations/20260827052000_employee_e5h_purchasing_suppliers_temp_access.sql");
  verifySchemaAndPolicies();

  identities = await createQaIdentities();
  qaRows = Object.values(identities).map((item) => item.profile);
  cleanupRevokerId = identities.owner.profile.id;
  await seedFixture();

  await seedGrant(identities.purchasingStaff.profile.id, "purchasing_suppliers", identities.owner.profile.id);
  await seedGrant(identities.inventoryStaff.profile.id, "inventory", identities.owner.profile.id);
  await seedGrant(identities.productionStaff.profile.id, "production", identities.owner.profile.id);
  await seedGrant(identities.catalogStaff.profile.id, "master_catalog", identities.owner.profile.id);
  await seedGrant(identities.revokedStaff.profile.id, "purchasing_suppliers", identities.owner.profile.id, { revoked: true });
  await seedGrant(identities.expiredStaff.profile.id, "purchasing_suppliers", identities.owner.profile.id, { expired: true });

  server = await startLocalDevServer();

  const ownerSession = await signIn(identities.owner.email);
  const adminSession = await signIn(identities.admin.email);
  const noGrantSession = await signIn(identities.noGrantStaff.email);
  const purchasingSession = await signIn(identities.purchasingStaff.email);
  const inventorySession = await signIn(identities.inventoryStaff.email);
  const productionSession = await signIn(identities.productionStaff.email);
  const catalogSession = await signIn(identities.catalogStaff.email);
  const revokedSession = await signIn(identities.revokedStaff.email);
  const expiredSession = await signIn(identities.expiredStaff.email);

  await expectEffective("", "purchasing_suppliers", 401, undefined, "Unauthenticated effective Purchasing access must be blocked.");
  await expectEffective(ownerSession.access_token, "purchasing_suppliers", 200, { allowed: true, source: "permanent" }, "Owner Purchasing access must remain permanent.");
  await expectEffective(adminSession.access_token, "purchasing_suppliers", 200, { allowed: true, source: "permanent" }, "Admin Purchasing access must remain permanent.");
  await expectEffective(noGrantSession.access_token, "purchasing_suppliers", 200, { allowed: false, source: "none" }, "Staff without Purchasing grant must be denied.");
  await expectEffective(purchasingSession.access_token, "purchasing_suppliers", 200, { allowed: true, source: "temporary" }, "Active purchasing_suppliers grant must allow Staff read.");
  await expectEffective(inventorySession.access_token, "purchasing_suppliers", 200, { allowed: false, source: "none" }, "Inventory grant must not unlock Purchasing.");
  await expectEffective(productionSession.access_token, "purchasing_suppliers", 200, { allowed: false, source: "none" }, "Production grant must not unlock Purchasing.");
  await expectEffective(catalogSession.access_token, "purchasing_suppliers", 200, { allowed: false, source: "none" }, "Master Catalog grant must not unlock Purchasing.");
  await expectEffective(revokedSession.access_token, "purchasing_suppliers", 200, { allowed: false, source: "none" }, "Revoked Purchasing grant must be denied.");
  await expectEffective(expiredSession.access_token, "purchasing_suppliers", 200, { allowed: false, source: "none" }, "Expired Purchasing grant must be denied.");

  for (const moduleCode of ["calendar", "workboard", "master_catalog", "inquiries", "orders", "production", "design_artwork", "inventory"]) {
    await expectEffective(purchasingSession.access_token, moduleCode, 200, { allowed: false, source: "none" }, `Purchasing grant must not unlock ${moduleCode}.`);
  }
  await expectEffective(purchasingSession.access_token, "pos_sales", 200, { allowed: false, source: "none" }, "Purchasing grant must not unlock POS Sales.");
  for (const moduleCode of ["pricing_discounts", "people_access", "my_tasks"]) {
    const response = await effectiveRequest(purchasingSession.access_token, moduleCode);
    assert.ok(response.status >= 400, `Purchasing grant must not register or unlock future module ${moduleCode}.`);
  }

  const forged = await effectiveRequest(noGrantSession.access_token, "purchasing_suppliers", { "X-TRRY-Temp-Access": "purchasing_suppliers" });
  assert.equal(forged.status, 200, "Forged client Purchasing state must not break authenticated API.");
  assert.equal(forged.body.access?.allowed, false, "Forged client Purchasing state must be denied server-side.");

  await expectPurchasingRead(ownerSession.access_token, true, "Owner direct Purchasing read must be preserved.");
  await expectPurchasingRead(adminSession.access_token, true, "Admin direct Purchasing read must be preserved.");
  await expectPurchasingRead(noGrantSession.access_token, false, "No-grant Staff Purchasing read must be denied by RLS.");
  await expectPurchasingRead(purchasingSession.access_token, true, "Temporary Purchasing Staff direct read must be allowed.");
  await expectPurchasingRead(inventorySession.access_token, false, "Inventory grant must not read Purchasing.");
  await expectPurchasingRead(revokedSession.access_token, false, "Revoked Purchasing grant direct read must be denied.");
  await expectPurchasingRead(expiredSession.access_token, false, "Expired Purchasing grant direct read must be denied.");
  await expectPurchasingRead("", false, "Unauthenticated Purchasing read must be denied.");

  const appOrders = await getPurchaseOrders(purchasingSession);
  assert.equal(appOrders.error, null, "Temporary Purchasing Staff app PO read must not return an error.");
  assert.ok(appOrders.purchaseOrders.some((order) => order.id === orderedPo.id), "Temporary Purchasing Staff app read must include QA purchase order.");
  const appSuppliers = await getAdminSuppliers(purchasingSession);
  assert.equal(appSuppliers.error, null, "Temporary Purchasing Staff supplier read must not return an error.");
  assert.ok(appSuppliers.suppliers.some((supplier) => supplier.id === ids.supplierA), "Temporary Purchasing Staff app read must include QA supplier.");

  await expectOwnerAdminWorkflows(ownerSession, adminSession);

  await expectDeniedNoChange("Create PO", () => createPoAttempt(purchasingSession));
  await expectDeniedNoChange("Edit PO quantity", () => updatePoLine(purchasingSession.access_token, { ordered_quantity: 99 }));
  await expectDeniedNoChange("Edit PO cost", () => updatePoLine(purchasingSession.access_token, { unit_cost: 999 }));
  await expectDeniedNoChange("Change supplier", () => updatePurchaseOrder(purchasingSession.access_token, { supplier_id: ids.supplierB }));
  await expectDeniedNoChange("Approve/Mark Ordered", () => markPurchaseOrderOrdered(draftPo.id, purchasingSession));
  await expectDeniedNoChange("Cancel/Close PO", () => updatePurchaseOrder(purchasingSession.access_token, { status: "CANCELLED" }));
  await expectDeniedNoChange("Supplier create", () => createSupplierAttempt(purchasingSession));
  await expectDeniedNoChange("Supplier edit", () => updateAdminSupplier(ids.supplierA, supplierDraft("Forbidden"), purchasingSession));
  await expectDeniedNoChange("Purchase receipt", () => receivePurchaseOrder(receiptPayload(), purchasingSession));
  await expectDeniedNoChange("Inventory receive", () => receiveInventory(purchasingSession.access_token, 3));
  await expectDeniedNoChange("Inventory movement", () => insertMovement(purchasingSession.access_token));
  await expectDeniedNoChange("Product/Catalog mutation", () => updateProduct(purchasingSession.access_token));
  await expectDeniedNoChange("POS mutation", () => insertMovement(purchasingSession.access_token, "POS_SALE"));

  assert.equal(await readAdminRole(identities.purchasingStaff.profile.id), "staff", "Staff role must remain staff after Purchasing grant.");

  await revokeAllActiveQaGrants(identities.owner.profile.id);
  assert.equal(await readActiveQaGrantCount(), 0, "No active E5H QA grants should remain after cleanup.");
  await expectEffective(purchasingSession.access_token, "purchasing_suppliers", 200, { allowed: false, source: "none" }, "Revoked active Purchasing grant must deny effective access.");
  await expectPurchasingRead(purchasingSession.access_token, false, "Revoked active Purchasing grant must deny subsequent direct Purchasing read.");
  assert.equal(await readAdminRole(identities.purchasingStaff.profile.id), "staff", "Staff role must remain staff after revoke.");

  console.log("PASS: Employee E5H local runtime verification");
  console.log(`EVIDENCE: purchasing_suppliers module gate ok; temp Staff read-only verified; create/edit/approve/cancel/supplier/receipt/inventory/catalog/POS mutations denied with before=after; owner/admin Purchasing reads and writes preserved; qaRun=${runId}`);
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
  for (const table of ["suppliers", "purchase_orders", "purchase_order_lines", "purchase_order_receipts", "purchase_order_receipt_lines"]) {
    assert.equal(sqlValue(`select exists (select 1 from information_schema.tables where table_schema='public' and table_name='${table}')`), "t", `${table} table must exist locally.`);
    assert.equal(sqlValue(`select count(*) from pg_policies where schemaname='public' and tablename='${table}' and cmd='SELECT' and qual like '%purchasing_suppliers%'`), "1", `${table} must have active purchasing_suppliers temp read policy.`);
    assert.equal(sqlValue(`select count(*) from pg_policies where schemaname='public' and tablename='${table}' and cmd in ('INSERT','UPDATE','DELETE') and coalesce(qual,'') like '%purchasing_suppliers%'`), "0", `${table} must not have temporary Purchasing write policy.`);
  }
  assert.equal(sqlValue("select count(*) from pg_policies where schemaname='public' and tablename in ('purchase_orders','purchase_order_lines','suppliers') and cmd in ('INSERT','UPDATE','DELETE') and coalesce(qual,'') like '%staff%'"), "0", "Purchasing/Suppliers must not have broad Staff write policies.");
  assert.equal(sqlValue("select exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='receive_purchase_order')"), "t", "Receive Purchase RPC must exist locally.");
  assert.equal(sqlValue("select exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='trry_api' and p.proname='receive_inventory')"), "t", "Canonical receive_inventory RPC must exist locally.");
}

async function createQaIdentities() {
  const specs = {
    owner: ["owner", true],
    admin: ["admin", true],
    noGrantStaff: ["staff", true],
    purchasingStaff: ["staff", true],
    inventoryStaff: ["staff", true],
    productionStaff: ["staff", true],
    catalogStaff: ["staff", true],
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
      user_metadata: { display_name: `E5H ${key}`, trry_admin_role: role },
    });
    assert.ifError(createError);
    const { data: profile, error: profileError } = await service
      .from("admin_users")
      .insert({
        user_id: created.user.id,
        email,
        display_name: `E5H ${key}`,
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

async function seedFixture() {
  assert.ifError((await service.from("brands").insert({
    id: ids.brand,
    brand_code: `E5H-${String(Date.now()).slice(-8)}`,
    name: `E5H Brand ${runId}`,
    ownership_type: "internal",
    owner_name: "TRRY QA",
    status: "active",
  })).error);
  assert.ifError((await service.from("product_categories").insert({
    id: ids.category,
    name: `E5H Category ${runId}`,
    code: `E5H-${String(Date.now()).slice(-8)}`,
    product_type: "PHYSICAL",
  })).error);
  assert.ifError((await service.from("products").insert({
    id: ids.product,
    category_id: ids.category,
    brand_id: ids.brand,
    master_product_id: `E5H-MP-${runId}`,
    product_code: `E5H-P-${String(Date.now()).slice(-8)}`,
    name: `E5H QA Product ${runId}`,
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
    master_variant_id: `E5H-V-${runId}`,
    sku: `E5H-SKU-${String(Date.now()).slice(-8)}`,
    global_sku: `E5H-GSKU-${String(Date.now()).slice(-8)}`,
    size: "M",
    color: "Black",
    selling_price: 250,
    unit_cost: 100,
    active: true,
  })).error);
  assert.ifError((await service.from("suppliers").insert([
    supplierRow(ids.supplierA, "A"),
    supplierRow(ids.supplierB, "B"),
  ])).error);
  assert.ifError((await service.from("inventory_locations").insert({
    id: ids.location,
    name: `E5H Main ${runId}`,
    code: `E5H-${String(Date.now()).slice(-6)}`,
    branch_name: "Local QA",
    active: true,
  })).error);
  assert.ifError((await service.from("inventory_balances").insert({
    id: ids.balance,
    variant_id: ids.variant,
    location_id: ids.location,
    on_hand: 4,
    reserved: 1,
    available: 3,
    reorder_point: 2,
    incoming: 0,
    last_cost: 100,
  })).error);
  assert.ifError((await service.from("stock_movements").insert({
    id: ids.movement,
    product_id: ids.product,
    variant_id: ids.variant,
    location_id: ids.location,
    movement_type: "SEED",
    quantity_delta: 4,
    balance_before: 0,
    balance_after: 4,
    source: "LOCAL_QA",
    source_reference: runId,
    reason: "E5H QA seed",
  })).error);
  const ownerSession = await signIn(identities.owner.email);
  orderedPo = await createPurchaseOrder(poDraft(), "ORDERED", ownerSession);
  orderedLineId = orderedPo.lines[0].id;
  draftPo = await createPurchaseOrder(poDraft(), "DRAFT", ownerSession);
}

function supplierRow(id, suffix) {
  const numericSuffix = suffix === "A" ? "1" : "2";
  return {
    id,
    supplier_reference: `SUP-${String(Date.now()).slice(-4)}${numericSuffix}`,
    name: `E5H Supplier ${suffix} ${runId}`,
    supply_type: "Raw Materials",
    country_region: "PH",
    contact_person: `Buyer ${suffix}`,
    phone: "09000000000",
    email: `e5h-${suffix}-${Date.now()}@local.test`,
    address_location: "Local QA",
    currency: "PHP",
    payment_terms: "COD",
    lead_time_days: 3,
    internal_notes: `E5H QA ${runId}`,
    active: true,
  };
}

function supplierDraft(name) {
  return {
    name: `${name} ${runId}`,
    supplyType: "Raw Materials",
    countryRegion: "PH",
    contactPerson: "QA Buyer",
    phone: "09170000000",
    email: `${name.toLowerCase()}-${Date.now()}@local.test`,
    addressLocation: "Local QA",
    currency: "PHP",
    paymentTerms: "COD",
    leadTimeDays: "2",
    internalNotes: `E5H ${name}`,
    active: true,
  };
}

function poDraft() {
  return {
    supplierId: ids.supplierA,
    expectedDate: "2026-09-01",
    supplierReference: `E5H-${runId}`,
    freightCost: 10,
    internalNote: `E5H QA ${runId}`,
    lines: [{
      productId: ids.product,
      variantId: ids.variant,
      productName: `E5H QA Product ${runId}`,
      sku: `E5H-SKU-${String(Date.now()).slice(-8)}`,
      variantLabel: "Black / M",
      orderedQuantity: 5,
      unitCost: 100,
    }],
  };
}

function receiptPayload() {
  return {
    purchaseOrderId: orderedPo.id,
    locationId: ids.location,
    idempotencyKey: `e5h-receipt-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    reference: runId,
    note: "E5H temporary staff forbidden receive",
    lines: [{ purchaseOrderLineId: orderedLineId, quantity: 1 }],
  };
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
    reason: `E5H runtime ${moduleCode} ${runId}`,
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

async function expectPurchasingRead(token, shouldSee, message) {
  const client = token ? createUserClient(token) : anon;
  const { data, error } = await client
    .from("purchase_orders")
    .select("id,po_number,status,purchase_order_lines(id,ordered_quantity,unit_cost)")
    .eq("id", orderedPo.id);
  if (!shouldSee) {
    assert.ok(error || (data || []).length === 0, message);
    return;
  }
  assert.equal(error, null, message);
  assert.equal((data || []).some((row) => row.id === orderedPo.id), true, message);
  const { data: suppliers, error: supplierError } = await client
    .from("suppliers")
    .select("id,name,payment_terms")
    .eq("id", ids.supplierA);
  assert.equal(supplierError, null, message);
  assert.equal((suppliers || []).some((row) => row.id === ids.supplierA), true, message);
}

async function expectOwnerAdminWorkflows(ownerSession, adminSession) {
  const adminSupplier = await createAdminSupplier(supplierDraft("Admin Supplier"), adminSession);
  assert.ok(adminSupplier?.id, "Admin supplier create must be preserved.");
  const ownerDraft = await createPurchaseOrder(poDraft(), "DRAFT", ownerSession);
  assert.ok(ownerDraft?.id, "Owner Create PO must be preserved.");
  const ownerOrdered = await markPurchaseOrderOrdered(ownerDraft.id, ownerSession);
  assert.equal(ownerOrdered.status, "ORDERED", "Owner Mark Ordered must be preserved.");
  const received = await receivePurchaseOrder({
    ...receiptPayload(),
    purchaseOrderId: ownerOrdered.id,
    lines: [{ purchaseOrderLineId: ownerOrdered.lines[0].id, quantity: 1 }],
  }, adminSession);
  assert.ok(received?.receipts?.length >= 1 || received?.receiptCount >= 1, "Admin Receive Purchase must be preserved.");
}

async function expectDeniedNoChange(label, action) {
  const before = await readIntegritySnapshot();
  let denied = false;
  try {
    const result = await action();
    denied = result == null || Boolean(result?.denied);
  } catch {
    denied = true;
  }
  assert.equal(denied, true, `${label} must be denied.`);
  const after = await readIntegritySnapshot();
  assert.deepEqual(after, before, `${label} must not partially mutate PO, supplier, receipt, inventory, movement, or product data.`);
}

async function createPoAttempt(session) {
  const result = await createPurchaseOrder(poDraft(), "DRAFT", session);
  return { denied: !result?.id };
}

async function createSupplierAttempt(session) {
  const result = await createAdminSupplier(supplierDraft("Forbidden Supplier"), session);
  return { denied: !result?.id };
}

async function updatePurchaseOrder(token, patch) {
  const { data, error } = await createUserClient(token)
    .from("purchase_orders")
    .update(patch)
    .eq("id", orderedPo.id)
    .select("id");
  return { denied: Boolean(error) || (data || []).length === 0 };
}

async function updatePoLine(token, patch) {
  const { data, error } = await createUserClient(token)
    .from("purchase_order_lines")
    .update(patch)
    .eq("id", orderedLineId)
    .select("id");
  return { denied: Boolean(error) || (data || []).length === 0 };
}

async function receiveInventory(token, quantity) {
  const actorId = jwtSub(token);
  try {
    execFileSync("docker", ["exec", "-i", "supabase_db_Admin_portal", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
      input: `
        begin;
        set local role authenticated;
        set local "request.jwt.claim.sub" = '${actorId}';
        set local "request.jwt.claim.role" = 'authenticated';
        select trry_api.receive_inventory(
          p_location_id => '${ids.location}'::uuid,
          p_variant_id => '${ids.variant}'::uuid,
          p_quantity => ${Number(quantity)},
          p_idempotency_key => 'e5h-inventory-${Date.now()}',
          p_source_reference => '${runId}',
          p_reason => 'E5H forbidden temp purchasing receive'
        );
        commit;
      `,
    });
    return { denied: false };
  } catch (error) {
    return { denied: true, error };
  }
}

async function insertMovement(token, type = "ADJUSTMENT") {
  const { data, error } = await createUserClient(token)
    .from("stock_movements")
    .insert({
      product_id: ids.product,
      variant_id: ids.variant,
      location_id: ids.location,
      movement_type: type,
      quantity_delta: -1,
      balance_before: 4,
      balance_after: 3,
      source: "FORBIDDEN_E5H",
      source_reference: runId,
      reason: "forbidden temporary purchasing write",
    })
    .select("id");
  return { denied: Boolean(error) || (data || []).length === 0 };
}

async function updateProduct(token) {
  const { data, error } = await createUserClient(token)
    .from("products")
    .update({ name: `Forbidden ${runId}` })
    .eq("id", ids.product)
    .select("id");
  return { denied: Boolean(error) || (data || []).length === 0 };
}

async function readIntegritySnapshot() {
  const { data: po, error: poError } = await service
    .from("purchase_orders")
    .select("id,status,supplier_id,freight_cost,internal_note,updated_at")
    .eq("id", orderedPo.id)
    .single();
  assert.ifError(poError);
  const { data: line, error: lineError } = await service
    .from("purchase_order_lines")
    .select("id,ordered_quantity,received_quantity,unit_cost,updated_at")
    .eq("id", orderedLineId)
    .single();
  assert.ifError(lineError);
  const { data: supplier, error: supplierError } = await service
    .from("suppliers")
    .select("id,name,payment_terms,active,updated_at")
    .eq("id", ids.supplierA)
    .single();
  assert.ifError(supplierError);
  const { data: balance, error: balanceError } = await service
    .from("inventory_balances")
    .select("id,on_hand,reserved,available,updated_at")
    .eq("id", ids.balance)
    .single();
  assert.ifError(balanceError);
  const { data: product, error: productError } = await service
    .from("products")
    .select("id,name,readiness_status,sellable,purchasable,updated_at")
    .eq("id", ids.product)
    .single();
  assert.ifError(productError);
  const { count: receiptCount, error: receiptError } = await service
    .from("purchase_order_receipts")
    .select("id", { count: "exact", head: true })
    .eq("purchase_order_id", orderedPo.id);
  assert.ifError(receiptError);
  const { count: movementCount, error: movementError } = await service
    .from("stock_movements")
    .select("id", { count: "exact", head: true })
    .or(`source_reference.eq.${runId},id.eq.${ids.movement}`);
  assert.ifError(movementError);
  const { count: poCount, error: poCountError } = await service
    .from("purchase_orders")
    .select("id", { count: "exact", head: true })
    .ilike("supplier_reference", `E5H-${runId}%`);
  assert.ifError(poCountError);
  const { count: supplierCount, error: supplierCountError } = await service
    .from("suppliers")
    .select("id", { count: "exact", head: true })
    .like("internal_notes", `%${runId}%`);
  assert.ifError(supplierCountError);
  return {
    po: normalizeSnapshot(po),
    line: normalizeSnapshot(line),
    supplier: normalizeSnapshot(supplier),
    balance: normalizeSnapshot(balance),
    product: normalizeSnapshot(product),
    receiptCount: receiptCount || 0,
    movementCount: movementCount || 0,
    poCount: poCount || 0,
    supplierCount: supplierCount || 0,
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
  const { data: poRows } = await service.from("purchase_orders").select("id").ilike("supplier_reference", `E5H-${runId}%`);
  const poIds = (poRows || []).map((row) => row.id);
  if (poIds.length) {
    const { data: receiptRows } = await service.from("purchase_order_receipts").select("id").in("purchase_order_id", poIds);
    const receiptIds = (receiptRows || []).map((row) => row.id);
    if (receiptIds.length) await service.from("purchase_order_receipt_lines").delete().in("receipt_id", receiptIds);
    await service.from("purchase_order_receipts").delete().in("purchase_order_id", poIds);
    await service.from("purchase_order_lines").delete().in("purchase_order_id", poIds);
    await service.from("purchase_orders").delete().in("id", poIds);
  }
  await service.from("stock_movements").delete().or(`source_reference.eq.${runId},id.eq.${ids.movement}`);
  await service.from("inventory_balances").delete().eq("id", ids.balance);
  await service.from("inventory_locations").delete().eq("id", ids.location);
  await service.from("product_variants").delete().eq("id", ids.variant);
  await service.from("products").delete().eq("id", ids.product);
  await service.from("product_categories").delete().eq("id", ids.category);
  await service.from("brands").delete().eq("id", ids.brand);
  await service.from("suppliers").delete().like("internal_notes", `%${runId}%`);
}

function sqlValue(sql) {
  return execFileSync("docker", ["exec", "supabase_db_Admin_portal", "psql", "-U", "postgres", "-d", "postgres", "-tAc", sql], { encoding: "utf8" }).trim();
}

function jwtSub(token) {
  const payload = JSON.parse(Buffer.from(String(token || "").split(".")[1] || "", "base64url").toString("utf8"));
  return payload.sub;
}
