insert into public.public_site_sections (section_key, content, status, updated_at)
values
  ('hero', $$
  {
    "badge": "Kommunikasiya və Media Monitorinq Platforması",
    "brand": "Vizual.Az",
    "tagline": "Monitor. Understand. Decide.",
    "description": "Media mənbələrində yayımlanan materialları, seçilmiş vebsaytlardakı dəyişiklikləri və təşkilatınız haqqında vacib məlumatları bir platformadan izləyin. Vizual.Az açar sözlər üzrə yeni materialları aşkar edir və sizi vaxtında xəbərdar edir.",
    "primaryCta": "15 gün pulsuz sına",
    "secondaryCta": "İstifadəçi girişi"
  }
  $$::jsonb, 'published', now()),
  ('services', $$
  {
    "eyebrow": "Xidmətlər",
    "title": "Vizual.Az nə edir?",
    "description": "Media gündəmini, vebsayt dəyişikliklərini və təşkilatınız haqqında yayımlanan məlumatları bir platformadan izləyin.",
    "items": [
      {
        "title": "Media monitorinqi",
        "description": "Təşkilatınız, layihəniz, məhsulunuz və ya seçdiyiniz açar sözlər haqqında yerli media mənbələrində yayımlanan materialları avtomatik izləyin. Sistem yeni xəbərləri aşkar edir, uyğun nəticələri toplayır və istədiyiniz halda Telegram vasitəsilə xəbərdar edir.",
        "icon": "newspaper",
        "status": "Aktiv"
      },
      {
        "title": "Vebsayt dəyişikliklərinin izlənməsi",
        "description": "İzləmək istədiyiniz vebsəhifənin müəyyən hissəsini seçin və həmin hissədə baş verən dəyişikliklər barədə avtomatik məlumat alın. Bu xidmət elanlar, qəbul qaydaları, vakansiyalar, tenderlər və normativ sənədlərin izlənməsi üçün faydalıdır.",
        "icon": "radio",
        "status": "Aktiv"
      },
      {
        "title": "Kommunikasiya analitikası",
        "description": "Media monitorinqinin nəticələrini təhlil edin, təşkilatınız haqqında yayımlanan məlumatların ümumi mənzərəsini görün və kommunikasiya fəaliyyətinizin effektivliyini qiymətləndirin.",
        "icon": "megaphone",
        "status": "Tezliklə"
      },
      {
        "title": "Sosial media monitorinqi",
        "description": "Seçilmiş mövzular və açar sözlər üzrə sosial şəbəkələrdə aparılan müzakirələri izləyin, ictimai rəyin istiqamətini qiymətləndirin və dəyişiklikləri vaxtında müəyyən edin.",
        "icon": "file",
        "status": "Tezliklə"
      },
      {
        "title": "Qlobal xəbər axını",
        "description": "Dünyanın aparıcı informasiya resurslarında yayımlanan xəbərləri seçdiyiniz mövzular üzrə izləyin və beynəlxalq gündəmdən operativ xəbərdar olun.",
        "icon": "search",
        "status": "Tezliklə"
      }
    ]
  }
  $$::jsonb, 'published', now()),
  ('audiences', $$
  {
    "eyebrow": "Kimlər üçündür?",
    "title": "Kommunikasiya gündəmini izləyən komandalar üçün",
    "items": [
      {
        "title": "Dövlət qurumları",
        "description": "Media görünürlüğü, rəsmi məlumatlar və gündəlik kommunikasiya nəzarəti üçün."
      },
      {
        "title": "Universitetlər",
        "description": "Təhsil, qəbul, elm və universitet adı ilə bağlı media materiallarını izləmək üçün."
      },
      {
        "title": "Şirkətlər",
        "description": "Brend, məhsul, rəhbərlik və sektor xəbərlərini vaxtında görmək üçün."
      },
      {
        "title": "Banklar",
        "description": "Reputasiya, bazar xəbərləri və ictimai kommunikasiya siqnalları üçün."
      },
      {
        "title": "PR və kommunikasiya komandaları",
        "description": "Müştəri, kampaniya və media nəticələrini sistemli izləmək üçün."
      },
      {
        "title": "Media nümayəndələri",
        "description": "Gündəmi, mənbələri və mövzu axınını daha ardıcıl izləmək üçün."
      }
    ]
  }
  $$::jsonb, 'published', now()),
  ('demo', $$
  {
    "eyebrow": "Demo",
    "title": "Vizual.Az-ı 15 gün sınaqdan keçirin",
    "description": "Demo yalnız video deyil. 15 günlük sınaq müddətində monitor yaradın, açar sözləri yoxlayın, nəticələri və bildiriş axınını real iş prosesinizdə test edin.",
    "primaryCta": "15 gün pulsuz sına",
    "secondaryCta": "Demo müraciəti",
    "placeholderTitle": "Sınaq və məhsul təqdimatı",
    "placeholderDescription": "Burada məhsul turu, qısa təqdimat videosu və ya demo workspace nümayişi yerləşdirilə bilər.",
    "items": [
      {
        "title": "Təşkilatınızla bağlı yeni media materialı tapıldı",
        "source": "azertag.az",
        "keyword": "təşkilat adı",
        "time": "09:12"
      },
      {
        "title": "Seçilmiş vebsəhifədə yeni məlumat əlavə olundu",
        "source": "rəsmi sayt",
        "keyword": "veb izləmə",
        "time": "08:47"
      },
      {
        "title": "Vacib uyğunluq üzrə Telegram bildirişi göndərildi",
        "source": "workspace",
        "keyword": "bildiriş",
        "time": "08:21"
      }
    ]
  }
  $$::jsonb, 'published', now()),
  ('pricing', $$
  {
    "eyebrow": "Qiymətlər",
    "title": "Sınaqdan başlayın, ehtiyacınıza uyğun böyüdün",
    "description": "Dəqiq qiymətlər demo və istifadə həcminə görə razılaşdırılır. Planlar monitorinq ehtiyacına, bildiriş axınına və komanda ölçüsünə görə seçilir.",
    "plans": [
      {
        "name": "Free / Trial",
        "price": "15 günlük sınaq",
        "description": "Məhsulu tanımaq və ilk monitorinq axınını yoxlamaq üçün.",
        "features": ["Məhdud monitor sayı", "Əsas nəticələr", "Sınaq workspace-i"]
      },
      {
        "name": "Starter",
        "price": "Sorğu əsasında",
        "description": "Kiçik komandalar və ilkin media monitorinqi üçün.",
        "features": ["Açar söz izləmə", "Telegram bildirişləri", "CSV ixrac"]
      },
      {
        "name": "Professional",
        "price": "Sorğu əsasında",
        "description": "Aktiv PR və kommunikasiya komandaları üçün.",
        "features": ["Geniş monitorinq", "Vebsayt dəyişikliklərinin izlənməsi", "Prioritet dəstək"]
      },
      {
        "name": "Enterprise",
        "price": "Fərdi təklif",
        "description": "Böyük təşkilatlar və xüsusi ehtiyaclar üçün.",
        "features": ["Fərdi limitlər", "Xüsusi onboarding", "Əməliyyat dəstəyi"]
      }
    ]
  }
  $$::jsonb, 'published', now()),
  ('campaigns', $$
  {
    "eyebrow": "Kampaniyalar",
    "title": "Yeni funksiyalar və kampaniyalar",
    "description": "Yeni funksiyalar, sınaq imkanları və xüsusi təqdimat təklifləri bu bölmədə elan olunacaq."
  }
  $$::jsonb, 'published', now()),
  ('blog', $$
  {
    "eyebrow": "Blog",
    "title": "Media, PR, SEO və kommunikasiya",
    "description": "Vizual.Az blogu kommunikasiya komandaları üçün praktik monitorinq, reputasiya və media görünürlüğü mövzularını izah edəcək.",
    "items": [
      "Media monitorinq nə üçün vacibdir?",
      "PR komandaları gündəlik xəbər axınını necə idarə etməlidir?",
      "SEO və kommunikasiya görünürlüğü arasında əlaqə"
    ]
  }
  $$::jsonb, 'published', now()),
  ('about', $$
  {
    "eyebrow": "Haqqımızda",
    "title": "Vizual.Az nədir və nə üçün lazımdır?",
    "description": "Vizual.Az təşkilatlar, universitetlər, şirkətlər, banklar, media və PR komandaları üçün kommunikasiya və media monitorinq platformasıdır. Məqsəd çox məlumat göstərmək deyil, vacib məlumatı vaxtında çatdırmaq və düzgün qərar verməyə kömək etməkdir.",
    "principles": [
      {
        "title": "Yerli bazar üçün",
        "description": "Azərbaycan media mənbələri və təşkilatların real kommunikasiya ehtiyacları nəzərə alınır."
      },
      {
        "title": "Vaxtında xəbərdarlıq",
        "description": "Açar sözlər və seçilmiş vebsəhifələr üzrə vacib dəyişikliklər vaxtında görünür."
      },
      {
        "title": "Qərar üçün siqnal",
        "description": "Məqsəd məlumatı artırmaq yox, vacib siqnalı aydın və istifadəyə hazır formada göstərməkdir."
      }
    ]
  }
  $$::jsonb, 'published', now()),
  ('contact', $$
  {
    "eyebrow": "Əlaqə",
    "title": "Demo, əməkdaşlıq və dəstək üçün əlaqə saxlayın",
    "description": "Vizual.Az-ı komandanızın media monitorinqi, vebsayt izləmə və bildiriş ehtiyaclarına görə necə istifadə edə biləcəyinizi birlikdə nəzərdən keçirək.",
    "cardTitle": "Demo müraciəti",
    "cardDescription": "Hazırda public form aktiv deyil. Demo, əməkdaşlıq və texniki dəstək üçün email vasitəsilə əlaqə saxlayın.",
    "email": "info@vizual.az"
  }
  $$::jsonb, 'published', now())
on conflict (section_key) do update
set
  content = excluded.content,
  status = excluded.status,
  updated_at = now();
