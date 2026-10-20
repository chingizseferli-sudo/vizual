import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { supabase } from '@/lib/supabase'
import { ResponsiveTable } from '@/components/ui/responsive-table'

type MatchRow = {
  id: string
  monitor_id: string
  item_id: string
  matched_keyword: string | null
  created_at: string | null
  user_monitors: {
    name: string
  } | null
  monitored_items: {
    title: string
    url: string
    detected_at: string | null
  } | null
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

function isToday(value: string | null) {
  if (!value) return false

  const now = new Date()
  const date = new Date(value)

  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  )
}

function MonitorDashboard() {
  const [sourcesCount, setSourcesCount] = useState(0)
  const [todayItemsCount, setTodayItemsCount] = useState(0)
  const [activeMonitorsCount, setActiveMonitorsCount] = useState(0)
  const [todayMatchesCount, setTodayMatchesCount] = useState(0)
  const [recentMatches, setRecentMatches] = useState<MatchRow[]>([])
  const [loading, setLoading] = useState(true)

  async function loadDashboard() {
    setLoading(true)

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [sourcesRes, itemsRes, monitorsRes, matchesRes, recentMatchesRes] =
      await Promise.all([
        supabase
          .from('sources')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'active'),

        supabase
          .from('monitored_items')
          .select('id', { count: 'exact', head: true })
          .gte('detected_at', todayStart.toISOString()),

        supabase
          .from('user_monitors')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'active'),

        supabase
          .from('monitor_matches')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', todayStart.toISOString()),

        supabase
          .from('monitor_matches')
          .select(
            'id,monitor_id,item_id,matched_keyword,created_at,user_monitors(name),monitored_items(title,url,detected_at)'
          )
          .order('created_at', { ascending: false })
          .limit(10),
      ])

    setSourcesCount(sourcesRes.count || 0)
    setTodayItemsCount(itemsRes.count || 0)
    setActiveMonitorsCount(monitorsRes.count || 0)
    setTodayMatchesCount(matchesRes.count || 0)

    if (!recentMatchesRes.error && recentMatchesRes.data) {
      setRecentMatches(recentMatchesRes.data as unknown as MatchRow[])
    } else {
      setRecentMatches([])
    }

    setLoading(false)
  }

  useEffect(() => {
    loadDashboard()
  }, [])

  const todayRecentMatches = useMemo(() => {
    return recentMatches.filter((item) => isToday(item.created_at))
  }, [recentMatches])

  if (loading) {
    return <div className='p-6'>Yüklənir...</div>
  }

  return (
    <div className='grid gap-6 p-6'>
      <div>
        <h1 className='text-xl font-semibold tracking-tight'>Vizual Monitor</h1>
        <p className='text-muted-foreground'>
          Media monitorinq və xəbərdarlıq sistemi
        </p>
      </div>

      <div className='grid gap-4 md:grid-cols-4'>
        <Link
          to='/admin/monitor/sources'
          className='rounded-lg border bg-card p-4 hover:bg-muted/50'
        >
          <div className='text-sm text-muted-foreground'>Aktiv mənbələr</div>
          <div className='text-2xl font-bold'>{sourcesCount}</div>
        </Link>

        <Link
          to='/admin/monitor/results'
          className='rounded-lg border bg-card p-4 hover:bg-muted/50'
        >
          <div className='text-sm text-muted-foreground'>Bugünkü nəticələr</div>
          <div className='text-2xl font-bold'>{todayItemsCount}</div>
        </Link>

        <Link
          to='/admin/users'
          className='rounded-lg border bg-card p-4 hover:bg-muted/50'
        >
          <div className='text-sm text-muted-foreground'>Açar söz izləyən müştərilər</div>
          <div className='text-2xl font-bold'>{activeMonitorsCount}</div>
        </Link>

        <Link
          to='/admin/monitor/results'
          className='rounded-lg border bg-card p-4 hover:bg-muted/50'
        >
          <div className='text-sm text-muted-foreground'>
            Bugünkü uyğunluqlar
          </div>
          <div className='text-2xl font-bold'>{todayMatchesCount}</div>
        </Link>
      </div>

      <ResponsiveTable label='Son monitor uyğunluqları'>
        <div className='border-b p-4'>
          <h2 className='text-lg font-semibold'>Son uyğunluqlar</h2>
          <p className='text-sm text-muted-foreground'>
            İstifadəçi monitorlarına uyğun gələn ən son xəbərlər
          </p>
        </div>

        {recentMatches.length === 0 ? (
          <div className='p-10 text-center text-muted-foreground'>
            Hələ uyğunluq yoxdur.
          </div>
        ) : (
          <table className='w-full text-sm'>
            <thead className='bg-muted/50'>
              <tr>
                <th className='p-4 text-left'>Monitor</th>
                <th className='p-4 text-left'>Başlıq</th>
                <th className='p-4 text-left'>Açar söz</th>
                <th className='p-4 text-left'>Vaxt</th>
                <th className='p-4 text-right'>Keçid</th>
              </tr>
            </thead>

            <tbody>
              {recentMatches.map((match) => (
                <tr key={match.id} className='border-t hover:bg-muted/50'>
                  <td className='p-4'>
                    <Link
                      to='/admin/monitor/monitors/$monitorId'
                      params={{ monitorId: match.monitor_id }}
                      className='font-medium text-primary hover:underline'
                    >
                      {match.user_monitors?.name || 'Monitor'}
                    </Link>
                  </td>

                  <td className='max-w-xl p-4'>
                    {match.monitored_items ? (
                      <a
                        href={match.monitored_items.url}
                        target='_blank'
                        rel='noreferrer'
                        className='line-clamp-2 font-medium hover:underline'
                      >
                        {decodeHtml(match.monitored_items.title)}
                      </a>
                    ) : (
                      <span className='text-muted-foreground'>
                        Xəbər tapılmadı
                      </span>
                    )}
                  </td>

                  <td className='p-4'>
                    <span className='rounded-full border px-2 py-1 text-xs'>
                      {match.matched_keyword || '-'}
                    </span>
                  </td>

                  <td className='p-4'>{formatDate(match.created_at)}</td>

                  <td className='p-4 text-right'>
                    {match.monitored_items ? (
                      <a
                        href={match.monitored_items.url}
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
            </tbody>
          </table>
        )}
      </ResponsiveTable>

      {todayRecentMatches.length === 0 && recentMatches.length > 0 ? (
        <div className='rounded-lg border bg-muted/50 p-4 text-sm text-muted-foreground'>
          Bu gün üçün uyğunluq yoxdur, yuxarıda son tarixçə göstərilir.
        </div>
      ) : null}
    </div>
  )
}

export const Route = createFileRoute('/(auth)/admin/monitor/')({
  component: MonitorDashboard,
})
