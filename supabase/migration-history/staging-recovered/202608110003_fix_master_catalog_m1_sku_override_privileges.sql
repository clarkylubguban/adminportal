-- Master Catalog M1.1 security remediation for SKU override RPC privileges.

DO $$
BEGIN
  IF to_regprocedure('public.override_product_variant_sku(uuid,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'MISSING_FUNCTION: public.override_product_variant_sku(uuid,text,text,text)';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.override_product_variant_sku(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.override_product_variant_sku(uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.override_product_variant_sku(uuid, text, text, text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.override_product_variant_sku(uuid, text, text, text) TO authenticated;;
