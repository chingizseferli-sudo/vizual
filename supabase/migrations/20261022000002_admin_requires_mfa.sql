-- Admin rights need a two-step (TOTP) session. A stolen or guessed admin
-- password alone now gives an aal1 session, which every admin policy and RPC
-- treats as a plain user: is_admin_user() is the single admin check they use.
--
-- Enrolling and verifying the authenticator is Supabase Auth (auth.mfa_*), not
-- an admin action, and the admin sign-in page reads the caller's own
-- admin_users row through admin_users_select_self, which does not call
-- is_admin_user(). So an admin without a factor yet is not locked out: sign-in
-- asks them to enroll. service_role (workers, edge functions) bypasses RLS and
-- never calls these functions.

create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
    and exists (
      select 1
      from public.admin_users admin_user
      where admin_user.user_id = (select auth.uid())
        and admin_user.status = 'active'
        and admin_user.role in ('admin', 'superadmin')
    );
$$;

create or replace function public.is_superadmin_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
    and exists (
      select 1
      from public.admin_users admin_user
      where admin_user.user_id = (select auth.uid())
        and admin_user.status = 'active'
        and admin_user.role = 'superadmin'
    );
$$;

-- Same grants as before (create or replace keeps them; restated for a fresh
-- database built from migrations).
revoke all on function public.is_admin_user() from public, anon;
grant execute on function public.is_admin_user() to authenticated, service_role;
revoke all on function public.is_superadmin_user() from public, anon;
grant execute on function public.is_superadmin_user() to authenticated;
