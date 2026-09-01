-- Forward-only hardening for project-owned functions after the reconciled
-- migration-chain security audit. Historical migrations remain unchanged.

-- Trigger functions are invoked by their owning triggers, not through PostgREST
-- RPC. Remove inherited direct EXECUTE access from web-facing roles while
-- preserving trigger execution.
revoke execute on function public.enforce_ops_inquiry_mvp_workflow() from public, anon, authenticated;
revoke execute on function public.enforce_shop_payment_confirmation_actor() from public, anon, authenticated;
revoke execute on function public.mark_pay_at_shop_selection() from public, anon, authenticated;
revoke execute on function public.prevent_direct_variant_sku_change() from public, anon, authenticated;
revoke execute on function public.prevent_historical_sku_reuse() from public, anon, authenticated;
revoke execute on function public.prevent_inquiry_payment_event_changes() from public, anon, authenticated;
revoke execute on function public.prevent_product_category_cycle() from public, anon, authenticated;
revoke execute on function public.prevent_sku_history_changes() from public, anon, authenticated;
revoke execute on function public.prevent_unsafe_category_archive() from public, anon, authenticated;
revoke execute on function public.record_pay_at_shop_selection() from public, anon, authenticated;
revoke execute on function public.set_catalog_products_updated_at() from public, anon, authenticated;
revoke execute on function public.set_master_catalog_updated_at() from public, anon, authenticated;
revoke execute on function public.validate_product_category_assignment() from public, anon, authenticated;
revoke execute on function public.validate_product_category_contract() from public, anon, authenticated;
revoke execute on function public.validate_product_image_m1_contract() from public, anon, authenticated;
revoke execute on function public.validate_product_m1_contract() from public, anon, authenticated;
revoke execute on function public.validate_variant_m1_contract() from public, anon, authenticated;

-- The admin-policy helper is schema-qualified internally and is required by RLS
-- policies for authenticated Admin/Owner/Staff/Viewer checks.
alter function public.is_active_admin_user(text[]) set search_path = '';

-- This immutable payment helper uses only pg_catalog built-ins. Pinning the
-- search path removes advisor noise without changing payment-gate behavior.
alter function public.trry_payment_gate_satisfied(numeric, text, numeric) set search_path = '';
