# STLOLAB SW3 staging migration and configuration runbook

Status: proposal only. Do not run until staging acceptance authorizes remote migrations, configuration, test stock, and temporary ordering enablement.

## Fixed target and safety gates

- Supabase project: `trry-admin-staging` / `fszkypwovpdthqfobxrk`, region `ap-southeast-1`, Postgres 17, currently `ACTIVE_HEALTHY`.
- Admin Vercel project: `adminportal-staging` / `prj_K0oDSa6r1MgAEpQMcl3mKVdJvtNI`, team `team_lLNAY28RJHud9QjW9vcIh7WO`.
- Storefront Site: `appgprj_6a8978ad58bc8191bc74e2fba33f4528`, owner-private preview.
- POS Vercel project: `trry-pos` / `prj_OXFRieJe4VlBWFClY38K06QYMn1Z`.
- Admin and storefront must remain on their existing staging/private projects. Do not create projects or paid services.
- Keep `STLO_CHECKOUT_ENABLED=false` (or absent) in both server hops until every preflight check and test-stock nomination below is accepted.
- Never print, paste, or expose the Supabase service-role key or storefront gateway secret in browser configuration, logs, screenshots, or command history.
- Do not run this sequence against production, and do not configure payment-failure, refund, return, or post-handover cancellation behavior.

## Preflight evidence

1. Record the Admin and Storefront commit SHAs selected for staging.
2. Confirm the linked Supabase project before any write:

   ```powershell
   npx.cmd supabase projects list
   npx.cmd supabase migration list --linked
   ```

3. Confirm the target host contains `fszkypwovpdthqfobxrk`. Stop on any mismatch.
4. Capture a schema-only backup or owner-approved staging rollback point using the existing project tooling.
5. Reconfirm the read-only result captured 2026-09-11 before changing it:

   ```sql
   select il.id, il.location_code, il.name, il.is_default_retail, b.branch_code, b.name as branch_name
   from public.inventory_locations il
   join public.branches b on b.id = il.branch_id
   where il.name = 'Main Retail Stock' and il.active is true and b.active is true;
   ```

   Expected single row: location `9cc81235-0af3-4ad6-aa95-35af81178312`, code `RETAIL`, active/default retail; branch `396d0b49-9594-4270-934c-304bea69b392`, code `MAIN`, `Main Shop`, active. Stop on any mismatch.

## POS lineage and migration order

Read-only Vercel evidence collected 2026-09-11:

- Project `trry-pos`, ID `prj_OXFRieJe4VlBWFClY38K06QYMn1Z`, Hobby plan.
- Current production alias `trry-pos.vercel.app` points to READY deployment `dpl_DTe5j92W5MT1hbBY3xq47wmy4aER`.
- Deployed Git commit: `bcbe14837915defb101d248f939bba171bab526d` on `main`.
- That deployed commit does not contain the M2B inventory migration or M3B atomic checkout migration.
- Exact M2B/M3B source is `codex/pos-sale-m3` at `b67c09098c64cad6b8e9a52424111a16c8dc30ff`. M2B starts at `b5fb1f1`, with required fixes `1e97bbe` and `d9e1907`; `7abc2df` binds availability in the POS UI; `b67c090` adds atomic checkout. This branch is not an ancestor of the deployed commit.
- The candidate also carries unrelated Phase 8B/8C preservation (`951b7ef`), Owner POS UI styling (`f679b89`), and Master Catalog boot/read work (`b69ff1e`, `3528e1c`). Do not merge the branch wholesale.
- Deployed `bcbe148` separately contains operator authority, preview routing/runtime configuration, production build-host guards, and customer identity capture. Those later deployed changes must be retained in any POS reconciliation.

Local reconciliation completed 2026-09-11:

- Worktree `C:\tmp\trry-pos-sw3-reconcile`, branch `codex/pos-sw3-reconcile`.
- Commit `382fc386331b59c1078581297fa0e219073a4979` is based on deployed `bcbe14837915defb101d248f939bba171bab526d`; `bcbe148` is an ancestor and candidate `b67c090` is not.
- The commit selectively ports M1B runtime/catalog dependencies, M2B/M2C, availability projection, and M3B. It excludes candidate Phase 8B/8C and Owner UI changes.
- It retains deployed effective POS/Sales authority, customer capture, routing, runtime allowlisting, and production build guards.
- Active staging register verified read-only: `POS-01` / `Main Counter`, ID `0f65cfbc-e85d-4324-ad89-c0c41c8d2f7d`, branch `MAIN`.

POS M3B dependencies to reconcile onto the deployed lineage:

- Database: existing `auth.uid()`, `pgcrypto`, branches, brands, product categories, canonical products/variants, inventory locations/balances/movements, and M2B movement helpers. M3B creates its own POS staff/register/shift/sale/payment/receipt/cash/audit tables and `trry_api.complete_pos_sale`.
- Runtime: the M1B canonical catalog adapter and guarded staging runtime (`b69ff1e`, `3528e1c`), M2 inventory availability projection (`7abc2df`), and the M3 checkout calls in `src/data/supabase/writeRepositories.js` plus `src/main.js` (`b67c090`).
- Reconciliation constraint: retain deployed operator/session authority and customer capture from `bcbe148`; do not restore the candidate branch's old runtime configuration or overwrite later deployed routing/build guards.

Read-only staging history already records M2B `20260820000000`, M2C `20260820001000`, and M3B `20260820132016`; do not reapply them. Verify their functions first. The only proposed new database migrations, in exact order, are:

Run the five files as one controlled maintenance batch while checkout remains disabled and no staging POS sale, receiving, reversal, adjustment, or STLOLAB handover is permitted. Do not reopen those paths between files: migrations 2-4 temporarily replace the shared function before migration 5 restores every live authorization branch plus the reservation floor.

1. Admin `20260911110045_stlolab_sw3_checkout_foundation.sql`.
2. Admin `20260911113647_stlolab_sw3_inventory_reservations.sql`.
3. Admin `20260911130719_stlolab_sw3_fulfillment_lifecycle.sql`.
4. Admin `20260911134759_stlolab_sw3_admin_order_actions.sql`.
5. Admin `20260911142227_stlolab_sw3_preserve_shared_stock_authority.sql` last. This is required because live staging has later M4 reversal and E7 receiving authorization branches; it preserves those branches, POS sales, Owner/Admin STLOLAB handover, and the reservation floor.

After migration, verify the final shared primitive and both callers before allowing any sale:

```sql
select pg_get_functiondef('private.m2b_apply_stock_movement(uuid,uuid,text,integer,text,uuid,text,text,text)'::regprocedure);
select pg_get_functiondef('private.m2b_record_sale_stock_movement(uuid,uuid,integer,uuid,text,text)'::regprocedure);
select pg_get_functiondef('trry_api.handover_stlolab_order_sw3(uuid,text,text)'::regprocedure);
```

The final `m2b_apply_stock_movement` definition must reject a `SALE` that would reduce on-hand below `reserved_quantity`. POS checkout and STLOLAB handover must both reach that shared function. Stop if the guard is absent or if either caller resolves to another stock mutation path.

## Staging configuration

1. Create the config disabled, using location `9cc81235-0af3-4ad6-aa95-35af81178312` and `RESERVE_ON_SUBMIT`. Set `enabled=true` only for the controlled test window.
2. Enable `SHOP_PICKUP`: pickup code `TRRY-ILIGAN-MAIN`, PHP 0, label `TRRY Apparel Shop`, instructions `Torralba St., Brgy. Poblacion, Iligan City; daily 10 AM-6 PM Asia/Manila.`
3. Enable `NATIONWIDE_DELIVERY`: PHP 120, complete address required, coverage `NATIONWIDE`.
4. Create `LOCAL_DELIVERY` at PHP 60 but leave it disabled with coverage `UNCONFIRMED`; retain the known exclusions only as non-authorizing metadata. No local address may pass acceptance.
5. Authorize these exact canonical test receipts in Main Retail Stock, all with source reference `SW3-STAGING-ACCEPTANCE-01`: S `9a8f3cc9-b22f-40ad-890c-b78add622acd` = 1; M `651d79c6-a6a9-47a5-ba1a-77d8ebb5cbd6` = 1; L `86d11ac3-efc1-4778-a768-809603a67745` = 1; XL `fdbdb5d4-c80c-4dda-8ba4-602a48de9b35` = 2. Read-only inspection found no existing balance row for any of them.
6. Configure server-only gateway and service credentials in the existing staging projects. Never add them to `VITE_*`, `NEXT_PUBLIC_*`, committed files, or browser payloads.

Runtime gate changes for the acceptance window only:

- Admin server: `SUPABASE_URL=https://fszkypwovpdthqfobxrk.supabase.co`, staging service-role credential, `STLO_CHECKOUT_ENV=staging`, `STLO_CHECKOUT_ENABLED=true`, and one new random `STLO_STOREFRONT_GATEWAY_SECRET` of at least 32 characters.
- Storefront server: `STLO_ENV=staging`, the same server-only gateway secret, `STLO_CHECKOUT_ENABLED=true`, `STLO_CHECKOUT_URL=https://adminportal-staging.vercel.app/api/stlolab-checkout`, and exactly the two enabled options (`SHOP_PICKUP`, `NATIONWIDE_DELIVERY`) in `STLO_CHECKOUT_OPTIONS_JSON`.
- Keep `VERCEL_AUTOMATION_BYPASS_SECRET` server-only on the Storefront for the protected Admin endpoint. Do not expose the Supabase service role to the Storefront.
- Rollback gates first: set both `STLO_CHECKOUT_ENABLED=false`, redeploy the existing private staging previews, then set database config `enabled=false`.

POS Preview values, in project `trry-pos` (`prj_OXFRieJe4VlBWFClY38K06QYMn1Z`) and Preview scope only:

```text
VITE_APP_ENV=staging
VITE_DATA_MODE=supabase
VITE_SUPABASE_ENABLED=true
VITE_SUPABASE_URL=https://fszkypwovpdthqfobxrk.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<active staging publishable key>
VITE_ALLOW_REMOTE_SUPABASE_WRITES=true
VITE_POS_REGISTER_ID=0f65cfbc-e85d-4324-ad89-c0c41c8d2f7d
VITE_POS_INVENTORY_LOCATION_ID=9cc81235-0af3-4ad6-aa95-35af81178312
```

Apply all eight values above to Preview scope. Deploy commit `382fc386331b59c1078581297fa0e219073a4979` with a normal Preview deployment only. Do not pass `--prod`, promote the deployment, assign `trry-pos.vercel.app`, or change Production variables. The build rejects remote write mode outside Vercel Preview and rejects any host/register/location other than the staging values above. POS rollback is to set Preview write approval false or data mode `supabase_read`, then redeploy Preview; Production remains untouched.

```json
[{"code":"SHOP_PICKUP","method":"pickup","label":"TRRY Apparel Shop","feeMinor":0,"pickupCode":"TRRY-ILIGAN-MAIN","instructions":"Torralba St., Brgy. Poblacion, Iligan City; daily 10 AM-6 PM Asia/Manila."},{"code":"NATIONWIDE_DELIVERY","method":"delivery","label":"Nationwide delivery","feeMinor":12000}]
```

Exact configuration SQL for owner approval is kept as a transaction: upsert the disabled checkout row, upsert the three options above, assert local remains disabled, then commit. Inventory must be received through authenticated `trry_api.receive_inventory`, once per variant with unique `SW3-ACCEPT-01-RECEIVE-{SIZE}` idempotency keys; do not insert or update balances directly.

```sql
begin;
insert into public.stlolab_checkout_config(environment, enabled, inventory_policy, inventory_location_id)
values ('staging', false, 'RESERVE_ON_SUBMIT', '9cc81235-0af3-4ad6-aa95-35af81178312')
on conflict (environment) do update set
  enabled = false, inventory_policy = excluded.inventory_policy,
  inventory_location_id = excluded.inventory_location_id, updated_at = now();

insert into public.stlolab_fulfillment_options(
  environment, option_code, method, enabled, fee_amount, requires_address,
  pickup_code, customer_label, coverage_mode, coverage_rules, customer_instructions
) values
  ('staging','SHOP_PICKUP','pickup',true,0,false,'TRRY-ILIGAN-MAIN','TRRY Apparel Shop','PICKUP','{}',
   'Torralba St., Brgy. Poblacion, Iligan City; daily 10 AM-6 PM Asia/Manila.'),
  ('staging','NATIONWIDE_DELIVERY','delivery',true,120,true,null,'Nationwide delivery','NATIONWIDE','{}',null),
  ('staging','LOCAL_DELIVERY','delivery',false,60,true,null,'Local delivery','UNCONFIRMED',
   '{"allowedBarangays":[],"excludedBarangays":["Buru-un","Linamon","Dalipuga","Pugaan","Suarez","Santa Elena"]}',null)
on conflict (environment, option_code) do update set
  method = excluded.method, enabled = excluded.enabled, fee_amount = excluded.fee_amount,
  requires_address = excluded.requires_address, pickup_code = excluded.pickup_code,
  customer_label = excluded.customer_label, coverage_mode = excluded.coverage_mode,
  coverage_rules = excluded.coverage_rules, customer_instructions = excluded.customer_instructions;

do $$begin
  if (select enabled from public.stlolab_checkout_config where environment='staging')
    or coalesce((select enabled from public.stlolab_fulfillment_options
                 where environment='staging' and option_code='LOCAL_DELIVERY'), true) then
    raise exception 'SW3 staging safety gate is not closed';
  end if;
end$$;
commit;
```

## Proposed expiry runner

Use Supabase Cron (`pg_cron`) inside the existing staging database, with no new service. Proposed cadence: every 15 minutes, batch limit 100. A reservation therefore expires at the first successful run on or after its absolute `created_at + 72 hours` instant, normally within 15 minutes of eligibility.

Owner-review SQL, not yet authorized to run:

```sql
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select cron.schedule(
  'stlolab-sw3-expiry-staging',
  '*/15 * * * *',
  $$select trry_api.expire_stlolab_reservations_sw3(clock_timestamp(), 100);$$
);
```

Before activation, verify no job with that name exists and capture the returned job ID. After activation, inspect `cron.job` and `cron.job_run_details`; alert on failed runs. Keep the function service-only and never expose an HTTP expiry endpoint.

Rollback: `select cron.unschedule('stlolab-sw3-expiry-staging');`, verify the named job is absent, then leave database expiry functions installed but inactive. Do not update or delete `cron.job` directly.

The 72-hour deadline does not release stock by itself. Checkout subtracts `reserved_quantity` and does not reap overdue rows inline, so an overdue ACTIVE reservation continues blocking purchases until the expiry function commits. At the proposed 15-minute cadence, normal release is between 72h00m and just under 72h15m, plus any scheduler delay. Immediate release exactly at 72 hours would require a separately reviewed checkout-side reaper or finer Cron cadence.

## Acceptance sequence

1. With ordering still disabled, verify migrations, grants, RLS, append-only payment events, final stock function text, and configured fulfillment rows.
2. Enable the controlled staging test path only, create one clearly labeled pickup order and one authorized delivery fixture, and record order IDs, reservation IDs, payment event IDs, and inventory effects.
3. Through authenticated Admin Orders actions, confirm payment using a durable receipt/provider reference. Verify one append-only `order_payment_events` row and a `PAID` order state.
4. Execute pickup or courier handover. Verify reservation `CONSUMED`, one canonical `SALE` movement, one on-hand deduction, and no payment-state change from courier handover.
5. Repeat the same action and idempotency key; verify no additional event, movement, or deduction.
6. Race payment against expiry and handover against expiry using disposable quantities. Verify one valid serialized outcome and no negative available balance.
7. Attempt the actions anonymously and as Staff; verify denial. Confirm customer/order details remain inaccessible by order ID alone.
8. Run a POS sale against the same last available unit after reservations exist; verify the final shared guard prevents oversell.
9. Disable ordering again and remove only the explicitly approved disposable fixtures according to the recorded test IDs. Do not invent return/refund stock movements as cleanup.

## Concrete acceptance matrix

- Use run marker `SW3-STAGING-ACCEPTANCE-01`; record every order, request, reservation, payment-event, sale, and movement UUID.
- S/1: race two real Storefront checkout HTTP requests for the last unit. Expect one `201`, one `409`, one order and one ACTIVE reservation. While reserved, attempt a real authenticated POS `complete_pos_sale`; expect insufficient availability and no sale/movement. Cancel the winning order through the token-protected HTTP handler and verify one release.
- M/1 pickup: repeat the same checkout request and idempotency key concurrently; expect one canonical order. Through authenticated Admin Orders, repeat payment confirmation with the same key/reference, then repeat customer pickup. Expect one payment event, one SALE movement, one deduction, and a CONSUMED reservation.
- L/1 nationwide: create through the real checkout handler, perform courier handover while UNPAID, repeat it, then confirm payment. Expect one deduction and no payment-state change until the separate payment action.
- XL/2: create two one-unit orders. For a bounded expiry test, owner-approved test SQL may backdate both `created_at` and `reservation_expires_at` together by 72 hours; never alter one clock alone. Race payment versus service-role expiry on one and handover versus expiry on the other. Each race must serialize to one valid outcome, never double release/deduct, and never produce negative availability.
- Denial checks: no gateway secret, wrong confirmation token, order ID without token, anonymous Admin action, Staff Admin action, changed canonical price, wrong variant, wrong fulfillment code, disabled local delivery, and POS sale against reserved stock.
- Teardown: first set both server gates and database config `enabled=false`; unschedule Cron if it was temporarily enabled; verify no ACTIVE acceptance reservations. Preserve canonical test orders and ledger movements as labeled audit evidence. Use authenticated `adjust_inventory` only to remove unused test units back to the recorded zero baseline, with explicit acceptance-cleanup references. No refund/return path is used.

## Acceptance blockers

- Owner-approved local-delivery positive coverage or manual-review workflow.
- Owner approval to push and Preview-deploy reconciled POS commit `382fc386331b59c1078581297fa0e219073a4979`, followed by live shared-stock contention testing.
- Authorization to apply the listed migrations/configuration and nominate staging test stock.
- Authorization to install the proposed expiry cron job.
- Refund, return, and payment-failure policies remain undefined; their transitions stay unavailable.

## Next-session Preview handoff

POS Preview deployment is not yet authorized. After explicit owner approval, run the deployment from `C:\tmp\trry-pos-sw3-reconcile` at exact commit `382fc386331b59c1078581297fa0e219073a4979`. Bind the command to the existing owner and project identifiers so an absent local `.vercel` directory cannot select or create another project:

```powershell
$env:VERCEL_ORG_ID='team_lLNAY28RJHud9QjW9vcIh7WO'
$env:VERCEL_PROJECT_ID='prj_OXFRieJe4VlBWFClY38K06QYMn1Z'
npx.cmd vercel deploy --yes --scope clarkylubguban1
```

Do not add `--prod`, promote the result, or assign the production alias. Configure only the Vercel **Preview** scope. Required configuration names are listed here with values deliberately omitted from this handoff:

```text
VITE_APP_ENV
VITE_DATA_MODE
VITE_SUPABASE_ENABLED
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_ALLOW_REMOTE_SUPABASE_WRITES
VITE_POS_REGISTER_ID
VITE_POS_INVENTORY_LOCATION_ID
```

The approved non-secret project, register, and stock-source identities remain in the preceding sections. No service-role key, database password, Vercel token, or Admin/storefront gateway secret belongs in POS browser configuration.

Perform these read-only checks immediately after deployment and before any staging order or stock action:

1. Run `npx.cmd vercel inspect <preview-url> --scope clarkylubguban1` and verify project `trry-pos`, READY state, Preview target, and source commit `382fc386331b59c1078581297fa0e219073a4979`.
2. Confirm the Preview has no `trry-pos.vercel.app` alias and that owner-private deployment protection remains enabled. Reinspect the production alias read-only and confirm it still resolves to deployment `dpl_DTe5j92W5MT1hbBY3xq47wmy4aER` from deployed commit `bcbe14837915defb101d248f939bba171bab526d`.
3. Request the Preview URL without an authenticated owner session and confirm protection denies or redirects access; do not use a temporary `_vercel_share` URL as permanent configuration.
4. In an authenticated owner browser session, verify the staging banner, canonical catalog, operator access, customer capture, and sellable quantity display. Do not submit checkout during this read-only pass.
5. Confirm the browser bundle contains no service-role credential, database password, Vercel token, or Admin/storefront gateway secret.
6. Recheck the staging migration ledger and final definitions of `private.m2b_apply_stock_movement(...)`, `private.m2b_record_sale_stock_movement(...)`, and `trry_api.handover_stlolab_order_sw3(...)` without applying migrations or invoking write paths.

The remaining Auth-dependent browser check is `npm.cmd run phase8a:verify-browser-modes`. Its `supabase_read` branch needs reachable staging-compatible Supabase Auth and the expected seeded QA identity; the prior local run stopped at `supabase_read auth sign-in failed`. Run it only when that Auth fixture is deliberately available, and keep remote writes disabled during the check.

Tomorrow's first task is to obtain and record explicit owner approval for the POS Preview, set the eight variables in Preview scope only, deploy the exact reconciled commit with the command above, and complete the read-only checks before any migration, order, or stock write. Subsequent staging acceptance remains blocked on migration/configuration authorization, Cron authorization, controlled test-stock authorization, positive local-delivery coverage or manual review, real handler-to-database lifecycle and POS contention evidence, and decisions for refund, return, and payment-failure transitions.
