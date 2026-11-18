// Customer-facing UI language. Azerbaijani is the source language: t() takes
// the Azerbaijani text itself as the key, so the default needs no dictionary
// and adds nothing to the bundle. The Russian and English dictionaries
// (src/locales/ru.json, en.json) are loaded once, before the app renders, only
// for visitors who chose that language. A text missing from a dictionary is
// shown in Azerbaijani.
// Switching language reloads the page, so no component has to re-render on change.
// The admin panel is always Azerbaijani.

export type Lang = 'az' | 'ru' | 'en'

export const LANGS: { code: Lang; label: string }[] = [
  { code: 'az', label: 'AZ' },
  { code: 'ru', label: 'RU' },
  { code: 'en', label: 'EN' },
]

const dictionaries: Record<Exclude<Lang, 'az'>, () => Promise<unknown>> = {
  ru: () => import('@/locales/ru.json'),
  en: () => import('@/locales/en.json'),
}

const STORAGE_KEY = 'vizual-lang'

let lang: Lang = 'az'
let dict: Record<string, string> = {}

function readStoredLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'ru' || stored === 'en' ? stored : 'az'
  } catch {
    return 'az'
  }
}

export async function initI18n() {
  const isAdmin = window.location.pathname.startsWith('/admin')
  lang = isAdmin ? 'az' : readStoredLang()
  if (lang !== 'az') {
    try {
      const module = (await dictionaries[lang]()) as {
        default: Record<string, string>
      }
      dict = module.default
    } catch {
      lang = 'az'
    }
  }
  document.documentElement.lang = lang
  document
    .querySelector('meta[http-equiv="Content-Language"]')
    ?.setAttribute('content', lang)
}

export function getLang(): Lang {
  return lang
}

export function setLang(next: Lang) {
  if (next === lang) return
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Private mode: the choice lasts for this page load only.
  }
  window.location.reload()
}

// t('{0} monitor', [count]) → "3 monitor" / "3 мониторов" / "3 monitors"
export function t(text: string, values?: readonly unknown[]): string {
  const template = dict[text] || text
  if (!values) return template
  return template.replace(/\{(\d+)\}/g, (_match, index: string) => {
    const value = values[Number(index)]
    return value === undefined || value === null ? '' : String(value)
  })
}

// Locale for Intl / toLocaleString calls.
export function dateLocale() {
  if (lang === 'ru') return 'ru-RU'
  if (lang === 'en') return 'en-GB'
  return 'az-AZ'
}
