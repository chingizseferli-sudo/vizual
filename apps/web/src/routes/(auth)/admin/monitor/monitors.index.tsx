import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { getStatusBadgeClass, getStatusLabel } from '@/lib/status-ui'
import { supabase } from '@/lib/supabase'
import { ResponsiveTable } from '@/components/ui/responsive-table'

type Monitor = {
  id: string
  user_id: string
  name: string
  description: string | null
  status: string | null
  notify_telegram: boolean | null
  telegram_chat_id: string | null
  created_at: string | null
}

type Keyword = {
  id: string
  monitor_id: string
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

function MonitorsPage() {
  const [monitors, setMonitors] = useState<Monitor[]>([])
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newKeywords, setNewKeywords] = useState('')
  const [newTelegramChatId, setNewTelegramChatId] = useState('')

  async function loadData() {
    setLoading(true)

    const [monitorsRes, keywordsRes, matchesRes] = await Promise.all([
      supabase
        .from('user_monitors')
        .select(
          'id,user_id,name,description,status,notify_telegram,telegram_chat_id,created_at'
        )
        .order('created_at', { ascending: false }),

      supabase
        .from('monitor_keywords')
        .select('id,monitor_id,keyword,match_type')
        .order('keyword', { ascending: true }),

      supabase
        .from('monitor_matches')
        .select('id,monitor_id,item_id,matched_keyword,created_at')
        .order('created_at', { ascending: false }),
    ])

    if (monitorsRes.error) {
      alert('Monitorlar oxunmadı: ' + monitorsRes.error.message)
      setMonitors([])
    } else {
      setMonitors(monitorsRes.data || [])
    }

    if (keywordsRes.error) {
      alert('Açar sözlər oxunmadı: ' + keywordsRes.error.message)
      setKeywords([])
    } else {
      setKeywords(keywordsRes.data || [])
    }

    if (matchesRes.error) {
      alert('Nəticələr oxunmadı: ' + matchesRes.error.message)
      setMatches([])
    } else {
      setMatches(matchesRes.data || [])
    }

    setLoading(false)
  }

  async function createMonitor() {
    const name = newName.trim()

    if (!name) {
      alert('Monitor adı yazılmalıdır.')
      return
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      alert('İstifadəçi tapılmadı. Əvvəl login et.')
      return
    }

    const { data: createdMonitor, error } = await supabase
      .from('user_monitors')
      .insert({
        user_id: user.id,
        name,
        description: newDescription.trim() || null,
        status: 'active',
        notify_telegram: true,
        telegram_chat_id: newTelegramChatId.trim() || null,
      })
      .select('id')
      .single()

    if (error || !createdMonitor) {
      alert('Monitor yaradılmadı: ' + (error?.message || 'Naməlum xəta'))
      return
    }

    const keywordList = newKeywords
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)

    if (keywordList.length > 0) {
      const payload = keywordList.map((keyword) => ({
        monitor_id: createdMonitor.id,
        keyword,
        match_type: 'contains',
      }))

      const { error: keywordError } = await supabase
        .from('monitor_keywords')
        .insert(payload)

      if (keywordError) {
        alert(
          'Monitor yaradıldı, amma açar sözlər əlavə olunmadı: ' +
            keywordError.message
        )
      }
    }

    setNewName('')
    setNewDescription('')
    setNewKeywords('')
    setNewTelegramChatId('')

    await loadData()
  }

  async function toggleMonitor(monitor: Monitor) {
    const nextStatus = monitor.status === 'active' ? 'inactive' : 'active'

    const { error } = await supabase
      .from('user_monitors')
      .update({ status: nextStatus })
      .eq('id', monitor.id)

    if (error) {
      alert('Status dəyişmədi: ' + error.message)
      return
    }

    await loadData()
  }

  async function deleteMonitor(monitor: Monitor) {
    const ok = window.confirm(
      `"${monitor.name}" monitorunu silmək istəyirsən? Açar sözləri də silinəcək.`
    )

    if (!ok) return

    await supabase
      .from('monitor_keywords')
      .delete()
      .eq('monitor_id', monitor.id)

    const { error } = await supabase
      .from('user_monitors')
      .delete()
      .eq('id', monitor.id)

    if (error) {
      alert('Monitor silinmədi: ' + error.message)
      return
    }

    await loadData()
  }

  const rows = useMemo(() => {
    const q = search.toLowerCase().trim()

    return monitors
      .map((monitor) => {
        const monitorKeywords = keywords.filter(
          (item) => item.monitor_id === monitor.id
        )

        const monitorMatches = matches.filter(
          (item) => item.monitor_id === monitor.id
        )

        return {
          ...monitor,
          keywordCount: monitorKeywords.length,
          resultCount: monitorMatches.length,
          keywordText: monitorKeywords.map((item) => item.keyword).join(', '),
          lastMatch: monitorMatches[0]?.created_at || null,
        }
      })
      .filter((monitor) => {
        if (!q) return true

        return (
          monitor.name.toLowerCase().includes(q) ||
          (monitor.description || '').toLowerCase().includes(q) ||
          monitor.keywordText.toLowerCase().includes(q) ||
          (monitor.status || '').toLowerCase().includes(q)
        )
      })
  }, [monitors, keywords, matches, search])

  const stats = useMemo(() => {
    return {
      total: monitors.length,
      active: monitors.filter((item) => item.status === 'active').length,
      inactive: monitors.filter((item) => item.status === 'inactive').length,
      keywords: keywords.length,
      matches: matches.length,
    }
  }, [monitors, keywords, matches])

  useEffect(() => {
    loadData()
  }, [])

  if (loading) {
    return <div className='p-6'>Yüklənir...</div>
  }

  return (
    <div className='grid gap-6 p-6'>
      <div>
        <h1 className='text-xl font-semibold tracking-tight'>Monitorlar</h1>
        <p className='text-muted-foreground'>
          İstifadəçilərin yaratdığı açar söz monitorları
        </p>
      </div>

      <div className='grid gap-4 md:grid-cols-5'>
        <div className='rounded-lg border bg-card p-4'>
          <div className='text-sm text-muted-foreground'>Ümumi monitor</div>
          <div className='text-2xl font-bold'>{stats.total}</div>
        </div>

        <div className='rounded-lg border bg-card p-4'>
          <div className='text-sm text-muted-foreground'>Aktiv</div>
          <div className='text-2xl font-bold'>{stats.active}</div>
        </div>

        <div className='rounded-lg border bg-card p-4'>
          <div className='text-sm text-muted-foreground'>Passiv</div>
          <div className='text-2xl font-bold'>{stats.inactive}</div>
        </div>

        <div className='rounded-lg border bg-card p-4'>
          <div className='text-sm text-muted-foreground'>Açar söz</div>
          <div className='text-2xl font-bold'>{stats.keywords}</div>
        </div>

        <div className='rounded-lg border bg-card p-4'>
          <div className='text-sm text-muted-foreground'>Nəticə</div>
          <div className='text-2xl font-bold'>{stats.matches}</div>
        </div>
      </div>

      <div className='grid gap-3 rounded-lg border bg-card p-4 md:grid-cols-5'>
        <input
          aria-label='Monitor adı'
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder='Monitor adı'
          className='rounded-lg border bg-background px-3 py-2'
        />

        <input
          aria-label='Təsvir'
          value={newDescription}
          onChange={(e) => setNewDescription(e.target.value)}
          placeholder='Təsvir'
          className='rounded-lg border bg-background px-3 py-2'
        />

        <input
          aria-label='Açar sözlər vergüllə: Qarabağ Universiteti, Xankəndi'
          value={newKeywords}
          onChange={(e) => setNewKeywords(e.target.value)}
          placeholder='Açar sözlər vergüllə: Qarabağ Universiteti, Xankəndi'
          className='rounded-lg border bg-background px-3 py-2'
        />

        <input
          aria-label='Telegram chat ID / nömrə'
          value={newTelegramChatId}
          onChange={(e) => setNewTelegramChatId(e.target.value)}
          placeholder='Telegram chat ID / nömrə'
          className='rounded-lg border bg-background px-3 py-2'
        />

        <button
          onClick={createMonitor}
          className='rounded-lg bg-primary px-4 py-2 text-primary-foreground'
        >
          Monitor yarat
        </button>
      </div>

      <div className='rounded-lg border bg-card p-4'>
        <input
          aria-label='Monitor adı, status və ya açar söz üzrə axtar...'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Monitor adı, status və ya açar söz üzrə axtar...'
          className='w-full rounded-lg border bg-background px-3 py-2'
        />
      </div>

      <ResponsiveTable label='Monitorinq məlumatları'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/50'>
            <tr>
              <th className='p-4 text-left'>Telegram</th>
              <th className='p-4 text-left'>Monitor</th>
              <th className='p-4 text-left'>Status</th>
              <th className='p-4 text-left'>Açar sözlər</th>
              <th className='p-4 text-left'>Nəticə sayı</th>
              <th className='p-4 text-left'>Son uyğunluq</th>
              <th className='p-4 text-right'>Əməliyyatlar</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((monitor) => (
              <tr key={monitor.id} className='border-t hover:bg-muted/50'>
                <td className='p-4'>
                  <span className='text-xs text-muted-foreground'>
                    {monitor.telegram_chat_id || '-'}
                  </span>
                </td>
                <td className='max-w-sm p-4'>
                  <Link
                    to='/admin/monitor/monitors/$monitorId'
                    params={{ monitorId: monitor.id }}
                    className='font-medium text-primary hover:underline'
                  >
                    {monitor.name}
                  </Link>
                  <div className='line-clamp-1 text-muted-foreground'>
                    {monitor.description || 'Təsvir yoxdur'}
                  </div>
                </td>

                <td className='p-4'>
                  <span
                    className={`rounded-full border px-2 py-1 text-xs ${getStatusBadgeClass(monitor.status)}`}
                  >
                    {getStatusLabel(monitor.status)}
                  </span>
                </td>

                <td className='max-w-md p-4'>
                  <div className='line-clamp-2'>
                    {monitor.keywordText || 'Açar söz yoxdur'}
                  </div>
                  <div className='text-xs text-muted-foreground'>
                    {monitor.keywordCount} açar söz
                  </div>
                </td>

                <td className='p-4'>
                  <span className='text-lg font-bold'>
                    {monitor.resultCount}
                  </span>
                </td>

                <td className='p-4'>{formatDate(monitor.lastMatch)}</td>

                <td className='p-4 text-right'>
                  <div className='flex flex-wrap justify-end gap-2'>
                    <Link
                      to='/admin/monitor/monitors/$monitorId'
                      params={{ monitorId: monitor.id }}
                      className='rounded-md border px-3 py-1 text-xs hover:bg-muted'
                    >
                      Aç
                    </Link>

                    <button
                      onClick={() => toggleMonitor(monitor)}
                      className='rounded-md border px-3 py-1 text-xs hover:bg-muted'
                    >
                      {monitor.status === 'active' ? 'Passiv et' : 'Aktiv et'}
                    </button>

                    <button
                      onClick={() => deleteMonitor(monitor)}
                      className='rounded-md border px-3 py-1 text-xs text-destructive hover:bg-destructive/10'
                    >
                      Sil
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className='p-10 text-center text-muted-foreground'
                >
                  Monitor tapılmadı.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ResponsiveTable>
    </div>
  )
}

export const Route = createFileRoute('/(auth)/admin/monitor/monitors/')({
  component: MonitorsPage,
})
