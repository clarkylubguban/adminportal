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

## End-of-session handoff (2026-09-11)

Source identities were reverified read-only before this documentation update. All three worktrees were clean, and no unexpected changes were present:

- Admin: `C:\tmp\trry-admin-stlolab-sw3-checkout`, branch `codex/stlolab-sw3-checkout`, remote `https://github.com/clarkylubguban/adminportal.git`, verified HEAD `9e40498926a46dbc588fbef7ff59dc499e6dfa8a` before this documentation-only commit.
- Storefront: `C:\tmp\stlolab-sw3-checkout`, branch `codex/stlolab-sw3-checkout`, remote `https://git.chatgpt-team.site/34e4df0b-d845-4167-af7b-7163706dca37/appgprj_6a8978ad58bc8191bc74e2fba33f4528.git`, HEAD `42997da07639aceb04ca487f788c9ccd02013df3`.
- POS: `C:\tmp\trry-pos-sw3-reconcile`, branch `codex/pos-sw3-reconcile`, remote `https://github.com/clarkylubguban/trry-pos.git`, HEAD `382fc386331b59c1078581297fa0e219073a4979`.

Completed local verification remains as recorded above; already-passed suites were not rerun for this checkpoint. At this checkpoint, POS `npm.cmd run phase8a:verify-browser-modes` still used the obsolete Phase 8A `staff_profiles` fixture and stopped at `supabase_read auth sign-in failed`. The 2026-09-16 correction below supersedes the earlier Auth-only diagnosis: the deployed canonical staging path also entered the legacy post-login loader.

POS Preview deployment approval remains pending. No push, deployment, merge, migration, Cron activation, order creation, stock change, or remote configuration change occurred during this checkpoint. V6, working size selection, and disabled live ordering remain preserved.

## POS Preview outcome (2026-09-12)

Owner approval was limited to the existing POS Preview and read-only verification. Source preflight reconfirmed clean POS HEAD `382fc386331b59c1078581297fa0e219073a4979` on `codex/pos-sw3-reconcile` and clean Admin checkpoint HEAD `fbf580509a111c1d89ee87d81d00593956629e9b` before this documentation-only update.

- Vercel project: existing `trry-pos` / `prj_OXFRieJe4VlBWFClY38K06QYMn1Z` under `team_lLNAY28RJHud9QjW9vcIh7WO`.
- Preview deployment: `dpl_H1d9bJYPtWxgbrhADzer7tJfpiKu` at `https://trry-7vvu5yyo1-clarkylubguban1.vercel.app`.
- Vercel metadata reports source `cli`, branch `codex/pos-sw3-reconcile`, commit `382fc386331b59c1078581297fa0e219073a4979`, state `READY`, target Preview (`null`/non-production), and no aliases.
- The production alias `trry-pos.vercel.app` remains on READY deployment `dpl_DTe5j92W5MT1hbBY3xq47wmy4aER`, commit `bcbe14837915defb101d248f939bba171bab526d`; it was not promoted or changed.
- Branch-scoped Preview variables were rejected because the branch is intentionally not pushed to the connected Git repository. Vercel created none. The eight approved values were supplied as build variables to this deployment only. Authenticated `vercel curl` confirmed staging mode, Supabase project `fszkypwovpdthqfobxrk`, remote-write approval, register `0f65cfbc-e85d-4324-ad89-c0c41c8d2f7d`, and location `9cc81235-0af3-4ad6-aa95-35af81178312`. No service-role credential or database password appeared in the runtime configuration.
- Unauthenticated requests receive Vercel SSO redirects, so deployment protection remains active. A temporary `_vercel_share` URL was used only for the browser check and was not stored in application configuration.
- Protected browser smoke reached the `TRRY POS` / `Counter sign in` shell with `supabase` + `staging` runtime values and the approved register/location. The Phase 8A login attempt returned `Invalid login credentials` and created no session.
- Read-only staging SQL confirms `phase8a-read@example.test` is absent and legacy `public.staff_profiles` is absent. This identified an obsolete Phase 8A browser fixture; no legacy identity or table should be created for it.
- Read-only canonical data confirms Glow N Underground `PRD-260911-8DC1A1`, Black S/M/L/XL, PHP 790, active/sellable/`READY_FOR_SALE`. Main Retail Stock has no balance rows for those variants, so inventory quantity display cannot show acceptance stock yet.
- Staging currently has zero active customer rows. The resolver check used the wrong schema name: the applied function is `public.resolve_pos_walk_in_customer_identity_c2_4b(text,text)`, not `trry_api.resolve_pos_walk_in_customer_identity_c2_4b(text,text)`. Invoking its find-or-create path would still have violated this verification's no-customer-write constraint.

Remaining blockers after deployment: use an existing POS-authorized staging identity for authenticated UI verification after a corrected POS Preview is authorized; obtain separate owner authorization before applying the five SW3 migrations; authorize controlled Main Retail Stock test receipts before quantity/stock-contention checks; and retain the existing local-delivery, Cron, refund, return, and payment-failure blockers. C2.4B is already recorded in staging migration history and must not be reapplied. No migration, Cron job, order, sale, receipt, customer, or stock movement was created, and STLOLAB ordering remains disabled.

## POS canonical post-login loader correction (2026-09-16)

Source identity was reverified before editing. Admin was clean at `2864d19ff3fb11fa2a7736e779c9476f04902992` on `codex/stlolab-sw3-checkout`; POS was clean at `382fc386331b59c1078581297fa0e219073a4979` on `codex/pos-sw3-reconcile`.

- Diagnosis: canonical sign-in already used active `admin_users` plus `public.get_pos_sales_effective_access()`, but remote staging then called the Phase 8A `refreshSupabaseData()` path. That path required `staff_profiles` and eagerly requested other obsolete relations. The blocker was therefore both an outdated browser test and a real post-login loader defect.
- POS commit `70bb10abe6427692b50bdd96822883a85d243fcd` retains canonical authorization and the existing RPC write adapters. Remote staging now keeps the authorized shared-operator session and loads only Master Catalog, `v_inventory_sellable`, and M3B-owned POS records (`stock_movements`, `shifts`, `sales`, `sale_lines`, `payments`, `receipts`, `cash_movements`, and `audit_logs`). Explicit local `supabase_write_local` behavior remains on the historical Phase 8A loader.
- The canonical loader does not query `staff_profiles`, `businesses`, `inventory_receivings`, `held_sales`, `held_sale_lines`, legacy `transactions`, legacy expenses, or `pos_staff_profiles`. A canonical operation can still enforce `pos_staff_profiles` inside its existing database authority; profile absence no longer blocks an otherwise eligible user from reaching the POS screen.
- Canonical schema and permission errors remain blocking and visible. An empty `v_inventory_sellable` result maps absent variant balances to zero sellable stock and blocks adding the variant. Empty customer capture remains the valid walk-in state and does not call the C2.4B find-or-create RPC.
- `scripts/phase8a/verify-browser-modes.mjs` now drives the actual login form and post-login loader using canonical local browser fixtures. It verifies eligible access, inactive and unauthorized denial, the empty customer state, zero/unavailable stock, a disabled zero-stock sale action, visible schema failure, and absence of legacy relation requests.
- Local results: Phase 8A browser modes 32 assertions, including a non-empty saved M3B transaction; M1B canonical boot 38; M2C inventory display 22; M3B atomic checkout contract 48; SW3 Preview guards 23; SW3 POS handler 10; C2.4A operator authority passed; C2.4B customer identity passed; POS build passed.
- Admin source now restores `supabase/migrations/20260910132057_customer_identity_pos_walk_in_c2_4b.sql` directly from authoritative commit `4a5a049`. Its Git blob hash is exactly `c7555c5678c52fa5d1a46bb88ceac933108132b6`, matching that history. Staging already records migration `20260910132057`; this source recovery must not be applied remotely.

No remote migration, account or permission change, stock write, deployment, merge, order, receipt, customer creation, or production change occurred. STLOLAB ordering remains disabled. Remaining acceptance requires owner authorization for a new protected POS Preview from the corrected POS commit, authenticated read-only UI verification with an existing eligible identity, the separately authorized five-migration SW3 batch, controlled test stock, and the previously recorded delivery/Cron/refund/return/payment-failure decisions.
