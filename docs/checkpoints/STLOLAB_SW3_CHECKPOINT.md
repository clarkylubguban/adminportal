# STLOLAB SW3 checkout checkpoint

Status: source implementation and disposable-database verification complete; staging migration, fulfillment configuration, deployment, and live order acceptance are intentionally pending.

## Source boundary

- Admin baseline: `c4a1ed4a90d8a99396010254ba470f14b4d51755` on `codex/stlolab-sw3-checkout`.
- Storefront baseline: `eb18c8de518efa517d6d27db344694b83a93c477` on `codex/stlolab-sw3-checkout`.
- Direct retail orders extend canonical `public.orders`; they do not fabricate `ops_inquiries` or create a parallel order authority.
- Customer identity remains `public.customers`, matched atomically by normalized mobile with `STLO_WEB` as the first source for a new identity.
- Checkout RPCs are executable by `service_role` only. `anon` and `authenticated` retain no checkout/customer lookup privilege.
- Admin authentication remains unchanged. Storefront-to-Admin checkout also requires a separate server-only gateway secret.
- No migration or test fixture was applied to staging or production. Ordering defaults off.

## Implemented

- Canonical variant lines, accepted PHP unit prices, subtotal, fulfillment fee, total, customer snapshot, fulfillment snapshot, source channel, and token hash are durable.
- Product/channel/readiness/variant/price and known stock are revalidated inside the atomic order transaction.
- Idempotency is keyed by environment and client request key; replay requires the same payload hash.
- Confirmation lookup requires both order UUID and a high-entropy token hash.
- Bag state and checkout draft are session-persisted. Variant edits, quantity changes, removal, totals, pickup/delivery validation, and saved confirmation rendering are implemented.
- Owner decision recorded: use the existing `Main Retail Stock` location, reserve atomically on order submit, and release on cancellation.
- Active reservations are durable and idempotent, and `inventory_balances.reserved_quantity` is changed under the same balance lock as checkout, cancellation, and stock movements.
- Catalog and Admin sellable quantities are `quantity_on_hand - reserved_quantity`. Missing balances become sold out, never available.
- The canonical `private.m2b_apply_stock_movement` primitive rejects POS or other negative stock movements that would consume active reservations.
- Repeated cancellation is idempotent and cannot release a reservation twice. Direct status cancellation is blocked while a reservation remains active.

## Decisions required before any staging order

1. Which fulfillment methods are offered: pickup, delivery, or both.
2. Exact fee for each offered method and any delivery-zone rule. No fee has been assumed.
3. For pickup: the customer-facing label, stable pickup code, and approved pickup instructions/location.
4. Reservation expiry behavior, if any.
5. Payment-failure handling, fulfillment-time stock deduction, and return movements.

Proposed acceptance-only configuration: create one clearly named staging fulfillment option `SW3_ACCEPTANCE` at PHP 0 and place documented test stock in the existing staging `Main Retail Stock` location. Checkout reserves on submit; cancellation releases. This is a proposal, not applied configuration.

## Disposable fixtures and effects

- Product: `PRD-260911-8DC1A1`, `Glow N Underground`; fixture variant `STLO-S`, size S, Black, PHP 790.
- Customer: `SW3 Staging Tester`, `09171234567`, `sw3@example.test`.
- Location: disposable `MAIN-RETAIL` / `Main Retail Stock`; on-hand quantity is unchanged by reservation/cancellation tests.
- Fulfillment fixtures: `TEST-PICKUP` and an incomplete delivery payload used only for rejection testing.
- Last-item races allow exactly one order; duplicate submits create one reservation; POS cannot consume reserved stock; repeated cancellation releases once.
- Containers are removed after each run. Persistent inventory effects: none.

## POS audit boundary

The accepted repository intentionally excludes the full POS checkout engine. Its tracked stock authority is the shared `private.m2b_apply_stock_movement` primitive and wrappers. That primitive and `v_inventory_sellable` now enforce reservations. A separately deployed POS engine that bypasses this canonical primitive cannot be proven from this worktree and must be identified before staging acceptance.
