-- The landing page drops its slogan-style hero, the six icon cards for
-- audiences and the placeholder "your organisation" alerts for concrete,
-- plain copy. Each text changes only while it still equals the seeded one,
-- so edits made in the admin panel stay. The hero brand field and the
-- campaigns section are no longer shown anywhere and are removed.

update public.public_site_sections
set content = jsonb_set(content, '{badge}', '"Azərbaycan mediası üçün monitorinq"'), updated_at = now()
where section_key = 'hero'
  and content ->> 'badge' = 'Kommunikasiya və Media Monitorinq Platforması';

update public.public_site_sections
set content = jsonb_set(content, '{tagline}', '"Adınız xəbərə düşəndə ilk siz bilin."'), updated_at = now()
where section_key = 'hero'
  and content ->> 'tagline' in ('İzləyin. Anlayın. Qərar verin.', 'Monitor. Understand. Decide.');

update public.public_site_sections
set content = jsonb_set(content, '{description}', '"Vizual 280-dən çox Azərbaycan xəbər saytını hər 15 dəqiqədən bir, Facebook və Instagram-ı isə planınıza görə yoxlayır. Açar sözünüz harada çıxsa, linki Telegram-a göndəririk. Səhər mətbuat icmalını əl ilə yığmağa ehtiyac qalmır."'), updated_at = now()
where section_key = 'hero'
  and content ->> 'description' like 'Media mənbələrində və sosial şəbəkələrdə təşkilatınız haqqında yayımlanan vacib məlumatları bir platformadan izləyin.%';

update public.public_site_sections
set content = content - 'brand', updated_at = now()
where section_key = 'hero' and content ? 'brand';

update public.public_site_sections
set content = content
    || jsonb_build_object('title', 'Vizual-ı kim, nə üçün işlədir')
    || jsonb_build_object('items', $$[
      {"title": "Universitetin mətbuat xidməti", "description": "Əvvəl hər səhər 20 saytı açıb universitetin adını axtarırdılar. İndi axşamdan bəri çıxan hər xəbər Telegram-dadır, həftəlik hesabat isə emailə gəlir."},
      {"title": "Bankın PR komandası", "description": "Müştəri şikayəti Facebook-da çıxanda bildiriş gəlir. Cavab saatlar sonra yox, eyni səhər verilir."},
      {"title": "PR agentliyi", "description": "Hər müştərinin adı ayrıca açar sözdür. Kampaniyadan sonra neçə saytda çıxdığını saymaq üçün nəticələri bir kliklə ixrac edirsiniz."}
    ]$$::jsonb),
    updated_at = now()
where section_key = 'audiences'
  and content ->> 'title' = 'Kommunikasiya gündəmini izləyən komandalar üçün'
  and content #>> '{items,0,title}' = 'Dövlət qurumları';

update public.public_site_sections
set content = jsonb_set(content, '{items}', $$[
      {"title": "Qəbul imtahanlarının cədvəli açıqlandı", "source": "report.az", "keyword": "qəbul imtahanı", "time": "09:12"},
      {"title": "İpoteka faizləri ilə bağlı paylaşım, 48 rəy", "source": "facebook.com", "keyword": "ipoteka", "time": "08:47"},
      {"title": "Bakı metrosunda qatarların hərəkət qrafiki dəyişir", "source": "apa.az", "keyword": "Bakı metrosu", "time": "08:21"}
    ]$$::jsonb), updated_at = now()
where section_key = 'demo'
  and content #>> '{items,0,keyword}' = 'təşkilat adı';

delete from public.public_site_sections where section_key = 'campaigns';
