import { spawn } from "node:child_process";
import { resolve } from "node:path";

const image = process.env.POSTGRES_IMAGE ?? "postgres:17";
const container = `trry-customer-c1-validation-${Date.now()}`;
const password = "postgres";
const workspace = resolve(".");
const dockerEnv = { ...process.env };

const bootstrap = `
create schema if not exists auth;
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

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null,
  display_name text,
  is_active boolean not null default true
);

create or replace function public.is_active_admin_user(required_roles text[] default array['owner','admin','staff'])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
      and is_active = true
      and role = any(required_roles)
  );
$$;

revoke all on function public.is_active_admin_user(text[]) from public;
grant execute on function public.is_active_admin_user(text[]) to authenticated;
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
    if (options.input) child.stdin.write(options.input);
    child.stdin.end();
    if (options.capture) {
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolveRun({ stdout, stderr });
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
    "exec", "-e", `PGPASSWORD=${password}`, container,
    "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-f", file,
  ]);
}

async function psqlStdin(sql) {
  await run("docker", [
    "exec", "-i", "-e", `PGPASSWORD=${password}`, container,
    "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres",
  ], { input: sql });
}

try {
  await run("docker", [
    "run", "--name", container,
    "-e", `POSTGRES_PASSWORD=${password}`,
    "-v", `${dockerPath(workspace)}:/workspace:ro`,
    "-d", image,
  ], { capture: true });
  await waitForPostgres();
  await psqlStdin(bootstrap);
  await psqlFile("/workspace/supabase/migrations/20260831021438_add_customer_identity_c1.sql");
  await psqlFile("/workspace/supabase/migrations/20260902142917_repair_customer_identity_c1_audit_users.sql");
  await psqlFile("/workspace/supabase/tests/customer_identity_c1.sql");
  console.log("Customer Identity C1 validation passed.");
} finally {
  await run("docker", ["rm", "-f", container], { capture: true }).catch(() => {});
}
