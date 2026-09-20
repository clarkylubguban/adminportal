# STLOLAB SW3 pickup-only production release package

Prepared locally on 2026-09-20. This package performs no remote write and keeps ordering disabled.

## Exact release sources

- Admin implementation: `98873b2b5082058e19693d97435b3a79f1f87de4` on `codex/stlolab-sw3-production-readiness`.
- Storefront implementation: `8e38a074282c33204e63b4eddf60f8fb25b3b204` on `codex/stlolab-production-readiness`.
- POS: retain deployed production `bcbe14837915defb101d248f939bba171bab526d`. No POS deployment is required for the pickup-only release. Preview fixes through `b1988adec4375a86c58e7e14a7209a3e021ee0a4` remain outside this package.

No release branch has been pushed or merged.

## Read-only production identity

- Supabase: `wcgtwfctpnwgpglywvvx` (`trryportalsystem`), `ACTIVE_HEALTHY`, Singapore, PostgreSQL 17.6.
- Latest production migration: `20260904010200_repair_external_inquiry_digest_schema_c2_3_1`.
- Admin Vercel: `adminportal` / `prj_ObjP9WVxYHHvfYgsLgZYd3PrXQ0g`; current production deployment `dpl_BxHGmyxgoQQBxApbNj9rFy9WwWgR`; source `2a7aa652b9e225c1418a0a17a1cfb028810ae2e6`; alias `admin.trryapparel.com`.
- POS Vercel: `trry-pos` / `prj_OXFRieJe4VlBWFClY38K06QYMn1Z`; current production deployment `dpl_DTe5j92W5MT1hbBY3xq47wmy4aER`; source `bcbe14837915defb101d248f939bba171bab526d`; alias `trry-pos.vercel.app`.
- Storefront project proposed for Production scope: existing `stlolab-staging` / `prj_1qpqKNRMElvGyRQwCkl7d7tbBovK`. It has no Production deployment today. The owner must approve its public production hostname before release.
- Main Retail Stock: `6e8b2ba6-f2e1-4630-a92f-392281c767a2`, branch `989df66a-298f-48b7-985a-f830759e890f` (`MAIN`, Main Shop).
- Main Counter register: `e16c12fa-8d7b-47e9-abbf-10d0a8ac9c50` (`POS-01`).

Read-only preflight found five existing production orders, no null `source_inquiry_id`, no unsupported order status for the SW3 constraint, 35 inventory balance rows, no negative on-hand balance, and no production row for `PRD-260911-8DC1A1`. Production has M2B/M2C/M3B but none of the SW3 reservation, payment, access, or expiry schema. `pg_cron` and `pg_net` are available but not installed.

## Exact migration manifest

Apply only these files, in this order, after a fresh ledger and checksum comparison. Hashes are SHA-256 of LF-normalized file contents.

1. `20260911110045_stlolab_sw3_checkout_foundation.sql` - `9ae0ba1ffcec54e62fb0a0cf8002f2a3b85e0995cbc198485db5c0dddfcb296d`
2. `20260911113647_stlolab_sw3_inventory_reservations.sql` - `b17de969077aff2928362e415fb3529d4a43b164b10db5d16abb48b8c540507e`
3. `20260911130719_stlolab_sw3_fulfillment_lifecycle.sql` - `f47bbeb585a4fb05c8a688e80b6a0dabe3b69960871b51b55d3d0e40b1f09ca8`
4. `20260911134759_stlolab_sw3_admin_order_actions.sql` - `f9b9c3c37710fc87333752a78cc8f54ab60496b212157722ac92915b55952266`
5. `20260911142227_stlolab_sw3_preserve_shared_stock_authority.sql` - `9c3d39e15077b40503162c365f00238da91cc1d0cadd7b810bd3b6f3475610c1`
6. `20260916082231_stlolab_sw3_checkout_service_role_permissions.sql` - `ece6d958815078f33f9a00993823eaa2d054afa5b22da65b96e4b57ddae47407`
7. `20260917034542_stlolab_order_access_lifecycle.sql` - `a4b6d5666f66ffc7031adf254821d16214626dc754ffae5496f65d059c4f713b`
8. `20260920111117_stlolab_production_environment_release.sql` - `e1e327e91699c35e614ab5d8054268c2cf317d5cd3990e5e38a25548ba2a0968`

Do not apply `20260918160020_pos_sw3_acceptance_key_control.sql` to production. Do not use an unrestricted `supabase db push`: the repository contains later migrations outside this package. Apply each named migration through the supported Supabase migration operation and re-read the ledger after every step.

The final migration is forward-only. It adds `orders.checkout_environment`, backfills any existing STLOLAB order from its checkout request, makes the reservation trigger select the matching environment, and permits only exact `staging` or `production` RPC input. It inserts no config, stock, product, customer, or order. Existing non-STLOLAB orders remain unchanged. After any version-1 order exists, retain the lifecycle schema and use forward correction rather than a destructive down migration.

## Disabled configuration

Admin Production scope:

```text
VITE_APP_ENV=production
VITE_SUPABASE_URL=https://wcgtwfctpnwgpglywvvx.supabase.co
VITE_SUPABASE_ANON_KEY=<production publishable key>
SUPABASE_URL=https://wcgtwfctpnwgpglywvvx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-only production service role>
STLO_CATALOG_ENV=production
STLO_CATALOG_ENABLED=false
STLO_CHECKOUT_ENV=production
STLO_CHECKOUT_ENABLED=false
STLO_STOREFRONT_GATEWAY_SECRET=<server-only shared production secret>
VITE_STLO_ACCEPTANCE_KEYS_ENABLED=false
```

Storefront Production scope:

```text
STLO_ENV=production
STLO_SUPABASE_URL=https://wcgtwfctpnwgpglywvvx.supabase.co
STLO_CATALOG_URL=https://admin.trryapparel.com/api/stlolab-catalog
STLO_CHECKOUT_URL=https://admin.trryapparel.com/api/stlolab-checkout
STLO_CHECKOUT_ENABLED=false
STLO_ACCEPTANCE_KEYS_ENABLED=false
STLO_CHECKOUT_OPTIONS_JSON=[{"code":"SHOP_PICKUP","method":"pickup","label":"TRRY Apparel Shop","feeMinor":0,"pickupCode":"TRRY-SHOP"}]
STLO_ORDER_ACCESS_TTL_SECONDS=<owner-approved production value>
STLO_STOREFRONT_GATEWAY_SECRET=<same server-only production secret>
```

Use `VERCEL_AUTOMATION_BYPASS_SECRET` only if the Admin production hop is protected and a dedicated server-to-server bypass is approved. Keep it server-only. Acceptance controls must remain false or absent in every Production scope.

## Database configuration and catalog setup

After the migrations, create exactly one disabled `stlolab_checkout_config` row for `production`, inventory policy `RESERVE_ON_SUBMIT`, Main Retail Stock `6e8b2ba6-f2e1-4630-a92f-392281c767a2`, and `enabled=false`. Create only the pickup fulfillment option:

- code `SHOP_PICKUP`, method `pickup`, enabled `true`, fee PHP 0, no address required;
- pickup code `TRRY-SHOP`;
- label `TRRY Apparel Shop`;
- `coverage_mode=PICKUP`;
- instructions `Torralba St., Brgy. Poblacion, Iligan City; daily 10 AM-6 PM Philippine time.`

Do not create or enable local or nationwide delivery rows for this launch.

Production currently has no `PRD-260911-8DC1A1`. Through authenticated Admin workflows, publish the owner-approved production record for Glow N Underground only after the image is approved for public production use. Expected commercial shape is Black S-XL at PHP 790, STLOLAB channel, physical, active, sellable, and `READY_FOR_SALE`; the owner must reconfirm this before creation. Receive stock only through canonical Receive Stock, into Main Retail Stock, with one unique reference/idempotency key per size. Quantities are intentionally blank until owner confirmation. Never copy staging IDs, movements, balances, or test fixtures.

## Expiry automation and monitoring

Recommended owner decision: install `pg_cron`, run every 15 minutes, batch limit 100, and name the job `stlolab-sw3-expiry-production`:

```sql
select cron.schedule(
  'stlolab-sw3-expiry-production',
  '*/15 * * * *',
  $$select trry_api.expire_stlolab_reservations_sw3(clock_timestamp(), 100);$$
);
```

The 72-hour timestamp does not release stock by itself. An eligible reservation remains blocking until the first successful job run, normally from 72h00m through just under 72h15m plus scheduler delay. Before activation, verify the job name is absent and capture its returned job ID. Monitor `cron.job_run_details`; alert when a run fails, when the last successful run is older than 30 minutes, or when eligible ACTIVE reservations remain after two intervals. Roll back automation with `select cron.unschedule('stlolab-sw3-expiry-production');`; do not edit cron tables directly.

## Release sequence

1. Re-run the read-only production ledger/schema/balance preflight. Confirm both application creation flags are false/absent and no `production` database config row is enabled.
2. Verify all eight hashes, apply only the manifest in order, and verify grants: `service_role` only for customer checkout/access; Owner/Admin only for payment, handover, receive, and adjustment; no new `anon`, `authenticated`, or `PUBLIC` privilege.
3. Insert the disabled production config and pickup-only option. Keep `enabled=false`.
4. Configure Admin Production with both catalog and checkout false, then deploy Admin `98873b2b5082058e19693d97435b3a79f1f87de4`. Verify exact SHA, project, alias, and closed API responses.
5. Configure the existing Storefront project's Production scope with checkout false, then deploy Storefront `8e38a074282c33204e63b4eddf60f8fb25b3b204` to the owner-approved public hostname. Verify Home/Product/Bag/Checkout routes and the unavailable-order state. Do not promote a staging deployment.
6. Publish the canonical product and receive only approved production quantities. Re-read product, variants, images, price, Main Retail Stock on-hand/reserved/available, and movement IDs.
7. Enable catalog only and verify the public projection. Checkout remains false in Storefront, Admin, and database.
8. Install and observe expiry automation. Run a zero-mutation preflight: no STLO orders/reservations/payment events, no negative or over-reserved balances, pickup is the only enabled option, acceptance controls are false, and server secrets are absent from client bundles.
9. Opening production ordering is a separate approval after all owner decisions below. Gate order is database config, Admin, then Storefront; closure order is Storefront, Admin, then database.

## Rollback

Close Storefront creation first, redeploy its last verified disabled build, close Admin creation and catalog as needed, then set the database config `enabled=false`. Unschedule expiry only if the lifecycle is intentionally paused and verify no eligible reservations are stranded. Restore the prior Admin and Storefront deployments/aliases without touching POS. Do not delete orders, reservations, payment events, movements, or schema. Never compensate by directly editing balances.

## Owner decisions still required

1. Public Storefront hostname and whether the existing `stlolab-staging` Vercel project may own its Production deployment.
2. Production order-access lifetime. Seven days is the staging value, not an approved production policy.
3. Exact initial quantity for Black S, M, L, and XL, plus confirmation that PHP 790 and the current image/content are approved for production.
4. Approval for 15-minute expiry cadence, batch 100, monitoring owner, and alert destination.
5. Explicit acceptance that initial launch is pickup-only and pay-at-shop, with no online payment or delivery.
6. Support handling when a customer clears cookies or switches devices; recovery/token reissue remains unavailable.
7. Whether local-only duplicate/replay cancellation evidence and the unverified request-level POS/Storefront overlap are accepted for launch or require a future production-like acceptance window.

Refunds, returns, post-handover cancellation, payment-failure automation, local delivery, nationwide COD, rewards, and cross-device recovery remain disabled/deferred. They do not block a pickup-only, pay-at-shop launch if the owner explicitly accepts those limits.
