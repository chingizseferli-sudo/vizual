import { t } from '@/lib/i18n'

// Headlines of one story are close in time; the same words weeks later are a new story.
const STORY_WINDOW_MS = 72 * 60 * 60 * 1000
const STORY_MIN_SHARED_WORDS = 3
const STORY_MIN_OVERLAP = 0.7
const STORY_MIN_DISTINCT_SHARED_WORDS = 2
// A word in more than this share of all headlines ("yeni", "təyin", "direktor") says nothing about the story.
const STORY_COMMON_WORD_SHARE = 0.04
const STORY_COMMON_WORD_MIN_ITEMS = 20

// One row of my_story_matches(): a match with the article fields it groups by.
export type StoryMatchRow = {
  id: string
  item_id: string
  matched_keyword: string | null
  created_at: string | null
  title: string | null
  url: string | null
  published_at: string | null
  detected_at: string | null
}

export type StoryItem = {
  id: string
  title: string
  normalizedTitle: string
  words: Set<string>
  source: string
  url: string
  // When the article was published; falls back to when the bot found it.
  detectedAt: string | null
  keyword: string
}

export type StoryGroup = {
  key: string
  title: string
  firstSource: string
  firstDetectedAt: string | null
  totalCoverage: number
  uniqueSourceCount: number
  spreadMinutes: number | null
  coverageLevel: string
  items: StoryItem[]
}

function decodeHtml(text: string) {
  if (typeof document === 'undefined') return text
  const textarea = document.createElement('textarea')
  textarea.innerHTML = text
  return textarea.value
}

function cleanTitle(title: string | null | undefined) {
  return decodeHtml(title || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeTitle(title: string) {
  return title
    .toLocaleLowerCase('az-AZ')
    .replace(/[“”"'.:,;!?()[\]{}<>/\\|_-]+/g, ' ')
    .replace(/\b\d{1,2}[:.]\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getHost(url: string | null | undefined) {
  if (!url) return t("Mənbə yoxdur")

  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

// Order by when the site published the article. The bot's detection time
// depends on its crawl order and on blocked sites, so it only backs up a
// missing or implausible publish time (empty, or later than detection).
function getDetectedAt(row: StoryMatchRow) {
  const found = row.detected_at || row.created_at || null
  const published = row.published_at || null
  if (!published) return found
  if (!found) return published

  const publishedMs = new Date(published).getTime()
  const foundMs = new Date(found).getTime()
  if (!Number.isFinite(publishedMs)) return found
  if (Number.isFinite(foundMs) && publishedMs > foundMs + 5 * 60 * 1000) {
    return found
  }
  return published
}

// Word stems (first 5 letters) so Azerbaijani case endings do not split a story.
function titleWords(normalizedTitle: string) {
  return new Set(
    normalizedTitle
      .split(' ')
      .filter((word) => word.length > 2)
      .map((word) => word.slice(0, 5))
  )
}

function sharedWordCount(a: Set<string>, b: Set<string>) {
  let shared = 0
  for (const word of a) if (b.has(word)) shared += 1
  return shared
}

// `words` are all headline words, `distinct` the ones left after dropping common words.
type StoryWords = { words: Set<string>; distinct: Set<string> }

function sameStory(a: StoryWords, b: StoryWords) {
  // Two headlines that differ only in a place or a name ("Bakıda müəllim vəfat etdi"
  // vs "Beyləqanda müəllim vəfat edib") share generic words but are different stories,
  // so enough of the shared words must be uncommon ones.
  const distinctShared = sharedWordCount(a.distinct, b.distinct)
  if (distinctShared < STORY_MIN_DISTINCT_SHARED_WORDS) return false
  if (sharedWordCount(a.words, b.words) < STORY_MIN_SHARED_WORDS) return false
  return (
    distinctShared / Math.min(a.distinct.size, b.distinct.size) >=
    STORY_MIN_OVERLAP
  )
}

export function timeMs(value: string | null) {
  const ms = value ? new Date(value).getTime() : NaN
  return Number.isFinite(ms) ? ms : 0
}

export function minutesBetween(start: string | null, end: string | null) {
  if (!start || !end) return null
  const diff = new Date(end).getTime() - new Date(start).getTime()
  if (!Number.isFinite(diff) || diff < 0) return null
  return Math.round(diff / 60000)
}

function getCoverageLevel(count: number) {
  if (count >= 20) return t("Yüksək")
  if (count >= 8) return t("Orta")
  return t("Aşağı")
}

type Cluster = { members: StoryItem[]; startMs: number }

export function buildStoryGroups(rows: StoryMatchRow[]): StoryGroup[] {
  // One article can match several keywords and may be stored under several
  // URLs: count it once per site and headline and keep every keyword.
  const unique = new Map<string, StoryItem>()

  for (const row of rows) {
    const title = cleanTitle(row.title)
    const url = row.url || ''
    if (!title || !url) continue

    const source = getHost(url)
    const normalizedTitle = normalizeTitle(title)
    const keyword = row.matched_keyword || t("Açar söz")
    const key = `${source}|${normalizedTitle}`
    const existing = unique.get(key)

    if (existing) {
      const keywords = existing.keyword.split(', ')
      if (!keywords.includes(keyword)) existing.keyword += `, ${keyword}`
      const at = getDetectedAt(row)
      if (timeMs(at) && (!existing.detectedAt || timeMs(at) < timeMs(existing.detectedAt))) {
        existing.detectedAt = at
      }
      continue
    }

    unique.set(key, {
      id: row.id,
      title,
      normalizedTitle,
      words: titleWords(normalizedTitle),
      source,
      url,
      detectedAt: getDetectedAt(row),
      keyword,
    })
  }

  // Cluster by shared headline words, oldest first, within a time window.
  const items = [...unique.values()].sort(
    (a, b) => timeMs(a.detectedAt) - timeMs(b.detectedAt)
  )

  // Words that appear in many unrelated headlines must not join stories.
  const common = new Set<string>()
  if (items.length >= STORY_COMMON_WORD_MIN_ITEMS) {
    const counts = new Map<string, number>()
    for (const item of items)
      for (const word of item.words) counts.set(word, (counts.get(word) || 0) + 1)
    for (const [word, count] of counts)
      if (count / items.length > STORY_COMMON_WORD_SHARE) common.add(word)
  }
  const wordsOf = new Map<StoryItem, StoryWords>(
    items.map((item) => [
      item,
      {
        words: item.words,
        distinct: new Set([...item.words].filter((word) => !common.has(word))),
      },
    ])
  )

  // A headline joins a story only if it resembles most of its members, so a
  // chain of look-alikes cannot glue different stories together. It joins
  // the oldest such story. Only stories holding one of its uncommon words can
  // qualify (sameStory needs shared uncommon words), so those are looked up
  // by word instead of comparing the headline with every story.
  const clusters: Cluster[] = []
  const clustersByWord = new Map<string, number[]>()

  for (const item of items) {
    const mine = wordsOf.get(item) as StoryWords
    const itemMs = timeMs(item.detectedAt)
    const candidates = new Set<number>()
    for (const word of mine.distinct)
      for (const index of clustersByWord.get(word) ?? []) candidates.add(index)

    let joined: number | undefined
    for (const index of [...candidates].sort((a, b) => a - b)) {
      const cluster = clusters[index]
      if (Math.abs(itemMs - cluster.startMs) > STORY_WINDOW_MS) continue
      const similar = cluster.members.filter((member) =>
        sameStory(mine, wordsOf.get(member) as StoryWords)
      ).length
      if (similar >= Math.floor(cluster.members.length / 2) + 1) {
        joined = index
        break
      }
    }

    if (joined === undefined) {
      joined = clusters.length
      clusters.push({ members: [item], startMs: itemMs })
    } else {
      clusters[joined].members.push(item)
    }
    for (const word of mine.distinct) {
      const indexes = clustersByWord.get(word)
      if (!indexes) clustersByWord.set(word, [joined])
      else if (indexes[indexes.length - 1] !== joined) indexes.push(joined)
    }
  }

  return clusters
    .map(({ members: sorted }, index) => {
      const first = sorted[0]
      const last = sorted[sorted.length - 1]
      const sources = new Set(sorted.map((item) => item.source))
      const spreadMinutes = minutesBetween(
        first?.detectedAt || null,
        last?.detectedAt || null
      )

      return {
        key: `${index}-${first.normalizedTitle.slice(0, 40)}`,
        title: first?.title || t("Xəbər mövzusu"),
        firstSource: first?.source || '-',
        firstDetectedAt: first?.detectedAt || null,
        totalCoverage: sorted.length,
        uniqueSourceCount: sources.size,
        spreadMinutes,
        coverageLevel: getCoverageLevel(sources.size),
        items: sorted,
      } satisfies StoryGroup
    })
    .filter((group) => group.uniqueSourceCount >= 2)
    .sort((a, b) => {
      if (b.uniqueSourceCount !== a.uniqueSourceCount)
        return b.uniqueSourceCount - a.uniqueSourceCount
      if (b.totalCoverage !== a.totalCoverage)
        return b.totalCoverage - a.totalCoverage
      return timeMs(b.firstDetectedAt) - timeMs(a.firstDetectedAt)
    })
}
