import { fetchPublicRows } from '@/lib/supabase-lazy'
import { getLang, t } from '@/lib/i18n'

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
    badge: t("Kommunikasiya və Media Monitorinq Platforması"),
    brand: 'Vizual.Az',
    tagline: t("İzləyin. Anlayın. Qərar verin."),
    description:
      t("Media mənbələrində yayımlanan materialları, seçilmiş vebsaytlardakı dəyişiklikləri və təşkilatınız haqqında vacib məlumatları bir platformadan izləyin."),
    primaryCta: t("15 gün pulsuz sına"),
    secondaryCta: t("İstifadəçi girişi"),
  },
  services: {
    eyebrow: t("Xidmətlər"),
    title: t("Vizual.Az nə edir?"),
    description:
      t("Media gündəmini, vebsayt dəyişikliklərini və təşkilatınız haqqında yayımlanan məlumatları bir platformadan izləyin."),
    items: [
      {
        title: 'Media monitorinqi',
        description:
          t("Təşkilatınız, layihəniz, məhsulunuz və ya seçdiyiniz açar sözlər haqqında yerli media mənbələrində yayımlanan materialları avtomatik izləyin."),
        icon: 'newspaper',
        status: 'Aktiv',
      },
      {
        title: t("Vebsayt dəyişikliklərinin izlənməsi"),
        description:
          t("İzləmək istədiyiniz vebsəhifənin müəyyən hissəsini seçin və həmin hissədə baş verən dəyişikliklər barədə məlumat alın."),
        icon: 'radio',
        status: 'Aktiv',
      },
      {
        title: t("Kommunikasiya analitikası"),
        description:
          t("Media monitorinqi nəticələrinin ümumi mənzərəsini görmək və kommunikasiya fəaliyyətini qiymətləndirmək üçün nəzərdə tutulur."),
        icon: 'megaphone',
        status: t("Tezliklə"),
      },
      {
        title: t("Facebook və Instagram monitorinqi"),
        description:
          t("Açar sözlərinizlə bağlı Facebook və Instagram paylaşımlarını izləyin və Telegram bildirişi alın."),
        icon: 'file',
        status: 'Beta',
      },
      {
        title: t("Qlobal xəbər axını"),
        description:
          t("Beynəlxalq informasiya resurslarında yayımlanan xəbərləri seçdiyiniz mövzular üzrə izləmək üçün gələcək modul."),
        icon: 'search',
        status: t("Tezliklə"),
      },
    ],
  },
  audiences: {
    eyebrow: t("Kimlər üçündür?"),
    title: t("Kommunikasiya gündəmini izləyən komandalar üçün"),
    items: [
      {
        title: t("Dövlət qurumları"),
        description:
          t("Media görünürlüğü, rəsmi məlumatlar və gündəlik kommunikasiya nəzarəti üçün."),
      },
      {
        title: t("Universitetlər"),
        description:
          t("Təhsil, qəbul, elm və universitet adı ilə bağlı media materiallarını izləmək üçün."),
      },
      {
        title: t("Şirkətlər"),
        description:
          t("Brend, məhsul, rəhbərlik və sektor xəbərlərini vaxtında görmək üçün."),
      },
      {
        title: 'Banklar',
        description:
          t("Reputasiya, bazar xəbərləri və ictimai kommunikasiya siqnalları üçün."),
      },
      {
        title: t("PR və kommunikasiya komandaları"),
        description:
          t("Müştəri, kampaniya və media nəticələrini sistemli izləmək üçün."),
      },
      {
        title: t("Media nümayəndələri"),
        description:
          t("Gündəmi, mənbələri və mövzu axınını daha ardıcıl izləmək üçün."),
      },
    ],
  },
  demo: {
    eyebrow: t("Sınaq"),
    title: t("Vizual.Az-ı 15 gün sınaqdan keçirin"),
    description:
      t("Sınaq müddətində monitor yaradın, açar sözləri yoxlayın, nəticələri və bildiriş axınını real iş prosesinizdə test edin."),
    primaryCta: t("15 gün pulsuz sına"),
    secondaryCta: t("Sınaq müraciəti"),
    placeholderTitle: t("Sınaq və məhsul təqdimatı"),
    placeholderDescription:
      t("Burada məhsul turu, qısa təqdimat videosu və ya iş masası nümunəsi yerləşdirilə bilər."),
    items: [
      {
        title: t("Təşkilatınızla bağlı yeni media materialı tapıldı"),
        source: 'azertag.az',
        keyword: t("təşkilat adı"),
        time: '09:12',
      },
      {
        title: t("Seçilmiş vebsəhifədə yeni məlumat əlavə olundu"),
        source: t("rəsmi sayt"),
        keyword: t("veb izləmə"),
        time: '08:47',
      },
      {
        title: t("Vacib uyğunluq üzrə Telegram bildirişi göndərildi"),
        source: t("iş masası"),
        keyword: t("bildiriş"),
        time: '08:21',
      },
    ],
  },
  pricing: {
    eyebrow: t("Qiymətlər"),
    title: t("Sınaqdan başlayın, ehtiyacınıza uyğun böyüdün"),
    description:
      t("Planlar monitorinq ehtiyacına, bildiriş axınına və komanda ölçüsünə görə seçilir."),
    plans: [
      {
        name: t("Pulsuz sınaq"),
        price: t("15 günlük sınaq"),
        description: t("Məhsulu tanımaq və ilk monitorinq axınını yoxlamaq üçün."),
        features: [t("Məhdud monitor sayı"), t("Əsas nəticələr"), t("Sınaq iş masası")],
      },
      {
        name: t("Başlanğıc"),
        price: t("Sorğu əsasında"),
        description: t("Kiçik komandalar və ilkin media monitorinqi üçün."),
        features: [t("Açar söz izləmə"), t("Telegram bildirişləri"), t('CSV ixrac')],
      },
      {
        name: t("Peşəkar"),
        price: t("Sorğu əsasında"),
        description: t("Aktiv PR və kommunikasiya komandaları üçün."),
        features: [
          t("Geniş monitorinq"),
          t("Vebsayt dəyişikliklərinin izlənməsi"),
          t("Prioritet dəstək"),
        ],
      },
      {
        name: 'Korporativ',
        price: t("Fərdi təklif"),
        description: t("Böyük təşkilatlar və xüsusi ehtiyaclar üçün."),
        features: [
          t("Fərdi limitlər"),
          t("Xüsusi ilkin qurulum"),
          t("Əməliyyat dəstəyi"),
        ],
      },
    ],
  },
  campaigns: {
    eyebrow: 'Kampaniyalar',
    title: t("Yeni funksiyalar və kampaniyalar"),
    description:
      t("Yeni funksiyalar, sınaq imkanları və xüsusi təqdimat təklifləri bu bölmədə elan olunacaq."),
  },
  blog: {
    eyebrow: 'Bloq',
    title: t("Media, PR, SEO və kommunikasiya"),
    description:
      t("Vizual.Az bloqu kommunikasiya komandaları üçün praktik monitorinq, reputasiya və media görünürlüğü mövzularını izah edəcək."),
    items: [
      t("Media monitorinq nə üçün vacibdir?"),
      t("PR komandaları gündəlik xəbər axınını necə idarə etməlidir?"),
      t("SEO və kommunikasiya görünürlüğü arasında əlaqə"),
    ],
  },
  about: {
    eyebrow: t("Haqqımızda"),
    title: t("Vizual.Az nədir və nə üçün lazımdır?"),
    description:
      t("Vizual.Az təşkilatlar, universitetlər, şirkətlər, banklar, media və PR komandaları üçün kommunikasiya və media monitorinq platformasıdır. Məqsəd çox məlumat göstərmək deyil, vacib məlumatı vaxtında çatdırmaq və düzgün qərar verməyə kömək etməkdir."),
    principles: [
      {
        title: t("Yerli bazar üçün"),
        description:
          t("Azərbaycan media mənbələri və təşkilatların real kommunikasiya ehtiyacları nəzərə alınır."),
      },
      {
        title: t("Vaxtında xəbərdarlıq"),
        description:
          t("Açar sözlər və seçilmiş vebsəhifələr üzrə vacib dəyişikliklər vaxtında görünür."),
      },
      {
        title: t("Qərar üçün siqnal"),
        description:
          t("Məqsəd məlumatı artırmaq yox, vacib siqnalı aydın və istifadəyə hazır formada göstərməkdir."),
      },
    ],
  },
  contact: {
    eyebrow: t("Əlaqə"),
    title: t("Sınaq, əməkdaşlıq və dəstək üçün əlaqə saxlayın"),
    description:
      t("Vizual.Az-ı komandanızın media monitorinqi, vebsayt izləmə və bildiriş ehtiyaclarına görə necə istifadə edə biləcəyinizi birlikdə nəzərdən keçirək."),
    cardTitle: t("Sınaq müraciəti"),
    cardDescription:
      t("Hazırda public form aktiv deyil. Sınaq, əməkdaşlıq və texniki dəstək üçün email vasitəsilə əlaqə saxlayın."),
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
  // Sections edited in the admin panel are Azerbaijani only; Russian visitors
  // get the translated built-in texts.
  if (getLang() === 'ru') return defaultPublicSiteContent

  if (contentCache && contentCache.expiresAt > Date.now()) {
    return contentCache.value
  }

  if (!pendingContent) {
    pendingContent = (async () => {
      const data = await fetchPublicRows<{
        section_key: string
        content: unknown
      }>('public_site_sections', {
        select: 'section_key,content',
        status: 'eq.published',
        section_key: `in.(${publicSiteSectionKeys.join(',')})`,
      })

      if (!data) {
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
