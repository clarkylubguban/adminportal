revoke execute on function public.is_active_admin_user(text[]) from anon;
revoke execute on function public.is_active_admin_user(text[]) from public;
grant execute on function public.is_active_admin_user(text[]) to authenticated;

drop policy if exists "Allow approved admin read ops inquiries" on public.ops_inquiries;
drop policy if exists "Allow approved admin insert ops inquiries" on public.ops_inquiries;
drop policy if exists "Allow approved admin update ops inquiries" on public.ops_inquiries;
drop policy if exists "Allow approved admin read clients" on public.clients;
drop policy if exists "Allow approved admin read reorder requests" on public.reorder_requests;
drop policy if exists "Allow approved admin read request items" on public.request_items;
drop policy if exists "Allow approved admin read catalog products" on public.catalog_products;
drop policy if exists "Allow approved admin insert catalog products" on public.catalog_products;
drop policy if exists "Allow approved admin update catalog products" on public.catalog_products;;
