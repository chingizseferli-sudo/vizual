-- Release hardening: keep profile-plan helper view behind caller permissions.
-- The view is useful for joining user profile and plan limits, but it must not be
-- exposed as an unrestricted public read surface.

alter view if exists public.user_profile_with_plan_limits
  set (security_invoker = true);

revoke all on public.user_profile_with_plan_limits from anon;
revoke all on public.user_profile_with_plan_limits from public;
revoke all on public.user_profile_with_plan_limits from authenticated;
grant select on public.user_profile_with_plan_limits to authenticated;
