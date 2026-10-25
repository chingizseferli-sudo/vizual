-- Biznes: social keywords checked 4 times a day (every 6 hours) on Facebook,
-- Instagram, X and LinkedIn (agreed 25 Oct 2026). Worst case ~366 AZN/month per
-- Biznes customer, ~127 AZN left of 599. YouTube stays once a day (floor 1440)
-- until Google raises the free quota; then lower youtube_min_interval_minutes.

update public.subscription_plans
set limits = coalesce(limits, '{}'::jsonb) || '{"social_interval_minutes": 360}'::jsonb,
    description = case
      when description = 'Razılaşma ilə, 599 AZN-dən. 100 açar söz, Facebook və Instagram gündə 2 dəfə, 5 rəqib, bütün hesabatlar.'
        then 'Razılaşma ilə, 599 AZN-dən. 100 açar söz, Facebook, Instagram, X və LinkedIn gündə 4 dəfə, YouTube, 5 rəqib, bütün hesabatlar.'
      else description
    end,
    updated_at = now()
where code = 'business';

-- Only Biznes has X and LinkedIn, so these floors bind only Biznes.
update public.social_settings
set x_min_interval_minutes = 360,
    linkedin_min_interval_minutes = 360;

-- Public pricing copy, where it still has the 25 Oct text.
update public.public_site_sections
set content = jsonb_set(
      jsonb_set(content, '{plans,3,features,1}', '"Facebook, Instagram, X və LinkedIn: 30 söz, gündə 4 dəfə"'),
      '{plans,3,features,2}', '"YouTube: gündə 1 dəfə"'
    ),
    updated_at = now()
where section_key = 'pricing'
  and content #>> '{plans,3,features,1}' = 'Facebook və Instagram: 30 söz, gündə 2 dəfə'
  and content #>> '{plans,3,features,2}' = 'YouTube, X və LinkedIn: gündə 1 dəfə';
