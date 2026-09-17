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

## Corrected POS Preview verification (2026-09-16)

Owner approval covered deployment of the tested loader correction and read-only verification only. Source preflight reconfirmed clean POS HEAD `70bb10abe6427692b50bdd96822883a85d243fcd`, clean Admin HEAD `a658a5f1706c10314a85831d739db6a35bb8d18d`, and clean Storefront HEAD `42997da07639aceb04ca487f788c9ccd02013df3` before this documentation-only update.

- Vercel Preview: `dpl_8SypXZNwzkjC17jzxxyYAu4hQruw` at `https://trry-hq9k4cdk6-clarkylubguban1.vercel.app` in existing project `trry-pos` / `prj_OXFRieJe4VlBWFClY38K06QYMn1Z`.
- Vercel metadata reports state `READY`, source `cli`, branch `codex/pos-sw3-reconcile`, exact commit `70bb10abe6427692b50bdd96822883a85d243fcd`, Preview target, and no aliases. The documented eight staging values were supplied as deployment build variables only; secret values are omitted here.
- Production remained unchanged: `trry-pos.vercel.app` still resolves to `dpl_DTe5j92W5MT1hbBY3xq47wmy4aER` at commit `bcbe14837915defb101d248f939bba171bab526d`. No promotion or production alias assignment occurred, and Vercel protection remains active.
- An existing eligible staging identity signed in successfully. The app reached the authenticated, usable POS shell and displayed the staging warning, canonical operator identity, open shift, New Sale, and Inventory routes.
- The live catalog displayed canonical Glow N Underground `PRD-260911-8DC1A1` at PHP 790 with Black S/M/L/XL. Main Retail Stock showed zero available and zero reserved for this product; each variant displayed `Stock: 0`, and every `ADD` action was disabled.
- The inventory route displayed canonical product, price range, available, reserved, out-of-stock, and sellable totals. A separate staging QA variant with an existing balance displayed 9 available, confirming nonzero balances also reach the loader.
- Empty customer capture was exercised from the live cart with both fields blank. Read-only SQL showed `public.customers` remained at zero before and after, so no customer was created and the empty walk-in state did not invoke the find-or-create write path.
- No browser console warning or error was emitted during the authenticated load, catalog, inventory, or empty-customer checks. The observed usable result is consistent with the locally verified canonical request allowlist and absence of legacy Phase 8A relation requests. The browser harness cannot expose a complete network-request ledger, so the exact no-legacy-request assertion remains backed by the 32-assertion canonical browser fixture rather than claimed from incomplete live telemetry.
- A deliberate permission or schema failure was not injected into staging. The local canonical browser fixture remains the evidence that these failures stay visible and blocking; the live session encountered no permission or schema failure to assess.
- A staging-only QA variant was placed in the browser-local cart to reach customer capture, then the cart was closed. Checkout, hold, payment, receipt, and every stock-writing action were not invoked. No order, sale, customer, receipt, or inventory movement was created.

Remaining acceptance blockers are unchanged except that corrected POS Preview deployment and basic authenticated read-only loader verification are complete. Owner authorization is still required for the five-migration SW3 staging batch, controlled Main Retail Stock acceptance receipts and shared-stock contention, and Cron activation. Local-delivery coverage, refunds, returns, and payment-failure transitions remain blocked. STLOLAB ordering remains disabled, and C2.4B was not reapplied.

## Checkout service-role permission correction (2026-09-16)

Source identity was reverified before editing. Admin was `fb4af7b54b6b8724c363000c2e41bf918f51b4eb` on `codex/stlolab-sw3-checkout`; Storefront was clean at `4b9fb63c400ababcfa3b25cf710506f20a933d23` on `codex/stlolab-sw3-checkout`; POS was clean at `70bb10abe6427692b50bdd96822883a85d243fcd` on `codex/pos-sw3-reconcile`. The Admin worktree contained only this task's migration and regression-test edits.

- The controlled staging checkout attempt failed atomically with PostgreSQL `42501: permission denied for schema private`. No order, checkout request, customer, reservation, payment, or stock movement was created; the database checkout row and both server gates were returned to disabled.
- `trry_api.create_stlolab_order_sw3` is `SECURITY INVOKER`. Its only direct private dependency is `private.stlolab_place_key(text)`, called while normalizing and validating delivery barangays. The reservation helper `private.stlolab_reserve_order_item_sw3()` is reached only through the `order_items` trigger; PostgreSQL does not require the caller to hold direct `EXECUTE` on a trigger function.
- Additive migration `20260916082231_stlolab_sw3_checkout_service_role_permissions.sql` grants `service_role` only `USAGE` on schema `private` and `EXECUTE` on `private.stlolab_place_key(text)`. It explicitly revokes those privileges from `PUBLIC`, `anon`, and `authenticated`. It does not grant the trigger helper, alter default privileges, disable RLS, or change function security mode.
- Disposable PostgreSQL 17 reproduced the pre-migration failure under `SET ROLE service_role`. After applying the migration, checkout succeeded under the same role, duplicate and concurrent retries remained idempotent, the reservation trigger completed while direct service-role execute on its helper remained false, and `anon`/`authenticated` could execute neither the private helper nor checkout RPC. The complete SW3 lifecycle/concurrency suite passed. Fixtures represented Supabase's managed service-role access to `auth.uid()`, public tables, sequences, and public functions; those baseline grants are test setup only and are not in the migration.
- Temporary verification used loopback PostgreSQL only. No Supabase credentials were loaded, and no remote migration, deployment, order attempt, account/configuration change, or stock write occurred.

Exact corrective SQL:

```sql
grant usage on schema private to service_role;
grant execute on function private.stlolab_place_key(text) to service_role;

revoke usage on schema private from public, anon, authenticated;
revoke execute on function private.stlolab_place_key(text) from public, anon, authenticated;
```

Staging apply and retry plan, pending separate owner authorization:

1. Keep Admin `STLO_CHECKOUT_ENABLED=false`, Storefront `STLO_CHECKOUT_ENABLED=false`, and `public.stlolab_checkout_config.enabled=false`. Verify target project ref `fszkypwovpdthqfobxrk`; do not use production credentials.
2. Run `npx.cmd supabase migration list --project-ref fszkypwovpdthqfobxrk`, then `npx.cmd supabase db push --project-ref fszkypwovpdthqfobxrk --skip-vault --dry-run`. Stop unless the only pending file is `20260916082231_stlolab_sw3_checkout_service_role_permissions.sql`.
3. With explicit migration approval, run `npx.cmd supabase db push --project-ref fszkypwovpdthqfobxrk --skip-vault --yes`. Re-list the ledger and read back `has_schema_privilege`/`has_function_privilege`: `service_role` must have the two intended privileges; `anon` and `authenticated` must have neither; service role must still lack direct execute on `private.stlolab_reserve_order_item_sw3()`.
4. If privilege verification fails, keep all gates closed. Because staging was verified to lack both service-role grants before this migration, rollback only these additions with `revoke execute on function private.stlolab_place_key(text) from service_role; revoke usage on schema private from service_role;`, then record the rollback separately. Do not alter browser roles, defaults, RLS, or function security.
5. Only after privilege verification and separate order-test approval, open the database and two server gates for the controlled window, retry exactly one M-size pickup submission using the original client idempotency key and access token, verify one canonical order/request/reservation, and close both server gates plus the database gate in a `finally` procedure even if retry fails. Do not confirm payment or hand over stock.

## Controlled staging pickup acceptance (2026-09-17)

Owner approval covered only the tested permission migration, one M-size pickup order, read-only verification, and gate cleanup in staging. Admin source was clean at `928c0dece91a4ad5a36750c07f5ad51cdc73ada9` before operational work; Storefront remained at accepted commit `4b9fb63c400ababcfa3b25cf710506f20a933d23`. No source deployment, merge, production change, payment confirmation, handover, Cron activation, or stock receipt occurred.

- Applied only `20260916082231_stlolab_sw3_checkout_service_role_permissions.sql` to staging project `fszkypwovpdthqfobxrk`; the remote migration ledger records version `20260916100834`. Post-apply privileges are limited to `service_role` schema `private` `USAGE` and `private.stlolab_place_key(text)` `EXECUTE`. `PUBLIC`, `anon`, and `authenticated` retain neither privilege, and the trigger helper was not granted directly.
- A security review rejected pulling all Preview environment values into a local file because that could expose privileged secrets. The requested safe action was to inspect configuration without pulling values. The run used environment-name listing and targeted updates only; secrets remained server-side.
- Before checkout, Main Retail Stock `9cc81235-0af3-4ad6-aa95-35af81178312` held M variant `651d79c6-a6a9-47a5-ba1a-77d8ebb5cbd6` at on-hand `1`, reserved `0`. No stock was added.
- The controlled window used Admin Preview `dpl_Ae85s8Aqpe3HeUx9yadK9QPMj2i5` and the existing owner-private Sites version. Exactly one browser submission created canonical order `49dc89ae-2e30-4f8a-b4e8-3b746c5d70e2` / `TRRY-ORD-8B12C7F9` and reservation `7640053c-05a2-4831-9619-6b0c864d7956` for Glow N Underground, Black, M, quantity `1`, unit/total PHP `790`, `pickup`, `UNPAID`, and `PENDING` fulfillment.
- Direct staging readback found exactly one canonical order item and one ACTIVE reservation. Final Main Retail Stock is on-hand `1`, reserved `1`, available `0`; no stock movement occurred.
- Confirmation access passed both sides: the submitting browser session reloaded the saved confirmation successfully after gates closed, while a fresh tab with the order UUID alone displayed `CONFIRMATION UNAVAILABLE` and no order/customer details.
- Cleanup completed in fail-closed order. Database `public.stlolab_checkout_config.enabled=false`; Admin Preview environment `STLO_CHECKOUT_ENABLED=false` is deployed READY as `dpl_2EG7WHcxzsVph8bJy7uoyGyiJBtq` at `https://adminportal-staging-o3lm1gghp-clarkylubguban1.vercel.app`; Sites environment revision `7` has `STLO_CHECKOUT_ENABLED=false`, points at that disabled Preview endpoint, and was republished owner-private at `https://stlolab-after-dark-preview.clarkylubguban.chatgpt.site`.

The acceptance record remains awaiting payment and reserved. Do not confirm payment, hand over, cancel, expire, or otherwise alter it without a separately approved acceptance step. Local-delivery coverage, refunds, returns, and payment-failure transitions remain blocked; STLOLAB ordering is disabled.

## Read-only Admin and POS acceptance evidence (2026-09-17)

Admin source was clean at checkpoint `c2032af749214a8544d4199f99c96ed3e740b066`; POS source was clean at `70bb10abe6427692b50bdd96822883a85d243fcd`. Verification used authenticated staging Preview sessions only. The production Admin and POS aliases were not used after their identities were detected, and no action button or write path was invoked.

- Canonical SQL still shows order `49dc89ae-2e30-4f8a-b4e8-3b746c5d70e2` / `TRRY-ORD-8B12C7F9` as `awaiting_payment`, `UNPAID`, `PENDING`, pickup, PHP `790.00`. Its sole line is Glow N Underground `PRD-260911-8DC1A1`, Black, M, quantity `1`, unit price PHP `790.00`. Reservation `7640053c-05a2-4831-9619-6b0c864d7956` remains ACTIVE; Main Retail Stock is on-hand `1`, reserved `1`, available `0`; there are zero order stock movements.
- The protected Admin Preview Orders page finds `TRRY-ORD-8B12C7F9`, shows `UNPAID`, pickup, M quantity `1`, and PHP `790` due. Two UI discrepancies remain: the item display uses the generic order snapshot `Direct STLOLAB retail checkout` instead of the canonical line name `Glow N Underground`/Black; the Fulfillment tab shows `Sub-status: Not set` instead of canonical `PENDING`. These are display/projection gaps, not canonical-data failures.
- The protected POS Preview Inventory page shows the correct product at `1 available / 1 reserved / 0 sellable`. Its M row shows on-hand/available `1`, reserved `1`, sellable `0`, and `OUT OF STOCK`. New Sale shows Glow N Underground as `0 sellable`; the Black/M selector shows `Stock: 0` and its `ADD` action is disabled. No sale was attempted.
- Checkout remains closed: database `stlolab_checkout_config.enabled=false`, Sites environment revision `7` has `STLO_CHECKOUT_ENABLED=false`, and the disabled Admin Preview from the prior acceptance remains the configured checkout endpoint. No order, reservation, payment, handover, cancellation, sale, or stock state changed during this verification.

### Next staging test: token-authorized cancellation

Do not run without separate mutation approval. Reuse only order `49dc89ae-2e30-4f8a-b4e8-3b746c5d70e2`; do not create another order.

1. Recheck the baseline above and confirm the order has not reached its absolute expiry instant `2026-09-20 01:59:44.487094+00`, no Cron cleanup is active, and all checkout gates are disabled.
2. Keep the Storefront and database checkout gates disabled. Temporarily enable only a dedicated Admin staging Preview for the existing `/api/stlolab-order-cancel` server route. Reuse the existing server-only gateway secret and the confirmation token held by the owner-private submitting session; never print, download, or persist either secret.
3. Use cancellation idempotency key `SW3-CANCEL-49DC89AE-01` and reason `SW3 staging cancellation acceptance`. First send a wrong-token control request and require HTTP `404 ORDER_NOT_FOUND` with every canonical row unchanged.
4. Send two concurrent authorized POST requests with the same order ID, confirmation token, idempotency key, and reason. Both may return the same cancelled confirmation, but the transaction must produce exactly one state transition and one reservation release.
5. Require final order status `cancelled` while payment remains `UNPAID` and fulfillment remains `PENDING`; reservation status `RELEASED` with `release_idempotency_key='SW3-CANCEL-49DC89AE-01'` and reason `CUSTOMER_CANCELLATION`; on-hand `1`, reserved `0`, available `1`; zero stock movements. Replay the identical request once more and require no further change.
6. Refresh Admin and POS read-only: Admin must show cancelled; POS M must show on-hand `1`, reserved `0`, sellable `1`. Do not add it to a cart or attempt a sale.
7. In a `finally` cleanup, return the Admin Preview gate to false and verify Storefront, Admin, and database gates are all disabled. Record request IDs, responses, and final SQL evidence without recording secrets.

## Cancellation acceptance attempt and local Admin projection fix (2026-09-17)

Cancellation evidence and the undeployed UI work are intentionally recorded separately.

### Staging cancellation acceptance

- The requested cancellation mutation was not executed. The owner-private browser session that created the order and held its confirmation token in session storage had been closed, and the token is not retained by Admin, Storefront source, or the database. Staging stores only its one-way hash. Reopening browser history did not recover the token.
- Rotating, reissuing, recovering, or bypassing the confirmation token is outside the documented cancellation scope. The wrong-token control was also not run because opening the dedicated Admin cancellation gate without a valid-token path could not complete the approved acceptance sequence safely. No cancellation endpoint request was sent and no gate was opened.
- Fresh read-only SQL reconfirmed order `49dc89ae-2e30-4f8a-b4e8-3b746c5d70e2` / `TRRY-ORD-8B12C7F9` remains `awaiting_payment`, `UNPAID`, and `PENDING`, with one ACTIVE reservation for quantity `1`. Main Retail Stock M remains on-hand `1`, reserved `1`, available `0`. The order has zero stock movements, and the total STLOLAB retail order count remains `1`.
- The database checkout gate remains `false`. The Admin and Sites checkout gates were not changed from their disabled checkpoint state. No order, reservation release, stock movement, payment, handover, sale, customer, or remote configuration change occurred. POS therefore correctly remains blocked for M at available/sellable `0`; released availability cannot be claimed until an authorized cancellation actually succeeds.
- Required owner action: restore the original token-bearing confirmation browser session. If it cannot be restored, approve a separately reviewed token-reissue procedure that preserves proof of possession and does not weaken the confirmation or cancellation boundary. Do not use a database bypass or disclose the token.

### Local Admin display mapping

- Admin source started clean at `c4ffd4e2bf370b4130c83edf83a6ba49728af9f6` on `codex/stlolab-sw3-checkout`. POS remained clean at `70bb10abe6427692b50bdd96822883a85d243fcd`; Storefront remained clean at `4b9fb63c400ababcfa3b25cf710506f20a933d23`.
- The existing authenticated `/api/orders/:orderId/actions` function now supports a read-only detail response. It requires canonical Orders effective access, uses the server-side client to read only the canonical fulfillment state and order-line snapshots, and returns no customer data. Existing owner/admin mutation restrictions and action contracts are unchanged; temporary Orders staff receive only the same read authority already granted to their module.
- The Orders compatibility loader enriches only `STLOLAB_RETAIL` rows. The dashboard now renders canonical `Glow N Underground`, `Black`, `M × 1`, and fulfillment `Pending`; legacy and other native order display behavior remains unchanged. Missing or denied detail reads remain visible as Orders load errors rather than being converted to empty data.
- Focused verification passed: `node scripts/test-stlolab-admin-order-actions.mjs`, `node scripts/test-orders-dual-read.mjs`, `node scripts/test-orders-dashboard.mjs`, and `npm.cmd run build`. The generated `dist` artifact was refreshed. These Admin changes are local only and were not deployed.

## Durable same-browser order access (2026-09-17)

Source identity was verified before editing. Admin started clean at `8a48340dababd621ceeb709d46cbcf5bbbe7aca6`; Storefront started clean at `4b9fb63c400ababcfa3b25cf710506f20a933d23`; POS remained clean and untouched at `70bb10abe6427692b50bdd96822883a85d243fcd`. All are on their existing `codex/*-sw3-*` branches and expected remotes.

- Admin implementation commit: `596d850bf9239d99e741b379eaaa6e9a5f7d0087`. Additive migration `20260917034542_stlolab_order_access_lifecycle.sql` adds nullable version/issued/expiry/revocation fields, rejects newly inserted STLOLAB orders that do not establish version 1 access before commit, and enforces expiry/revocation in confirmation and cancellation. It does not update or backfill any row.
- Storefront implementation commit: `8e62bb59612bf011c6de014718d73b49ff5948ce`. A same-origin preparation request creates a server-generated random token in a short-lived `Secure`, `HttpOnly`, `SameSite=Strict`, host-only cookie. Successful checkout promotes the same token into a persistent per-order `Secure`, `HttpOnly`, `SameSite=Lax`, host-only cookie. Per-order names preserve access to multiple orders.
- Interrupted checkout responses do not strand a created order: the pending cookie exists before order creation and is cleared only in the same response that sets durable access. The browser retains a SHA-256 request fingerprint plus the non-secret idempotency key, not customer data or the token. Retrying the same payload reaches the canonical idempotent order with the same token.
- Confirmation now comes from the canonical Admin RPC through a Storefront server route. Order UUID alone, absent cookie, wrong cookie, expired token, or revoked token returns the same not-found boundary. Mutations require exact same-origin `Origin`, a fixed same-origin CSRF request header, SameSite cookies, the server-only gateway secret, and the canonical token check.
- Order creation alone depends on `STLO_CHECKOUT_ENABLED=true`. Confirmation and token-authorized cancellation remain available with creation disabled, while still requiring staging identity, server gateway configuration, canonical token authorization, and database lifecycle rules.
- The migration leaves `TRRY-ORD-8B12C7F9` unchanged: no token is rotated or reissued, no lifecycle columns are backfilled, and its existing hash remains the only credential accepted by the legacy-version compatibility branch.
- `STLO_ORDER_ACCESS_TTL_SECONDS` is mandatory when checkout is enabled and accepts 5 minutes through 90 days. `2592000` (30 days) was used only by local fixtures; no deployed lifetime has been approved.

Verification passed: Storefront typecheck; 23 unit checks; Vinext build with the four access API routes present; 11 built Worker/rendered checks covering fresh browser requests with persisted cookies, two simultaneous order-access cookies, interrupted response plus retry, duplicate idempotency, missing-cookie denial, Origin/CSRF denial, canonical confirmation, and token-authorized cancellation while creation is closed; Admin route contract; and the complete disposable PostgreSQL lifecycle/race suite through the preserved embedded PostgreSQL harness. The database suite also verifies direct use of the legacy create overload cannot commit a new order, expiry and revocation deny reads/cancellation, browser roles remain denied, and stock/payment/fulfillment invariants still pass. A hydrated localhost browser then placed one in-memory M pickup fixture at PHP 790, rendered its canonical confirmation, closed the tab, and reopened the exact URL in a new tab with confirmation restored only from the persistent cookie. The local fixture tab and server were closed afterward. All records and stock were disposable.

Email OTP, token recovery/reissue, and ChatGPT identity binding remain deferred. Clearing cookies or moving to another browser/device still loses access until one of those ownership-verification paths is approved and implemented. No durable access is retrofitted to the existing staging order. No remote migration, deployment, email, order, cancellation, stock change, gate change, push, or merge occurred; V6, size selection, and disabled live ordering are preserved.

## Durable-access staging restart handoff (2026-09-17)

This checkpoint was written before intentionally terminating the Codex desktop process for the required full browser-process restart test. It contains no cookie, access token, credential, customer data, or secret value.

- Source before this documentation-only commit: clean Admin `ce0a903870a5bd11c9fcaed7857f833568d71533` on `codex/stlolab-sw3-checkout`; clean Storefront `a67c4cfd37b1c846167077dd0d302325a370f4b2` on `codex/stlolab-sw3-checkout`.
- Applied staging migration: only `20260917034542_stlolab_order_access_lifecycle.sql` for this release, SHA-256 `A4B6D5666F66FFC7031ADF254821D16214626DC754FFAE5496F65D059C4F713B`. Version-1 rows now exist, so the lifecycle schema must be retained and any correction must be forward-only.
- Current closed Admin Preview: `dpl_CPViVqaKFbDQsRPidq1ToMVyFjyg` at `https://adminportal-staging-5b4ovrdta-clarkylubguban1.vercel.app`, exact source `ce0a903870a5bd11c9fcaed7857f833568d71533`, with checkout disabled.
- Current owner-private Sites deployment: `appgdep_6aabac8a2d0081919e3f2c54ead0d75b`, saved version `appgprj_6a8978ad58bc8191bc74e2fba33f4528~appgver_2c9f21310ee88191b9d7e756e25f0261`, environment revision `15`, exact source `a67c4cfd37b1c846167077dd0d302325a370f4b2`, with `STLO_CHECKOUT_ENABLED=false` and access lifetime `604800` seconds.
- All creation gates are closed: database `public.stlolab_checkout_config.enabled=false`, Admin checkout disabled, and Sites checkout disabled. They must remain closed throughout cancellation and cleanup acceptance.
- Existing S acceptance order: `72ffd058-6c3f-4531-85eb-f525237ba405` / `TRRY-ORD-17390094`, Glow N Underground, Black, S x 1, PHP 790, pickup, `UNPAID`, `PENDING`, active reservation `938c6ec9-2d1f-4e7c-810b-269abb589e31`. Access expires `2026-09-24 09:00:07.753+00`; reservation expires `2026-09-20 09:00:08.281744+00`. Current S balance is on-hand `1`, reserved `1`, available `0`; there is no sale deduction or order stock movement.
- Preserved M acceptance order: `49dc89ae-2e30-4f8a-b4e8-3b746c5d70e2` / `TRRY-ORD-8B12C7F9`. Current M balance remains on-hand `1`, reserved `1`, available `0`. Do not alter it during the S acceptance.
- Separate-profile denial checks are complete. An isolated persistent Chrome profile at `C:\tmp\stlolab-sw3-denial-profile`, with no authorized order cookie, rendered `CONFIRMATION UNAVAILABLE`. Adding only a bogus per-order cookie in that isolated profile produced the same denial and exposed no order or customer details. The authorized Codex profile was not modified.
- Process ownership is now established. The authorized in-app browser is embedded in Codex desktop `ChatGPT.exe` PID `32332`, created `2026-09-17 10:22:13 +08:00`. Its browser network and renderer children use `C:\Users\ROG\AppData\Roaming\Codex\web\Codex`; `codex-computer-use-swift.exe` PID `35340`, created `2026-09-17 10:23:16 +08:00`, was launched with `--parent-pid 32332`. A prior controller reset or tab close did not terminate this process and therefore was not a full restart test.
- The persistent Codex profile must not be cleared, reset, signed out, or replaced. After relaunch, first prove that the root `ChatGPT.exe` and `codex-computer-use-swift.exe` PIDs and creation times are newer, then open the existing confirmation URL in the same in-app browser profile and require canonical confirmation access without reissuing or exposing the token.
- Cancellation and S cleanup have not run. After restart confirmation succeeds, recheck canonical state; send concurrent duplicate cancellation requests and one replay through the protected same-origin application endpoint using stable idempotency key `SW3-CANCEL-17390094-01`; require one cancellation and one reservation release, S `1/0/1`, and no sale deduction. Only then remove the unused S test unit through the authorized inventory adjustment workflow with a dedicated cleanup reference, producing final S `0/0/0`. Reverify M `1/1/0` and all creation gates closed.

If any cancellation response is uncertain, inspect the canonical order and reservation before retrying. Do not create another order, confirm payment, hand over stock, invoke production, bypass token authorization, or expose browser storage.

## Durable-access restart verification and cancellation blocker (2026-09-17)

Source identity was reverified before continuing from checkpoint `8289687ff46e9a1d9be29391bed1ecd44c2dc6a3`. Admin is clean on `codex/stlolab-sw3-checkout` at `8289687ff46e9a1d9be29391bed1ecd44c2dc6a3` with remote `https://github.com/clarkylubguban/adminportal.git`. Storefront is clean on `codex/stlolab-sw3-checkout` at `a67c4cfd37b1c846167077dd0d302325a370f4b2` with the existing Sites git remote. POS was not changed.

The full browser-process restart requirement passed. The prior embedded Codex browser owner was `ChatGPT.exe` PID `32332` / `codex-computer-use-swift.exe` PID `35340`. After the user relaunched Codex, the root process was `ChatGPT.exe` PID `43140`, created `2026-09-17 20:22:55 +08:00`; the computer-use host was `codex-computer-use-swift.exe` PID `3864`, parent PID `43140`, created `2026-09-17 20:23:36 +08:00`. The persistent Codex profile was preserved.

Owner-private Sites authentication was required after restart and succeeded through the saved ChatGPT account chooser without exposing credentials. The same persistent in-app browser then loaded `https://stlolab-after-dark-preview.clarkylubguban.chatgpt.site/confirmation/72ffd058-6c3f-4531-85eb-f525237ba405` and rendered canonical confirmation data for `TRRY-ORD-17390094`: Glow N Underground, Black, S x 1, subtotal PHP `790`, fulfillment PHP `0`, total PHP `790`, status `awaiting_payment`. This proves durable same-browser confirmation access survived a real browser-process restart.

Canonical preflight before mutation showed S order `72ffd058-6c3f-4531-85eb-f525237ba405` / `TRRY-ORD-17390094` still `awaiting_payment`, `UNPAID`, and `PENDING`, with ACTIVE reservation `938c6ec9-2d1f-4e7c-810b-269abb589e31`; S balance remained on-hand `1`, reserved `1`, available `0`, with zero stock movements. Preserved M order `49dc89ae-2e30-4f8a-b4e8-3b746c5d70e2` / `TRRY-ORD-8B12C7F9` remained on-hand `1`, reserved `1`, available `0`, with zero stock movements. The database checkout creation gate remained `public.stlolab_checkout_config.enabled=false`.

The approved cancellation was not executed. The deployed confirmation page has no customer-facing cancel control; its protected cancellation path is route-only. The computer-use top-level page evaluation ran outside the browser document and could not send same-origin requests or cookies. Locator-scoped evaluation could read the live confirmation DOM but exposes a restricted automation realm with no usable `fetch`, no constructible `XMLHttpRequest`, and no DOM script injection, so it could not submit the protected same-origin endpoint while preserving the HttpOnly cookie. A direct database cancellation using the stored token hash was intentionally not used because it would bypass the protected application endpoint and would not satisfy token-authorized browser cancellation acceptance.

Final read-only SQL confirmed no mutation occurred: S remained `awaiting_payment` / `UNPAID` / `PENDING`, reservation ACTIVE, release fields null, on-hand `1`, reserved `1`, available `0`, and zero stock movements. M remained untouched at on-hand `1`, reserved `1`, available `0`. Because the S reservation was not released, the approved cleanup adjustment for the unused S unit was not run. All checkout creation gates remain closed; no order, payment, handover, sale, receipt, stock movement, deployment, migration, merge, or production change occurred.

Remaining blocker: staging needs a supported token-authorized cancellation surface that can run from the authorized browser without exposing the token, such as a temporary owner-only acceptance UI/button on the confirmation page or an approved browser automation channel capable of same-origin POST with the existing HttpOnly cookie. Do not use token extraction, token reissue, database bypass, or direct RPC cancellation for the acceptance result. Once that surface exists, rerun exactly the approved `SW3-CANCEL-17390094-01` concurrent duplicate cancellation, verify S `1/0/1`, then perform the already approved authenticated cleanup adjustment to final S `0/0/0`; keep M `1/1/0` untouched and keep creation gates closed.

## Live confirmation cancellation acceptance (2026-09-17)

The owner-private Sites repository was verified at `a67c4cfd37b1c846167077dd0d302325a370f4b2` on `main`, then fast-forwarded by one commit to `ebae78847512f87c92f814ec56e7d0ad06e473bf`. Sites saved version `18` as `appgprj_6a8978ad58bc8191bc74e2fba33f4528~appgver_5be1b7ad27a881919042ea398b177993` and published deployment `appgdep_6aabe893b79481918bccf3ba8f43c54a` successfully to the unchanged owner-private hostname. Provider deployment ID is `site---6a8978ad58bc8191bc74e2fba33f4528`. Environment revision remained `15`; `STLO_CHECKOUT_ENABLED=false`, `STLO_ORDER_ACCESS_TTL_SECONDS=604800`, staging project `fszkypwovpdthqfobxrk`, and the existing secret entries were preserved without disclosure.

Using the retained authorized browser profile and HttpOnly order-access cookie, the deployed confirmation rendered canonical order `72ffd058-6c3f-4531-85eb-f525237ba405` / `TRRY-ORD-17390094` before mutation. The new two-step UI required a separate confirmation, disabled its controls while the request was in flight, and then rendered `ORDER CANCELLED` from canonical data. No token or cookie was exposed.

Canonical readback proves one valid cancellation outcome: order status `cancelled`, payment state `UNPAID`, fulfillment state `PENDING`, reservation `938c6ec9-2d1f-4e7c-810b-269abb589e31` `RELEASED` once for `CUSTOMER_CANCELLATION`, S on-hand `1`, reserved `0`, available `1`, and zero `SALE` movements. The existing receipt is unchanged. The protected UI retained one opaque per-order cancellation idempotency key; its value is not recorded here. Local disposable tests remain the evidence for concurrent duplicate and replay behavior; the live browser operation was a single confirmed submission.

The separately approved S cleanup did not run. A proposed direct SQL call that set an authenticated JWT execution context was rejected by the security reviewer because it would impersonate an authenticated subject instead of using a verified authenticated adjustment workflow. No bypass or alternate raw mutation was attempted. Staging therefore remains S `1/0/1`, with zero adjustment movements. Required action is to expose or identify a supported authenticated Owner/Admin `trry_api.adjust_inventory` surface, then remove exactly one unused S unit with a dedicated acceptance-cleanup reference and stable idempotency key. Final S `0/0/0` must not be claimed until that authorized workflow succeeds.

The preserved M order `49dc89ae-2e30-4f8a-b4e8-3b746c5d70e2` / `TRRY-ORD-8B12C7F9` remains `awaiting_payment` with its reservation `ACTIVE` and balance on-hand `1`, reserved `1`, available `0`. Database checkout creation remains disabled and Sites checkout creation remains disabled. Admin Preview and its disabled checkout configuration were not changed. No new order, payment, handover, sale, migration, Admin deployment, production change, or gate opening occurred.

## Authenticated S cleanup path audit (2026-09-17)

Resumed from clean Admin checkpoint `61e9feaa9de2a863e3b06ec1c951ae9f072a3277` and clean Storefront `ebae78847512f87c92f814ec56e7d0ad06e473bf`. Read-only canonical verification reconfirmed order `72ffd058-6c3f-4531-85eb-f525237ba405` / `TRRY-ORD-17390094` has exact order status `cancelled`, payment state `UNPAID`, fulfillment state `PENDING`, and `cancelled_at=2026-09-17 13:25:39.535548+00`. Reservation `938c6ec9-2d1f-4e7c-810b-269abb589e31` remains `RELEASED` for `CUSTOMER_CANCELLATION`. S remains on-hand `1`, reserved `0`, available `1`, with one preserved `RECEIPT`, zero `ADJUSTMENT`, and zero `SALE` movements.

No supported authenticated canonical adjustment surface is currently available in the deployed staging applications. Admin source exposes authenticated canonical receiving through `trry_api.receive_inventory` but has no Owner/Admin adjustment action. POS source exposes canonical receiving and sale repositories, but its visible `ADJUST STOCK` control still mutates local mock state through `confirmManualAdjustment()` and never calls `trry_api.adjust_inventory`; it must not be used for canonical cleanup. The previously visible POS identity was in-memory only and a page refresh returned to the staging login screen, so no retained authenticated session was available for a legitimate write. No raw SQL, fabricated JWT claims, direct balance edit, or mock adjustment was attempted.

Required owner UI capability: an authenticated staging Owner/Admin must be able to open Inventory, select Main Retail Stock, select Glow N Underground / Black / S (`9a8f3cc9-b22f-40ad-890c-b78add622acd`), choose Remove `1`, enter the dedicated cleanup reference `SW3-STAGING-DURABLE-ACCESS-S-CLEANUP-01` and idempotency key `SW3-ACCESS-S-CLEANUP-01`, and submit through `trry_api.adjust_inventory`. The control must display the canonical RPC result and movement ID. This UI/action must be implemented and deployed to staging before the owner can perform that step; there is no safe existing button to click today.

Cleanup remains blocked and S is intentionally unchanged at `1/0/1`. Preserved M order `49dc89ae-2e30-4f8a-b4e8-3b746c5d70e2` / `TRRY-ORD-8B12C7F9` remains `awaiting_payment`, reservation `ACTIVE`, and balance `1/1/0`. Database checkout creation is `false`; Sites environment revision `15` still has `STLO_CHECKOUT_ENABLED=false` and the seven-day access lifetime. Admin configuration was not changed. No production change occurred.

## Local authenticated Admin inventory adjustment action (2026-09-17)

Worktree governance and source identities were reverified before editing. Admin resumed at clean checkpoint `2dd6bbcd39229d40ed637ce0511c86ecfa71046a` on `codex/stlolab-sw3-checkout` with remote `https://github.com/clarkylubguban/adminportal.git`. Storefront remained clean and untouched at `ebae78847512f87c92f814ec56e7d0ad06e473bf` on `codex/stlolab-sw3-checkout`. POS remained clean and untouched at `70bb10abe6427692b50bdd96822883a85d243fcd` on `codex/pos-sw3-reconcile`.

The existing Admin Inventory page now exposes a narrowly scoped Adjust action for Owner/Admin only. It requires an explicit canonical inventory location, variant, add/remove direction, positive whole-number quantity, audit reference, operational reason, stable idempotency key, and a separate confirmation checkbox. It sends the current real Admin access token to the existing schema-aware `trry_api.adjust_inventory` RPC and refreshes balances and movements from canonical tables after success. Retries retain the same key, in-flight repeat clicks are blocked, and the client never writes `inventory_balances` or `stock_movements` directly.

No database migration was added. Existing canonical authority remains the enforcement boundary: `trry_api.adjust_inventory` is executable by `authenticated` only, with `anon`, `PUBLIC`, and `service_role` denied; its private shared-stock helper validates active Owner/Admin identity from `auth.uid()`, takes the idempotency lock, preserves the reservation floor, and appends the audited movement. UI role gating is supplementary and does not replace that server-side check.

Local verification passed:

- `node --check src/main.js` and `node --check src/services/adminInventory.js`.
- `npm.cmd run test:admin-inventory-p0`, including exact schema RPC routing, real bearer-session propagation, stable cleanup key/reference payload, no direct stock writes or fabricated claims, and canonical post-adjustment display refresh.
- Complete disposable PostgreSQL migration suite through `C:\tmp\codex-embedded-postgres-sw3\run-sw3-test.mjs`, exit `0`, using actual `anon` and `authenticated` roles. It verifies anonymous denial, non-Owner/Admin denial, duplicate/retry creates exactly one adjustment movement and one balance change, and a removal crossing reserved quantity is denied without a movement.
- `npm.cmd run test:admin-inventory-responsive` at 1920, 1366, tablet, and 390 pixels.
- `npm.cmd run build` with refreshed tracked `dist` artifacts.

Read-only staging verification after local testing confirms no remote mutation: Main Retail Stock S remains on-hand `1`, reserved `0`, available `1`; M remains on-hand `1`, reserved `1`, available `0`; and `public.stlolab_checkout_config.enabled=false`. The later approved S cleanup values remain reserved exactly as documented: reference `SW3-STAGING-DURABLE-ACCESS-S-CLEANUP-01` and idempotency key `SW3-ACCESS-S-CLEANUP-01`.

The POS `ADJUST STOCK` issue is still unresolved. Its visible action remains mock-only and does not call the canonical RPC; this Admin implementation neither changes nor validates that POS path.

Exact future staging deployment scope is Admin-only: deploy the tested commit from this worktree to the existing protected `adminportal-staging` Preview/project, retaining its staging Supabase configuration and real Owner/Admin login. No migration, environment change, Sites/POS deployment, production alias, checkout-gate change, or stock mutation belongs to that deployment. After separate deployment approval, the already approved cleanup may be submitted once through Admin Inventory for Glow N Underground / Black / S at Main Retail Stock, Remove `1`, with the preserved reference and idempotency key; canonical balance and movement readback must precede any retry. This checkpoint does not perform that deployment or cleanup.

## Staging Admin deployment and S cleanup acceptance (2026-09-17)

Owner approval authorized only Admin commit `9844d07ec3acb95f48858715689f84f7d213a86b` and the already approved S cleanup. The clean `codex/stlolab-sw3-checkout` worktree was deployed with Preview semantics to existing Vercel project `adminportal-staging` (`prj_K0oDSa6r1MgAEpQMcl3mKVdJvtNI`) under team `team_lLNAY28RJHud9QjW9vcIh7WO`. Deployment `dpl_7wjgMHTdBYyb1N3VSA8srsCnb5ep` is READY at `https://adminportal-staging-g6i0e8v0c-clarkylubguban1.vercel.app`; target is Preview, aliases are empty, and Vercel metadata records exact commit `9844d07ec3acb95f48858715689f84f7d213a86b`. No production promotion, merge, migration, or environment operation occurred.

Canonical preflight immediately before the mutation confirmed Main Retail Stock, Glow N Underground, Black/S (`PRD-260911-8DC1A1-BLACK-S`), on-hand `1`, reserved `0`, available `1`; M remained `1/1/0`; database checkout creation was `false`; and cleanup idempotency key `SW3-ACCESS-S-CLEANUP-01` plus reference `SW3-STAGING-DURABLE-ACCESS-S-CLEANUP-01` matched zero existing movements.

Using a genuine authenticated staging Owner/Admin session in the exact deployed Preview, the Inventory UI displayed the canonical S target and After Adjustment `0`. One confirmed Remove `1` submission used reference `SW3-STAGING-DURABLE-ACCESS-S-CLEANUP-01`, idempotency key `SW3-ACCESS-S-CLEANUP-01`, and reason `Remove unused S staging acceptance test unit after verified cancellation`. The UI reported canonical RPC success and refreshed the row to Out of Stock. No retry was sent.

Canonical post-mutation readback shows exactly one matching `ADJUSTMENT` movement: `dc8ac6fe-b125-4fd4-b110-c52906f189f5`, quantity delta `-1`, balance `1 -> 0`, location `9cc81235-0af3-4ad6-aa95-35af81178312`, variant `9a8f3cc9-b22f-40ad-890c-b78add622acd`, and the preserved key/reference. Final S is on-hand `0`, reserved `0`, available `0`; S has zero `SALE` movements. Preserved M is unchanged at on-hand `1`, reserved `1`, available `0`.

All creation gates remain closed. Database `public.stlolab_checkout_config.enabled=false`; Sites project `appgprj_6a8978ad58bc8191bc74e2fba33f4528` remains environment revision `15` with `STLO_CHECKOUT_ENABLED=false`; and the Admin Preview configuration was inherited unchanged. The POS mock adjustment control was not used. No new order, payment, handover, sale, receipt, customer, production change, or unrelated mutation occurred.

## Remaining staging acceptance batch preparation (2026-09-17)

This pass was read-only against staging. No gate, deployment, database row, stock balance, order, payment, handover, receipt, sale, shift, or remote configuration was changed.

### Verified identities and deployed paths

- Admin worktree: clean starting HEAD `aeb318225d8c560b931180b60fbdd11f6fccc6ab`, branch `codex/stlolab-sw3-checkout`, remote `https://github.com/clarkylubguban/adminportal.git`.
- Storefront worktree: clean HEAD `ebae78847512f87c92f814ec56e7d0ad06e473bf`, branch `codex/stlolab-sw3-checkout`, existing Sites git remote.
- POS worktree: clean HEAD `70bb10abe6427692b50bdd96822883a85d243fcd`, branch `codex/pos-sw3-reconcile`, remote `https://github.com/clarkylubguban/trry-pos.git`.
- Admin Preview `dpl_7wjgMHTdBYyb1N3VSA8srsCnb5ep` is READY at `https://adminportal-staging-g6i0e8v0c-clarkylubguban1.vercel.app`, project `adminportal-staging` / `prj_K0oDSa6r1MgAEpQMcl3mKVdJvtNI`, exact deployed commit `9844d07ec3acb95f48858715689f84f7d213a86b`, no alias.
- POS Preview `dpl_8SypXZNwzkjC17jzxxyYAu4hQruw` is READY at `https://trry-hq9k4cdk6-clarkylubguban1.vercel.app`, project `trry-pos` / `prj_OXFRieJe4VlBWFClY38K06QYMn1Z`, exact deployed commit `70bb10abe6427692b50bdd96822883a85d243fcd`, no alias.
- The protected POS runtime is the intended staging write build: `VITE_APP_ENV=staging`, `VITE_DATA_MODE=supabase`, remote writes explicitly enabled, Supabase `fszkypwovpdthqfobxrk`, register `0f65cfbc-e85d-4324-ad89-c0c41c8d2f7d`, and Main Retail Stock `9cc81235-0af3-4ad6-aa95-35af81178312`. The publishable browser key is not reproduced here; no privileged key is present in the browser runtime.
- Sites version `18` / deployment `appgdep_6aabe893b79481918bccf3ba8f43c54a` is published owner-private at the existing hostname from exact commit `ebae78847512f87c92f814ec56e7d0ad06e473bf`. Environment revision `15` has `STLO_CHECKOUT_ENABLED=false`, seven-day staging order access, pickup at PHP 0, and nationwide delivery at PHP 120.
- Staging records all required migrations through `20260917074538_stlolab_order_access_lifecycle`; no migration is pending for this batch.

The deployed Admin Orders UI was inspected with a real Owner session. Canonical STLOLAB rows expose the payment form and the fulfillment action. Payment calls `POST /api/orders/:orderId/actions` with `confirm_payment`; pickup and delivery use the same protected endpoint with `customer_pickup` or `courier_handover`. Both server operations require authenticated Owner/Admin authority. Handover presents an explicit confirmation and the database atomically consumes the active reservation and deducts on-hand once. Courier handover intentionally leaves COD payment unchanged. The protected POS `/sale` route redirects an expired session to `/login`; acceptance therefore requires a fresh existing POS/Sales-authorized staging login, not a new account.

### Current canonical baseline

- Main Retail Stock and Main Counter are active in the same Main Shop branch. Open shift `SHF-20260820-00001` exists for the register; recheck it immediately before acceptance rather than opening another shift.
- Glow N Underground `ceb96960-67ef-41c0-bca7-55a063dd70b2`, Black variants: S `9a8f3cc9-b22f-40ad-890c-b78add622acd` = `0/0/0`; M `651d79c6-a6a9-47a5-ba1a-77d8ebb5cbd6` = `1/1/0`; L `86d11ac3-efc1-4778-a768-809603a67745` = `0/0/0`; XL `fdbdb5d4-c80c-4dda-8ba4-602a48de9b35` = `0/0/0`. Values are on-hand/reserved/available.
- Preserved M order `49dc89ae-2e30-4f8a-b4e8-3b746c5d70e2` / `TRRY-ORD-8B12C7F9` remains `awaiting_payment`, `UNPAID`, `PENDING`, with its ACTIVE reservation and absolute expiry `2026-09-20 01:59:44.487094+00`. This batch must not readjust its clock or invoke expiry.
- Database creation gate is `false`; Sites creation gate is `false`. Admin Preview contains the expected encrypted Preview-only gate/configuration names. Secret values were not pulled.

### Focused local fix

The deployed database and handler contracts already support all three acceptance flows. One UI retry defect was confirmed: Admin generated a new payment or handover idempotency key for every click, so an uncertain response could not be replayed with the same key. The local Admin source now stores one key per order/action/payload in session storage, reuses it after errors or reloads, rotates it if the payment payload changes, and clears it only after a verified response. This changes no authorization, RPC, schema, layout, or storefront behavior.

Focused verification passed:

- `npm.cmd run test:stlolab-order-action-attempts`
- `npm.cmd run test:stlolab-admin-order-actions`
- `npm.cmd run build`

The first build attempt completed validation but could not replace a generated `dist/404.html` under the restricted filesystem. Re-running the same build with normal workspace write access completed and created `dist`. This was a local filesystem issue, not an application failure.

### Exact proposed acceptance fixtures

Minimum new stock is three units, received through authenticated canonical `trry_api.receive_inventory` only:

| Variant | Quantity | Source reference | Idempotency key |
| --- | ---: | --- | --- |
| Black / L | 2 | `SW3-STAGING-BATCH-L2-RECEIVE-01` | `SW3-BATCH-RECEIVE-L2-01` |
| Black / XL | 1 | `SW3-STAGING-BATCH-XL1-RECEIVE-01` | `SW3-BATCH-RECEIVE-XL1-01` |

Use reason `SW3 remaining acceptance test stock`. Owner/Admin authority is required. Expected receipt movements are L `+2` and XL `+1`, leaving L `2/0/2`, XL `1/0/1`, S `0/0/0`, and M `1/1/0`.

1. Pickup fixture: Black/L x 1, `SHOP_PICKUP`, subtotal PHP 790, fee PHP 0, total PHP 790. Customer `SW3 Pickup Acceptance`, mobile `09170000031`, email `sw3-pickup@example.test`. Checkout idempotency key `SW3-BATCH-PICKUP-L-CREATE-01`. After creation require L `2/1/1`. Owner/Admin then confirms the full PHP 790 using method `cash`, reference `SW3-TEST-PICKUP-PAYMENT-01`, internal note `STAGING ACCEPTANCE FIXTURE - no real funds`, and action key `SW3-BATCH-PICKUP-L-PAY-01`. Only after canonical `PAID` readback, confirm customer pickup with `SW3-BATCH-PICKUP-L-HANDOVER-01`. Expected one L `SALE -1`, reservation `CONSUMED`, and L `1/0/1`.
2. Nationwide COD fixture: Black/XL x 1, `NATIONWIDE_DELIVERY`, subtotal PHP 790, fee PHP 120, total PHP 910. Customer `SW3 Nationwide COD Acceptance`, mobile `09170000032`, email `sw3-cod@example.test`; address line `STAGING TEST - DO NOT SHIP`, barangay `Test Fixture`, city `Cebu City`, province `Cebu`, postal code `6000`, note `SW3 acceptance only; no real parcel`. Checkout key `SW3-BATCH-COD-XL-CREATE-01`. Require XL `1/1/0`, then Owner/Admin confirms courier handover while the order remains `UNPAID` using `SW3-BATCH-COD-XL-HANDOVER-01`. Expected one XL `SALE -1`, reservation `CONSUMED`, XL `0/0/0`, fulfillment `HANDED_OVER`, payment still `UNPAID`. Only after that readback, confirm PHP 910 separately with method `cash`, reference `SW3-TEST-COD-PAYMENT-01`, note `STAGING COD ACCEPTANCE FIXTURE - no real funds`, and `SW3-BATCH-COD-XL-PAY-01`; payment becomes `PAID` with no additional stock movement.
3. Last-L contention fixture: after fixture 1, race one POS Black/L x 1 sale against one storefront Black/L x 1 pickup submission. The POS side uses the existing POS/Sales-authorized Owner session, Main Counter, Main Retail Stock, walk-in customer snapshot `SW3 Contention POS Fixture`, GCash reference `SW3-TEST-CONTENTION-POS-L-01`, exact PHP 790, and operation key `SW3-BATCH-CONTENTION-POS-L-01`. The storefront side uses customer `SW3 Contention Storefront`, mobile `09170000033`, email `sw3-contention@example.test`, checkout key `SW3-BATCH-CONTENTION-STOREFRONT-L-01`, and total PHP 790. Start both final submissions from a shared barrier. Exactly one may commit. If POS wins, require one sale/payment/receipt and one L `SALE -1`, no storefront order, L `0/0/0`. If storefront wins, require one order/reservation, POS rejection for unavailable stock, and interim L `1/1/0`; then confirm its synthetic PHP 790 payment with `SW3-BATCH-CONTENTION-STOREFRONT-L-PAY-01` and pickup with `SW3-BATCH-CONTENTION-STOREFRONT-L-HANDOVER-01`, producing exactly one L `SALE -1` and final L `0/0/0`.

The checkout keys above are non-secret test identifiers. Before each browser submit, place the specified key in the existing `stlolab-checkout-attempt-v2` retry record for the exact checkout fingerprint; do not add a customer-facing override or change checkout code. For each Admin action, pre-seed the same authenticated tab's session record `trry-admin-order-action:<order UUID>:<action>` with the exact key and matching payload fingerprint; actions are `confirm-payment`, `customer-pickup`, and `courier-handover`. The local helper then retains that key across uncertain retries and clears it only after a verified response. If this controlled session setup cannot be verified, stop rather than falling back to per-click keys. Record canonical order, reservation, payment-event, sale, receipt, and movement IDs after each commit. If a response is uncertain, query canonical state before replaying the same key.

Expected successful final balances are S `0/0/0`, M `1/1/0`, L `0/0/0`, XL `0/0/0`. Expected new stock ledger effects are two receipts totaling `+3` and exactly three `SALE -1` movements: pickup L, courier XL, and the single contention winner. Payment confirmations do not move stock. No adjustment, cancellation, expiry, refund, return, sale void, or payment-failure transition belongs to this batch.

## Staging acceptance deployment stopped before stock receipt (2026-09-17)

Owner approval deployed exact Admin commit `a5e2909b755f4150711cc99527fb2308a576d784` to the existing protected `adminportal-staging` Vercel project `prj_K0oDSa6r1MgAEpQMcl3mKVdJvtNI`. Preview deployment `dpl_HygA8vMN1Lprs4xZoKJn2E99CKUq` is READY at `https://adminportal-staging-9wk9a846u-clarkylubguban1.vercel.app`; Vercel metadata reports the exact approved source SHA, branch `codex/stlolab-sw3-checkout`, 12 functions, no alias, and no production target. The existing staging Owner authenticated successfully in that Preview.

Acceptance stopped before the first stock mutation because the deployed Admin Receive Stock path is not staging-capable. `receiveAdminInventoryStock()` calls `assertProductionSupabaseProject()`, which accepts only production ref `wcgtwfctpnwgpglywvvx` and rejects approved staging ref `fszkypwovpdthqfobxrk`. The visible receive form also creates an opaque random key inside `submitInventoryReceive()` and exposes no supported field or controlled session record for the exact approved receipt keys `SW3-BATCH-RECEIVE-L2-01` and `SW3-BATCH-RECEIVE-XL1-01`. No Confirm Receive action was submitted. No raw RPC, token copy, direct SQL write, adjustment, POS mock control, or alternate key was used.

Post-stop canonical readback confirms zero use of the planned checkout and movement keys, database checkout `enabled=false`, and unchanged Main Retail Stock balances: S `0/0/0`, M `1/1/0`, L `0/0/0`, XL `0/0/0`. Preserved order `TRRY-ORD-8B12C7F9` remains untouched. Sites project `appgprj_6a8978ad58bc8191bc74e2fba33f4528` remains at environment revision `15` with `STLO_CHECKOUT_ENABLED=false`, seven-day staging access, staging Supabase, and unchanged secret entries. No Sites publish, gate opening, order, customer, receipt, payment, handover, sale, stock movement, migration, Cron activation, production change, or merge occurred.

Required forward correction is narrowly scoped: permit the canonical Admin receive adapter on the allowlisted staging ref while retaining production support and expose a stable Owner/Admin-entered receipt idempotency key with validation and retry retention. Add focused tests for staging allowlisting, production compatibility, unauthorized denial, exact-key duplicate safety, and unchanged canonical receipt authority. Deploy that forward commit only after owner review, then restart this batch from the immutable baseline above; do not reuse this READY deployment for receipts.

### Exact release and mutation scope for approval

1. Deploy only the new tested Admin commit from this worktree to the existing protected `adminportal-staging` Preview. No migration is required. Keep POS at `70bb10a` and Sites source at `ebae788`.
2. Reverify project IDs, commits, active register/location, open shift, all four balances, zero use of every planned key, and all three closed creation gates. Stop on any discrepancy.
3. Receive only L x 2 and XL x 1 using the two exact receipt keys above. Do not receive S or M.
4. For the shortest possible creation window, point the owner-private Sites checkout/catalog variables at the newly deployed Admin Preview, enable Admin Preview checkout and Sites checkout, publish privately, and enable `public.stlolab_checkout_config` last. Create the pickup and COD fixtures, run their ordered payment/handover transitions, then run the contention race.
5. Close creation in fail-closed order regardless of result: Sites `STLO_CHECKOUT_ENABLED=false` and private republish first; database `enabled=false` second; Admin Preview checkout false with a closed Preview deployment third. Verify every public/private checkout surface reports closed. Old gate-open deployment URLs must not remain a permanent catalog or checkout configuration.
6. Complete only the already-created contention winner as described above. Preserve every audit row. On uncertainty or failure, close gates, inspect state, and stop; do not improvise a refund, return, payment-failure action, stock edit, or compensating sale.

This approval would authorize at most two stock receipts, two guaranteed storefront orders plus one conditional contention storefront order, two guaranteed Admin payments/handovers plus one conditional contention payment/handover, or one POS sale if POS wins. It does not authorize production changes, migrations, Cron activation, changes to the M order, S stock, local-delivery coverage, refunds, returns, payment-failure policy, or unrelated cleanup.
