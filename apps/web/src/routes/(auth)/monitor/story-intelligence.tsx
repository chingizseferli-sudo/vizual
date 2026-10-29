import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  AlertCircle,
  Clock3,
  Download,
  FileText,
  Globe2,
  Layers3,
  Loader2,
  MapPinned,
  Newspaper,
  Radio,
  Search,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import { customerQueryKeys } from '@/lib/query-keys'
import { supabase } from '@/lib/supabase'
import { fetchAllMonitorIds } from '@/features/keywords/dashboard'
import { dateLocale, t } from '@/lib/i18n'
import logoSvg from '../../../../public/images/vizual-logo.svg?raw'

const COLLAPSED_ITEM_COUNT = 5
const STORY_PAGE_SIZE = 1000
const STORY_MAX_PAGES = 3
// Headlines of one story are close in time; the same words weeks later are a new story.
const STORY_WINDOW_MS = 72 * 60 * 60 * 1000
const STORY_MIN_SHARED_WORDS = 3
const STORY_MIN_OVERLAP = 0.7
const STORY_MIN_DISTINCT_SHARED_WORDS = 2
// A word in more than this share of all headlines ("yeni", "təyin", "direktor") says nothing about the story.
const STORY_COMMON_WORD_SHARE = 0.04
const STORY_COMMON_WORD_MIN_ITEMS = 20

type StoryMatchRow = {
  id: string
  monitor_id: string
  item_id: string
  matched_keyword: string | null
  created_at: string | null
  monitored_items: {
    title: string | null
    url: string | null
    published_at: string | null
    detected_at: string | null
    status: string | null
  } | null
}

type StoryItem = {
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

type StoryGroup = {
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

type StoryData = {
  groups: StoryGroup[]
  totalRows: number
  errorMessage: string
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

function formatDate(value: string | null) {
  if (!value) return '-'

  return new Date(value).toLocaleString(dateLocale(), {
    timeZone: 'Asia/Baku',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Cells starting with = + - @ would run as formulas when opened in Excel.
function csvCell(value: string | number | null | undefined) {
  let text = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// Only web links become clickable in the exported page.
function safeHref(url: string) {
  return /^https?:\/\//i.test(url) ? escapeHtml(url) : '#'
}

// The export is one offline file, so the logo is embedded instead of linked.
const LOGO_DATA_URI = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(logoSvg)}`

function buildStoriesHtml(groups: StoryGroup[]) {
  const generatedAt = formatDate(new Date().toISOString())
  const sections = groups
    .map((group, index) => {
      const rows = group.items
        .map(
          (item) => `
          <tr>
            <td data-label="${escapeHtml(t("Sayt"))}">${escapeHtml(item.source)}</td>
            <td data-label="${escapeHtml(t("Başlıq"))}"><a href="${safeHref(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a></td>
            <td data-label="${escapeHtml(t("Açar söz"))}">${escapeHtml(item.keyword)}</td>
            <td data-label="${escapeHtml(t("Yayım vaxtı"))}" class="nowrap">${escapeHtml(formatDate(item.detectedAt))}</td>
          </tr>`
        )
        .join('')

      return `
      <section>
        <h2>${index + 1}. ${escapeHtml(group.title)}</h2>
        <p class="meta">${escapeHtml(t("İlk mənbə:"))} ${escapeHtml(group.firstSource)} · ${escapeHtml(formatDate(group.firstDetectedAt))} · ${escapeHtml(t("{0} media", [group.uniqueSourceCount]))}</p>
        <table>
          <thead><tr><th>${escapeHtml(t("Sayt"))}</th><th>${escapeHtml(t("Başlıq"))}</th><th>${escapeHtml(t("Açar söz"))}</th><th>${escapeHtml(t("Yayım vaxtı"))}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`
    })
    .join('')

  return `<!doctype html>
<html lang="az">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(t("Xəbər xəritəsi"))}</title>
    <style>
      *{box-sizing:border-box}
      html{-webkit-text-size-adjust:100%}
      body{margin:0;color:#172033;background:#f5f8ff;font-family:"Segoe UI",Tahoma,Arial,sans-serif}
      .page{max-width:1100px;margin:0 auto;padding:32px 20px}
      header{display:flex;align-items:center;gap:20px;flex-wrap:wrap;border:1px solid #dbe4f5;border-top:5px solid #1e63ff;border-radius:18px;padding:20px 24px;background:#fff}
      header img{display:block;height:56px;width:auto;max-width:100%;border-radius:10px}
      header div{margin-left:auto;text-align:right}
      header h1{margin:0 0 4px;font-size:24px;color:#071a44}
      header p{margin:0;color:#5b6b86;font-size:14px}
      footer{margin-top:22px;text-align:center;color:#5b6b86;font-size:12px}
      section{margin-top:22px;border:1px solid #dbe4f5;border-radius:16px;background:#fff;padding:20px}
      h2{margin:0;font-size:18px;line-height:1.35}
      .meta{margin:6px 0 14px;color:#5b6b86;font-size:14px}
      table{width:100%;border-collapse:collapse;font-size:14px}
      th,td{padding:9px 10px;border-top:1px solid #e6ecf8;text-align:left;vertical-align:top}
      th{border-top:0;color:#5b6b86;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
      a{color:#1463ff;text-decoration:none}
      a:hover{text-decoration:underline}
      .nowrap{white-space:nowrap}
      @media (max-width:640px){
        .page{padding:16px 12px}
        header{flex-direction:column;align-items:flex-start;gap:12px;padding:16px}
        header div{margin-left:0;text-align:left}
        header img{height:44px}
        section{padding:14px}
        table,tbody,tr,td{display:block;width:100%}
        thead{display:none}
        tr{border-top:1px solid #e6ecf8;padding:10px 0}
        tr:first-child{border-top:0}
        td{border:0;padding:3px 0}
        td[data-label]::before{content:attr(data-label);display:block;color:#5b6b86;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
        td a{overflow-wrap:anywhere}
      }
      @media print{body{background:#fff}section{break-inside:avoid}}
    </style>
  </head>
  <body>
    <div class="page">
      <header>
        <img src="${LOGO_DATA_URI}" alt="Vizual.Az" />
        <div>
          <h1>${escapeHtml(t("Xəbər xəritəsi"))}</h1>
          <p>${escapeHtml(generatedAt)} · ${groups.length} ${escapeHtml(t("mövzu"))}</p>
        </div>
      </header>${sections}
      <footer>Vizual.Az</footer>
    </div>
  </body>
</html>`
}

function exportStories(groups: StoryGroup[], format: 'csv' | 'json' | 'html') {
  const stamp = new Date().toISOString().slice(0, 10)

  if (format === 'html') {
    downloadFile(
      `xeber-xeritesi-${stamp}.html`,
      buildStoriesHtml(groups),
      'text/html;charset=utf-8'
    )
    return
  }

  if (format === 'json') {
    const data = groups.map((group, index) => ({
      topic_number: index + 1,
      title: group.title,
      first_source: group.firstSource,
      first_published_at: group.firstDetectedAt,
      media_count: group.uniqueSourceCount,
      items: group.items.map((item) => ({
        source: item.source,
        title: item.title,
        url: item.url,
        published_at: item.detectedAt,
        keywords: item.keyword,
      })),
    }))
    downloadFile(
      `xeber-xeritesi-${stamp}.json`,
      JSON.stringify(data, null, 2),
      'application/json;charset=utf-8'
    )
    return
  }

  const rows: Array<Array<string | number | null>> = [
    [
      t("Mövzu №"),
      t("Mövzu"),
      t("İlk mənbə"),
      t("Media əhatəsi"),
      t("Sayt"),
      t("Başlıq"),
      t("Link"),
      t("Yayım vaxtı"),
      t("Açar söz"),
    ],
  ]
  groups.forEach((group, index) => {
    for (const item of group.items) {
      rows.push([
        index + 1,
        group.title,
        group.firstSource,
        group.uniqueSourceCount,
        item.source,
        item.title,
        item.url,
        formatDate(item.detectedAt),
        item.keyword,
      ])
    }
  })
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n')
  downloadFile(
    `xeber-xeritesi-${stamp}.csv`,
    `\ufeff${csv}`,
    'text/csv;charset=utf-8'
  )
}

function formatTime(value: string | null) {
  if (!value) return '-'

  return new Date(value).toLocaleTimeString(dateLocale(), {
    timeZone: 'Asia/Baku',
    hour: '2-digit',
    minute: '2-digit',
  })
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
  const item = row.monitored_items
  const found = item?.detected_at || row.created_at || null
  const published = item?.published_at || null
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

function timeMs(value: string | null) {
  const ms = value ? new Date(value).getTime() : NaN
  return Number.isFinite(ms) ? ms : 0
}

function minutesBetween(start: string | null, end: string | null) {
  if (!start || !end) return null
  const diff = new Date(end).getTime() - new Date(start).getTime()
  if (!Number.isFinite(diff) || diff < 0) return null
  return Math.round(diff / 60000)
}

function formatSpread(minutes: number | null, total: number) {
  if (minutes === null) return t("{0} media üzrə yayılma", [total])
  if (minutes < 60) return t("İlk {0} dəqiqədə {1} media", [Math.max(1, minutes), total])

  const hours = Math.round(minutes / 60)
  return t("İlk {0} saatda {1} media", [hours, total])
}

function getCoverageLevel(count: number) {
  if (count >= 20) return t("Yüksək")
  if (count >= 8) return t("Orta")
  return t("Aşağı")
}

function getSimilarityLabel(item: StoryItem, firstItem: StoryItem) {
  if (item.normalizedTitle === firstItem.normalizedTitle) return t("Eyni mətn")

  const itemLength = item.normalizedTitle.length
  const firstLength = firstItem.normalizedTitle.length
  if (itemLength > firstLength + 24) return t("Əlavə məlumat əlavə olunub")

  return t("Başlıq dəyişib")
}

function buildStoryGroups(rows: StoryMatchRow[]): StoryGroup[] {
  // One article can match several keywords and may be stored under several
  // URLs: count it once per site and headline and keep every keyword.
  const unique = new Map<string, StoryItem>()

  for (const row of rows) {
    const title = cleanTitle(row.monitored_items?.title)
    const url = row.monitored_items?.url || ''
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
  // chain of look-alikes cannot glue different stories together.
  const clusters: StoryItem[][] = []

  for (const item of items) {
    const mine = wordsOf.get(item) as StoryWords
    const cluster = clusters.find((members) => {
      if (
        Math.abs(timeMs(item.detectedAt) - timeMs(members[0].detectedAt)) >
        STORY_WINDOW_MS
      )
        return false
      const similar = members.filter((member) =>
        sameStory(mine, wordsOf.get(member) as StoryWords)
      ).length
      return similar >= Math.floor(members.length / 2) + 1
    })
    if (cluster) cluster.push(item)
    else clusters.push([item])
  }

  return clusters
    .map((sorted, index) => {
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

async function fetchStoryData(): Promise<StoryData> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      groups: [],
      totalRows: 0,
      errorMessage: t("Sessiya tapılmadı. Zəhmət olmasa yenidən daxil olun."),
    }
  }

  let monitorIds: string[]
  try {
    monitorIds = await fetchAllMonitorIds(user.id)
  } catch {
    return {
      groups: [],
      totalRows: 0,
      errorMessage: t("Nəticələri yükləmək mümkün olmadı."),
    }
  }
  if (monitorIds.length === 0) {
    return { groups: [], totalRows: 0, errorMessage: '' }
  }

  const retentionStart = new Date()
  retentionStart.setDate(retentionStart.getDate() - 31)

  const rows: StoryMatchRow[] = []

  for (let page = 0; page < STORY_MAX_PAGES; page += 1) {
    const from = page * STORY_PAGE_SIZE
    const { data, error } = await supabase
      .from('monitor_matches')
      .select(
        'id,monitor_id,item_id,matched_keyword,created_at,monitored_items(title,url,published_at,detected_at,status)'
      )
      .in('monitor_id', monitorIds)
      .gte('created_at', retentionStart.toISOString())
      .order('created_at', { ascending: false })
      .range(from, from + STORY_PAGE_SIZE - 1)

    if (error) {
      return {
        groups: [],
        totalRows: 0,
        errorMessage: t("Story Intelligence məlumatlarını yükləmək mümkün olmadı."),
      }
    }

    const batch = (data || []) as unknown as StoryMatchRow[]
    rows.push(...batch)
    if (batch.length < STORY_PAGE_SIZE) break
  }

  return {
    groups: buildStoryGroups(rows),
    totalRows: rows.length,
    errorMessage: '',
  }
}

function StoryIntelligence() {
  const [selectedStoryKey, setSelectedStoryKey] = useState<string | null>(null)
  const [isTopicListOpen, setIsTopicListOpen] = useState(false)
  // The story whose full list is open; picking another story collapses it again.
  const [expandedStoryKey, setExpandedStoryKey] = useState<string | null>(null)
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: customerQueryKeys.storyIntelligence(),
    queryFn: fetchStoryData,
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  })

  const storyData = data || { groups: [], totalRows: 0, errorMessage: '' }
  const story = useMemo(() => {
    if (storyData.groups.length === 0) return null
    return (
      storyData.groups.find((group) => group.key === selectedStoryKey) ||
      storyData.groups[0]
    )
  }, [selectedStoryKey, storyData.groups])

  const firstItem = story?.items[0] || null
  const showAll = Boolean(story) && expandedStoryKey === story?.key
  const visibleItems = story
    ? showAll
      ? story.items
      : story.items.slice(0, COLLAPSED_ITEM_COUNT)
    : []
  const canExpand = Boolean(story) && (story?.items.length ?? 0) > COLLAPSED_ITEM_COUNT
  // Fastest follower: the earliest item from a different site than the first.
  const fastest =
    story?.items.find((item) => item.source !== firstItem?.source) || null
  const countMedia = (label: string) =>
    story && firstItem
      ? new Set(
          story.items
            .filter(
              (item) =>
                item.source !== firstItem.source &&
                getSimilarityLabel(item, firstItem) === label
            )
            .map((item) => item.source)
        ).size
      : 0
  const changedTitleCount = countMedia(t('Başlıq dəyişib'))
  const addedInfoCount = countMedia(t('Əlavə məlumat əlavə olunub'))
  const fastestGap =
    fastest && firstItem
      ? minutesBetween(firstItem.detectedAt, fastest.detectedAt)
      : null

  return (
    <section className='min-h-screen bg-muted/50 px-4 py-6 text-foreground sm:px-6 lg:px-8'>
      <div className='mx-auto flex max-w-7xl flex-col gap-6'>
        <section className='rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6'>
          <div className='flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
            <div className='max-w-3xl'>
              <h1 className='text-3xl font-bold tracking-tight sm:text-4xl'>
                {t("Xəbər xəritəsi")}
              </h1>
              <p className='mt-2 text-lg text-muted-foreground'>{t("Xəbərin ilk harada yayımlandığını və mediada necə yayıldığını izləyin.")}</p>
              <p className='mt-3 text-sm text-muted-foreground'>{t("Son 30 gündə tapılan nəticələr mövzular üzrə qruplaşdırılır. Aşağıdakı siyahıdan konkret mövzunu seçib yayılma xəritəsinə baxa bilərsiniz.")}</p>
            </div>
            <button
              type='button'
              onClick={() => void refetch()}
              className='inline-flex w-fit items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-muted/50'
            >
              {isFetching ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : (
                <Search className='h-4 w-4' />
              )}{t("Yenilə")}</button>
          </div>
        </section>

        {isLoading ? (
          <StateCard
            icon={Loader2}
            title={t("Story məlumatları yüklənir")}
            description={t("Mövzular və yayılma ardıcıllığı hazırlanır.")}
            loading
          />
        ) : storyData.errorMessage ? (
          <StateCard
            icon={AlertCircle}
            title={t("Məlumat yüklənmədi")}
            description={storyData.errorMessage}
          />
        ) : !story ? (
          <StateCard
            icon={Newspaper}
            title={t("Hələ yayılma xəritəsi üçün məlumat yoxdur")}
            description={t("Nəticələr toplandıqca eyni mövzu üzrə yayılan xəbərlər burada qruplaşdırılacaq.")}
          />
        ) : (
          <>
            <section className='rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5'>
              <div className='flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between'>
                <div className='min-w-0'>
                  <div className='flex items-center gap-2 text-sm font-medium text-primary'>
                    <MapPinned className='h-4 w-4' />{t("Qruplaşdırılan mövzular")}</div>
                  <h2 className='mt-2 line-clamp-2 text-lg leading-tight font-bold'>
                    {story.title}
                  </h2>
                  <p className='mt-1 text-sm text-muted-foreground'>{t("İlk mənbə:")}{' '}{story.firstSource} ·{' '}
                    {formatTime(story.firstDetectedAt)} ·{' '}
                    {t("{0} media", [story.uniqueSourceCount])}
                  </p>
                </div>
                <div className='flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center'>
                  <span className='rounded-full border border-border bg-muted/50 px-3 py-2 text-sm font-semibold text-foreground'>
                    {storyData.groups.length}{' '}{t("mövzu")}</span>
                  <button
                    type='button'
                    onClick={() => exportStories(storyData.groups, 'csv')}
                    className='inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-muted/50'
                  >
                    <Download className='h-4 w-4' />
                    {t("Hamısını yüklə (CSV)")}
                  </button>
                  <button
                    type='button'
                    onClick={() => exportStories(storyData.groups, 'json')}
                    className='inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-muted/50'
                  >
                    <Download className='h-4 w-4' />
                    JSON
                  </button>
                  <button
                    type='button'
                    onClick={() => exportStories(storyData.groups, 'html')}
                    className='inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-muted/50'
                  >
                    <Download className='h-4 w-4' />
                    HTML
                  </button>
                  <button
                    type='button'
                    onClick={() => setIsTopicListOpen((value) => !value)}
                    className='inline-flex items-center justify-center rounded-xl border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary transition hover:bg-blue-100'
                  >
                    {isTopicListOpen ? t("Siyahını bağla") : t("Bütün mövzuları aç")}
                  </button>
                </div>
              </div>

              {isTopicListOpen ? (
                <div className='mt-4 border-t border-border pt-4'>
                  <div className='mb-3 flex items-center justify-between gap-3'>
                    <p className='text-sm font-semibold text-foreground'>{t("Mövzu siyahısı")}</p>
                    <p className='text-xs text-muted-foreground'>{t("Seçdiyiniz mövzu aşağıdakı xəritədə açılır.")}</p>
                  </div>
                  <div className='max-h-[360px] overflow-y-auto rounded-xl border border-border'>
                    {storyData.groups.map((group) => {
                      const isSelected = group.key === story.key
                      return (
                        <button
                          key={group.key}
                          type='button'
                          onClick={() => {
                            setSelectedStoryKey(group.key)
                            setIsTopicListOpen(false)
                          }}
                          className={
                            isSelected
                              ? 'flex w-full items-center justify-between gap-4 border-b border-border bg-primary/10 px-4 py-3 text-left last:border-b-0'
                              : 'flex w-full items-center justify-between gap-4 border-b border-border px-4 py-3 text-left transition last:border-b-0 hover:bg-muted/50'
                          }
                        >
                          <div className='min-w-0'>
                            <p className='line-clamp-1 leading-snug font-semibold'>
                              {group.title}
                            </p>
                            <p className='mt-1 text-sm text-muted-foreground'>{t("İlk mənbə:")}{' '}{group.firstSource} ·{' '}
                              {formatTime(group.firstDetectedAt)}
                            </p>
                          </div>
                          <span className='shrink-0 rounded-full border border-border bg-card px-3 py-1 text-sm font-semibold text-foreground'>
                            {t("{0} media", [group.uniqueSourceCount])}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </section>

            <section className='grid gap-4 lg:grid-cols-[1.35fr_0.65fr]'>
              <article className='rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6'>
                <div className='flex items-center gap-2 text-sm font-medium text-primary'>
                  <Newspaper className='h-4 w-4' />
                  {t("Mövzunun xülasəsi")}
                </div>
                <h2 className='mt-3 text-2xl leading-tight font-bold'>
                  {story.title}
                </h2>
                <div className='mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
                  <SummaryItem label={t("İlk mənbə")} value={story.firstSource} />
                  <SummaryItem
                    label={t("İlk yayım")}
                    value={formatDate(story.firstDetectedAt)}
                  />
                  <SummaryItem
                    label={t("Media əhatəsi")}
                    value={t("{0} media", [story.uniqueSourceCount])}
                  />
                  <SummaryItem
                    label={t("Yayılma sürəti")}
                    value={formatSpread(
                      story.spreadMinutes,
                      story.uniqueSourceCount
                    )}
                  />
                  <SummaryItem
                    label={t("Əhatə səviyyəsi")}
                    value={story.coverageLevel}
                    tone='strong'
                  />
                  <SummaryItem
                    label={t("Qruplaşdırılan nəticə")}
                    value={t("{0} nəticə", [story.totalCoverage])}
                  />
                </div>
              </article>

              <article className='rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6'>
                <div className='flex items-center gap-2 text-sm font-medium text-primary'>
                  <MapPinned className='h-4 w-4' />
                  {t("Əhatə göstəriciləri")}
                </div>
                <div className='mt-4 grid gap-3'>
                  <InsightItem
                    title={t("İlk paylaşan media")}
                    value={story.firstSource}
                    icon={Radio}
                  />
                  <InsightItem
                    title={t("Ən sürətli götürən media")}
                    value={
                      fastest
                        ? `${fastest.source} · ${formatTime(fastest.detectedAt)}${
                            fastestGap === null ? '' : ` (+${fastestGap} ${t('dəq')})`
                          }`
                        : '-'
                    }
                    icon={Clock3}
                  />
                  <InsightItem
                    title={t("Başlığı dəyişən media sayı")}
                    value={t("{0} media", [changedTitleCount])}
                    icon={FileText}
                  />
                  <InsightItem
                    title={t("Mətnə əlavə edən media sayı")}
                    value={t("{0} media", [addedInfoCount])}
                    icon={Layers3}
                  />
                </div>
              </article>
            </section>

            <section className='grid gap-4 lg:grid-cols-[0.8fr_1.2fr]'>
              <article className='rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6'>
                <div className='flex items-center gap-2 text-sm font-medium text-primary'>
                  <TrendingUp className='h-4 w-4' />
                  {t("Yayılma xətti")}
                </div>
                <div className='mt-5 space-y-4'>
                  {visibleItems.map((item, index) => (
                    <div key={item.id} className='flex gap-3'>
                      <div className='flex flex-col items-center'>
                        <div className='flex h-9 w-9 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-sm font-bold text-primary'>
                          {index + 1}
                        </div>
                        {index < visibleItems.length - 1 ? (
                          <div className='mt-2 h-full min-h-7 w-px bg-slate-200' />
                        ) : null}
                      </div>
                      <div className='min-w-0 pb-2'>
                        <p className='font-semibold'>
                          {formatTime(item.detectedAt)} · {item.source}
                        </p>
                        <p className='text-sm text-muted-foreground'>
                          {item.keyword}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </article>

              <article className='rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6'>
                <div className='flex items-center justify-between gap-3'>
                  <div className='flex items-center gap-2 text-sm font-medium text-primary'>
                    <Globe2 className='h-4 w-4' />
                    {t("Əlaqəli media materialları")}
                  </div>
                  {canExpand ? (
                    <button
                      type='button'
                      onClick={() =>
                        setExpandedStoryKey(showAll ? null : story.key)
                      }
                      className='shrink-0 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold hover:bg-muted/50'
                    >
                      {showAll
                        ? t("Daha az göstər")
                        : t("Hamısına bax ({0})", [story.items.length])}
                    </button>
                  ) : null}
                </div>
                <div className='mt-5 grid gap-3'>
                  {visibleItems.map((item) => (
                    <a
                      key={item.id}
                      href={item.url}
                      target='_blank'
                      rel='noreferrer'
                      className='rounded-xl border border-border bg-muted/50 p-4 transition hover:border-primary/20 hover:bg-primary/10'
                    >
                      <div className='flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between'>
                        <div className='min-w-0'>
                          <p className='text-sm font-medium text-primary'>
                            {item.source}
                          </p>
                          <h3 className='mt-1 leading-snug font-semibold'>
                            {item.title}
                          </h3>
                          <p className='mt-2 text-sm text-muted-foreground'>{t("Yayım vaxtı:")}{' '}{formatDate(item.detectedAt)}
                          </p>
                        </div>
                        <span className='w-fit rounded-full border border-border bg-card px-3 py-1 text-sm font-medium text-foreground'>
                          {firstItem
                            ? getSimilarityLabel(item, firstItem)
                            : t("Oxşar xəbər")}
                        </span>
                      </div>
                    </a>
                  ))}
                </div>
              </article>
            </section>

            <section className='rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6'>
              <div className='flex items-center gap-2 text-sm font-medium text-primary'>
                <FileText className='h-4 w-4' />{t("İstifadəçi üçün izah")}</div>
              <p className='mt-3 max-w-4xl text-muted-foreground'>{t("Bu bölmə eyni mövzu üzrə yayılan media materiallarını qruplaşdırır və xəbərin yayılma ardıcıllığını göstərir. Qruplaşdırma başlıqdakı ortaq sözlərə və 72 saatlıq vaxt pəncərəsinə görə aparılır, sıralama saytın yayım vaxtına əsaslanır. Yalnız sizin açar sözlərinizə uyğun gələn və ən azı 2 mediada çıxan xəbərlər göstərilir.")}</p>
              <div className='mt-4 text-sm text-muted-foreground'>{t("Son 30 gündə yoxlanılan nəticə:")}{' '}{storyData.totalRows}{' '}{t("· Qruplaşdırılan mövzu sayı:")}{' '}{storyData.groups.length}
              </div>
            </section>
          </>
        )}
      </div>
    </section>
  )
}

function StateCard({
  icon: Icon,
  title,
  description,
  loading = false,
}: {
  icon: LucideIcon
  title: string
  description: string
  loading?: boolean
}) {
  return (
    <section className='rounded-2xl border border-border bg-card p-8 text-center shadow-sm'>
      <div className='mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary'>
        <Icon className={loading ? 'h-5 w-5 animate-spin' : 'h-5 w-5'} />
      </div>
      <h2 className='mt-4 text-xl font-bold'>{title}</h2>
      <p className='mx-auto mt-2 max-w-xl text-sm text-muted-foreground'>
        {description}
      </p>
    </section>
  )
}

function SummaryItem({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'strong'
}) {
  return (
    <div className='rounded-xl border border-border bg-muted/50 p-4'>
      <p className='text-sm text-muted-foreground'>{label}</p>
      <p
        className={
          tone === 'strong'
            ? 'mt-1 text-lg font-bold text-primary'
            : 'mt-1 font-semibold'
        }
      >
        {value}
      </p>
    </div>
  )
}

function InsightItem({
  title,
  value,
  icon: Icon,
}: {
  title: string
  value: string
  icon: LucideIcon
}) {
  return (
    <div className='flex items-start gap-3 rounded-xl border border-border bg-muted/50 p-3'>
      <div className='rounded-lg bg-card p-2 text-primary shadow-sm'>
        <Icon className='h-4 w-4' />
      </div>
      <div>
        <p className='text-sm text-muted-foreground'>{title}</p>
        <p className='font-semibold'>{value}</p>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/(auth)/monitor/story-intelligence')({
  component: StoryIntelligence,
})
