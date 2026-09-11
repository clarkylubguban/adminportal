# STLOLAB SW3 checkout checkpoint

Status: owner-approved lifecycle rules and authenticated Admin Orders actions are implemented and verified locally. All migrations, configuration, deployment, remote writes, and live ordering remain disabled pending staging acceptance.

## Source identity

- Admin worktree: `C:\tmp\trry-admin-stlolab-sw3-checkout`; this continuation verified clean starting HEAD `d1a0cdec387ba6f739c311f0be44763d6f7d2640` on `codex/stlolab-sw3-checkout`.
- Storefront worktree: `C:\tmp\stlolab-sw3-checkout`; verified clean HEAD `42997da07639aceb04ca487f788c9ccd02013df3` on `codex/stlolab-sw3-checkout`.
- The accepted V6 product/home layouts, size selector, live catalog, and disabled ordering UI are unchanged in this continuation. The Storefront worktree remains clean.
- No migration or fixture was applied to staging or production. No push, merge, deployment, project, or paid service was created.

## Accepted lifecycle

- `Main Retail Stock` remains the single configured fulfillment source.
- Checkout reserves `quantity_on_hand` capacity without deducting it. Sellable quantity is `quantity_on_hand - reserved_quantity`.
- The expiry instant is exactly `created_at + interval '72 hours'` in PostgreSQL `timestamptz`. It is an absolute elapsed duration, not three Philippine calendar dates. Display timezone and daylight rules do not move the deadline.
- Expiry releases only an active reservation whose canonical order is still `UNPAID`, `PENDING` handover, and `awaiting_payment` at or after the deadline.
- Customer pickup and courier handover atomically clear the reservation, decrement on-hand through the canonical `SALE` stock-movement authority, and mark the reservation consumed.
- Payment and fulfillment are separate order facts. Courier handover leaves an unpaid order unpaid and does not claim COD collection.
- Direct STLOLAB payment confirmation writes an append-only canonical `order_payment_events` record and invokes the protected paid-state transition in the same database transaction. The raw paid-state RPC is no longer executable by authenticated browser clients.
- Authenticated Owner/Admin Orders actions invoke customer pickup or courier handover through the existing protected lifecycle RPC. Staff and anonymous callers remain denied.
- Cancellation remains token-scoped and idempotent for unpaid, pending orders. It is blocked after payment, expiry, or handover. Paid cancellation/refund behavior is intentionally not defined.
- Expiry, cancellation, payment confirmation, and handover serialize on the canonical order row. Replays cannot release or deduct twice.

## Fulfillment configuration

- Pickup: free, `TRRY Apparel Shop`, Torralba St., Brgy. Poblacion, Iligan City; daily 10 AM-6 PM Philippine time.
- Local delivery: PHP 60 using `EXPLICIT_BARANGAYS`. Unknown barangays fail closed. The test allowlist contains only `Poblacion`; it is a disposable fixture, not approved live coverage.
- Explicit local exclusions: Buru-un, Linamon, Dalipuga, Pugaan, Suarez, and Santa Elena.
- Nationwide delivery: PHP 120 with a complete address including barangay.
- Fulfillment options now have stable option codes so local and nationwide delivery remain distinct while both retain canonical method `delivery`.
- No fulfillment rows are seeded by migrations. Ordering still requires the existing staging-only environment gates and owner-controlled configuration.

## Verification

- Disposable PostgreSQL applies the complete relevant migration chain from zero.
- Last-item concurrent checkout permits exactly one reservation; duplicate and concurrent duplicate submissions create one order.
- Repeated expiry releases once without changing on-hand. Paid orders do not expire.
- Repeated pickup/handover writes one stock movement and deducts on-hand once.
- Expiry/payment, expiry/cancellation, expiry/handover, payment/handover, and cancellation/handover races preserve one valid terminal outcome and nonnegative balances.
- Courier handover remains `UNPAID` until a separate authenticated payment confirmation occurs.
- Handler tests exercise the consolidated API handler for missing authentication, Staff denial, canonical payment mapping, ignored browser payment-state claims, duplicate idempotency keys, pickup/courier mapping, database denial, and state conflict responses.
- Ordinary cancellation after handover and cancellation after payment are rejected.
- Local allowed, excluded, and unknown barangay fixtures plus nationwide PHP 120 and local PHP 60 totals pass server-side validation.
- Anonymous and non-Owner/Admin lifecycle calls are denied. Expiry execution is service-role-only; customer checkout/customer lookup privileges remain unchanged.
- Persistent order and inventory effects: none. All containers and fixtures are disposable.
- Focused checks passed: `test:stlolab-admin-order-actions`, `test:orders-dual-read`, `test:orders-dashboard`, `test:orders-dashboard-browser`, `test:order-readiness-actions`, `test:order-readiness-interactions-browser`, `test:stlolab-checkout-route`, payment-confirmation unit tests, and the Admin build.
- The full SW3 PostgreSQL suite also passes with POS M3B inserted between Admin M2B and the SW3 migrations, proving the final shared function retains POS authorization and reservation protection in the proposed order.

## POS audit

- Full POS checkout source is available at `C:\Users\ROG\Downloads\CODEX\trry-pos-sale-m3`, branch `codex/pos-sale-m3`, commit `b67c09098c64cad6b8e9a52424111a16c8dc30ff`.
- That checkout locks on-hand stock and records each sale through `private.m2b_record_sale_stock_movement`, which delegates to `private.m2b_apply_stock_movement`. The later Admin reservation migration protects that shared primitive from consuming reserved units.
- Vercel project `trry-pos` (`prj_OXFRieJe4VlBWFClY38K06QYMn1Z`) currently serves production alias `trry-pos.vercel.app` from READY deployment `dpl_DTe5j92W5MT1hbBY3xq47wmy4aER`, Git commit `bcbe14837915defb101d248f939bba171bab526d` on `main`.
- POS commit `b67c090` is not an ancestor of deployed `bcbe148`. The deployed tree contains neither the M2B inventory migration nor M3B atomic checkout migration, so deployed POS cannot yet be accepted as respecting SW3 reservations.
- Required ordering is documented in `docs/runbooks/STLOLAB_SW3_STAGING_RUNBOOK.md`: recorded POS M3B precedes the Admin reservation work, and `20260911142227` leaves the final shared movement definition with existing staging permissions plus the reservation floor.
- Reconciled POS worktree `C:\tmp\trry-pos-sw3-reconcile` now has local commit `382fc386331b59c1078581297fa0e219073a4979` on `codex/pos-sw3-reconcile`. Deployed `bcbe148` is its ancestor; candidate `b67c090` is not.
- Selective reconciliation retained deployed POS/Sales effective access, C2.4B customer capture, routing, runtime configuration, and production build guards. It added the required canonical catalog adapter, M2B/M2C, sellable inventory projection, M3B transaction binding, and a Preview-only staging write gate pinned to `POS-01` / Main Counter and Main Retail Stock.
- Local POS results: M2B 48 static + 37 PostgreSQL assertions; M3B 48 static + 42 PostgreSQL assertions; catalog 19; canonical boot 38; runtime allowlist 19; inventory browser 22; Preview gate 23; operation handler 10; operator/customer contracts passed. The full Admin SW3 database sequence also passed with actual M3B, M4, and M5 migrations, including POS exclusion and authorized M4/E7 compatibility. No persistent inventory effects were created.

## Staging acceptance preparation

- Read-only project verification confirmed `trry-admin-staging` / `fszkypwovpdthqfobxrk` is `ACTIVE_HEALTHY` in `ap-southeast-1` on Postgres 17.
- Staging already records M2B, M2C, M3B, M4, M5, and later E7 migrations. M2B/M3B must be verified, not reapplied.
- The current live shared movement function includes M3 POS-sale authorization, M4 Owner/Admin POS reversal authorization, and E7 receiving authorization. The earlier SW3 redefinition did not preserve all of those later branches.
- Forward migration `20260911142227_stlolab_sw3_preserve_shared_stock_authority.sql` corrects the staging plan by preserving those authorization branches and the SW3 reservation floor. It must be the final SW3 migration.
- Exact stock source: `Main Retail Stock` / `RETAIL`, location `9cc81235-0af3-4ad6-aa95-35af81178312`, under active `Main Shop` / `MAIN`, branch `396d0b49-9594-4270-934c-304bea69b392`.
- Glow N Underground S/M/L/XL have no current balance rows at that location. Proposed acceptance receipts are 1/1/1/2 respectively, through canonical authenticated receiving only.
- Exact disabled-first configuration, fulfillment rows, Cron proposal/rollback, test matrix, and teardown are recorded in `docs/runbooks/STLOLAB_SW3_STAGING_RUNBOOK.md`.
- The disposable SW3 database suite passes both without POS M3B and with exact POS migration `20260820132016_m3b_atomic_checkout_foundation.sql` inserted before SW3, including the new final compatibility migration.

## Remaining staging acceptance blockers

1. Apply and review the five local SW3 migrations in the existing staging database only. Do not reapply the already-recorded M2B/M3B migrations.
2. Supply the positive local-delivery barangay allowlist or an approved manual eligibility workflow. The approximate 15 km description and exclusions are not a machine-verifiable allow rule.
3. Approve and install the proposed Supabase Cron runner: every 15 minutes, batch size 100, calling the service-only expiry RPC. The SQL is documented but was not activated.
4. Apply and verify the new canonical order-payment event migration and authenticated Orders handler in staging.
5. Approve and Preview-deploy reconciled POS commit `382fc386331b59c1078581297fa0e219073a4979` from `C:\tmp\trry-pos-sw3-reconcile`; verify the final staging definition of `private.m2b_apply_stock_movement`, then run real shared-stock contention. The local reconciliation preserves deployed authority/customer/runtime guards and excludes the divergent candidate bundle.
6. Run a real staging order through Orders payment confirmation, reservation, pickup/courier handover, expiry, and confirmation access checks.
7. Decide paid cancellation/refund and returns behavior before enabling those transitions. Neither is implemented or inferred.
