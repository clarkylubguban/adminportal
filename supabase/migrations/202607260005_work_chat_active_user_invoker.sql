-- Keep the Work Chat active-admin helper callable by RLS without making it a SECURITY DEFINER RPC.

create or replace function public.work_chat_active_admin_user(p_user_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.admin_users admin_user
    where admin_user.user_id = p_user_id
      and admin_user.is_active = true
      and admin_user.role in ('owner', 'admin', 'staff')
  );
$$;

revoke all on function public.work_chat_active_admin_user(uuid) from public, anon, authenticated, service_role;
grant execute on function public.work_chat_active_admin_user(uuid) to authenticated;