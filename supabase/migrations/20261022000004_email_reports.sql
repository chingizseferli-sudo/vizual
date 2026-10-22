-- Daily, weekly and monthly email reports, sent by the rss worker over SMTP.
--
-- 1. Plans say which reports they include: limits.report_frequencies, a subset
--    of ["daily","weekly","monthly"]. Existing plans get the agreed defaults
--    unless an admin already set the key.
-- 2. Customers can switch off a report their plan includes:
--    user_profiles.email_report_opt_out.
-- 3. email_report_deliveries: one row per customer, report kind and period, so
--    a worker restart never sends the same report twice. Admins can read it.
-- 4. Service-role functions the worker calls: recipients, report data, claim.

update public.subscription_plans
set limits = coalesce(limits, '{}'::jsonb) || jsonb_build_object(
      'report_frequencies',
      case code
        when 'free' then '["weekly"]'::jsonb
        when 'pro' then '["daily","weekly"]'::jsonb
        when 'business' then '["daily","weekly","monthly"]'::jsonb
        when 'enterprise' then '["daily","weekly","monthly"]'::jsonb
        else '[]'::jsonb
      end
    ),
    updated_at = now()
where not (coalesce(limits, '{}'::jsonb) ? 'report_frequencies');

alter table public.user_profiles
  add column if not exists email_report_opt_out text[] not null default '{}';

alter table public.user_profiles
  drop constraint if exists user_profiles_email_report_opt_out_check;
alter table public.user_profiles
  add constraint user_profiles_email_report_opt_out_check
  check (email_report_opt_out <@ array['daily', 'weekly', 'monthly']::text[]);

create table if not exists public.email_report_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('daily', 'weekly', 'monthly')),
  period_start date not null,
  period_end date not null,
  recipient text,
  status text not null default 'sending' check (status in ('sending', 'sent', 'skipped', 'failed')),
  mention_count integer,
  attempts integer not null default 1,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, period_start)
);

create index if not exists email_report_deliveries_created_idx
  on public.email_report_deliveries (created_at desc);

alter table public.email_report_deliveries enable row level security;

revoke all on public.email_report_deliveries from anon, authenticated;
grant select on public.email_report_deliveries to authenticated;
grant all on public.email_report_deliveries to service_role;

drop policy if exists email_report_deliveries_admin_read on public.email_report_deliveries;
create policy email_report_deliveries_admin_read
  on public.email_report_deliveries
  for select
  to authenticated
  using (public.is_admin_user());

-- Customers still owed the report for this period: active account, the plan
-- includes it, not switched off, at least one active keyword, and no delivery
-- row yet (or a failed one that may be retried).
create or replace function public.email_report_recipients(
  p_kind text,
  p_period_start date,
  p_limit integer default 50
)
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.user_id, auth_user.email::text
  from public.user_profiles profile
  join auth.users auth_user on auth_user.id = profile.user_id
  join public.subscription_plans plan on plan.id = coalesce(
    profile.plan_id,
    (select free_plan.id from public.subscription_plans free_plan where free_plan.code = 'free' limit 1)
  )
  where profile.status = 'active'
    and coalesce(auth_user.email, '') <> ''
    and coalesce(plan.limits -> 'report_frequencies', '[]'::jsonb) ? p_kind
    and not (p_kind = any(profile.email_report_opt_out))
    and exists (
      select 1
      from public.monitor_keywords keyword
      join public.user_monitors monitor on monitor.id = keyword.monitor_id
      where monitor.user_id = profile.user_id
        and monitor.status <> 'archived'
        and coalesce(keyword.status, 'active') = 'active'
    )
    and not exists (
      select 1
      from public.email_report_deliveries delivery
      where delivery.user_id = profile.user_id
        and delivery.kind = p_kind
        and delivery.period_start = p_period_start
        and not (delivery.status = 'failed' and delivery.attempts < 3)
    )
  order by profile.user_id
  limit greatest(coalesce(p_limit, 50), 0);
$$;

-- What one report shows. Mentions are distinct articles matched in
-- [p_from, p_to); p_prev_from null means no comparison (data already deleted).
create or replace function public.email_report_data(
  p_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_prev_from timestamptz default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select distinct on (item.id)
      item.id,
      item.title,
      item.url,
      coalesce(item.published_at, item.created_at, match.created_at) as seen_at,
      match.matched_keyword as keyword,
      coalesce(nullif(source.name, ''), '-') as source_name
    from public.monitor_matches match
    join public.user_monitors monitor on monitor.id = match.monitor_id
    join public.monitored_items item on item.id = match.item_id
    left join public.sources source on source.id = item.source_id
    where monitor.user_id = p_user_id
      and match.created_at >= p_from
      and match.created_at < p_to
    order by item.id, match.created_at
  ),
  active_keywords as (
    select distinct keyword.keyword
    from public.monitor_keywords keyword
    join public.user_monitors monitor on monitor.id = keyword.monitor_id
    where monitor.user_id = p_user_id
      and monitor.status <> 'archived'
      and coalesce(keyword.status, 'active') = 'active'
  ),
  keyword_counts as (
    select coalesce(counted.keyword, active_keywords.keyword) as keyword,
           coalesce(counted.mentions, 0) as mentions
    from (select keyword, count(*)::integer as mentions from mine where keyword is not null group by keyword) counted
    full join active_keywords on lower(active_keywords.keyword) = lower(counted.keyword)
  )
  select jsonb_build_object(
    'total', (select count(*)::integer from mine),
    'previous_total', case when p_prev_from is null then null else (
      select count(distinct match.item_id)::integer
      from public.monitor_matches match
      join public.user_monitors monitor on monitor.id = match.monitor_id
      where monitor.user_id = p_user_id
        and match.created_at >= p_prev_from
        and match.created_at < p_from
    ) end,
    'keywords', coalesce((
      select jsonb_agg(jsonb_build_object('keyword', keyword, 'mentions', mentions) order by mentions desc, keyword)
      from (select * from keyword_counts order by mentions desc, keyword limit 30) top_keywords
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('source', source_name, 'mentions', mentions) order by mentions desc, source_name)
      from (
        select source_name, count(*)::integer as mentions
        from mine group by source_name order by mentions desc, source_name limit 5
      ) top_sources
    ), '[]'::jsonb),
    'headlines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', title, 'url', url, 'source', source_name, 'keyword', keyword, 'seen_at', seen_at
      ) order by seen_at desc)
      from (select * from mine order by seen_at desc limit 10) latest
    ), '[]'::jsonb)
  );
$$;

-- Reserve one report before sending it. Returns the delivery id, or null when
-- it was already sent, skipped, is being sent, or failed three times.
create or replace function public.claim_email_report(
  p_user_id uuid,
  p_kind text,
  p_period_start date,
  p_period_end date,
  p_recipient text
)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.email_report_deliveries as delivery
    (user_id, kind, period_start, period_end, recipient)
  values (p_user_id, p_kind, p_period_start, p_period_end, p_recipient)
  on conflict (user_id, kind, period_start) do update
    set status = 'sending',
        attempts = delivery.attempts + 1,
        recipient = excluded.recipient,
        error = null,
        updated_at = now()
    where delivery.status = 'failed' and delivery.attempts < 3
  returning delivery.id;
$$;

revoke all on function public.email_report_recipients(text, date, integer) from public, anon, authenticated;
revoke all on function public.email_report_data(uuid, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_email_report(uuid, text, date, date, text) from public, anon, authenticated;
grant execute on function public.email_report_recipients(text, date, integer) to service_role;
grant execute on function public.email_report_data(uuid, timestamptz, timestamptz, timestamptz) to service_role;
grant execute on function public.claim_email_report(uuid, text, date, date, text) to service_role;
