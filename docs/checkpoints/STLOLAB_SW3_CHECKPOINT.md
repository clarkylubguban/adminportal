# STLOLAB SW3 checkout checkpoint

Status: source implementation and disposable-database verification complete; staging migration, configuration, deployment, and live order acceptance are intentionally pending.

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
- Catalog availability remains `unknown` unless the staging checkout gate and a confirmed inventory location are active. Missing balances become sold out, never available.

## Decisions required before any staging order

1. Which fulfillment methods are offered: pickup, delivery, or both.
2. Exact fee for each offered method and any delivery-zone rule. No fee has been assumed.
3. For pickup: the customer-facing label, stable pickup code, and approved pickup instructions/location.
4. The existing staging inventory location that is eligible to fulfill STLOLAB orders. `Main Retail Stock` is not assumed.
5. Inventory timing: validate only, reserve, or deduct; when it occurs; reservation expiry; and cancellation, failed-payment, fulfillment, and return reversals. `DEDUCT_ON_SUBMIT` remains blocked in code pending this decision.

Proposed acceptance-only configuration: create one clearly named staging fulfillment option `SW3_ACCEPTANCE` at PHP 0, select an owner-approved existing staging inventory location containing only documented test stock, and use an owner-approved inventory movement/reversal policy. This is a proposal, not applied configuration.

## Disposable fixtures and effects

- Product: `PRD-260911-8DC1A1`, `Glow N Underground`; fixture variant `STLO-S`, size S, Black, PHP 790.
- Customer: `SW3 Staging Tester`, `09171234567`, `sw3@example.test`.
- Location: `UNCONFIRMED-TEST`; beginning and ending fixture quantity 3.
- Fulfillment fixtures: `TEST-PICKUP` and an incomplete delivery payload used only for rejection testing.
- Containers are removed after each run. Persistent inventory effects: none.
