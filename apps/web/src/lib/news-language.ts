export type NewsLanguage = 'az' | 'ru' | 'en'

const AZ_ONLY_LETTERS = /[əƏ]/
const CYRILLIC = /[Ѐ-ӿ]/g
const LATIN = /[A-Za-zƏəİıĞğŞşÇçÖöÜü]/g
const AZ_WORDS = new Set([
  'və', 'bu', 'üçün', 'ilə', 'bir', 'də', 'da', 'olub', 'edib', 'oldu', 'görə',
  'qədər', 'haqqında', 'olacaq', 'ki', 'çox', 'daha', 'yeni', 'ilk', 'son',
])
const EN_WORDS = new Set([
  'the', 'of', 'and', 'in', 'to', 'for', 'on', 'with', 'is', 'at', 'by', 'from',
  'as', 'after', 'over', 'new', 'says', 'will', 'has', 'are', 'was',
])
const URL_LANGUAGES: Record<string, NewsLanguage> = { az: 'az', ru: 'ru', en: 'en' }

// Sources do not store a language, so it is read from the link first (sites
// with /en/, /ru/ editions) and then from the title itself.
export function detectNewsLanguage(title: string, url: string): NewsLanguage {
  try {
    const parsed = new URL(url)
    const fromPath = URL_LANGUAGES[parsed.pathname.split('/')[1]?.toLowerCase() ?? '']
    if (fromPath) return fromPath
    const fromHost = URL_LANGUAGES[parsed.hostname.split('.')[0].toLowerCase()]
    if (fromHost && parsed.hostname.split('.').length > 2) return fromHost
  } catch {
    // a bad link falls back to the title
  }

  const cyrillic = title.match(CYRILLIC)?.length ?? 0
  const latin = title.match(LATIN)?.length ?? 0
  if (cyrillic > latin) return 'ru'
  if (AZ_ONLY_LETTERS.test(title)) return 'az'

  const words = title.toLocaleLowerCase('az-AZ').match(/[a-zəıöüğşç]+/g) ?? []
  const az = words.filter((word) => AZ_WORDS.has(word)).length
  const en = words.filter((word) => EN_WORDS.has(word)).length
  return en > az ? 'en' : 'az'
}
