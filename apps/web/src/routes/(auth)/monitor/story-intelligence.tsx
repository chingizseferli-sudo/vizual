import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  AlertCircle,
  Clock3,
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

const STORY_FETCH_LIMIT = 700

type StoryMatchRow = {
  id: string
  monitor_id: string
  item_id: string
  matched_keyword: string | null
  created_at: string | null
  user_monitors: {
    name: string | null
  } | null
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
  source: string
  url: string
  detectedAt: string | null
  keyword: string
  monitor: string
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

function makeStoryKey(title: string, keyword: string) {
  const normalized = normalizeTitle(title)
  const tokens = normalized
    .split(' ')
    .filter((token) => token.length > 2)
    .slice(0, 8)

  if (tokens.length >= 4) return tokens.join('-')
  return `${keyword || 'story'}-${tokens.join('-') || normalized}`
}

function formatDate(value: string | null) {
  if (!value) return '-'

  return new Date(value).toLocaleString('az-AZ', {
    timeZone: 'Asia/Baku',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatTime(value: string | null) {
  if (!value) return '-'

  return new Date(value).toLocaleTimeString('az-AZ', {
    timeZone: 'Asia/Baku',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getHost(url: string | null | undefined) {
  if (!url) return 'Mənbə yoxdur'

  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function getDetectedAt(row: StoryMatchRow) {
  return (
    row.monitored_items?.detected_at ||
    row.created_at ||
    row.monitored_items?.published_at ||
    null
  )
}

function minutesBetween(start: string | null, end: string | null) {
  if (!start || !end) return null
  const diff = new Date(end).getTime() - new Date(start).getTime()
  if (!Number.isFinite(diff) || diff < 0) return null
  return Math.round(diff / 60000)
}

function formatSpread(minutes: number | null, total: number) {
  if (minutes === null) return `${total} media üzrə yayılma`
  if (minutes < 60) return `İlk ${Math.max(1, minutes)} dəqiqədə ${total} media`

  const hours = Math.round(minutes / 60)
  return `İlk ${hours} saatda ${total} media`
}

function getCoverageLevel(count: number) {
  if (count >= 20) return 'Yüksək'
  if (count >= 8) return 'Orta'
  return 'Aşağı'
}

function getSimilarityLabel(item: StoryItem, firstItem: StoryItem) {
  if (item.normalizedTitle === firstItem.normalizedTitle) return 'Eyni mətn'

  const itemLength = item.normalizedTitle.length
  const firstLength = firstItem.normalizedTitle.length
  if (itemLength > firstLength + 24) return 'Əlavə məlumat əlavə olunub'

  return 'Başlıq dəyişib'
}

function buildStoryGroups(rows: StoryMatchRow[]): StoryGroup[] {
  const items = rows
    .map((row) => {
      const title = cleanTitle(row.monitored_items?.title)
      const url = row.monitored_items?.url || ''
      const keyword = row.matched_keyword || 'Açar söz'

      if (!title || !url) return null

      return {
        id: row.id,
        title,
        normalizedTitle: normalizeTitle(title),
        source: getHost(url),
        url,
        detectedAt: getDetectedAt(row),
        keyword,
        monitor: row.user_monitors?.name || 'Monitor',
      } satisfies StoryItem
    })
    .filter(Boolean) as StoryItem[]

  const map = new Map<string, StoryItem[]>()

  for (const item of items) {
    const key = makeStoryKey(item.title, item.keyword)
    const current = map.get(key) || []
    current.push(item)
    map.set(key, current)
  }

  return [...map.entries()]
    .map(([key, groupItems]) => {
      const sorted = [...groupItems].sort((a, b) => {
        const aTime = a.detectedAt ? new Date(a.detectedAt).getTime() : 0
        const bTime = b.detectedAt ? new Date(b.detectedAt).getTime() : 0
        return aTime - bTime
      })
      const first = sorted[0]
      const last = sorted[sorted.length - 1]
      const sources = new Set(sorted.map((item) => item.source))
      const spreadMinutes = minutesBetween(
        first?.detectedAt || null,
        last?.detectedAt || null
      )

      return {
        key,
        title: first?.title || 'Xəbər mövzusu',
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
      const aTime = a.firstDetectedAt
        ? new Date(a.firstDetectedAt).getTime()
        : 0
      const bTime = b.firstDetectedAt
        ? new Date(b.firstDetectedAt).getTime()
        : 0
      return bTime - aTime
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
      errorMessage: 'Sessiya tapılmadı. Zəhmət olmasa yenidən daxil olun.',
    }
  }

  const { data: monitors, error: monitorsError } = await supabase
    .from('user_monitors')
    .select('id')
    .eq('user_id', user.id)

  if (monitorsError) {
    return {
      groups: [],
      totalRows: 0,
      errorMessage: 'Monitor məlumatlarını yükləmək mümkün olmadı.',
    }
  }

  const monitorIds = (monitors || []).map((monitor) => monitor.id)
  if (monitorIds.length === 0) {
    return { groups: [], totalRows: 0, errorMessage: '' }
  }

  const retentionStart = new Date()
  retentionStart.setDate(retentionStart.getDate() - 31)

  const { data, error } = await supabase
    .from('monitor_matches')
    .select(
      'id,monitor_id,item_id,matched_keyword,created_at,user_monitors(name),monitored_items(title,url,published_at,detected_at,status)'
    )
    .in('monitor_id', monitorIds)
    .gte('created_at', retentionStart.toISOString())
    .order('created_at', { ascending: false })
    .limit(STORY_FETCH_LIMIT)

  if (error) {
    return {
      groups: [],
      totalRows: 0,
      errorMessage: 'Story Intelligence məlumatlarını yükləmək mümkün olmadı.',
    }
  }

  const rows = (data || []) as unknown as StoryMatchRow[]

  return {
    groups: buildStoryGroups(rows),
    totalRows: rows.length,
    errorMessage: '',
  }
}

function StoryIntelligence() {
  const [selectedStoryKey, setSelectedStoryKey] = useState<string | null>(null)
  const [isTopicListOpen, setIsTopicListOpen] = useState(false)
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
  const fastest = story?.items[1] || story?.items[0] || null
  const changedTitleCount =
    story && firstItem
      ? story.items.filter(
          (item) => getSimilarityLabel(item, firstItem) === 'Başlıq dəyişib'
        ).length
      : 0
  const addedInfoCount =
    story && firstItem
      ? story.items.filter(
          (item) =>
            getSimilarityLabel(item, firstItem) === 'Əlavə məlumat əlavə olunub'
        ).length
      : 0

  return (
    <section className='min-h-screen bg-muted/50 px-4 py-6 text-foreground sm:px-6 lg:px-8'>
      <div className='mx-auto flex max-w-7xl flex-col gap-6'>
        <section className='rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6'>
          <div className='flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
            <div className='max-w-3xl'>
              <h1 className='text-3xl font-bold tracking-tight sm:text-4xl'>
                Story Intelligence
              </h1>
              <p className='mt-2 text-lg text-muted-foreground'>
                Xəbərin ilk harada yayımlandığını və mediada necə yayıldığını
                izləyin.
              </p>
              <p className='mt-3 text-sm text-muted-foreground'>
                Son 30 gündə tapılan nəticələr mövzular üzrə qruplaşdırılır.
                Aşağıdakı siyahıdan konkret mövzunu seçib yayılma xəritəsinə
                baxa bilərsiniz.
              </p>
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
              )}
              Yenilə
            </button>
          </div>
        </section>

        {isLoading ? (
          <StateCard
            icon={Loader2}
            title='Story məlumatları yüklənir'
            description='Mövzular və yayılma ardıcıllığı hazırlanır.'
            loading
          />
        ) : storyData.errorMessage ? (
          <StateCard
            icon={AlertCircle}
            title='Məlumat yüklənmədi'
            description={storyData.errorMessage}
          />
        ) : !story ? (
          <StateCard
            icon={Newspaper}
            title='Hələ yayılma xəritəsi üçün məlumat yoxdur'
            description='Monitor nəticələri toplandıqca eyni mövzu üzrə yayılan xəbərlər burada qruplaşdırılacaq.'
          />
        ) : (
          <>
            <section className='rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5'>
              <div className='flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between'>
                <div className='min-w-0'>
                  <div className='flex items-center gap-2 text-sm font-medium text-primary'>
                    <MapPinned className='h-4 w-4' />
                    Qruplaşdırılan mövzular
                  </div>
                  <h2 className='mt-2 line-clamp-2 text-lg leading-tight font-bold'>
                    {story.title}
                  </h2>
                  <p className='mt-1 text-sm text-muted-foreground'>
                    İlk mənbə: {story.firstSource} ·{' '}
                    {formatTime(story.firstDetectedAt)} ·{' '}
                    {story.uniqueSourceCount} media
                  </p>
                </div>
                <div className='flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center'>
                  <span className='rounded-full border border-border bg-muted/50 px-3 py-2 text-sm font-semibold text-foreground'>
                    {storyData.groups.length} mövzu
                  </span>
                  <button
                    type='button'
                    onClick={() => setIsTopicListOpen((value) => !value)}
                    className='inline-flex items-center justify-center rounded-xl border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary transition hover:bg-blue-100'
                  >
                    {isTopicListOpen ? 'Siyahını bağla' : 'Bütün mövzuları aç'}
                  </button>
                </div>
              </div>

              {isTopicListOpen ? (
                <div className='mt-4 border-t border-border pt-4'>
                  <div className='mb-3 flex items-center justify-between gap-3'>
                    <p className='text-sm font-semibold text-foreground'>
                      Mövzu siyahısı
                    </p>
                    <p className='text-xs text-muted-foreground'>
                      Seçdiyiniz mövzu aşağıdakı xəritədə açılır.
                    </p>
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
                            <p className='mt-1 text-sm text-muted-foreground'>
                              İlk mənbə: {group.firstSource} ·{' '}
                              {formatTime(group.firstDetectedAt)}
                            </p>
                          </div>
                          <span className='shrink-0 rounded-full border border-border bg-card px-3 py-1 text-sm font-semibold text-foreground'>
                            {group.uniqueSourceCount} media
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
                  Story Summary
                </div>
                <h2 className='mt-3 text-2xl leading-tight font-bold'>
                  {story.title}
                </h2>
                <div className='mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
                  <SummaryItem label='İlk mənbə' value={story.firstSource} />
                  <SummaryItem
                    label='İlk aşkarlanma'
                    value={formatDate(story.firstDetectedAt)}
                  />
                  <SummaryItem
                    label='Media əhatəsi'
                    value={`${story.uniqueSourceCount} media`}
                  />
                  <SummaryItem
                    label='Yayılma sürəti'
                    value={formatSpread(
                      story.spreadMinutes,
                      story.uniqueSourceCount
                    )}
                  />
                  <SummaryItem
                    label='Əhatə səviyyəsi'
                    value={story.coverageLevel}
                    tone='strong'
                  />
                  <SummaryItem
                    label='Qruplaşdırılan nəticə'
                    value={`${story.totalCoverage} nəticə`}
                  />
                </div>
              </article>

              <article className='rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6'>
                <div className='flex items-center gap-2 text-sm font-medium text-primary'>
                  <MapPinned className='h-4 w-4' />
                  Coverage Insights
                </div>
                <div className='mt-4 grid gap-3'>
                  <InsightItem
                    title='İlk paylaşan media'
                    value={story.firstSource}
                    icon={Radio}
                  />
                  <InsightItem
                    title='Ən sürətli götürən media'
                    value={
                      fastest
                        ? `${fastest.source} · ${formatTime(fastest.detectedAt)}`
                        : '-'
                    }
                    icon={Clock3}
                  />
                  <InsightItem
                    title='Başlığı dəyişən media sayı'
                    value={`${changedTitleCount} media`}
                    icon={FileText}
                  />
                  <InsightItem
                    title='Mətnə əlavə edən media sayı'
                    value={`${addedInfoCount} media`}
                    icon={Layers3}
                  />
                </div>
              </article>
            </section>

            <section className='grid gap-4 lg:grid-cols-[0.8fr_1.2fr]'>
              <article className='rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6'>
                <div className='flex items-center gap-2 text-sm font-medium text-primary'>
                  <TrendingUp className='h-4 w-4' />
                  Spread Timeline
                </div>
                <div className='mt-5 space-y-4'>
                  {story.items.slice(0, 10).map((item, index) => (
                    <div key={item.id} className='flex gap-3'>
                      <div className='flex flex-col items-center'>
                        <div className='flex h-9 w-9 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-sm font-bold text-primary'>
                          {index + 1}
                        </div>
                        {index < Math.min(story.items.length, 10) - 1 ? (
                          <div className='mt-2 h-full min-h-7 w-px bg-slate-200' />
                        ) : null}
                      </div>
                      <div className='min-w-0 pb-2'>
                        <p className='font-semibold'>
                          {formatTime(item.detectedAt)} · {item.source}
                        </p>
                        <p className='text-sm text-muted-foreground'>
                          {item.keyword} · {item.monitor}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </article>

              <article className='rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6'>
                <div className='flex items-center gap-2 text-sm font-medium text-primary'>
                  <Globe2 className='h-4 w-4' />
                  Related Media Items
                </div>
                <div className='mt-5 grid gap-3'>
                  {story.items.slice(0, 12).map((item) => (
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
                          <p className='mt-2 text-sm text-muted-foreground'>
                            Aşkarlanma: {formatDate(item.detectedAt)}
                          </p>
                        </div>
                        <span className='w-fit rounded-full border border-border bg-card px-3 py-1 text-sm font-medium text-foreground'>
                          {firstItem
                            ? getSimilarityLabel(item, firstItem)
                            : 'Oxşar xəbər'}
                        </span>
                      </div>
                    </a>
                  ))}
                </div>
              </article>
            </section>

            <section className='rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6'>
              <div className='flex items-center gap-2 text-sm font-medium text-primary'>
                <FileText className='h-4 w-4' />
                İstifadəçi üçün izah
              </div>
              <p className='mt-3 max-w-4xl text-muted-foreground'>
                Bu bölmə eyni mövzu üzrə yayılan media materiallarını
                qruplaşdırır və xəbərin yayılma ardıcıllığını göstərir.
                Qruplaşdırma mövcud nəticələrin başlığı, mənbəsi, açar sözü və
                aşkarlanma vaxtı əsasında aparılır.
              </p>
              <div className='mt-4 text-sm text-muted-foreground'>
                Son 30 gündə yoxlanılan nəticə: {storyData.totalRows} ·
                Qruplaşdırılan mövzu sayı: {storyData.groups.length}
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
