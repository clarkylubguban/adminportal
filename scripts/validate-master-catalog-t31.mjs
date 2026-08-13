import { spawn } from "node:child_process";
import { resolve } from "node:path";

const image = process.env.POSTGRES_IMAGE ?? "postgres:17";
const container = `trry-t31-validation-${Date.now()}`;
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

async function psqlStdinExpectFailure(sql, expectedMessage) {
  try {
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
    ], { input: sql, capture: true });
  } catch (error) {
    if (String(error.message).includes(expectedMessage)) {
      return;
    }
    throw error;
  }
  throw new Error(`Expected psql failure containing ${expectedMessage}.`);
}

const approvedStagingFixture = `
do $$
declare
  v_root uuid := gen_random_uuid();
begin
  insert into public.product_categories(id, name, code, active)
  values
    (v_root, 'M1 QA Root Edited 20260812011129542', 'M1-QA-ROOT-20260812011129542', false),
    (gen_random_uuid(), 'M1 QA Inactive 20260812011129542', 'M1-QA-INACTIVE-20260812011129542', false),
    (gen_random_uuid(), 'T-shirt Oversize', 'T-SHIRT-OVERSIZE', true);

  insert into public.product_categories(id, name, code, parent_category_id, active)
  values
    (gen_random_uuid(), 'M1 QA Child 20260812011129542', 'M1-QA-CHILD-20260812011129542', v_root, false),
    (gen_random_uuid(), 'M1 QA Sibling 20260812011129542', 'M1-QA-SIBLING-20260812011129542', v_root, false);
end
$$;
`;

const approvedStagingFixtureAssertions = `
do $$
begin
  if exists (
    select 1
    from public.product_categories
    where code in (
      'M1-QA-ROOT-20260812011129542',
      'M1-QA-CHILD-20260812011129542',
      'M1-QA-SIBLING-20260812011129542',
      'M1-QA-INACTIVE-20260812011129542',
      'T-SHIRT-OVERSIZE'
    )
      and product_type <> 'PHYSICAL'
  ) then
    raise exception 'approved staging category mapping failed';
  end if;

  if (
    select count(*)
    from public.product_categories
    where code in (
      'M1-QA-ROOT-20260812011129542',
      'M1-QA-CHILD-20260812011129542',
      'M1-QA-SIBLING-20260812011129542',
      'M1-QA-INACTIVE-20260812011129542',
      'T-SHIRT-OVERSIZE'
    )
      and product_type = 'PHYSICAL'
  ) <> 5 then
    raise exception 'approved staging category mapping count mismatch';
  end if;
end
$$;
`;

const unknownCategoryRollbackProbe = `
begin;
insert into public.product_categories(name, code, active)
values ('T31 Unknown Zero Product Category', 'T31-UNKNOWN-ZERO-PRODUCT', true);
\\i /workspace/supabase/migrations/202608130001_add_master_catalog_t31_category_product_type_binding.sql
rollback;
`;

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
  await psqlStdin(approvedStagingFixture);
  await psqlStdinExpectFailure(unknownCategoryRollbackProbe, "CATEGORY_PRODUCT_TYPE_MAPPING_REQUIRED");
  await psqlFile("/workspace/supabase/migrations/202608130001_add_master_catalog_t31_category_product_type_binding.sql");
  await psqlStdin(approvedStagingFixtureAssertions);
  await psqlFile("/workspace/supabase/migrations/202608130001_add_master_catalog_t31_category_product_type_binding.sql");
  await psqlFile("/workspace/supabase/tests/master_catalog_t31_category_product_type_binding.sql");
  console.log("Master Catalog T3.1 category product-type binding validation passed.");
} finally {
  await run("docker", ["rm", "-f", container], { capture: true }).catch(() => {});
}
