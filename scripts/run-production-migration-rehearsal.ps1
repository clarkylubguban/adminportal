Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ContainerName = "trry-phase9b6-pg"
$DatabaseName = "phase9b6"
$PostgresUser = "postgres"
$PostgresPassword = "phase9b6-local-only"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptRoot "..")
$MigrationDir = Join-Path $RepoRoot "supabase\migrations"

$BaselinePayAtShopMigration = Join-Path $MigrationDir "202607290008_pay_at_shop_admin_workflow.sql"
$MigrationFiles = @(
  (Join-Path $MigrationDir "202607300009_online_payment_review.sql"),
  (Join-Path $MigrationDir "202607300010_online_payment_review_stale_version_fix.sql"),
  (Join-Path $MigrationDir "202607310001_allow_admin_down_payment_confirmations.sql")
)

foreach ($path in @($BaselinePayAtShopMigration) + $MigrationFiles) {
  if (!(Test-Path -LiteralPath $path)) {
    throw "Required migration file is missing: $path"
  }
}

function Invoke-Docker {
  param(
    [Parameter(Mandatory = $true)]
    [string[]] $Arguments
  )

  & docker @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Docker command failed: docker $($Arguments -join ' ')"
  }
}

function Invoke-Psql {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Sql,

    [Parameter(Mandatory = $true)]
    [string] $Label
  )

  Write-Host "==> $Label"
  $Sql | docker exec -i $ContainerName psql `
    -v ON_ERROR_STOP=1 `
    -U $PostgresUser `
    -d $DatabaseName

  if ($LASTEXITCODE -ne 0) {
    throw "psql failed during: $Label"
  }
}

function Invoke-PsqlFile {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Path,

    [Parameter(Mandatory = $true)]
    [string] $Label
  )

  $sql = Get-Content -Raw -LiteralPath $Path
  Invoke-Psql -Sql $sql -Label $Label
}

function Get-OldShopPaymentRollbackSql {
  $oldMigration = Get-Content -Raw -LiteralPath $BaselinePayAtShopMigration
  $startNeedle = "create or replace function public.confirm_inquiry_shop_payment("
  $commentNeedle = "comment on function public.confirm_inquiry_shop_payment(text, numeric, text, text, text) is"

  $start = $oldMigration.IndexOf($startNeedle, [StringComparison]::OrdinalIgnoreCase)
  if ($start -lt 0) {
    throw "Could not find old confirm_inquiry_shop_payment function in baseline migration."
  }

  $commentStart = $oldMigration.IndexOf($commentNeedle, $start, [StringComparison]::OrdinalIgnoreCase)
  if ($commentStart -lt 0) {
    throw "Could not find old confirm_inquiry_shop_payment comment/grant footer in baseline migration."
  }

  $commentEnd = $oldMigration.IndexOf(";", $commentStart, [StringComparison]::Ordinal)
  if ($commentEnd -lt 0) {
    throw "Could not find end of old confirm_inquiry_shop_payment footer."
  }

  $oldFunctionBlock = $oldMigration.Substring($start, $commentEnd - $start + 1)

  @"
begin;

revoke execute on function public.review_online_payment(
  text, text, numeric, text, text, timestamptz, text
) from public, anon, authenticated;

$oldFunctionBlock

commit;
"@
}

$BaselineSql = @'
create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table public.admin_users (
  user_id uuid primary key,
  role text not null,
  display_name text not null,
  is_active boolean not null default true
);

create or replace function public.is_active_admin_user(p_roles text[])
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users as admin_user
    where admin_user.user_id = auth.uid()
      and admin_user.is_active = true
      and admin_user.role = any(p_roles)
  );
$$;

create table public.ops_inquiries (
  id text primary key,
  updated_at timestamptz not null default now(),
  quote_status text,
  artwork_status text,
  production_stage text,
  quoted_amount numeric,
  amount_due numeric,
  payment_status text,
  payment_proof_path text,
  payment_confirmed_amount numeric,
  payment_confirmed_at timestamptz,
  payment_rejected_at timestamptz,
  payment_review_note text
);

insert into public.admin_users (user_id, role, display_name, is_active)
values
  ('00000000-0000-4000-8000-000000000123', 'owner', 'Phase 9B6 Owner', true),
  ('00000000-0000-4000-8000-000000000456', 'staff', 'Phase 9B6 Staff', true);
'@

$VerificationSql = @'
select 'verification: migration columns' as step;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inquiry_payment_events'
      and column_name = 'expected_version'
      and data_type = 'timestamp with time zone'
  ) then
    raise exception 'expected_version column is missing or has wrong type';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inquiry_payment_events'
      and column_name = 'review_note'
      and data_type = 'text'
  ) then
    raise exception 'review_note column is missing or has wrong type';
  end if;
end
$$;

select 'verification: function signatures and privileges' as step;

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'confirm_inquiry_shop_payment'
      and pg_get_function_identity_arguments(p.oid) =
        'p_inquiry_id text, p_amount numeric, p_payment_method text, p_internal_note text, p_idempotency_key text'
      and pg_get_function_result(p.oid) = 'jsonb'
  ) then
    raise exception 'confirm_inquiry_shop_payment signature mismatch';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'review_online_payment'
      and pg_get_function_identity_arguments(p.oid) =
        'p_inquiry_id text, p_action text, p_verified_amount numeric, p_review_note text, p_internal_note text, p_expected_updated_at timestamp with time zone, p_idempotency_key text'
      and pg_get_function_result(p.oid) = 'jsonb'
  ) then
    raise exception 'review_online_payment signature mismatch';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.review_online_payment(text,text,numeric,text,text,timestamptz,text)',
    'execute'
  ) then
    raise exception 'authenticated role cannot execute review_online_payment';
  end if;

  if has_function_privilege(
    'anon',
    'public.review_online_payment(text,text,numeric,text,text,timestamptz,text)',
    'execute'
  ) then
    raise exception 'anon role can execute review_online_payment';
  end if;
end
$$;
'@

$PaymentTestSql = @'
select 'payment tests: setup helpers' as step;

create or replace function public.rehearsal_assert_true(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if coalesce(p_condition, false) is not true then
    raise exception 'ASSERTION_FAILED: %', p_message;
  end if;
end;
$$;

create or replace function public.rehearsal_assert_text(p_actual text, p_expected text, p_message text)
returns void
language plpgsql
as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'ASSERTION_FAILED: %, expected %, got %', p_message, p_expected, p_actual;
  end if;
end;
$$;

create or replace function public.rehearsal_assert_numeric(p_actual numeric, p_expected numeric, p_message text)
returns void
language plpgsql
as $$
begin
  if round(coalesce(p_actual, -999999999), 2) <> round(p_expected, 2) then
    raise exception 'ASSERTION_FAILED: %, expected %, got %', p_message, p_expected, p_actual;
  end if;
end;
$$;

create or replace function public.rehearsal_expect_error(p_sql text, p_expected_message text, p_message text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      if position(p_expected_message in sqlerrm) = 0 then
        raise exception 'ASSERTION_FAILED: %, expected error %, got %', p_message, p_expected_message, sqlerrm;
      end if;
      return;
  end;

  raise exception 'ASSERTION_FAILED: %, expected error %, got success', p_message, p_expected_message;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000123', false);

select 'payment tests: shop full-only and DP/full amounts' as step;

insert into public.ops_inquiries (id, quote_status, artwork_status, production_stage, quoted_amount, amount_due, payment_status, payment_method)
values
  ('SHOP-850-DP', 'approved', 'approved', 'queued', 850, 850, 'pay_at_shop', 'cash'),
  ('SHOP-850-FULL', 'approved', 'approved', 'queued', 850, 850, 'pay_at_shop', 'cash'),
  ('SHOP-1050-DP', 'approved', 'approved', 'queued', 1050, 1050, 'pay_at_shop', 'cash'),
  ('SHOP-1050-FULL', 'approved', 'approved', 'queued', 1050, 1050, 'pay_at_shop', 'cash'),
  ('SHOP-1050-ARBITRARY', 'approved', 'approved', 'queued', 1050, 1050, 'pay_at_shop', 'cash'),
  ('SHOP-CONFLICT-A', 'approved', 'approved', 'queued', 1050, 1050, 'pay_at_shop', 'cash'),
  ('SHOP-CONFLICT-B', 'approved', 'approved', 'queued', 1050, 1050, 'pay_at_shop', 'cash');

select public.rehearsal_expect_error(
  $sql$select public.confirm_inquiry_shop_payment('SHOP-850-DP', 425, 'cash', null, 'shop-850-dp-reject')$sql$,
  'FULL_QUOTE_AMOUNT_REQUIRED',
  'below PHP 1000 shop DP must be rejected'
);

select public.confirm_inquiry_shop_payment('SHOP-850-FULL', 850, 'cash', 'full only', 'shop-850-full-ok');
select public.rehearsal_assert_text((select payment_status from public.ops_inquiries where id = 'SHOP-850-FULL'), 'full_payment_confirmed', 'PHP 850 shop full status');
select public.rehearsal_assert_numeric((select amount_due from public.ops_inquiries where id = 'SHOP-850-FULL'), 0, 'PHP 850 shop full balance');

select public.confirm_inquiry_shop_payment('SHOP-1050-DP', 525, 'cash', 'dp ok', 'shop-1050-dp-ok');
select public.rehearsal_assert_text((select payment_status from public.ops_inquiries where id = 'SHOP-1050-DP'), 'down_payment_confirmed', 'PHP 1050 shop DP status');
select public.rehearsal_assert_text((select payment_type from public.ops_inquiries where id = 'SHOP-1050-DP'), 'down_payment', 'PHP 1050 shop DP type');
select public.rehearsal_assert_numeric((select amount_due from public.ops_inquiries where id = 'SHOP-1050-DP'), 525, 'PHP 1050 shop DP balance');
select public.rehearsal_assert_true((select payment_verified_by from public.ops_inquiries where id = 'SHOP-1050-DP') = '00000000-0000-4000-8000-000000000123'::uuid, 'shop receiver recorded');
select public.rehearsal_assert_true((select count(*) from public.inquiry_payment_events where inquiry_id = 'SHOP-1050-DP' and event_type = 'SHOP_PAYMENT_CONFIRMED') = 1, 'shop DP one confirmation event');

select public.confirm_inquiry_shop_payment('SHOP-1050-FULL', 1050, 'cash', 'full ok', 'shop-1050-full-ok');
select public.rehearsal_assert_text((select payment_status from public.ops_inquiries where id = 'SHOP-1050-FULL'), 'full_payment_confirmed', 'PHP 1050 shop full status');
select public.rehearsal_assert_numeric((select amount_due from public.ops_inquiries where id = 'SHOP-1050-FULL'), 0, 'PHP 1050 shop full balance');

select public.rehearsal_expect_error(
  $sql$select public.confirm_inquiry_shop_payment('SHOP-1050-ARBITRARY', 700, 'cash', null, 'shop-arbitrary-reject')$sql$,
  'APPROVED_PAYMENT_AMOUNT_REQUIRED',
  'arbitrary partial amount rejected'
);

select public.confirm_inquiry_shop_payment('SHOP-CONFLICT-A', 525, 'cash', null, 'shop-conflict-key');
select public.rehearsal_expect_error(
  $sql$select public.confirm_inquiry_shop_payment('SHOP-CONFLICT-B', 525, 'cash', null, 'shop-conflict-key')$sql$,
  'IDEMPOTENCY_KEY_CONFLICT',
  'conflicting duplicate shop idempotency key rejected'
);

select 'payment tests: online DP/full, stale, duplicate' as step;

insert into public.ops_inquiries (
  id, quote_status, artwork_status, production_stage, quoted_amount, amount_due,
  payment_status, payment_method, payment_type, payment_selected_amount,
  payment_proof_path, payment_receipt_filename, payment_receipt_content_type, payment_receipt_size
)
values
  ('ONLINE-1050-DP', 'approved', 'approved', 'queued', 1050, 1050, 'proof_submitted', 'gcash', 'down_payment', 525, 'ONLINE-1050-DP/payments/receipt.png', 'receipt.png', 'image/png', 12345),
  ('ONLINE-1050-FULL', 'approved', 'approved', 'queued', 1050, 1050, 'proof_submitted', 'gcash', 'full', 1050, 'ONLINE-1050-FULL/payments/receipt.png', 'receipt.png', 'image/png', 12345),
  ('ONLINE-ARBITRARY', 'approved', 'approved', 'queued', 1050, 1050, 'proof_submitted', 'gcash', 'down_payment', 525, 'ONLINE-ARBITRARY/payments/receipt.png', 'receipt.png', 'image/png', 12345),
  ('ONLINE-STALE', 'approved', 'approved', 'queued', 1050, 1050, 'proof_submitted', 'gcash', 'down_payment', 525, 'ONLINE-STALE/payments/receipt.png', 'receipt.png', 'image/png', 12345),
  ('ONLINE-CONFLICT', 'approved', 'approved', 'queued', 1050, 1050, 'proof_submitted', 'gcash', 'down_payment', 525, 'ONLINE-CONFLICT/payments/receipt.png', 'receipt.png', 'image/png', 12345);

select public.review_online_payment(
  'ONLINE-1050-DP',
  'confirm_online_payment',
  525,
  null,
  'online dp ok',
  (select updated_at from public.ops_inquiries where id = 'ONLINE-1050-DP'),
  'online-1050-dp-ok'
);
select public.rehearsal_assert_text((select payment_status from public.ops_inquiries where id = 'ONLINE-1050-DP'), 'down_payment_confirmed', 'online DP status');
select public.rehearsal_assert_numeric((select amount_due from public.ops_inquiries where id = 'ONLINE-1050-DP'), 525, 'online DP balance');
select public.rehearsal_assert_true((select payment_verified_by from public.ops_inquiries where id = 'ONLINE-1050-DP') = '00000000-0000-4000-8000-000000000123'::uuid, 'online verifier recorded');
select public.rehearsal_assert_true((select count(*) from public.inquiry_payment_events where inquiry_id = 'ONLINE-1050-DP' and event_type = 'ONLINE_PAYMENT_CONFIRMED') = 1, 'online DP one event');
select public.rehearsal_assert_true((public.review_online_payment('ONLINE-1050-DP', 'confirm_online_payment', 525, null, 'online dp ok', (select expected_version from public.inquiry_payment_events where inquiry_id = 'ONLINE-1050-DP' and event_type = 'ONLINE_PAYMENT_CONFIRMED'), 'online-1050-dp-ok')->>'idempotent')::boolean, 'online duplicate same key is idempotent');
select public.rehearsal_assert_true((select count(*) from public.inquiry_payment_events where inquiry_id = 'ONLINE-1050-DP' and event_type = 'ONLINE_PAYMENT_CONFIRMED') = 1, 'online duplicate kept one event only');

select public.review_online_payment(
  'ONLINE-1050-FULL',
  'confirm_online_payment',
  1050,
  null,
  'online full ok',
  (select updated_at from public.ops_inquiries where id = 'ONLINE-1050-FULL'),
  'online-1050-full-ok'
);
select public.rehearsal_assert_text((select payment_status from public.ops_inquiries where id = 'ONLINE-1050-FULL'), 'full_payment_confirmed', 'online full status');
select public.rehearsal_assert_numeric((select amount_due from public.ops_inquiries where id = 'ONLINE-1050-FULL'), 0, 'online full balance');

select public.rehearsal_expect_error(
  format(
    $sql$select public.review_online_payment('ONLINE-ARBITRARY', 'confirm_online_payment', 700, null, 'bad partial', %L::timestamptz, 'online-arbitrary-reject')$sql$,
    (select updated_at from public.ops_inquiries where id = 'ONLINE-ARBITRARY')
  ),
  'VERIFIED_AMOUNT_MISMATCH',
  'online arbitrary partial rejected'
);

select public.rehearsal_expect_error(
  $sql$select public.review_online_payment('ONLINE-STALE', 'confirm_online_payment', 525, null, 'stale', '2000-01-01T00:00:00Z'::timestamptz, 'online-stale-reject')$sql$,
  'PAYMENT_STALE_VERSION',
  'online stale version rejected'
);

select public.rehearsal_expect_error(
  format(
    $sql$select public.review_online_payment('ONLINE-CONFLICT', 'confirm_online_payment', 525, null, 'conflict', %L::timestamptz, 'online-1050-dp-ok')$sql$,
    (select updated_at from public.ops_inquiries where id = 'ONLINE-CONFLICT')
  ),
  'IDEMPOTENCY_KEY_CONFLICT',
  'conflicting duplicate online idempotency key rejected'
);

create table public.rehearsal_before_rollback as
select
  (select count(*) from public.ops_inquiries) as inquiry_count,
  (select count(*) from public.inquiry_payment_events) as payment_event_count;
'@

$RollbackVerificationSql = @'
select 'rollback verification: data preserved and old behavior restored' as step;

insert into public.admin_users (user_id, role, display_name, is_active)
values ('00000000-0000-4000-8000-000000000123', 'owner', 'Phase 9B6 Owner', true)
on conflict (user_id) do update
set
  role = excluded.role,
  display_name = excluded.display_name,
  is_active = excluded.is_active;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000123', false);

do $$
begin
  if auth.uid() is distinct from '00000000-0000-4000-8000-000000000123'::uuid then
    raise exception 'rollback verification authenticated context was not restored';
  end if;

  if not exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
      and role in ('owner', 'admin')
      and is_active = true
  ) then
    raise exception 'rollback verification active owner/admin actor is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inquiry_payment_events'
      and column_name = 'expected_version'
  ) then
    raise exception 'rollback should preserve expected_version column';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inquiry_payment_events'
      and column_name = 'review_note'
  ) then
    raise exception 'rollback should preserve review_note column';
  end if;

  if (select inquiry_count from public.rehearsal_before_rollback) <>
     (select count(*) from public.ops_inquiries) then
    raise exception 'rollback changed inquiry record count';
  end if;

  if (select payment_event_count from public.rehearsal_before_rollback) <>
     (select count(*) from public.inquiry_payment_events) then
    raise exception 'rollback changed payment event count';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.review_online_payment(text,text,numeric,text,text,timestamptz,text)',
    'execute'
  ) then
    raise exception 'rollback left authenticated review_online_payment execute enabled';
  end if;
end
$$;

insert into public.ops_inquiries (id, quote_status, artwork_status, production_stage, quoted_amount, amount_due, payment_status, payment_method)
values
  ('ROLLBACK-SHOP-DP', 'approved', 'approved', 'queued', 1050, 1050, 'pay_at_shop', 'cash'),
  ('ROLLBACK-SHOP-FULL', 'approved', 'approved', 'queued', 1050, 1050, 'pay_at_shop', 'cash');

select public.rehearsal_expect_error(
  $sql$select public.confirm_inquiry_shop_payment('ROLLBACK-SHOP-DP', 525, 'cash', null, 'rollback-shop-dp-reject')$sql$,
  'FULL_QUOTE_AMOUNT_REQUIRED',
  'rollback old shop RPC rejects DP'
);

select public.confirm_inquiry_shop_payment('ROLLBACK-SHOP-FULL', 1050, 'cash', null, 'rollback-shop-full-ok');
select public.rehearsal_assert_text((select payment_status from public.ops_inquiries where id = 'ROLLBACK-SHOP-FULL'), 'full_payment_confirmed', 'rollback old shop RPC accepts full payment');
select public.rehearsal_assert_text((select payment_type from public.ops_inquiries where id = 'ROLLBACK-SHOP-FULL'), 'shop', 'rollback old shop RPC restores shop payment type');

select 'PHASE 9B6 DISPOSABLE DATABASE REHEARSAL PASSED' as result;
'@

$containerStarted = $false

try {
  Write-Host "==> Verifying Docker daemon"
  Invoke-Docker -Arguments @("info")

  $existing = docker ps -a --filter "name=^/$ContainerName$" --format "{{.Names}}"
  if ($existing -eq $ContainerName) {
    Write-Host "==> Removing existing disposable container $ContainerName"
    Invoke-Docker -Arguments @("rm", "-f", $ContainerName)
  }

  Write-Host "==> Starting disposable PostgreSQL container $ContainerName"
  Invoke-Docker -Arguments @(
    "run",
    "--name", $ContainerName,
    "-e", "POSTGRES_PASSWORD=$PostgresPassword",
    "-e", "POSTGRES_DB=$DatabaseName",
    "-d",
    "postgres:16-alpine"
  )
  $containerStarted = $true

  Write-Host "==> Waiting for PostgreSQL readiness"
  for ($i = 0; $i -lt 60; $i++) {
    $running = docker inspect -f "{{.State.Running}}" $ContainerName 2>$null
    if ($LASTEXITCODE -eq 0 -and $running -eq "true") {
      docker exec $ContainerName sh -c "psql -v ON_ERROR_STOP=1 -U $PostgresUser -d $DatabaseName -c 'select 1;' >/dev/null 2>&1"
      if ($LASTEXITCODE -eq 0) {
        break
      }
    } else {
      $logs = docker logs $ContainerName 2>&1
      throw "PostgreSQL container stopped before readiness. Logs:`n$logs"
    }
    Start-Sleep -Seconds 1
  }

  $running = docker inspect -f "{{.State.Running}}" $ContainerName 2>$null
  if ($LASTEXITCODE -ne 0 -or $running -ne "true") {
    $logs = docker logs $ContainerName 2>&1
    throw "PostgreSQL container is not running after readiness wait. Logs:`n$logs"
  }

  docker exec $ContainerName sh -c "psql -v ON_ERROR_STOP=1 -U $PostgresUser -d $DatabaseName -c 'select 1;' >/dev/null 2>&1"
  if ($LASTEXITCODE -ne 0) {
    $logs = docker logs $ContainerName 2>&1
    throw "PostgreSQL did not accept SQL before timeout. Logs:`n$logs"
  }

  Invoke-Psql -Sql $BaselineSql -Label "Create production-compatible synthetic schema baseline"
  Invoke-PsqlFile -Path $BaselinePayAtShopMigration -Label "Apply production-baseline Pay at Shop migration"
  Invoke-PsqlFile -Path $MigrationFiles[0] -Label "Apply 202607300009_online_payment_review.sql"
  Invoke-PsqlFile -Path $MigrationFiles[1] -Label "Apply 202607300010_online_payment_review_stale_version_fix.sql"
  Invoke-PsqlFile -Path $MigrationFiles[2] -Label "Apply 202607310001_allow_admin_down_payment_confirmations.sql"
  Invoke-Psql -Sql $VerificationSql -Label "Run migration verification queries"
  Invoke-Psql -Sql $PaymentTestSql -Label "Run synthetic payment behavior tests"

  $rollbackSql = Get-OldShopPaymentRollbackSql
  Invoke-Psql -Sql $rollbackSql -Label "Parse and apply rollback SQL"
  Invoke-Psql -Sql $RollbackVerificationSql -Label "Verify rollback preserves records and restores old shop behavior"

  Write-Host "PASS Phase 9B6 disposable production migration rehearsal"
} finally {
  if ($containerStarted) {
    Write-Host "==> Removing disposable container $ContainerName"
    docker rm -f $ContainerName | Out-Null
  }
}
