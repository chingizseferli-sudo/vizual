-- Authorize public asset writes through the canonical admin check.
-- The original policies compared auth.uid() with user_profiles.id, while
-- profiles are keyed by user_id and admin authorization now lives elsewhere.

drop policy if exists "Admins can upload public site assets" on storage.objects;
create policy "Admins can upload public site assets"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'public-site-assets'
  and public.is_admin_user()
);

drop policy if exists "Admins can update public site assets" on storage.objects;
create policy "Admins can update public site assets"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'public-site-assets'
  and public.is_admin_user()
)
with check (
  bucket_id = 'public-site-assets'
  and public.is_admin_user()
);

drop policy if exists "Admins can delete public site assets" on storage.objects;
create policy "Admins can delete public site assets"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'public-site-assets'
  and public.is_admin_user()
);
