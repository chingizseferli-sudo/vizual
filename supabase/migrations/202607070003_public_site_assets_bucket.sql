insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'public-site-assets',
  'public-site-assets',
  true,
  2097152,
  array['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can read public site assets" on storage.objects;
create policy "Public can read public site assets"
on storage.objects
for select
using (bucket_id = 'public-site-assets');

drop policy if exists "Admins can upload public site assets" on storage.objects;
create policy "Admins can upload public site assets"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'public-site-assets'
  and exists (
    select 1
    from public.user_profiles
    where id = auth.uid()
      and role in ('admin', 'superadmin')
  )
);

drop policy if exists "Admins can update public site assets" on storage.objects;
create policy "Admins can update public site assets"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'public-site-assets'
  and exists (
    select 1
    from public.user_profiles
    where id = auth.uid()
      and role in ('admin', 'superadmin')
  )
)
with check (
  bucket_id = 'public-site-assets'
  and exists (
    select 1
    from public.user_profiles
    where id = auth.uid()
      and role in ('admin', 'superadmin')
  )
);

drop policy if exists "Admins can delete public site assets" on storage.objects;
create policy "Admins can delete public site assets"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'public-site-assets'
  and exists (
    select 1
    from public.user_profiles
    where id = auth.uid()
      and role in ('admin', 'superadmin')
  )
);
