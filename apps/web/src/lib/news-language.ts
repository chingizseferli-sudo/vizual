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

function languageFromUrl(url: string): NewsLanguage | null {
  try {
    const parsed = new URL(url)
    const fromPath = URL_LANGUAGES[parsed.pathname.split('/')[1]?.toLowerCase() ?? '']
    if (fromPath) return fromPath
    const fromHost = URL_LANGUAGES[parsed.hostname.split('.')[0].toLowerCase()]
    if (fromHost && parsed.hostname.split('.').length > 2) return fromHost
  } catch {
    // a bad link says nothing
  }
  return null
}

// Sources do not store a language. The title's script decides first: a
// Cyrillic title is Russian and a Latin one never is, even when the link sits
// under /ru/ (sites put Azerbaijani articles there too). Between Azerbaijani
// and English the edition in the link (/en/, en.site.az) decides, then the
// title's letters and words.
export function detectNewsLanguage(title: string, url: string): NewsLanguage {
  const fromUrl = languageFromUrl(url)
  const cyrillic = title.match(CYRILLIC)?.length ?? 0
  const latin = title.match(LATIN)?.length ?? 0
  if (cyrillic + latin === 0) return fromUrl ?? 'az'
  if (cyrillic > latin) return 'ru'
  if (AZ_ONLY_LETTERS.test(title)) return 'az'
  if (fromUrl && fromUrl !== 'ru') return fromUrl

  const words = title.toLocaleLowerCase('az-AZ').match(/[a-zəıöüğşç]+/g) ?? []
  const az = words.filter((word) => AZ_WORDS.has(word)).length
  const en = words.filter((word) => EN_WORDS.has(word)).length
  return en > az ? 'en' : 'az'
}
