import { loadSupabase } from '@/lib/supabase-lazy'

export type PublicService = {
  title: string
  description: string
  status: string
  icon: 'newspaper' | 'radio' | 'megaphone' | 'file' | 'search'
}

export type PublicAudience = {
  title: string
  description: string
}

export type PublicPlan = {
  name: string
  price: string
  description: string
  features: string[]
}

export type PublicDemoItem = {
  title: string
  source: string
  keyword: string
  time: string
}

export type PublicSiteContent = {
  hero: {
    badge: string
    brand: string
    tagline: string
    description: string
    primaryCta: string
    secondaryCta: string
  }
  services: {
    eyebrow: string
    title: string
    description: string
    items: PublicService[]
  }
  audiences: {
    eyebrow: string
    title: string
    items: PublicAudience[]
  }
  demo: {
    eyebrow: string
    title: string
    description: string
    primaryCta: string
    secondaryCta: string
    placeholderTitle: string
    placeholderDescription: string
    items: PublicDemoItem[]
  }
  pricing: {
    eyebrow: string
    title: string
    description: string
    plans: PublicPlan[]
  }
  campaigns: {
    eyebrow: string
    title: string
    description: string
  }
  blog: {
    eyebrow: string
    title: string
    description: string
    items: string[]
  }
  about: {
    eyebrow: string
    title: string
    description: string
    principles: PublicAudience[]
  }
  contact: {
    eyebrow: string
    title: string
    description: string
    cardTitle: string
    cardDescription: string
    email: string
  }
}

export const publicSiteSectionKeys = [
  'hero',
  'services',
  'audiences',
  'demo',
  'pricing',
  'campaigns',
  'blog',
  'about',
  'contact',
] as const

export type PublicSiteSectionKey = (typeof publicSiteSectionKeys)[number]

const CACHE_TTL_MS = 5 * 60 * 1000
let contentCache: { value: PublicSiteContent; expiresAt: number } | null = null
let pendingContent: Promise<PublicSiteContent> | null = null

export const defaultPublicSiteContent: PublicSiteContent = {
  hero: {
    badge: 'Kommunikasiya və Media Monitorinq Platforması',
    brand: 'Vizual.Az',
    tagline: 'İzləyin. Anlayın. Qərar verin.',
    description:
      'Media mənbələrində yayımlanan materialları, seçilmiş vebsaytlardakı dəyişiklikləri və təşkilatınız haqqında vacib məlumatları bir platformadan izləyin.',
    primaryCta: '15 gün pulsuz sına',
    secondaryCta: 'İstifadəçi girişi',
  },
  services: {
    eyebrow: 'Xidmətlər',
    title: 'Vizual.Az nə edir?',
    description:
      'Media gündəmini, vebsayt dəyişikliklərini və təşkilatınız haqqında yayımlanan məlumatları bir platformadan izləyin.',
    items: [
      {
        title: 'Media monitorinqi',
        description:
          'Təşkilatınız, layihəniz, məhsulunuz və ya seçdiyiniz açar sözlər haqqında yerli media mənbələrində yayımlanan materialları avtomatik izləyin.',
        icon: 'newspaper',
        status: 'Aktiv',
      },
      {
        title: 'Vebsayt dəyişikliklərinin izlənməsi',
        description:
          'İzləmək istədiyiniz vebsəhifənin müəyyən hissəsini seçin və həmin hissədə baş verən dəyişikliklər barədə məlumat alın.',
        icon: 'radio',
        status: 'Aktiv',
      },
      {
        title: 'Kommunikasiya analitikası',
        description:
          'Media monitorinqi nəticələrinin ümumi mənzərəsini görmək və kommunikasiya fəaliyyətini qiymətləndirmək üçün nəzərdə tutulur.',
        icon: 'megaphone',
        status: 'Tezliklə',
      },
      {
        title: 'Sosial media monitorinqi',
        description:
          'Seçilmiş mövzular üzrə sosial şəbəkələrdə aparılan müzakirələri izləmək üçün gələcək modul.',
        icon: 'file',
        status: 'Tezliklə',
      },
      {
        title: 'Qlobal xəbər axını',
        description:
          'Beynəlxalq informasiya resurslarında yayımlanan xəbərləri seçdiyiniz mövzular üzrə izləmək üçün gələcək modul.',
        icon: 'search',
        status: 'Tezliklə',
      },
    ],
  },
  audiences: {
    eyebrow: 'Kimlər üçündür?',
    title: 'Kommunikasiya gündəmini izləyən komandalar üçün',
    items: [
      {
        title: 'Dövlət qurumları',
        description:
          'Media görünürlüğü, rəsmi məlumatlar və gündəlik kommunikasiya nəzarəti üçün.',
      },
      {
        title: 'Universitetlər',
        description:
          'Təhsil, qəbul, elm və universitet adı ilə bağlı media materiallarını izləmək üçün.',
      },
      {
        title: 'Şirkətlər',
        description:
          'Brend, məhsul, rəhbərlik və sektor xəbərlərini vaxtında görmək üçün.',
      },
      {
        title: 'Banklar',
        description:
          'Reputasiya, bazar xəbərləri və ictimai kommunikasiya siqnalları üçün.',
      },
      {
        title: 'PR və kommunikasiya komandaları',
        description:
          'Müştəri, kampaniya və media nəticələrini sistemli izləmək üçün.',
      },
      {
        title: 'Media nümayəndələri',
        description:
          'Gündəmi, mənbələri və mövzu axınını daha ardıcıl izləmək üçün.',
      },
    ],
  },
  demo: {
    eyebrow: 'Sınaq',
    title: 'Vizual.Az-ı 15 gün sınaqdan keçirin',
    description:
      'Sınaq müddətində monitor yaradın, açar sözləri yoxlayın, nəticələri və bildiriş axınını real iş prosesinizdə test edin.',
    primaryCta: '15 gün pulsuz sına',
    secondaryCta: 'Sınaq müraciəti',
    placeholderTitle: 'Sınaq və məhsul təqdimatı',
    placeholderDescription:
      'Burada məhsul turu, qısa təqdimat videosu və ya iş masası nümunəsi yerləşdirilə bilər.',
    items: [
      {
        title: 'Təşkilatınızla bağlı yeni media materialı tapıldı',
        source: 'azertag.az',
        keyword: 'təşkilat adı',
        time: '09:12',
      },
      {
        title: 'Seçilmiş vebsəhifədə yeni məlumat əlavə olundu',
        source: 'rəsmi sayt',
        keyword: 'veb izləmə',
        time: '08:47',
      },
      {
        title: 'Vacib uyğunluq üzrə Telegram bildirişi göndərildi',
        source: 'iş masası',
        keyword: 'bildiriş',
        time: '08:21',
      },
    ],
  },
  pricing: {
    eyebrow: 'Qiymətlər',
    title: 'Sınaqdan başlayın, ehtiyacınıza uyğun böyüdün',
    description:
      'Planlar monitorinq ehtiyacına, bildiriş axınına və komanda ölçüsünə görə seçilir.',
    plans: [
      {
        name: 'Pulsuz sınaq',
        price: '15 günlük sınaq',
        description: 'Məhsulu tanımaq və ilk monitorinq axınını yoxlamaq üçün.',
        features: ['Məhdud monitor sayı', 'Əsas nəticələr', 'Sınaq iş masası'],
      },
      {
        name: 'Başlanğıc',
        price: 'Sorğu əsasında',
        description: 'Kiçik komandalar və ilkin media monitorinqi üçün.',
        features: ['Açar söz izləmə', 'Telegram bildirişləri', 'CSV ixrac'],
      },
      {
        name: 'Peşəkar',
        price: 'Sorğu əsasında',
        description: 'Aktiv PR və kommunikasiya komandaları üçün.',
        features: [
          'Geniş monitorinq',
          'Vebsayt dəyişikliklərinin izlənməsi',
          'Prioritet dəstək',
        ],
      },
      {
        name: 'Korporativ',
        price: 'Fərdi təklif',
        description: 'Böyük təşkilatlar və xüsusi ehtiyaclar üçün.',
        features: [
          'Fərdi limitlər',
          'Xüsusi ilkin qurulum',
          'Əməliyyat dəstəyi',
        ],
      },
    ],
  },
  campaigns: {
    eyebrow: 'Kampaniyalar',
    title: 'Yeni funksiyalar və kampaniyalar',
    description:
      'Yeni funksiyalar, sınaq imkanları və xüsusi təqdimat təklifləri bu bölmədə elan olunacaq.',
  },
  blog: {
    eyebrow: 'Bloq',
    title: 'Media, PR, SEO və kommunikasiya',
    description:
      'Vizual.Az bloqu kommunikasiya komandaları üçün praktik monitorinq, reputasiya və media görünürlüğü mövzularını izah edəcək.',
    items: [
      'Media monitorinq nə üçün vacibdir?',
      'PR komandaları gündəlik xəbər axınını necə idarə etməlidir?',
      'SEO və kommunikasiya görünürlüğü arasında əlaqə',
    ],
  },
  about: {
    eyebrow: 'Haqqımızda',
    title: 'Vizual.Az nədir və nə üçün lazımdır?',
    description:
      'Vizual.Az təşkilatlar, universitetlər, şirkətlər, banklar, media və PR komandaları üçün kommunikasiya və media monitorinq platformasıdır. Məqsəd çox məlumat göstərmək deyil, vacib məlumatı vaxtında çatdırmaq və düzgün qərar verməyə kömək etməkdir.',
    principles: [
      {
        title: 'Yerli bazar üçün',
        description:
          'Azərbaycan media mənbələri və təşkilatların real kommunikasiya ehtiyacları nəzərə alınır.',
      },
      {
        title: 'Vaxtında xəbərdarlıq',
        description:
          'Açar sözlər və seçilmiş vebsəhifələr üzrə vacib dəyişikliklər vaxtında görünür.',
      },
      {
        title: 'Qərar üçün siqnal',
        description:
          'Məqsəd məlumatı artırmaq yox, vacib siqnalı aydın və istifadəyə hazır formada göstərməkdir.',
      },
    ],
  },
  contact: {
    eyebrow: 'Əlaqə',
    title: 'Sınaq, əməkdaşlıq və dəstək üçün əlaqə saxlayın',
    description:
      'Vizual.Az-ı komandanızın media monitorinqi, vebsayt izləmə və bildiriş ehtiyaclarına görə necə istifadə edə biləcəyinizi birlikdə nəzərdən keçirək.',
    cardTitle: 'Sınaq müraciəti',
    cardDescription:
      'Hazırda public form aktiv deyil. Sınaq, əməkdaşlıq və texniki dəstək üçün email vasitəsilə əlaqə saxlayın.',
    email: 'info@vizual.az',
  },
}

function isSectionKey(key: string): key is PublicSiteSectionKey {
  return publicSiteSectionKeys.includes(key as PublicSiteSectionKey)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function mergeWithDefaults<T>(defaults: T, value: unknown): T {
  if (Array.isArray(defaults)) {
    if (!Array.isArray(value)) return defaults
    const itemDefaults = defaults[0]
    if (itemDefaults === undefined) return value as T
    return value.map((item) => mergeWithDefaults(itemDefaults, item)) as T
  }

  if (isRecord(defaults)) {
    const candidate = isRecord(value) ? value : {}
    return Object.fromEntries(
      Object.entries(defaults).map(([key, defaultValue]) => [
        key,
        mergeWithDefaults(defaultValue, candidate[key]),
      ])
    ) as T
  }

  return typeof value === typeof defaults ? (value as T) : defaults
}

export async function loadPublicSiteContent(): Promise<PublicSiteContent> {
  if (contentCache && contentCache.expiresAt > Date.now()) {
    return contentCache.value
  }

  if (!pendingContent) {
    pendingContent = (async () => {
      const supabase = await loadSupabase()
      const { data, error } = await supabase
        .from('public_site_sections')
        .select('section_key, content')
        .eq('status', 'published')
        .in('section_key', [...publicSiteSectionKeys])

      if (error || !data) {
        return defaultPublicSiteContent
      }

      const value = data.reduce<PublicSiteContent>((content, row) => {
        const key = String(row.section_key)

        if (!isSectionKey(key) || !isRecord(row.content)) {
          return content
        }

        return {
          ...content,
          [key]: mergeWithDefaults(content[key], row.content),
        }
      }, defaultPublicSiteContent)

      contentCache = { value, expiresAt: Date.now() + CACHE_TTL_MS }
      return value
    })().finally(() => {
      pendingContent = null
    })
  }

  return pendingContent
}

export function invalidatePublicSiteContentCache() {
  contentCache = null
}
