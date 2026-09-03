import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const image = process.env.TRRY_VERIFY_POSTGRES_IMAGE ?? "postgres:16-alpine";
const container = `trry-customer-c2-1-validation-${Date.now()}`;
const password = "postgres";
const db = "trry_verify";
const workspace = resolve(".");
const dockerEnv = { ...process.env };
const staffUserId = "00000000-0000-0000-0000-00000000b201";

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
    try {
      const ready = run("docker", ["exec", container, "pg_isready", "-U", "postgres", "-d", db], { capture: true, allowFailure: true, timeout: 10_000 });
      const query = run("docker", ["exec", container, "psql", "-U", "postgres", "-d", db, "-X", "-t", "-A", "-c", "select 1"], { capture: true, allowFailure: true, timeout: 10_000 });
      if (ready.status === 0 && query.status === 0 && query.stdout.trim() === "1") return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
    }
  }
  throw new Error("Timed out waiting for Postgres validation container.");
}

async function psqlFile(file) {
  console.log(`Applying ${file.replace("/workspace/supabase/migrations/", "migration:").replace("/workspace/supabase/tests/", "test:")}`);
  await run("docker", [
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

async function validateConcurrentRpcResolution() {
  const setup = `
insert into auth.users (id, email)
values ('${staffUserId}'::uuid, 'staff-c2-race@example.test')
on conflict (id) do nothing;

insert into public.admin_users (user_id, email, role, display_name, is_active)
values ('${staffUserId}'::uuid, 'staff-c2-race@example.test', 'staff', 'C2 Race Staff', true)
on conflict (user_id) do update
set email = excluded.email,
    role = excluded.role,
    display_name = excluded.display_name,
    is_active = excluded.is_active;
`;

  const call = `
set role authenticated;
select set_config('request.jwt.claim.sub', '${staffUserId}', false);
select customer_id, customer_reference, created
from public.find_or_create_customer_identity_c2_1(
  'C2 Race Customer',
  '0917 777 8888',
  'ADMIN_MANUAL'
);
`;

  await psqlStdin(setup);
  const [first, second] = await Promise.all([
    psqlStdin(call, { capture: true }),
    psqlStdin(call, { capture: true }),
  ]);

  const verify = await psqlStdin(`
select count(*)::int as matching_customers
from public.customers
where mobile_normalized = '+639177778888';
`, { capture: true });

  if (!/matching_customers\s*\n-+\s*\n\s*1\b/.test(verify.stdout)) {
    throw new Error(`Concurrent RPC did not leave exactly one customer.\n${verify.stdout}`);
  }

  if (!/CUS-[0-9]{6,}/.test(first.stdout) || !/CUS-[0-9]{6,}/.test(second.stdout)) {
    throw new Error(`Concurrent RPC did not return customer references.\n${first.stdout}\n${second.stdout}`);
  }
}

try {
  console.log(`Starting ${container} from ${image}`);
  await run("docker", [
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
  await psqlFile("/workspace/supabase/migrations/20260903010100_customer_identity_linking_c2_1.sql");
  await psqlFile("/workspace/supabase/tests/customer_identity_c1.sql");
  await psqlFile("/workspace/supabase/tests/customer_identity_linking_c2_1.sql");
  console.log("Validating concurrent RPC duplicate resolution");
  await validateConcurrentRpcResolution();
  console.log("Customer Identity C2.1 validation passed.");
} finally {
  run("docker", ["rm", "-f", container], { capture: true, allowFailure: true, timeout: 30_000 });
}
