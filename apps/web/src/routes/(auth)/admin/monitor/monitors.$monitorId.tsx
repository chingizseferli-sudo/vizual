import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { getStatusLabel } from '@/lib/status-ui'
import { supabase } from '@/lib/supabase'
import { ResponsiveTable } from '@/components/ui/responsive-table'

type Monitor = {
  id: string
  name: string
  description: string | null
  status: string | null
}

type Keyword = {
  id: string
  keyword: string
  match_type: string | null
}

type Match = {
  id: string
  monitor_id: string
  item_id: string
  matched_keyword: string | null
  created_at: string | null
}

type Item = {
  id: string
  source_id: string | null
  title: string
  url: string
  published_at: string | null
  detected_at: string | null
}

type Source = {
  id: string
  name: string
  base_url: string
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

function MonitorDetailsPage() {
  const { monitorId } = Route.useParams()

  const [loading, setLoading] = useState(true)
  const [monitor, setMonitor] = useState<Monitor | null>(null)
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [search, setSearch] = useState('')

  async function loadData() {
    setLoading(true)

    const { data: monitorData, error: monitorError } = await supabase
      .from('user_monitors')
      .select('id,name,description,status')
      .eq('id', monitorId)
      .single()

    if (monitorError || !monitorData) {
      setMonitor(null)
      setLoading(false)
      return
    }

    const { data: keywordData } = await supabase
      .from('monitor_keywords')
      .select('id,keyword,match_type')
      .eq('monitor_id', monitorId)
      .order('keyword', { ascending: true })

    const { data: matchData } = await supabase
      .from('monitor_matches')
      .select('id,monitor_id,item_id,matched_keyword,created_at')
      .eq('monitor_id', monitorId)
      .order('created_at', { ascending: false })

    const itemIds = Array.from(
      new Set((matchData || []).map((item) => item.item_id).filter(Boolean))
    )

    let itemData: Item[] = []
    let sourceData: Source[] = []

    if (itemIds.length > 0) {
      const { data } = await supabase
        .from('monitored_items')
        .select('id,source_id,title,url,published_at,detected_at')
        .in('id', itemIds)

      itemData = data || []

      const sourceIds = Array.from(
        new Set(itemData.map((item) => item.source_id).filter(Boolean))
      ) as string[]

      if (sourceIds.length > 0) {
        const { data: sourcesResult } = await supabase
          .from('sources')
          .select('id,name,base_url')
          .in('id', sourceIds)

        sourceData = sourcesResult || []
      }
    }

    setMonitor(monitorData)
    setKeywords(keywordData || [])
    setMatches(matchData || [])
    setItems(itemData)
    setSources(sourceData)
    setLoading(false)
  }

  const rows = useMemo(() => {
    const q = search.toLowerCase().trim()

    return matches
      .map((match) => {
        const item = items.find((row) => row.id === match.item_id) || null
        const source = sources.find((row) => row.id === item?.source_id) || null

        return {
          match,
          item,
          source,
        }
      })
      .filter((row) => {
        if (!q) return true

        return (
          (row.item?.title || '').toLowerCase().includes(q) ||
          (row.item?.url || '').toLowerCase().includes(q) ||
          (row.match.matched_keyword || '').toLowerCase().includes(q) ||
          (row.source?.name || '').toLowerCase().includes(q)
        )
      })
  }, [matches, items, sources, search])

  useEffect(() => {
    loadData()
  }, [monitorId])

  if (loading) return <div className='p-6'>Yüklənir...</div>

  if (!monitor) {
    return (
      <div className='grid gap-4 p-6'>
        <Link to='/admin/monitor/monitors' className='underline'>
          ← Monitorlara qayıt
        </Link>
        <div className='rounded-lg border p-6 text-destructive'>
          Monitor tapılmadı.
        </div>
      </div>
    )
  }

  return (
    <div className='grid gap-6 p-6'>
      <div>
        <Link to='/admin/monitor/monitors' className='underline'>
          ← Monitorlara qayıt
        </Link>

        <h1 className='mt-4 text-xl font-semibold tracking-tight'>
          {monitor.name}
        </h1>

        <p className='text-muted-foreground'>
          {monitor.description || 'Təsvir yoxdur'}
        </p>
      </div>

      <div className='grid gap-4 md:grid-cols-4'>
        <div className='rounded-lg border bg-card p-4'>
          <div className='text-sm text-muted-foreground'>Status</div>
          <div className='text-2xl font-bold'>
            {getStatusLabel(monitor.status)}
          </div>
        </div>

        <div className='rounded-lg border bg-card p-4'>
          <div className='text-sm text-muted-foreground'>Açar söz</div>
          <div className='text-2xl font-bold'>{keywords.length}</div>
        </div>

        <div className='rounded-lg border bg-card p-4'>
          <div className='text-sm text-muted-foreground'>Nəticə</div>
          <div className='text-2xl font-bold'>{matches.length}</div>
        </div>

        <div className='rounded-lg border bg-card p-4'>
          <div className='text-sm text-muted-foreground'>Göstərilən</div>
          <div className='text-2xl font-bold'>{rows.length}</div>
        </div>
      </div>

      <div className='rounded-lg border bg-card p-4'>
        <div className='mb-2 text-sm font-medium'>Açar sözlər</div>
        <div className='flex flex-wrap gap-2'>
          {keywords.map((keyword) => (
            <span
              key={keyword.id}
              className='rounded-full border px-3 py-1 text-sm'
            >
              {keyword.keyword}
            </span>
          ))}
        </div>
      </div>

      <div className='rounded-lg border bg-card p-4'>
        <input
          aria-label='Başlıq, link, mənbə və ya açar söz üzrə axtar...'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Başlıq, link, mənbə və ya açar söz üzrə axtar...'
          className='w-full rounded-lg border bg-background px-3 py-2'
        />
      </div>

      <ResponsiveTable label='Monitorinq məlumatları'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/50'>
            <tr>
              <th className='p-4 text-left'>Başlıq</th>
              <th className='p-4 text-left'>Mənbə</th>
              <th className='p-4 text-left'>Açar söz</th>
              <th className='p-4 text-left'>Dərc tarixi</th>
              <th className='p-4 text-left'>Tapıldı</th>
              <th className='p-4 text-right'>Keçid</th>
            </tr>
          </thead>

          <tbody>
            {rows.map(({ match, item, source }) => (
              <tr key={match.id} className='border-t hover:bg-muted/50'>
                <td className='max-w-xl p-4'>
                  <div className='font-medium'>
                    {item?.title || 'Xəbər tapılmadı'}
                  </div>
                  <div className='line-clamp-1 text-xs text-muted-foreground'>
                    {item?.url || '-'}
                  </div>
                </td>

                <td className='p-4'>{source?.name || '-'}</td>

                <td className='p-4'>
                  <span className='rounded-full border px-2 py-1 text-xs'>
                    {match.matched_keyword || '-'}
                  </span>
                </td>

                <td className='p-4'>
                  {formatDate(item?.published_at || null)}
                </td>

                <td className='p-4'>{formatDate(match.created_at)}</td>

                <td className='p-4 text-right'>
                  {item?.url ? (
                    <a
                      href={item.url}
                      target='_blank'
                      rel='noreferrer'
                      className='text-primary underline'
                    >
                      Aç
                    </a>
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
            ))}

            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className='p-10 text-center text-muted-foreground'
                >
                  Nəticə tapılmadı.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ResponsiveTable>
    </div>
  )
}

export const Route = createFileRoute(
  '/(auth)/admin/monitor/monitors/$monitorId'
)({
  component: MonitorDetailsPage,
})
