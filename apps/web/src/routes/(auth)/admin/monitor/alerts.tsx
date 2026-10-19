import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Download } from 'lucide-react'
import {
  getChannelLabel,
  getStatusBadgeClass,
  getStatusLabel,
} from '@/lib/status-ui'
import { supabase } from '@/lib/supabase'
import { ResponsiveTable } from '@/components/ui/responsive-table'

type AlertRow = {
  id: string
  match_id: string | null
  channel: string | null
  recipient: string | null
  status: string | null
  sent_at: string | null
  monitor_matches: {
    id: string
    monitor_id: string
    matched_keyword: string | null
    created_at: string | null
    user_monitors: {
      id: string
      name: string
    } | null
    monitored_items: {
      id: string
      title: string
      url: string
      published_at: string | null
      detected_at: string | null
      sources: {
        name: string
      } | null
    } | null
  } | null
}

function formatDate(value: string | null | undefined) {
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

function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [channelFilter, setChannelFilter] = useState('all')

  async function loadAlerts() {
    setLoading(true)

    const { data, error } = await supabase
      .from('monitor_alerts')
      .select(
        'id,match_id,channel,recipient,status,sent_at,monitor_matches(id,monitor_id,matched_keyword,created_at,user_monitors(id,name),monitored_items(id,title,url,published_at,detected_at,sources(name)))'
      )
      .order('sent_at', { ascending: false, nullsFirst: false })
      .limit(300)

    if (error) {
      alert('Bildirişlər oxunmadı: ' + error.message)
      setAlerts([])
    } else {
      setAlerts((data || []) as unknown as AlertRow[])
    }

    setLoading(false)
  }

  async function updateAlertStatus(alertId: string, status: string) {
    const { error } = await supabase
      .from('monitor_alerts')
      .update({ status })
      .eq('id', alertId)

    if (error) {
      alert('Status dəyişmədi: ' + error.message)
      return
    }

    await loadAlerts()
  }

  async function markAllAsRead() {
    const ids = filteredAlerts
      .filter((alert) => (alert.status || 'new') === 'new')
      .map((alert) => alert.id)

    if (ids.length === 0) {
      alert('Oxunmamış bildiriş yoxdur.')
      return
    }

    const { error } = await supabase
      .from('monitor_alerts')
      .update({ status: 'read' })
      .in('id', ids)

    if (error) {
      alert('Bildirişlər oxunmuş edilmədi: ' + error.message)
      return
    }

    await loadAlerts()
  }

  async function deleteAlert(alertId: string) {
    const ok = window.confirm('Bu bildirişi silmək istəyirsən?')

    if (!ok) return

    const { error } = await supabase
      .from('monitor_alerts')
      .delete()
      .eq('id', alertId)

    if (error) {
      alert('Bildiriş silinmədi: ' + error.message)
      return
    }

    await loadAlerts()
  }

  const filteredAlerts = useMemo(() => {
    const q = search.toLowerCase().trim()

    return alerts.filter((alert) => {
      const match = alert.monitor_matches
      const item = match?.monitored_items
      const monitor = match?.user_monitors
      const source = item?.sources

      const status = alert.status || 'new'
      const channel = alert.channel || 'web'

      const matchesStatus = statusFilter === 'all' || status === statusFilter
      const matchesChannel =
        channelFilter === 'all' || channel === channelFilter

      const matchesSearch =
        !q ||
        (monitor?.name || '').toLowerCase().includes(q) ||
        (item?.title || '').toLowerCase().includes(q) ||
        (item?.url || '').toLowerCase().includes(q) ||
        (match?.matched_keyword || '').toLowerCase().includes(q) ||
        (source?.name || '').toLowerCase().includes(q) ||
        (alert.recipient || '').toLowerCase().includes(q)

      return matchesStatus && matchesChannel && matchesSearch
    })
  }, [alerts, search, statusFilter, channelFilter])

  const stats = useMemo(() => {
    return {
      total: alerts.length,
      shown: filteredAlerts.length,
      new: alerts.filter((item) => (item.status || 'new') === 'new').length,
      read: alerts.filter((item) => item.status === 'read').length,
      web: alerts.filter((item) => (item.channel || 'web') === 'web').length,
      telegram: alerts.filter((item) => item.channel === 'telegram').length,
    }
  }, [alerts, filteredAlerts.length])

  const channels = useMemo(() => {
    const values = new Set<string>()

    for (const alert of alerts) {
      values.add(alert.channel || 'web')
    }

    return Array.from(values)
  }, [alerts])

  function exportAlerts() {
    downloadCsv('admin-monitor-alerts.csv', [
      [
        'Tarix',
        'Monitor',
        'A\u00e7ar s\u00f6z',
        'Kanal',
        'Status',
        'Ba\u015fl\u0131q',
        'URL',
      ],
      ...filteredAlerts.map((alert) => {
        const match = alert.monitor_matches
        const item = match?.monitored_items

        return [
          formatDate(alert.sent_at || match?.created_at),
          match?.user_monitors?.name || 'Monitor',
          match?.matched_keyword || '-',
          alert.channel || 'web',
          getStatusLabel(alert.status, 'new'),
          item?.title
            ? decodeHtml(item.title)
            : 'X\u0259b\u0259r tap\u0131lmad\u0131',
          item?.url || '',
        ]
      }),
    ])
  }

  useEffect(() => {
    loadAlerts()
  }, [])

  if (loading) {
    return (
      <div className='flex min-h-[320px] items-center justify-center p-6 text-sm text-muted-foreground'>
        Bildirişlər yüklənir...
      </div>
    )
  }

  return (
    <div className='grid gap-4 p-4 md:p-6'>
      <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
        <div>
          <h1 className='text-xl font-semibold tracking-tight'>Bildirişlər</h1>
          <p className='text-muted-foreground'>
            Monitor uyğunluqları üzrə yaradılan bildirişlər
          </p>
        </div>
        <button
          type='button'
          onClick={exportAlerts}
          disabled={filteredAlerts.length === 0}
          className='inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
        >
          <Download className='h-4 w-4' />
          CSV ixrac et
        </button>
      </div>

      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-5'>
        <div className='rounded-lg border bg-card p-3'>
          <div className='text-sm text-muted-foreground'>Ümumi</div>
          <div className='text-2xl font-bold'>{stats.total}</div>
        </div>

        <div className='rounded-lg border bg-card p-3'>
          <div className='text-sm text-muted-foreground'>Göstərilən</div>
          <div className='text-2xl font-bold'>{stats.shown}</div>
        </div>

        <div className='rounded-lg border bg-card p-3'>
          <div className='text-sm text-muted-foreground'>Yeni</div>
          <div className='text-2xl font-bold text-warning'>{stats.new}</div>
        </div>

        <div className='rounded-lg border bg-card p-3'>
          <div className='text-sm text-muted-foreground'>Oxunmuş</div>
          <div className='text-2xl font-bold'>{stats.read}</div>
        </div>

        <div className='rounded-lg border bg-card p-3'>
          <div className='text-sm text-muted-foreground'>Telegram</div>
          <div className='text-2xl font-bold'>{stats.telegram}</div>
        </div>
      </div>

      <div className='grid gap-3 rounded-lg border bg-card p-3 md:grid-cols-4'>
        <input
          aria-label='Monitor, başlıq, mənbə, açar söz üzrə axtar...'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Monitor, başlıq, mənbə, açar söz üzrə axtar...'
          className='rounded-lg border bg-background px-3 py-2'
        />

        <select
          aria-label='Vəziyyət filtri'
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className='rounded-lg border bg-background px-3 py-2'
        >
          <option value='all'>Bütün statuslar</option>
          <option value='new'>Yeni</option>
          <option value='read'>Oxundu</option>
          <option value='sent'>Göndərildi</option>
          <option value='failed'>Xəta</option>
        </select>

        <select
          aria-label='Bildiriş kanalı'
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value)}
          className='rounded-lg border bg-background px-3 py-2'
        >
          <option value='all'>Bütün kanallar</option>
          {channels.map((channel) => (
            <option
              key={getChannelLabel(channel)}
              value={getChannelLabel(channel)}
            >
              {getChannelLabel(channel)}
            </option>
          ))}
        </select>

        <button
          onClick={markAllAsRead}
          className='rounded-lg border px-4 py-2 hover:bg-muted'
        >
          Göstərilənləri oxunmuş et
        </button>
      </div>

      <ResponsiveTable label='Monitorinq məlumatları'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/50'>
            <tr>
              <th className='p-4 text-left'>Monitor</th>
              <th className='p-4 text-left'>Başlıq</th>
              <th className='p-4 text-left'>Mənbə</th>
              <th className='p-4 text-left'>Açar söz</th>
              <th className='p-4 text-left'>Kanal</th>
              <th className='p-4 text-left'>Status</th>
              <th className='p-4 text-left'>Vaxt</th>
              <th className='p-4 text-right'>Əməliyyatlar</th>
            </tr>
          </thead>

          <tbody>
            {filteredAlerts.map((alert) => {
              const match = alert.monitor_matches
              const item = match?.monitored_items
              const monitor = match?.user_monitors
              const source = item?.sources

              return (
                <tr key={alert.id} className='border-t hover:bg-muted/50'>
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
                      'Monitor'
                    )}
                  </td>

                  <td className='max-w-xl p-4'>
                    {item ? (
                      <>
                        <a
                          href={item.url}
                          target='_blank'
                          rel='noreferrer'
                          className='line-clamp-2 font-medium hover:underline'
                        >
                          {decodeHtml(item.title)}
                        </a>

                        <div className='line-clamp-1 text-xs text-muted-foreground'>
                          {item.url}
                        </div>
                      </>
                    ) : (
                      <span className='text-muted-foreground'>
                        Xəbər tapılmadı
                      </span>
                    )}
                  </td>

                  <td className='p-4'>{source?.name || '-'}</td>

                  <td className='p-4'>
                    <span className='rounded-full border px-2 py-1 text-xs'>
                      {match?.matched_keyword || '-'}
                    </span>
                  </td>

                  <td className='p-4'>{getChannelLabel(alert.channel)}</td>

                  <td className='p-4'>
                    <span
                      className={`rounded-full border px-2 py-1 text-xs ${getStatusBadgeClass(alert.status, 'new')}`}
                    >
                      {getStatusLabel(alert.status, 'new')}
                    </span>
                  </td>

                  <td className='p-4'>{formatDate(alert.sent_at)}</td>

                  <td className='p-4 text-right'>
                    <div className='flex flex-wrap justify-end gap-2'>
                      {item?.url ? (
                        <a
                          href={item.url}
                          target='_blank'
                          rel='noreferrer'
                          className='rounded-md border px-3 py-1 text-xs hover:bg-muted'
                        >
                          Aç
                        </a>
                      ) : null}

                      <button
                        onClick={() => updateAlertStatus(alert.id, 'read')}
                        className='rounded-md border px-3 py-1 text-xs hover:bg-muted'
                      >
                        Oxunmuş et
                      </button>

                      <button
                        onClick={() => deleteAlert(alert.id)}
                        className='rounded-md border px-3 py-1 text-xs text-destructive hover:bg-destructive/10'
                      >
                        Sil
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}

            {filteredAlerts.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className='p-10 text-center text-muted-foreground'
                >
                  Hələ bildiriş yoxdur.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ResponsiveTable>
    </div>
  )
}

export const Route = createFileRoute('/(auth)/admin/monitor/alerts')({
  component: AlertsPage,
})
