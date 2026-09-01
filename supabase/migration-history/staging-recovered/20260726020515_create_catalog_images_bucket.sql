insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'catalog-images',
  'catalog-images',
  true,
  5242880,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can read catalog images" on storage.objects;
create policy "Public can read catalog images"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'catalog-images');

drop policy if exists "Admin and staff can upload catalog images" on storage.objects;
create policy "Admin and staff can upload catalog images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'catalog-images'
  and exists (
    select 1
    from public.admin_users
    where admin_users.user_id = (select auth.uid())
      and admin_users.role in ('admin', 'staff')
  )
);

drop policy if exists "Admin and staff can update catalog images" on storage.objects;
create policy "Admin and staff can update catalog images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'catalog-images'
  and exists (
    select 1
    from public.admin_users
    where admin_users.user_id = (select auth.uid())
      and admin_users.role in ('admin', 'staff')
  )
)
with check (
  bucket_id = 'catalog-images'
  and exists (
    select 1
    from public.admin_users
    where admin_users.user_id = (select auth.uid())
      and admin_users.role in ('admin', 'staff')
  )
);

drop policy if exists "Admin and staff can delete catalog images" on storage.objects;
create policy "Admin and staff can delete catalog images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'catalog-images'
  and exists (
    select 1
    from public.admin_users
    where admin_users.user_id = (select auth.uid())
      and admin_users.role in ('admin', 'staff')
  )
);;
