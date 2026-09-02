-- Customer C1 staging reconciliation.
-- Repairs environments where the original C1 migration was recorded before the
-- audit-user spoofing fix was applied to set_customer_identity_audit_users().

create or replace function public.set_customer_identity_audit_users()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_user_id uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if v_actor_user_id is not null then
      new.created_by_user_id := v_actor_user_id;
    end if;
  end if;

  if v_actor_user_id is not null then
    new.updated_by_user_id := v_actor_user_id;
  end if;

  return new;
end;
$$;
