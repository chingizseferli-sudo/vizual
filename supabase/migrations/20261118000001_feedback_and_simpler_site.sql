-- 1. "Suggestions and complaints" from the public site.
--    Visitors send them through submit_feedback() (anon may call it, but may
--    not touch the table), the same way as demo requests: lengths are checked,
--    bot submissions that fill the hidden field are dropped, floods are
--    limited (5 per email per day, 30 in total per hour). Admins read them and mark them handled; the rss
--    worker tells admins on Telegram and stamps notified_at.
-- 2. The site has an English version, so demo requests and feedback accept
--    lang 'en'.
-- 3. Shorter landing, about and contact copy. Each text changes only while it
--    still equals the seeded one, so edits made in the admin panel stay.

-- 1. Feedback ------------------------------------------------------------------

create table if not exists public.feedback_messages (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'suggestion' check (kind in ('suggestion', 'complaint')),
  name text check (name is null or char_length(name) between 1 and 120),
  email text check (email is null or (char_length(email) between 5 and 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  message text not null check (char_length(message) between 5 and 2000),
  page text check (page is null or char_length(page) <= 200),
  lang text not null default 'az' check (lang in ('az', 'ru', 'en')),
  status text not null default 'new' check (status in ('new', 'handled')),
  notified_at timestamptz,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists feedback_messages_created_at_idx on public.feedback_messages (created_at desc);
create index if not exists feedback_messages_unnotified_idx on public.feedback_messages (created_at) where notified_at is null;

alter table public.feedback_messages enable row level security;

drop policy if exists feedback_messages_admin_select on public.feedback_messages;
create policy feedback_messages_admin_select on public.feedback_messages
  for select to authenticated using (public.is_admin_user());

drop policy if exists feedback_messages_admin_update on public.feedback_messages;
create policy feedback_messages_admin_update on public.feedback_messages
  for update to authenticated using (public.is_admin_user()) with check (public.is_admin_user());

revoke all on public.feedback_messages from anon, authenticated;
grant select, update (status, handled_at) on public.feedback_messages to authenticated;

create or replace function public.submit_feedback(
  p_message text,
  p_kind text default 'suggestion',
  p_name text default null,
  p_email text default null,
  p_page text default null,
  p_lang text default 'az',
  p_website text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  -- Honeypot: people never see this field, bots fill it. Pretend it worked.
  if nullif(btrim(coalesce(p_website, '')), '') is not null then
    return;
  end if;

  if (v_email is not null and (select count(*) from public.feedback_messages
        where email = v_email and created_at > now() - interval '1 day') >= 5)
     or (select count(*) from public.feedback_messages
         where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'too_many_requests' using errcode = 'P0001';
  end if;

  insert into public.feedback_messages (kind, name, email, message, page, lang)
  values (
    case when p_kind = 'complaint' then 'complaint' else 'suggestion' end,
    nullif(btrim(coalesce(p_name, '')), ''),
    v_email,
    btrim(coalesce(p_message, '')),
    left(nullif(btrim(coalesce(p_page, '')), ''), 200),
    case when p_lang in ('ru', 'en') then p_lang else 'az' end
  );
end;
$$;

revoke execute on function public.submit_feedback(text, text, text, text, text, text, text) from public;
grant execute on function public.submit_feedback(text, text, text, text, text, text, text) to anon, authenticated;

-- 2. English demo requests -----------------------------------------------------

alter table public.demo_requests drop constraint if exists demo_requests_lang_check;
alter table public.demo_requests add constraint demo_requests_lang_check check (lang in ('az', 'ru', 'en'));

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
    case when p_lang in ('ru', 'en') then p_lang else 'az' end
  );
end;
$$;

-- 3. Shorter site copy ---------------------------------------------------------

update public.public_site_sections
set content = jsonb_set(content, '{description}', '"280-dən çox xəbər saytını və sosial şəbəkələri sizin yerinizə izləyirik. Açar sözünüz harada çıxsa, linki dərhal Telegram-a göndəririk."'), updated_at = now()
where section_key = 'hero'
  and content ->> 'description' = 'Vizual 280-dən çox Azərbaycan xəbər saytını hər 15 dəqiqədən bir, Facebook və Instagram-ı isə planınıza görə yoxlayır. Açar sözünüz harada çıxsa, linki Telegram-a göndəririk. Səhər mətbuat icmalını əl ilə yığmağa ehtiyac qalmır.';

update public.public_site_sections
set content = content
    || jsonb_build_object('description', '')
    || jsonb_build_object('items', $$[
      {"title": "Xəbər saytları", "description": "280-dən çox yerli sayt hər 15 dəqiqədən bir yoxlanılır.", "icon": "newspaper", "status": "Aktiv"},
      {"title": "Sosial şəbəkələr", "description": "Facebook, Instagram, YouTube, X, LinkedIn və Telegram kanalları.", "icon": "file", "status": "Aktiv"},
      {"title": "Rəqib analizi", "description": "Rəqiblər haqqında xəbərlər və onların müsbət, neytral, mənfi tonu.", "icon": "megaphone", "status": "Aktiv"},
      {"title": "Email hesabatları", "description": "Gündəlik, həftəlik və aylıq xülasə email-inizə gəlir.", "icon": "search", "status": "Aktiv"}
    ]$$::jsonb),
    updated_at = now()
where section_key = 'services'
  and content #>> '{items,0,title}' = 'Media monitorinqi'
  and content #>> '{items,1,title}' = 'Facebook və Instagram';

update public.public_site_sections
set content = jsonb_set(content, '{items}', $$[
      {"title": "Universitetin mətbuat xidməti", "description": "Hər səhər 20 saytı açmaq lazım deyil: universitet haqqında çıxan hər xəbər Telegram-a gəlir."},
      {"title": "Bankın PR komandası", "description": "Facebook-da müştəri şikayəti çıxanda bildiriş gəlir, cavab eyni gün verilir."},
      {"title": "PR agentliyi", "description": "Hər müştəri ayrıca açar sözdür, kampaniya nəticələri bir kliklə ixrac olunur."}
    ]$$::jsonb), updated_at = now()
where section_key = 'audiences'
  and content #>> '{items,0,description}' = 'Əvvəl hər səhər 20 saytı açıb universitetin adını axtarırdılar. İndi axşamdan bəri çıxan hər xəbər Telegram-dadır, həftəlik hesabat isə emailə gəlir.';

update public.public_site_sections
set content = content
    || jsonb_build_object('title', 'Vizual.Az nədir?')
    || jsonb_build_object('description', 'Vizual Azərbaycanda hazırlanmış media monitorinq xidmətidir. Təşkilatınızın, rəhbərlərinizin və rəqiblərinizin adı xəbər saytlarında və sosial şəbəkələrdə çıxanda sizə ilk xəbər verən biz oluruq.')
    || jsonb_build_object('principles', $$[
      {"title": "Yerli bazar üçün", "description": "Azərbaycan dilinin xüsusiyyətlərini (İ/ı, şəkilçilər) və yerli saytları yaxşı tanıyırıq."},
      {"title": "Vaxtında xəbər", "description": "Xəbər tapılan kimi Telegram-a gəlir, səhər icmalını gözləmirsiniz."},
      {"title": "Az, amma vacib", "description": "Hər şeyi yox, yalnız sizin açar sözlərinizə uyğun olanı göstəririk."}
    ]$$::jsonb),
    updated_at = now()
where section_key = 'about'
  and content ->> 'title' = 'Vizual.Az nədir və nə üçün lazımdır?';

update public.public_site_sections
set content = content
    || jsonb_build_object('title', 'Bizimlə əlaqə saxlayın')
    || jsonb_build_object('description', 'Sınaq, əməkdaşlıq və ya sual üçün bizə yazın və ya zəng edin.'),
    updated_at = now()
where section_key = 'contact'
  and content ->> 'title' in ('Demo, əməkdaşlıq və dəstək üçün əlaqə saxlayın', 'Sınaq, əməkdaşlıq və dəstək üçün əlaqə saxlayın')
  and content ->> 'description' = 'Vizual.Az-ı komandanızın media monitorinqi, sosial şəbəkə izləmə və bildiriş ehtiyaclarına görə necə istifadə edə biləcəyinizi birlikdə nəzərdən keçirək.';
