# Phase 9B7B Production Database Migration Result

Status: PASS
Completed: 2026-07-31

## Target Verification

- Supabase project name: `trryportalsystem`
- Supabase project ref: `wcgtwfctpnwgpglywvvx`
- Region: `ap-southeast-1`
- Status before migration: `ACTIVE_HEALTHY`
- Database host: `db.wcgtwfctpnwgpglywvvx.supabase.co`
- Confirmed staging ref `fszkypwovpdthqfobxrk` was not targeted.

## Backup And Rollback Checkpoint

- Release checkpoint source: `docs/checkpoints/PHASE_9B7A_PRODUCTION_PRE_RELEASE_CHECKPOINT.md`
- Fresh production preflight snapshot timestamp: `2026-07-31 07:21:31 UTC`
- Rollback rehearsal source: `scripts/run-production-migration-rehearsal.ps1`
- Previous shop-payment function source: `supabase/migrations/202607290008_pay_at_shop_admin_workflow.sql`
- No production backup identifier was exposed through the available tools. The checkpoint used for this approved additive/function-replacement migration set was the Phase 9B7A checkpoint plus the fresh read-only preflight snapshot.

## Preflight Snapshot

- Current database: `postgres`
- Current user: `postgres`
- `inquiry_payment_events` table existed: yes
- `inquiries.expected_version` existed: no
- `inquiry_payment_events.review_note` existed: no
- `review_online_payment` RPC existed: no
- Duplicate inquiry payment idempotency groups: `0`

### Existing Function Before Migration

- Function: `confirm_inquiry_shop_payment`
- Signature: `p_inquiry_id text, p_amount numeric, p_payment_method text, p_internal_note text, p_idempotency_key text`
- Return type: `jsonb`
- Body MD5: `1fa73214f7eb5f939b696ca4b8ff3c82`

### Preflight Record Counts

- Inquiries: `23`
- Inquiries with payment status: `21`
- Payment workflow status count: `3`
- Payment event count: `4`
- Events with idempotency key: `2`

Payment status distribution:

| payment_status | count |
| --- | ---: |
| `(null)` | 2 |
| `full_payment_confirmed` | 2 |
| `not_required` | 14 |
| `pay_at_shop` | 1 |
| `required` | 4 |

## Migration Execution

Applied to production project `wcgtwfctpnwgpglywvvx` in this exact order:

1. `supabase/migrations/202607300009_online_payment_review.sql` as `online_payment_review`: success
2. `supabase/migrations/202607300010_online_payment_review_stale_version_fix.sql` as `online_payment_review_stale_version_fix`: success
3. `supabase/migrations/202607310001_allow_admin_down_payment_confirmations.sql` as `allow_admin_down_payment_confirmations`: success

Migration history after execution:

| version | name |
| --- | --- |
| `20260730012857` | `pay_at_shop_admin_workflow` |
| `20260731072322` | `online_payment_review` |
| `20260731072334` | `online_payment_review_stale_version_fix` |
| `20260731072520` | `allow_admin_down_payment_confirmations` |

## Post-Migration Verification

### Columns

| table | column | type | nullable |
| --- | --- | --- | --- |
| `inquiries` | `expected_version` | `timestamp with time zone` | yes |
| `inquiry_payment_events` | `review_note` | `text` | yes |

### RPCs

| function | signature | return type | body_md5 |
| --- | --- | --- | --- |
| `confirm_inquiry_shop_payment` | `p_inquiry_id text, p_amount numeric, p_payment_method text, p_internal_note text, p_idempotency_key text` | `jsonb` | `e36462d34d474851bedef74ba033b45e` |
| `review_online_payment` | `p_inquiry_id text, p_action text, p_verified_amount numeric, p_review_note text, p_internal_note text, p_expected_updated_at timestamp with time zone, p_idempotency_key text` | `jsonb` | `d17011e9511eb6b08fb653b34978565f` |

### Function Grants

| function | authenticated execute | anon execute |
| --- | --- | --- |
| `confirm_inquiry_shop_payment` | yes | no |
| `review_online_payment` | yes | no |

### Payment Event Constraints

- `inquiry_payment_events_actor_role_check`
- `inquiry_payment_events_actor_user_id_fkey`
- `inquiry_payment_events_amount_check`
- `inquiry_payment_events_event_type_check`
- `inquiry_payment_events_idempotency_length_check`
- `inquiry_payment_events_inquiry_id_fkey`
- `inquiry_payment_events_method_check`
- `inquiry_payment_events_note_length_check`
- `inquiry_payment_events_pkey`
- `inquiry_payment_events_review_note_length_check`
- `inquiry_payment_events_source_check`

The `event_type` check includes:

- `PAY_AT_SHOP_SELECTED`
- `SHOP_PAYMENT_CONFIRMED`
- `ONLINE_PAYMENT_REVIEW_STARTED`
- `ONLINE_PAYMENT_CONFIRMED`
- `ONLINE_PAYMENT_CORRECTION_REQUESTED`

### Policies, Grants, And Triggers

- RLS policy: `inquiry_payment_events_active_portal_read`
- Policy command: `SELECT`
- Policy roles: `{authenticated}`
- Policy check: `is_active_admin_user(ARRAY['owner'::text, 'admin'::text, 'staff'::text])`
- Table grant: `authenticated SELECT`
- Append-only trigger: `inquiry_payment_events_append_only` before `UPDATE`
- Append-only trigger: `inquiry_payment_events_append_only` before `DELETE`
- Trigger function: `prevent_inquiry_payment_event_changes()`

## Record Preservation

All aggregate counts remained unchanged after migration.

| metric | before | after |
| --- | ---: | ---: |
| Inquiries | 23 | 23 |
| Inquiries with payment status | 21 | 21 |
| Payment workflow status count | 3 | 3 |
| Payment event count | 4 | 4 |
| Events with idempotency key | 2 | 2 |
| Duplicate inquiry payment idempotency groups | 0 | 0 |

Payment status distribution remained unchanged:

| payment_status | before | after |
| --- | ---: | ---: |
| `(null)` | 2 | 2 |
| `full_payment_confirmed` | 2 | 2 |
| `not_required` | 14 | 14 |
| `pay_at_shop` | 1 | 1 |
| `required` | 4 | 4 |

## Anomalies

- No migration execution errors.
- No record-count drift.
- No duplicate idempotency groups.
- No production payment test was created.
- No customer records were manually modified.
- Post-DDL advisory calls were attempted as read-only checks, but the output exceeded the available context and was not reviewed as part of the release decision.

## Scope Confirmation

- Production database migrations were applied only to `wcgtwfctpnwgpglywvvx`.
- No Admin app deployment was performed.
- No Vercel environment variables were changed.
- No domains or aliases were changed.
- No production payment test was run.
- No staging fixtures were deleted.
- Production Admin deployment remains unchanged at the deployment checkpoint provided for Phase 9B7B.
