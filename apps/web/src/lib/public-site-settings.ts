import { loadSupabase } from '@/lib/supabase-lazy'

export type PublicSiteSettings = {
  id: string
  site_name: string
  site_url: string
  logo_url: string
  icon_url: string
  seo_title: string
  seo_description: string
  og_title: string
  og_description: string
}

export const defaultPublicSiteSettings: PublicSiteSettings = {
  id: 'main',
  site_name: 'Vizual.Az',
  site_url: 'https://vizual.az',
  logo_url: '/images/vizual-logo.svg',
  icon_url: '/images/vizual-icon.svg',
  seo_title:
    'Vizual.Az - Kommunikasiya v\u0259 Media Monitorinq Platformas\u0131',
  seo_description:
    'Media m\u0259nb\u0259l\u0259rind\u0259 yay\u0131mlanan materiallar\u0131, vebsayt d\u0259yi\u015fiklikl\u0259rini v\u0259 t\u0259\u015fkilat\u0131n\u0131z haqq\u0131nda vacib m\u0259lumatlar\u0131 bir platformadan izl\u0259yin.',
  og_title: 'Vizual.Az',
  og_description:
    'Media monitorinqi, vebsayt d\u0259yi\u015fiklikl\u0259ri v\u0259 vacib bildiri\u015fl\u0259r bir platformada.',
}

const CACHE_TTL_MS = 5 * 60 * 1000
let settingsCache: { value: PublicSiteSettings; expiresAt: number } | null =
  null
let pendingSettings: Promise<PublicSiteSettings> | null = null

function isAllowedAssetUrl(value: string) {
  if (value.startsWith('/') && !value.startsWith('//')) return true

  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function validatePublicSiteSettings(settings: PublicSiteSettings) {
  if (!settings.site_name.trim() || settings.site_name.length > 100) {
    throw new Error('Sayt adı 1–100 simvol arasında olmalıdır.')
  }

  if (!isHttpUrl(settings.site_url)) {
    throw new Error('Sayt URL-i düzgün http/https ünvanı olmalıdır.')
  }

  if (
    !isAllowedAssetUrl(settings.logo_url) ||
    !isAllowedAssetUrl(settings.icon_url)
  ) {
    throw new Error(
      'Logo və ikon URL-ləri nisbi və ya http/https ünvanı olmalıdır.'
    )
  }

  if (settings.seo_title.length > 200 || settings.og_title.length > 200) {
    throw new Error(
      'SEO və Open Graph başlıqları 200 simvoldan uzun olmamalıdır.'
    )
  }

  if (
    settings.seo_description.length > 500 ||
    settings.og_description.length > 500
  ) {
    throw new Error('SEO təsvirləri 500 simvoldan uzun olmamalıdır.')
  }
}

export async function loadPublicSiteSettings() {
  if (settingsCache && settingsCache.expiresAt > Date.now()) {
    return settingsCache.value
  }

  if (!pendingSettings) {
    pendingSettings = (async () => {
      const supabase = await loadSupabase()
      const { data, error } = await supabase
        .from('public_site_settings')
        .select(
          'id, site_name, site_url, logo_url, icon_url, seo_title, seo_description, og_title, og_description'
        )
        .eq('id', 'main')
        .maybeSingle()

      const value =
        error || !data
          ? defaultPublicSiteSettings
          : ({
              ...defaultPublicSiteSettings,
              ...data,
            } satisfies PublicSiteSettings)

      if (!error && data) {
        settingsCache = { value, expiresAt: Date.now() + CACHE_TTL_MS }
      }

      return value
    })().finally(() => {
      pendingSettings = null
    })
  }

  return pendingSettings
}

export async function savePublicSiteSettings(settings: PublicSiteSettings) {
  validatePublicSiteSettings(settings)

  const supabase = await loadSupabase()
  const { error } = await supabase.from('public_site_settings').upsert({
    ...settings,
    id: 'main',
    updated_at: new Date().toISOString(),
  })

  if (error) throw error

  settingsCache = {
    value: settings,
    expiresAt: Date.now() + CACHE_TTL_MS,
  }
}

function setMeta(
  name: string,
  content: string,
  attr: 'name' | 'property' = 'name'
) {
  if (!content) return

  let tag = document.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`)

  if (!tag) {
    tag = document.createElement('meta')
    tag.setAttribute(attr, name)
    document.head.appendChild(tag)
  }

  tag.content = content
}

export function applyPublicSiteMetadata(settings: PublicSiteSettings) {
  document.title = settings.seo_title || settings.site_name
  setMeta('description', settings.seo_description)
  setMeta('og:title', settings.og_title || settings.seo_title, 'property')
  setMeta(
    'og:description',
    settings.og_description || settings.seo_description,
    'property'
  )
  setMeta('og:site_name', settings.site_name, 'property')
  setMeta('og:image', settings.logo_url || settings.icon_url, 'property')
  setMeta('twitter:image', settings.logo_url || settings.icon_url)

  if (settings.icon_url) {
    const icons = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')

    if (!icons.length) {
      const icon = document.createElement('link')
      icon.rel = 'icon'
      document.head.appendChild(icon)
      icon.href = settings.icon_url
      return
    }

    icons.forEach((icon) => {
      icon.href = settings.icon_url
    })
  }
}
