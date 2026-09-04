import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const image = process.env.TRRY_VERIFY_POSTGRES_IMAGE ?? "postgres:16-alpine";
const container = `trry-customer-c2-3-1-validation-${Date.now()}`;
const password = "postgres";
const db = "trry_verify";
const workspace = resolve(".");
const dockerEnv = { ...process.env };

const bootstrap = `
create schema if not exists auth;
create schema if not exists storage;
create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
end
$$;

alter role service_role bypassrls;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
`;

function dockerPath(path) {
  return path.replaceAll("\\", "/");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    input: options.input,
    maxBuffer: 10 * 1024 * 1024,
    timeout: options.timeout || 120_000,
    env: dockerEnv,
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}\n${result.stdout || ""}\n${result.stderr || ""}`);
  }
  if (!options.capture && result.stdout) process.stdout.write(result.stdout);
  if (!options.capture && result.stderr) process.stderr.write(result.stderr);
  return { stdout: result.stdout || "", stderr: result.stderr || "", status: result.status };
}

async function waitForPostgres() {
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    const ready = run("docker", ["exec", container, "pg_isready", "-U", "postgres", "-d", db], { capture: true, allowFailure: true, timeout: 10_000 });
    const query = run("docker", ["exec", container, "psql", "-U", "postgres", "-d", db, "-X", "-t", "-A", "-c", "select 1"], { capture: true, allowFailure: true, timeout: 10_000 });
    if (ready.status === 0 && query.status === 0 && query.stdout.trim() === "1") return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  throw new Error("Timed out waiting for Postgres validation container.");
}

async function psqlFile(file) {
  console.log(`Applying ${file.replace("/workspace/supabase/migrations/", "migration:").replace("/workspace/supabase/tests/", "test:")}`);
  run("docker", [
    "exec", "-e", `PGPASSWORD=${password}`, container,
    "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", db, "-f", file,
  ]);
}

async function psqlStdin(sql, options = {}) {
  return run("docker", [
    "exec", "-i", "-e", `PGPASSWORD=${password}`, container,
    "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", db,
  ], { input: sql, capture: options.capture });
}

async function validateConcurrentExternalRequests() {
  const call = (key, inquiryId) => `
set role service_role;
select inquiry_id, customer_id, customer_reference, customer_created, replay
from public.create_external_inquiry_identity_c2_3_1(
  '${key}',
  '${inquiryId}',
  'C23 Race Customer',
  '0917 777 8888',
  'Concurrent C2.3.1 external inquiry.',
  'Custom shirt',
  '10 pcs',
  current_date + 10
);
`;

  const [first, second] = await Promise.all([
    psqlStdin(call("web-c23-race-left", "TRRY-C23-RACE-L"), { capture: true }),
    psqlStdin(call("web-c23-race-right", "TRRY-C23-RACE-R"), { capture: true }),
  ]);

  const verify = await psqlStdin(`
select
  (select count(*)::int from public.customers where mobile_normalized = '+639177778888') as matching_customers,
  (select count(*)::int from public.ops_inquiries where id in ('TRRY-C23-RACE-L','TRRY-C23-RACE-R')) as matching_inquiries,
  (select count(distinct customer_id)::int from public.ops_inquiries where id in ('TRRY-C23-RACE-L','TRRY-C23-RACE-R')) as linked_customer_count;
`, { capture: true });

  if (!/matching_customers\s*\|\s*matching_inquiries\s*\|\s*linked_customer_count[\s\S]*\n\s*1\s*\|\s*2\s*\|\s*1\b/.test(verify.stdout)) {
    throw new Error(`Concurrent external requests did not leave one linked customer and two inquiries.\n${verify.stdout}\n${first.stdout}\n${second.stdout}`);
  }
}

try {
  console.log(`Starting ${container} from ${image}`);
  run("docker", [
    "run", "--name", container,
    "-e", `POSTGRES_PASSWORD=${password}`,
    "-e", `POSTGRES_DB=${db}`,
    "-v", `${dockerPath(workspace)}:/workspace:ro`,
    "-d", image,
  ], { capture: true });
  console.log("Waiting for Postgres");
  await waitForPostgres();
  console.log("Bootstrapping local Supabase roles");
  await psqlStdin(bootstrap);
  await psqlFile("/workspace/supabase/migrations/202607110001_create_catalog_products.sql");
  await psqlFile("/workspace/supabase/migrations/202607120002_add_order_dashboard_fields.sql");
  await psqlFile("/workspace/supabase/migrations/20260717043119_align_admin_mvp_workflow_fields.sql");
  await psqlFile("/workspace/supabase/migrations/202607220001_harden_admin_auth_profiles.sql");
  await psqlFile("/workspace/supabase/migrations/202608080001_phase3d_native_orders.sql");
  await psqlFile("/workspace/supabase/migrations/20260831021438_add_customer_identity_c1.sql");
  await psqlFile("/workspace/supabase/migrations/20260902142917_repair_customer_identity_c1_audit_users.sql");
  await psqlFile("/workspace/supabase/migrations/20260903010100_customer_identity_linking_c2_1.sql");
  await psqlFile("/workspace/supabase/migrations/20260904010100_external_inquiry_identity_c2_3_1.sql");
  await psqlFile("/workspace/supabase/migrations/20260904010100_external_inquiry_identity_c2_3_1.sql");
  await psqlFile("/workspace/supabase/tests/customer_identity_c1.sql");
  await psqlFile("/workspace/supabase/tests/customer_identity_linking_c2_1.sql");
  await psqlFile("/workspace/supabase/tests/customer_identity_external_c2_3_1.sql");
  console.log("Validating concurrent external duplicate-mobile resolution");
  await validateConcurrentExternalRequests();
  console.log("Customer Identity C2.3.1 validation passed.");
} finally {
  run("docker", ["rm", "-f", container], { capture: true, allowFailure: true, timeout: 30_000 });
}
