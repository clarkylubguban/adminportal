-- Restore task-domain feature flag visibility for caller-scoped Task APIs.
--
-- OS baseline hardening removed authenticated execute from this helper, but
-- task read RLS policies and API feature checks intentionally evaluate it as
-- the signed-in portal user.

do $$
begin
  if to_regprocedure('public.task_domain_enabled()') is not null then
    grant execute on function public.task_domain_enabled() to authenticated;
  end if;
end;
$$;
