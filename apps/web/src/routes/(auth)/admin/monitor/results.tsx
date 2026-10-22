import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Download } from 'lucide-react'
import { getStatusBadgeClass, getStatusLabel } from '@/lib/status-ui'
import { supabase } from '@/lib/supabase'
import { ResponsiveTable } from '@/components/ui/responsive-table'
import { friendlyError } from '@/lib/friendly-error'

type Monitor = {
  id: string
  name: string
}

type Source = {
  id: string
  name: string
  base_url: string
}

type Item = {
  id: string
  source_id: string | null
  title: string
  url: string
  published_at: string | null
  detected_at: string | null
  status: string | null
}

type Match = {
  id: string
  monitor_id: string
  item_id: string
  matched_keyword: string | null
  created_at: string | null
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

function decodeHtml(text: string) {
  const textarea = document.createElement('textarea')
  textarea.innerHTML = text
  return textarea.value
}

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? '').replace(/"/g, '""')
  return `"${text}"`
}

function downloadCsv(
  filename: string,
  rows: Array<Array<string | number | null | undefined>>
) {
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n')
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function ResultsPage() {
  const [loading, setLoading] = useState(true)
  const [matches, setMatches] = useState<Match[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [monitors, setMonitors] = useState<Monitor[]>([])
  const [sources, setSources] = useState<Source[]>([])

  const [search, setSearch] = useState('')
  const [monitorFilter, setMonitorFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  async function loadData() {
    setLoading(true)

    const { data: matchData, error: matchError } = await supabase
      .from('monitor_matches')
      .select('id,monitor_id,item_id,matched_keyword,created_at')
      .order('created_at', { ascending: false })
      .limit(500)

    if (matchError) {
      alert('Monitor nəticələri oxunmadı: ' + friendlyError(matchError))
      setMatches([])
      setItems([])
      setMonitors([])
      setSources([])
      setLoading(false)
      return
    }

    const safeMatches = matchData || []

    const itemIds = Array.from(
      new Set(safeMatches.map((match) => match.item_id).filter(Boolean))
    )

    const monitorIds = Array.from(
      new Set(safeMatches.map((match) => match.monitor_id).filter(Boolean))
    )

    let itemData: Item[] = []
    let monitorData: Monitor[] = []
    let sourceData: Source[] = []

    if (itemIds.length > 0) {
      const { data, error } = await supabase
        .from('monitored_items')
        .select('id,source_id,title,url,published_at,detected_at,status')
        .in('id', itemIds)

      if (error) {
        alert('Xəbərlər oxunmadı: ' + friendlyError(error))
      } else {
        itemData = data || []
      }
    }

    if (monitorIds.length > 0) {
      const { data, error } = await supabase
        .from('user_monitors')
        .select('id,name')
        .in('id', monitorIds)

      if (error) {
        alert('Monitor adları oxunmadı: ' + friendlyError(error))
      } else {
        monitorData = data || []
      }
    }

    const sourceIds = Array.from(
      new Set(itemData.map((item) => item.source_id).filter(Boolean))
    ) as string[]

    if (sourceIds.length > 0) {
      const { data, error } = await supabase
        .from('sources')
        .select('id,name,base_url')
        .in('id', sourceIds)

      if (error) {
        alert('Mənbələr oxunmadı: ' + friendlyError(error))
      } else {
        sourceData = data || []
      }
    }

    setMatches(safeMatches)
    setItems(itemData)
    setMonitors(monitorData)
    setSources(sourceData)
    setLoading(false)
  }

  const rows = useMemo(() => {
    const q = search.toLowerCase().trim()

    return matches
      .map((match) => {
        const item = items.find((row) => row.id === match.item_id) || null
        const monitor =
          monitors.find((row) => row.id === match.monitor_id) || null
        const source = sources.find((row) => row.id === item?.source_id) || null

        return {
          match,
          item,
          monitor,
          source,
        }
      })
      .filter((row) => {
        const matchesMonitor =
          monitorFilter === 'all' || row.match.monitor_id === monitorFilter

        const matchesStatus =
          statusFilter === 'all' || (row.item?.status || 'new') === statusFilter

        const matchesSearch =
          !q ||
          (row.item?.title || '').toLowerCase().includes(q) ||
          (row.item?.url || '').toLowerCase().includes(q) ||
          (row.monitor?.name || '').toLowerCase().includes(q) ||
          (row.source?.name || '').toLowerCase().includes(q) ||
          (row.match.matched_keyword || '').toLowerCase().includes(q)

        return matchesMonitor && matchesStatus && matchesSearch
      })
  }, [matches, items, monitors, sources, search, monitorFilter, statusFilter])

  const stats = useMemo(() => {
    const today = new Date().toLocaleDateString('az-AZ', {
      timeZone: 'Asia/Baku',
    })

    const todayCount = rows.filter((row) => {
      if (!row.match.created_at) return false

      const date = new Date(row.match.created_at).toLocaleDateString('az-AZ', {
        timeZone: 'Asia/Baku',
      })

      return date === today
    }).length

    return {
      total: matches.length,
      shown: rows.length,
      today: todayCount,
      monitors: monitors.length,
    }
  }, [matches.length, rows, monitors.length])

  function exportResults() {
    downloadCsv('admin-monitor-results.csv', [
      [
        'Tarix',
        'Monitor',
        'A\u00e7ar s\u00f6z',
        'M\u0259nb\u0259',
        'Ba\u015fl\u0131q',
        'URL',
      ],
      ...rows.map((row) => [
        formatDate(row.match.created_at),
        row.monitor?.name || '-',
        row.match.matched_keyword || '-',
        row.source?.name || '-',
        row.item?.title
          ? decodeHtml(row.item.title)
          : 'X\u0259b\u0259r tap\u0131lmad\u0131',
        row.item?.url || '',
      ]),
    ])
  }

  useEffect(() => {
    loadData()
  }, [])

  if (loading) {
    return (
      <div className='flex min-h-[320px] items-center justify-center p-6 text-sm text-muted-foreground'>
        Nəticələr yüklənir...
      </div>
    )
  }

  return (
    <div className='grid gap-4 p-4 md:p-6'>
      <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
        <div>
          <h1 className='text-xl font-semibold tracking-tight'>Nəticələr</h1>
          <p className='text-muted-foreground'>
            Monitor açar sözlərinə uyğun tapılan xəbərlər
          </p>
        </div>
        <button
          type='button'
          onClick={exportResults}
          disabled={rows.length === 0}
          className='inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
        >
          <Download className='h-4 w-4' />
          CSV ixrac et
        </button>
      </div>

      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
        <div className='rounded-lg border bg-card p-3'>
          <div className='text-sm text-muted-foreground'>Ümumi uyğunluq</div>
          <div className='text-2xl font-bold'>{stats.total}</div>
        </div>

        <div className='rounded-lg border bg-card p-3'>
          <div className='text-sm text-muted-foreground'>Göstərilən</div>
          <div className='text-2xl font-bold'>{stats.shown}</div>
        </div>

        <div className='rounded-lg border bg-card p-3'>
          <div className='text-sm text-muted-foreground'>Bu gün</div>
          <div className='text-2xl font-bold'>{stats.today}</div>
        </div>

        <div className='rounded-lg border bg-card p-3'>
          <div className='text-sm text-muted-foreground'>Monitor sayı</div>
          <div className='text-2xl font-bold'>{stats.monitors}</div>
        </div>
      </div>

      <div className='grid gap-3 rounded-lg border bg-card p-3 md:grid-cols-3'>
        <input
          aria-label='Başlıq, link, mənbə, monitor və ya açar söz üzrə axtar...'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Başlıq, link, mənbə, monitor və ya açar söz üzrə axtar...'
          className='rounded-lg border bg-background px-3 py-2'
        />

        <select
          aria-label='Monitor'
          value={monitorFilter}
          onChange={(e) => setMonitorFilter(e.target.value)}
          className='rounded-lg border bg-background px-3 py-2'
        >
          <option value='all'>Bütün monitorlar</option>
          {monitors.map((monitor) => (
            <option key={monitor.id} value={monitor.id}>
              {monitor.name}
            </option>
          ))}
        </select>

        <select
          aria-label='Vəziyyət filtri'
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className='rounded-lg border bg-background px-3 py-2'
        >
          <option value='all'>Bütün statuslar</option>
          <option value='new'>Yeni</option>
          <option value='seen'>Görüldü</option>
          <option value='archived'>Arxivləşdirilib</option>
        </select>
      </div>

      <ResponsiveTable label='Monitorinq məlumatları'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/50'>
            <tr>
              <th className='p-4 text-left'>Başlıq</th>
              <th className='p-4 text-left'>Monitor</th>
              <th className='p-4 text-left'>Mənbə</th>
              <th className='p-4 text-left'>Açar söz</th>
              <th className='p-4 text-left'>Status</th>
              <th className='p-4 text-left'>Dərc tarixi</th>
              <th className='p-4 text-left'>Tapıldı</th>
              <th className='p-4 text-right'>Keçid</th>
            </tr>
          </thead>

          <tbody>
            {rows.map(({ match, item, monitor, source }) => (
              <tr key={match.id} className='border-t hover:bg-muted/50'>
                <td className='max-w-xl p-4'>
                  <div className='line-clamp-2 font-medium'>
                    {item?.title ? decodeHtml(item.title) : 'Xəbər tapılmadı'}
                  </div>

                  <div className='line-clamp-1 text-xs text-muted-foreground'>
                    {item?.url || '-'}
                  </div>
                </td>

                <td className='p-4'>
                  {monitor ? (
                    <Link
                      to='/admin/monitor/monitors/$monitorId'
                      params={{ monitorId: monitor.id }}
                      className='text-primary hover:underline'
                    >
                      {monitor.name}
                    </Link>
                  ) : (
                    '-'
                  )}
                </td>

                <td className='p-4'>{source?.name || '-'}</td>

                <td className='p-4'>
                  <span className='rounded-full border px-2 py-1 text-xs'>
                    {match.matched_keyword || '-'}
                  </span>
                </td>

                <td className='p-4'>
                  <span
                    className={`rounded-full border px-2 py-1 text-xs ${getStatusBadgeClass(item?.status, 'new')}`}
                  >
                    {getStatusLabel(item?.status, 'new')}
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
                <td colSpan={8} className='p-8 text-center'>
                  <div className='font-medium'>
                    Seçilmiş filtrə uyğun nəticə tapılmadı
                  </div>
                  <div className='mt-1 text-sm text-muted-foreground'>
                    Filtrləri dəyişin və ya monitorların yeni uyğun xəbər
                    tapmasını gözləyin.
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ResponsiveTable>
    </div>
  )
}

export const Route = createFileRoute('/(auth)/admin/monitor/results')({
  component: ResultsPage,
})
