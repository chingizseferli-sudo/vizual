// Customer-facing UI language. Azerbaijani is the source language: t() takes
// the Azerbaijani text itself as the key, so the default needs no dictionary
// and adds nothing to the bundle. The Russian dictionary (src/locales/ru.json)
// is loaded once, before the app renders, only for visitors who chose Russian.
// Switching language reloads the page, so no component has to re-render on change.
// The admin panel is always Azerbaijani.

export type Lang = 'az' | 'ru'

export const LANGS: { code: Lang; label: string }[] = [
  { code: 'az', label: 'AZ' },
  { code: 'ru', label: 'RU' },
]

const STORAGE_KEY = 'vizual-lang'

let lang: Lang = 'az'
let dict: Record<string, string> = {}

function readStoredLang(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'ru' ? 'ru' : 'az'
  } catch {
    return 'az'
  }
}

export async function initI18n() {
  const isAdmin = window.location.pathname.startsWith('/admin')
  lang = isAdmin ? 'az' : readStoredLang()
  if (lang === 'ru') {
    try {
      dict = (await import('@/locales/ru.json')).default as Record<
        string,
        string
      >
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

// t('{0} monitor', [count]) → "3 monitor" / "3 мониторов"
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
  return lang === 'ru' ? 'ru-RU' : 'az-AZ'
}
