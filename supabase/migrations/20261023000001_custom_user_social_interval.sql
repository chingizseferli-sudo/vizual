-- A per-customer Facebook/Instagram interval ("Fərdi təklif") can be any number
-- of minutes the admin types, not only the 1/2/3/6/12/24 hour presets. The
-- social collector wakes every 5 minutes, so 10 minutes is the real minimum;
-- 7 days is the maximum. Plan intervals keep their presets.

alter table public.user_profiles
  drop constraint if exists user_profiles_social_interval_check,
  add constraint user_profiles_social_interval_check
    check (social_interval_minutes is null or social_interval_minutes between 10 and 10080);
