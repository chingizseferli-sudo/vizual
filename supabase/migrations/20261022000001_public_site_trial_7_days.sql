-- The Demo plan lasts 7 days (20261020000007) and web page watching is now an
-- admin-only tool, so the public site stops promising a 15-day trial and web
-- page watching. Each text changes only while it still equals the seeded one,
-- so edits made in the admin panel stay.

update public.public_site_sections
set content = jsonb_set(content, '{primaryCta}', '"7 gün pulsuz sına"'), updated_at = now()
where section_key = 'hero' and content ->> 'primaryCta' = '15 gün pulsuz sına';

update public.public_site_sections
set content = jsonb_set(content, '{description}', '"Media mənbələrində və sosial şəbəkələrdə təşkilatınız haqqında yayımlanan vacib məlumatları bir platformadan izləyin. Vizual.Az açar sözlər üzrə yeni materialları aşkar edir və sizi vaxtında xəbərdar edir."'), updated_at = now()
where section_key = 'hero'
  and content ->> 'description' = 'Media mənbələrində yayımlanan materialları, seçilmiş vebsaytlardakı dəyişiklikləri və təşkilatınız haqqında vacib məlumatları bir platformadan izləyin. Vizual.Az açar sözlər üzrə yeni materialları aşkar edir və sizi vaxtında xəbərdar edir.';

update public.public_site_sections
set content = jsonb_set(content, '{description}', '"Media gündəmini, sosial şəbəkələri və təşkilatınız haqqında yayımlanan məlumatları bir platformadan izləyin."'), updated_at = now()
where section_key = 'services'
  and content ->> 'description' = 'Media gündəmini, vebsayt dəyişikliklərini və təşkilatınız haqqında yayımlanan məlumatları bir platformadan izləyin.';

update public.public_site_sections
set content = jsonb_set(content, '{items}', coalesce((
    select jsonb_agg(item order by position)
    from jsonb_array_elements(content -> 'items') with ordinality as items(item, position)
    where item ->> 'title' not in ('Vebsayt dəyişiklikləri', 'Vebsayt dəyişikliklərinin izlənməsi')
  ), '[]'::jsonb)), updated_at = now()
where section_key = 'services'
  and jsonb_typeof(content -> 'items') = 'array'
  and exists (
    select 1 from jsonb_array_elements(content -> 'items') item
    where item ->> 'title' in ('Vebsayt dəyişiklikləri', 'Vebsayt dəyişikliklərinin izlənməsi')
  );

update public.public_site_sections
set content = jsonb_set(content, '{title}', '"Vizual.Az-ı 7 gün sınaqdan keçirin"'), updated_at = now()
where section_key = 'demo' and content ->> 'title' = 'Vizual.Az-ı 15 gün sınaqdan keçirin';

update public.public_site_sections
set content = jsonb_set(content, '{primaryCta}', '"7 gün pulsuz sına"'), updated_at = now()
where section_key = 'demo' and content ->> 'primaryCta' = '15 gün pulsuz sına';

update public.public_site_sections
set content = jsonb_set(content, '{description}', '"Demo yalnız video deyil. 7 günlük sınaq müddətində açar sözlərinizi əlavə edin, nəticələri və bildiriş axınını real iş prosesinizdə test edin."'), updated_at = now()
where section_key = 'demo'
  and content ->> 'description' = 'Demo yalnız video deyil. 15 günlük sınaq müddətində monitor yaradın, açar sözləri yoxlayın, nəticələri və bildiriş axınını real iş prosesinizdə test edin.';

update public.public_site_sections
set content = jsonb_set(content, '{items,1}', '{"title": "Facebook-da açar sözünüzlə yeni paylaşım tapıldı", "source": "facebook.com", "keyword": "brend adı", "time": "08:47"}'), updated_at = now()
where section_key = 'demo' and content #>> '{items,1,keyword}' = 'veb izləmə';

update public.public_site_sections
set content = jsonb_set(content, '{plans,0,price}', '"7 günlük sınaq"'), updated_at = now()
where section_key = 'pricing' and content #>> '{plans,0,price}' = '15 günlük sınaq';

update public.public_site_sections
set content = jsonb_set(content, '{plans,0,features,0}', '"Məhdud açar söz sayı"'), updated_at = now()
where section_key = 'pricing' and content #>> '{plans,0,features,0}' = 'Məhdud monitor sayı';

update public.public_site_sections
set content = jsonb_set(content, '{plans,2,features,1}', '"Facebook və Instagram monitorinqi"'), updated_at = now()
where section_key = 'pricing' and content #>> '{plans,2,features,1}' = 'Vebsayt dəyişikliklərinin izlənməsi';

update public.public_site_sections
set content = jsonb_set(content, '{principles,1,description}', '"Açar sözlər üzrə vacib xəbərlər və paylaşımlar vaxtında görünür."'), updated_at = now()
where section_key = 'about'
  and content #>> '{principles,1,description}' = 'Açar sözlər və seçilmiş vebsəhifələr üzrə vacib dəyişikliklər vaxtında görünür.';

update public.public_site_sections
set content = jsonb_set(content, '{description}', '"Vizual.Az-ı komandanızın media monitorinqi, sosial şəbəkə izləmə və bildiriş ehtiyaclarına görə necə istifadə edə biləcəyinizi birlikdə nəzərdən keçirək."'), updated_at = now()
where section_key = 'contact'
  and content ->> 'description' = 'Vizual.Az-ı komandanızın media monitorinqi, vebsayt izləmə və bildiriş ehtiyaclarına görə necə istifadə edə biləcəyinizi birlikdə nəzərdən keçirək.';
