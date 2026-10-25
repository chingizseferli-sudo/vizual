-- Final plan table agreed on 25 Oct 2026.
-- 1. Networks per plan (limits.social_platforms):
--    Demo and Pro: Facebook + Instagram; Başlanğıc: none;
--    Biznes: Facebook, Instagram, YouTube, X, LinkedIn.
-- 2. YouTube, X and LinkedIn are searched once a day (floor 1440 min), so the
--    YouTube free quota covers ~3 Biznes customers and X/LinkedIn cost stays low.
--    An admin custom offer still goes below the floor.
-- 3. Public pricing copy lists the Biznes networks where it still has the old text.

-- 1. Plans -------------------------------------------------------------------
update public.subscription_plans
set limits = coalesce(limits, '{}'::jsonb) || '{"social_platforms": ["facebook", "instagram"]}'::jsonb,
    updated_at = now()
where code in ('demo', 'pro');

update public.subscription_plans
set limits = coalesce(limits, '{}'::jsonb) || '{"social_platforms": []}'::jsonb,
    updated_at = now()
where code = 'free';

update public.subscription_plans
set limits = coalesce(limits, '{}'::jsonb)
      || '{"social_platforms": ["facebook", "instagram", "youtube", "x", "linkedin"]}'::jsonb,
    updated_at = now()
where code = 'business';

-- 2. Once-a-day floors ---------------------------------------------------------
update public.social_settings
set youtube_min_interval_minutes = 1440,
    x_min_interval_minutes = 1440,
    linkedin_min_interval_minutes = 1440;

-- 3. Public pricing copy -------------------------------------------------------
update public.public_site_sections
set content = jsonb_insert(
      content,
      '{plans,3,features,2}',
      '"YouTube, X və LinkedIn: gündə 1 dəfə"'::jsonb
    ),
    updated_at = now()
where section_key = 'pricing'
  and content #>> '{plans,3,name}' = 'Biznes'
  and content #>> '{plans,3,features,1}' = 'Facebook və Instagram: 30 söz, gündə 2 dəfə'
  and not (content #> '{plans,3,features}') ? 'YouTube, X və LinkedIn: gündə 1 dəfə';
