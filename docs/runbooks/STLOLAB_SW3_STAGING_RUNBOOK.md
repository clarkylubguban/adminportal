# STLOLAB SW3 staging migration and configuration runbook

Status: proposal only. Do not run until staging acceptance authorizes remote migrations, configuration, test stock, and temporary ordering enablement.

## Fixed target and safety gates

- Supabase project: `fszkypwovpdthqfobxrk` only.
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
5. Confirm the exact `Main Retail Stock` UUID and branch without changing it:

   ```sql
   select il.id, il.location_code, il.name, il.is_default_retail, b.branch_code, b.name as branch_name
   from public.inventory_locations il
   join public.branches b on b.id = il.branch_id
   where il.name = 'Main Retail Stock' and il.active is true and b.active is true;
   ```

   Exactly one owner-approved row must be selected. Do not infer the UUID from its name.

## POS lineage and migration order

Read-only Vercel evidence collected 2026-09-11:

- Project `trry-pos`, ID `prj_OXFRieJe4VlBWFClY38K06QYMn1Z`, Hobby plan.
- Current production alias `trry-pos.vercel.app` points to READY deployment `dpl_DTe5j92W5MT1hbBY3xq47wmy4aER`.
- Deployed Git commit: `bcbe14837915defb101d248f939bba171bab526d` on `main`.
- That deployed commit does not contain the M2B inventory migration or M3B atomic checkout migration.
- Local POS M3B commit `b67c09098c64cad6b8e9a52424111a16c8dc30ff` contains `20260820132016_m3b_atomic_checkout_foundation.sql`, but it is not an ancestor of the deployed commit.

Before shared-stock staging acceptance, select and deploy an owner-approved POS lineage that contains M3B. The database migration order must leave the Admin reservation-aware definition last:

1. Admin `20260820000000_m2b_inventory_foundation.sql`.
2. POS `20260820132016_m3b_atomic_checkout_foundation.sql` (creates atomic POS checkout and replaces `private.m2b_apply_stock_movement`).
3. Admin `20260911110045_stlolab_sw3_checkout_foundation.sql`.
4. Admin `20260911113647_stlolab_sw3_inventory_reservations.sql` (adds the reservation floor after POS M3B).
5. Admin `20260911130719_stlolab_sw3_fulfillment_lifecycle.sql`.
6. Admin `20260911134759_stlolab_sw3_admin_order_actions.sql` (final shared function preserves POS staff and Owner/Admin authority while retaining the reservation floor).

After migration, verify the final shared primitive and both callers before allowing any sale:

```sql
select pg_get_functiondef('private.m2b_apply_stock_movement(uuid,uuid,text,integer,text,uuid,text,text,text)'::regprocedure);
select pg_get_functiondef('private.m2b_record_sale_stock_movement(uuid,uuid,integer,uuid,text,text)'::regprocedure);
select pg_get_functiondef('trry_api.handover_stlolab_order_sw3(uuid,text,text)'::regprocedure);
```

The final `m2b_apply_stock_movement` definition must reject a `SALE` that would reduce on-hand below `reserved_quantity`. POS checkout and STLOLAB handover must both reach that shared function. Stop if the guard is absent or if either caller resolves to another stock mutation path.

## Staging configuration

1. Insert or update one `stlolab_checkout_config` row for environment `staging` with the verified location UUID, `enabled=true`, and `inventory_policy='RESERVE_ON_SUBMIT'` only during the controlled acceptance window.
2. Configure the confirmed pickup option: code `SHOP_PICKUP`, fee `0`, `TRRY Apparel Shop, Torralba St., Brgy. Poblacion, Iligan City`, daily `10 AM-6 PM`, Asia/Manila.
3. Configure nationwide delivery at PHP 120.
4. Keep local delivery disabled until the owner approves either an explicit positive barangay allowlist or a manual-review workflow. The approximate 15 km statement and exclusions are not a machine-verifiable boundary. Disposable tests may use Poblacion as an explicitly labeled fixture only.
5. Nominate disposable STLOLAB test variant IDs and exact quantities in Main Retail Stock. Record before/after `quantity_on_hand` and `reserved_quantity`; do not use live customer stock implicitly.
6. Configure server-only gateway and service credentials in the existing staging projects. Never add them to `VITE_*`, `NEXT_PUBLIC_*`, committed files, or browser payloads.

## Proposed expiry runner

Use Supabase Cron (`pg_cron`) inside the existing staging database, with no new service. Proposed cadence: every 15 minutes, batch limit 100. A reservation therefore expires at the first successful run on or after its absolute `created_at + 72 hours` instant, normally within 15 minutes of eligibility.

Owner-review SQL, not yet authorized to run:

```sql
create extension if not exists pg_cron;

select cron.schedule(
  'stlolab-sw3-expiry-staging',
  '*/15 * * * *',
  $$select trry_api.expire_stlolab_reservations_sw3(clock_timestamp(), 100);$$
);
```

Before activation, verify no job with that name exists and capture the returned job ID. After activation, inspect `cron.job` and `cron.job_run_details`; alert on failed runs. Keep the function service-only and never expose an HTTP expiry endpoint.

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

## Acceptance blockers

- Owner-approved local-delivery positive coverage or manual-review workflow.
- Owner-approved POS lineage containing M2B/M3B, followed by a deployment and live shared-stock contention test.
- Authorization to apply the listed migrations/configuration and nominate staging test stock.
- Authorization to install the proposed expiry cron job.
- Refund, return, and payment-failure policies remain undefined; their transitions stay unavailable.
