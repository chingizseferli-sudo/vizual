create table if not exists public.public_site_sections (
  id uuid primary key default gen_random_uuid(),
  section_key text not null unique,
  content jsonb not null default '{}'::jsonb,
  status text not null default 'published' check (status in ('draft', 'published')),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.public_site_sections enable row level security;

drop policy if exists public_site_sections_read_published on public.public_site_sections;
drop policy if exists public_site_sections_admin_manage on public.public_site_sections;

create policy public_site_sections_read_published
on public.public_site_sections
for select
to anon, authenticated
using (status = 'published');

create policy public_site_sections_admin_manage
on public.public_site_sections
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

grant select on public.public_site_sections to anon;
grant select on public.public_site_sections to authenticated;
grant insert, update, delete on public.public_site_sections to authenticated;

insert into public.public_site_sections (section_key, content, status)
values
  ('hero', '{
    "badge": "Communication Intelligence Platform",
    "brand": "Vizual.Az",
    "tagline": "Monitor. Understand. Decide.",
    "description": "Media xəbərlərini, sayt dəyişikliklərini və vacib kommunikasiya siqnallarını bir yerdə izləyin. Vizual.Az komandalar üçün gündəlik monitorinq, bildiriş və hesabat workspace-i yaradır.",
    "primaryCta": "Demo istə",
    "secondaryCta": "İstifadəçi girişinə keç"
  }'::jsonb, 'published'),
  ('services', '{
    "eyebrow": "Xidmətlər",
    "title": "Vizual.Az nə edir?",
    "description": "Platforma media gündəmini, sayt dəyişikliklərini və vacib xəbərdarlıqları bir iş mühitində birləşdirir.",
    "items": [
      {"title": "Media monitorinq", "description": "Açar sözlərinizə uyğun xəbərləri və media materiallarını müxtəlif mənbələrdən tapır, nəticələri workspace-də toplayır.", "icon": "newspaper", "status": "Aktiv"},
      {"title": "Veb dəyişiklik izləmə", "description": "Seçilmiş sayt bölmələrində yeni məlumat, silinmə və real başlıq dəyişikliklərini izləyir.", "icon": "radio", "status": "Aktiv"},
      {"title": "Bildirişlər", "description": "Uyğun nəticə aşkar ediləndə Telegram və gələcək bildiriş kanalları üçün operativ xəbərdarlıq axını yaradır.", "icon": "megaphone", "status": "Aktiv"},
      {"title": "Hesabat və ixrac", "description": "Tapılan nəticələri gün, həftə və ay üzrə süzgəcdən keçirməyə və CSV/HTML formatında paylaşmağa imkan verir.", "icon": "file", "status": "Aktiv"},
      {"title": "Mənbə kəşfi", "description": "Yeni xəbər saytlarını tapmaq, oxuna bilən mənbələri təsdiqləmək və sağlam mənbə bazasını böyütmək üçün hazırlanır.", "icon": "search", "status": "İnkişafda"}
    ]
  }'::jsonb, 'published'),
  ('audiences', '{
    "eyebrow": "Kimlər üçündür?",
    "title": "Kommunikasiya gündəmini izləyən komandalar üçün",
    "items": [
      {"title": "Dövlət qurumları", "description": "Media görünürlüğü, risk siqnalları və gündəlik kommunikasiya nəzarəti."},
      {"title": "Universitetlər", "description": "Elmi, təhsil və qəbul mövzuları üzrə media görünürlüğünü izləmək üçün."},
      {"title": "Banklar", "description": "Reputasiya, bazar xəbərləri və operativ kommunikasiya siqnalları üçün."},
      {"title": "Şirkətlər", "description": "Brend, rəhbərlik, məhsul və sektor xəbərlərini izləmək üçün."},
      {"title": "PR Agentlikləri", "description": "Müştəri portfelləri üzrə gündəlik media nəticələrini toplamaq üçün."},
      {"title": "Media", "description": "Rəqib, mənbə və gündəm axınını sistemli izləmək üçün."}
    ]
  }'::jsonb, 'published'),
  ('demo', '{
    "eyebrow": "Demo",
    "title": "Workspace-i real iş axını kimi görün",
    "description": "Demo workspace media nəticələrinin, bildirişlərin və veb dəyişiklik izləməsinin gündəlik qərar prosesində necə göründüyünü göstərir.",
    "primaryCta": "Demo Workspace",
    "secondaryCta": "Canlı demo istə",
    "placeholderTitle": "Demo təqdimat üçün yer",
    "placeholderDescription": "Burada platformanın qısa videosu, məhsul turu və ya real demo workspace təqdimatı yerləşdirilə bilər.",
    "items": [
      {"title": "Təşkilatınızla bağlı yeni media materialı tapıldı", "source": "azertag.az", "keyword": "təşkilat adı", "time": "09:12"},
      {"title": "Seçilmiş veb səhifədə yeni məlumat əlavə olundu", "source": "rəsmi sayt", "keyword": "veb izləmə", "time": "08:47"},
      {"title": "Vacib uyğunluq üzrə Telegram bildirişi göndərildi", "source": "workspace", "keyword": "bildiriş", "time": "08:21"}
    ]
  }'::jsonb, 'published'),
  ('pricing', '{
    "eyebrow": "Qiymətlər",
    "title": "Başlamaq üçün sadə, böyümək üçün çevik",
    "description": "Planlar monitorinq həcminə, bildiriş ehtiyacına və komanda ölçüsünə görə seçilir.",
    "plans": [
      {"name": "Free", "price": "0 AZN", "description": "Məhsulu tanımaq və ilk monitorinqi sınamaq üçün.", "features": ["Məhdud monitor sayı", "Əsas nəticələr", "Standart tarixçə"]},
      {"name": "Starter", "price": "29 AZN", "description": "Kiçik komanda və gündəlik media izləmə üçün.", "features": ["Daha çox monitor", "Telegram bildirişləri", "CSV ixrac"]},
      {"name": "Professional", "price": "79 AZN", "description": "Qurumlar, şirkətlər və PR komandaları üçün.", "features": ["Geniş monitorinq", "Veb dəyişiklik izləmə", "Prioritet dəstək"]},
      {"name": "Enterprise", "price": "Razılaşma", "description": "Fərdi mənbələr, böyük komanda və xüsusi proseslər üçün.", "features": ["Fərdi limitlər", "Xüsusi onboarding", "Əməliyyat dəstəyi"]}
    ]
  }'::jsonb, 'published'),
  ('campaigns', '{
    "eyebrow": "Kampaniyalar",
    "title": "Yeni funksiyalar və kampaniyalar",
    "description": "Yeni modullar, təqdimat təklifləri və erkən istifadəçi kampaniyaları bu bölmədə elan olunacaq."
  }'::jsonb, 'published'),
  ('blog', '{
    "eyebrow": "Blog",
    "title": "Media, PR, SEO və kommunikasiya",
    "description": "Vizual.Az blogu kommunikasiya komandaları üçün praktik monitorinq və reputasiya mövzularını izah edəcək.",
    "items": [
      "Media monitorinq nə üçün vacibdir?",
      "PR komandaları gündəlik xəbər axınını necə idarə etməlidir?",
      "SEO və kommunikasiya görünürlüğü arasında əlaqə"
    ]
  }'::jsonb, 'published'),
  ('about', '{
    "eyebrow": "Haqqımızda",
    "title": "Vizual.Az kommunikasiya komandaları üçün qurulur",
    "description": "Platformanın məqsədi media görünürlüğünü, vebsayt dəyişikliklərini və vacib kommunikasiya siqnallarını daha aydın izlənən gündəlik iş axınına çevirməkdir.",
    "principles": [
      {"title": "Lokal bazar üçün", "description": "Azərbaycan media və təşkilat reallıqlarına uyğun monitorinq yanaşması."},
      {"title": "Etibarlı əməliyyat", "description": "Public sayt, workspace və admin qatları ayrı saxlanılır."},
      {"title": "Qərar üçün siqnal", "description": "Məqsəd daha çox data yox, daha aydın gündəlik kommunikasiya siqnalıdır."}
    ]
  }'::jsonb, 'published'),
  ('contact', '{
    "eyebrow": "Əlaqə",
    "title": "Komandanız üçün uyğun demo ssenarisini danışaq",
    "description": "Vizual.Az-ı dövlət qurumu, universitet, bank, şirkət və PR agentliyi ehtiyaclarına görə necə istifadə edə biləcəyinizi birlikdə nəzərdən keçirək.",
    "cardTitle": "Demo üçün məlumat",
    "cardDescription": "Hazırda public form aktiv deyil. Demo üçün email ilə əlaqə saxlayın.",
    "email": "info@vizual.az"
  }'::jsonb, 'published')
on conflict (section_key) do nothing;
