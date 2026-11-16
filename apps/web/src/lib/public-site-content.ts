import { fetchPublicRows } from '@/lib/supabase-lazy'
import { getLang, t } from '@/lib/i18n'

export type PublicService = {
  title: string
  description: string
  status: string
  icon: 'newspaper' | 'radio' | 'megaphone' | 'file' | 'search'
}

export function splitServices(items: PublicService[]) {
  const soon = t("Tezliklə")
  return {
    live: items.filter((item) => item.status !== soon),
    soon: items.filter((item) => item.status === soon),
  }
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
  'blog',
  'about',
  'contact',
] as const

export type PublicSiteSectionKey = (typeof publicSiteSectionKeys)[number]

const CACHE_TTL_MS = 5 * 60 * 1000
let contentCache: { value: PublicSiteContent; expiresAt: number } | null = null
let pendingContent: Promise<PublicSiteContent> | null = null

// The last content loaded from the database is kept in this browser so a
// refresh starts from it. Without it every refresh first paints the built-in
// defaults and then swaps in the edited texts, so the page looks different.
const STORED_CONTENT_KEY = 'vizual-public-site-v1'

function readStoredContent(): PublicSiteContent | null {
  try {
    const raw = localStorage.getItem(STORED_CONTENT_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!isRecord(parsed)) return null
    return mergeWithDefaults(defaultPublicSiteContent, parsed)
  } catch {
    return null
  }
}

function storeContent(value: PublicSiteContent) {
  try {
    localStorage.setItem(STORED_CONTENT_KEY, JSON.stringify(value))
  } catch {
    // Private mode or full storage: the page still works, it just repaints.
  }
}

export function initialPublicSiteContent(): PublicSiteContent {
  if (getLang() === 'ru') return defaultPublicSiteContent
  return contentCache?.value ?? readStoredContent() ?? defaultPublicSiteContent
}

export const defaultPublicSiteContent: PublicSiteContent = {
  hero: {
    badge: t("Azərbaycan mediası üçün monitorinq"),
    tagline: t("Adınız xəbərə düşəndə ilk siz bilin."),
    description:
      t("Vizual 280-dən çox Azərbaycan xəbər saytını hər 15 dəqiqədən bir, Facebook və Instagram-ı isə planınıza görə yoxlayır. Açar sözünüz harada çıxsa, linki Telegram-a göndəririk. Səhər mətbuat icmalını əl ilə yığmağa ehtiyac qalmır."),
    primaryCta: t("7 gün pulsuz sına"),
    secondaryCta: t("İstifadəçi girişi"),
  },
  services: {
    eyebrow: t("Xidmətlər"),
    title: t("Vizual.Az nə edir?"),
    description:
      t("Media gündəmini, sosial şəbəkələri və təşkilatınız haqqında yayımlanan məlumatları bir platformadan izləyin."),
    items: [
      {
        title: t("Media monitorinqi"),
        description: t("Açar sözlərinizlə bağlı yerli media xəbərlərini avtomatik toplayır."),
        icon: 'newspaper',
        status: t("Aktiv"),
      },
      {
        title: t("Facebook və Instagram"),
        description: t("Açar sözlərinizlə bağlı paylaşımları izləyir və Telegram-a göndərir."),
        icon: 'file',
        status: 'Beta',
      },
      {
        title: t("Kommunikasiya analitikası"),
        description: t("Nəticələrin ümumi mənzərəsi və kommunikasiyanın effektivliyi."),
        icon: 'megaphone',
        status: t("Tezliklə"),
      },
      {
        title: t("Qlobal xəbər axını"),
        description: t("Beynəlxalq mənbələrdə seçdiyiniz mövzular üzrə xəbərlər."),
        icon: 'search',
        status: t("Tezliklə"),
      },
    ],
  },
  audiences: {
    eyebrow: t("Kimlər üçündür?"),
    title: t("Vizual-ı kim, nə üçün işlədir"),
    items: [
      {
        title: t("Universitetin mətbuat xidməti"),
        description:
          t("Əvvəl hər səhər 20 saytı açıb universitetin adını axtarırdılar. İndi axşamdan bəri çıxan hər xəbər Telegram-dadır, həftəlik hesabat isə emailə gəlir."),
      },
      {
        title: t("Bankın PR komandası"),
        description:
          t("Müştəri şikayəti Facebook-da çıxanda bildiriş gəlir. Cavab saatlar sonra yox, eyni səhər verilir."),
      },
      {
        title: t("PR agentliyi"),
        description:
          t("Hər müştərinin adı ayrıca açar sözdür. Kampaniyadan sonra neçə saytda çıxdığını saymaq üçün nəticələri bir kliklə ixrac edirsiniz."),
      },
    ],
  },
  demo: {
    eyebrow: t("Sınaq"),
    title: t("Vizual.Az-ı 7 gün sınaqdan keçirin"),
    description:
      t("Sınaq müddətində açar sözlərinizi əlavə edin, nəticələri və bildiriş axınını real iş prosesinizdə test edin."),
    primaryCta: t("7 gün pulsuz sına"),
    secondaryCta: t("Sınaq müraciəti"),
    placeholderTitle: t("Sınaq və məhsul təqdimatı"),
    placeholderDescription:
      t("Burada məhsul turu, qısa təqdimat videosu və ya iş masası nümunəsi yerləşdirilə bilər."),
    items: [
      {
        title: t("Qəbul imtahanlarının cədvəli açıqlandı"),
        source: 'report.az',
        keyword: t("qəbul imtahanı"),
        time: '09:12',
      },
      {
        title: t("İpoteka faizləri ilə bağlı paylaşım, 48 rəy"),
        source: 'facebook.com',
        keyword: t("ipoteka"),
        time: '08:47',
      },
      {
        title: t("Bakı metrosunda qatarların hərəkət qrafiki dəyişir"),
        source: 'apa.az',
        keyword: t("Bakı metrosu"),
        time: '08:21',
      },
    ],
  },
  pricing: {
    eyebrow: t("Qiymətlər"),
    title: t("Sınaqdan başlayın, ehtiyacınıza uyğun böyüdün"),
    description:
      t("Qiymətlərə ƏDV daxildir. Telegram bildirişləri bütün planlarda xəbər tapılan kimi göndərilir."),
    plans: [
      {
        name: t("Demo"),
        price: t("Pulsuz, 7 gün"),
        description: t("Məhsulu tanımaq və ilk nəticələri görmək üçün."),
        features: [
          t("5 açar söz"),
          t("Bütün xəbər saytları"),
          t("Telegram bildirişləri"),
          t("Facebook və Instagram: 3 söz, gündə 1 dəfə"),
        ],
      },
      {
        name: t("Başlanğıc"),
        price: t("100 AZN / ay"),
        description: t("Kiçik komandalar və ilkin media monitorinqi üçün."),
        features: [
          t("10 açar söz"),
          t("Bütün xəbər saytları"),
          t("Telegram bildirişləri"),
          t("Həftəlik email hesabatı"),
        ],
      },
      {
        name: 'Pro',
        price: t("300 AZN / ay"),
        description: t("Aktiv PR və kommunikasiya komandaları üçün."),
        features: [
          t("30 açar söz"),
          t("Facebook və Instagram: 10 söz, gündə 1 dəfə"),
          t("3 rəqib üzrə AI analizi"),
          t("Gündəlik və həftəlik email hesabatı"),
        ],
      },
      {
        name: t("Biznes"),
        price: t("599 AZN-dən / ay"),
        description: t("Böyük təşkilatlar üçün, şərtlər razılaşma ilə."),
        features: [
          t("100 açar söz"),
          t("Facebook, Instagram, X və LinkedIn: 30 söz, gündə 4 dəfə"),
          t("YouTube: gündə 1 dəfə"),
          t("5 rəqib üzrə AI analizi"),
          t("Gündəlik, həftəlik və aylıq hesabat"),
        ],
      },
    ],
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
          t("Açar sözlər üzrə vacib xəbərlər və paylaşımlar vaxtında görünür."),
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
      t("Vizual.Az-ı komandanızın media monitorinqi, sosial şəbəkə izləmə və bildiriş ehtiyaclarına görə necə istifadə edə biləcəyinizi birlikdə nəzərdən keçirək."),
    cardTitle: t("Sınaq müraciəti"),
    cardDescription:
      t("Formu doldurun, komandamız sizinlə əlaqə saxlayacaq."),
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
        return initialPublicSiteContent()
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
      storeContent(value)
      return value
    })().finally(() => {
      pendingContent = null
    })
  }

  return pendingContent
}

export function invalidatePublicSiteContentCache() {
  contentCache = null
  try {
    localStorage.removeItem(STORED_CONTENT_KEY)
  } catch {
    // Nothing stored or storage unavailable.
  }
}
