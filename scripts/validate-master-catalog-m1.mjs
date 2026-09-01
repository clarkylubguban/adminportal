import { spawn } from "node:child_process";
import { resolve } from "node:path";

const image = process.env.POSTGRES_IMAGE ?? "postgres:17";
const container = `trry-m1-validation-${Date.now()}`;
const password = "postgres";
const workspace = resolve(".");
const dockerEnv = { ...process.env };

const bootstrap = `
create schema if not exists auth;
create schema if not exists storage;
create extension if not exists pgcrypto;

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
`;

function dockerPath(path) {
  return path.replaceAll("\\", "/");
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      stdio: options.capture ? ["pipe", "pipe", "pipe"] : ["pipe", "inherit", "inherit"],
      shell: false,
      env: dockerEnv,
    });
    let stdout = "";
    let stderr = "";
    if (options.input) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
    if (options.capture) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolveRun({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited ${code}\n${stdout}\n${stderr}`));
    });
  });
}

async function waitForPostgres() {
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    try {
      await run("docker", ["exec", container, "pg_isready", "-U", "postgres"], { capture: true });
      return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
    }
  }
  throw new Error("Timed out waiting for Postgres validation container.");
}

async function psqlFile(file) {
  await run("docker", [
    "exec",
    "-e",
    `PGPASSWORD=${password}`,
    container,
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-f",
    file,
  ]);
}

async function psqlStdin(sql) {
  await run("docker", [
    "exec",
    "-i",
    "-e",
    `PGPASSWORD=${password}`,
    container,
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
    "-d",
    "postgres",
  ], { input: sql });
}

try {
  await run("docker", [
    "run",
    "--name",
    container,
    "-e",
    `POSTGRES_PASSWORD=${password}`,
    "-v",
    `${dockerPath(workspace)}:/workspace:ro`,
    "-d",
    image,
  ], { capture: true });
  await waitForPostgres();
  await psqlStdin(bootstrap);
  await psqlFile("/workspace/supabase/migrations/202607110001_create_catalog_products.sql");
  await psqlFile("/workspace/supabase/migrations/202607220001_harden_admin_auth_profiles.sql");
  await psqlFile("/workspace/supabase/migrations/202608110001_add_master_catalog_m0_foundation.sql");
  await psqlFile("/workspace/supabase/migrations/202608110002_add_master_catalog_m1_governance.sql");
  await psqlFile("/workspace/supabase/migrations/202608110003_fix_master_catalog_m1_sku_override_privileges.sql");
  await psqlFile("/workspace/supabase/migrations/202608110004_enforce_active_category_product_assignment.sql");
  await psqlFile("/workspace/supabase/tests/master_catalog_m1_governance.sql");
  console.log("Master Catalog M1 validation passed.");
} finally {
  await run("docker", ["rm", "-f", container], { capture: true }).catch(() => {});
}