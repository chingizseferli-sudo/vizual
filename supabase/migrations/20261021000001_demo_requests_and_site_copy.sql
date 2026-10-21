-- 1. Demo requests from the public site.
--    Visitors send them through submit_demo_request() (anon may call it, but
--    may not touch the table). It checks lengths, drops bot submissions that
--    filled the hidden field, and limits floods: 3 requests per email per day,
--    30 in total per hour. Admins read them and mark them handled. The rss
--    worker tells admins on Telegram and stamps notified_at.
-- 2. Published landing copy: the hero tagline was English, the services were
--    long paragraphs and the contact card said the form is not active. Only
--    texts still equal to the seeded ones are replaced, so admin edits stay.

-- 1. Demo requests --------------------------------------------------------------

create table if not exists public.demo_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  company text not null check (char_length(company) between 2 and 160),
  email text not null check (char_length(email) between 5 and 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (phone is null or char_length(phone) between 5 and 40),
  message text check (message is null or char_length(message) <= 2000),
  lang text not null default 'az' check (lang in ('az', 'ru')),
  status text not null default 'new' check (status in ('new', 'handled')),
  notified_at timestamptz,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists demo_requests_created_at_idx on public.demo_requests (created_at desc);
create index if not exists demo_requests_unnotified_idx on public.demo_requests (created_at) where notified_at is null;

alter table public.demo_requests enable row level security;

drop policy if exists demo_requests_admin_select on public.demo_requests;
create policy demo_requests_admin_select on public.demo_requests
  for select to authenticated using (public.is_admin_user());

drop policy if exists demo_requests_admin_update on public.demo_requests;
create policy demo_requests_admin_update on public.demo_requests
  for update to authenticated using (public.is_admin_user()) with check (public.is_admin_user());

revoke all on public.demo_requests from anon, authenticated;
grant select, update (status, handled_at) on public.demo_requests to authenticated;

create or replace function public.submit_demo_request(
  p_name text,
  p_company text,
  p_email text,
  p_phone text default null,
  p_message text default null,
  p_lang text default 'az',
  p_website text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  -- Honeypot: people never see this field, bots fill it. Pretend it worked.
  if nullif(btrim(coalesce(p_website, '')), '') is not null then
    return;
  end if;

  if (select count(*) from public.demo_requests
      where email = v_email and created_at > now() - interval '1 day') >= 3
     or (select count(*) from public.demo_requests
         where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'too_many_requests' using errcode = 'P0001';
  end if;

  insert into public.demo_requests (name, company, email, phone, message, lang)
  values (
    btrim(coalesce(p_name, '')),
    btrim(coalesce(p_company, '')),
    v_email,
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_message, '')), ''),
    case when p_lang = 'ru' then 'ru' else 'az' end
  );
end;
$$;

revoke execute on function public.submit_demo_request(text, text, text, text, text, text, text) from public;
grant execute on function public.submit_demo_request(text, text, text, text, text, text, text) to anon, authenticated;

-- 2. Landing copy ---------------------------------------------------------------

update public.public_site_sections
set content = jsonb_set(content, '{tagline}', '"İzləyin. Anlayın. Qərar verin."'), updated_at = now()
where section_key = 'hero'
  and content ->> 'tagline' = 'Monitor. Understand. Decide.';

update public.public_site_sections
set content = jsonb_set(content, '{items}', $$[
  {"title": "Media monitorinqi", "description": "Açar sözlərinizlə bağlı yerli media xəbərlərini avtomatik toplayır.", "icon": "newspaper", "status": "Aktiv"},
  {"title": "Facebook və Instagram", "description": "Açar sözlərinizlə bağlı paylaşımları izləyir və Telegram-a göndərir.", "icon": "file", "status": "Beta"},
  {"title": "Vebsayt dəyişiklikləri", "description": "Seçdiyiniz səhifədə dəyişiklik olanda sizə xəbər verir.", "icon": "radio", "status": "Aktiv"},
  {"title": "Kommunikasiya analitikası", "description": "Nəticələrin ümumi mənzərəsi və kommunikasiyanın effektivliyi.", "icon": "megaphone", "status": "Tezliklə"},
  {"title": "Qlobal xəbər axını", "description": "Beynəlxalq mənbələrdə seçdiyiniz mövzular üzrə xəbərlər.", "icon": "search", "status": "Tezliklə"}
]$$::jsonb), updated_at = now()
where section_key = 'services'
  and content #>> '{items,0,description}' like 'Təşkilatınız, layihəniz, məhsulunuz və ya seçdiyiniz açar sözlər haqqında yerli media mənbələrində%'
  and content #>> '{items,1,description}' like 'İzləmək istədiyiniz vebsəhifənin müəyyən hissəsini seçin%';

update public.public_site_sections
set content = jsonb_set(content, '{cardDescription}', '"Formu doldurun, komandamız sizinlə əlaqə saxlayacaq."'), updated_at = now()
where section_key = 'contact'
  and content ->> 'cardDescription' like 'Hazırda public form aktiv deyil%';
