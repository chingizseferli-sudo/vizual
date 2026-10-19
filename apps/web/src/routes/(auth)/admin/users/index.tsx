import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { MoreHorizontal } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ResponsiveTable } from '@/components/ui/responsive-table'

type UserProfile = {
  user_id: string
  email: string | null
  telegram_chat_id: string | null
  plan_id: string | null
  created_at?: string | null
  updated_at?: string | null
}

type SubscriptionPlan = {
  id: string
  name: string
}

type AuthUser = {
  id: string
  email: string | null
  phone: string | null
  created_at: string | null
  updated_at: string | null
  last_sign_in_at: string | null
}

type UserMonitor = {
  id: string
  user_id: string
  name: string
  status: string | null
  created_at: string | null
}

type Keyword = {
  id: string
  monitor_id: string
  keyword: string
}

type MonitorMatch = {
  id: string
  monitor_id: string
  created_at: string | null
}

type UserRow = UserProfile & {
  monitors: UserMonitor[]
  keywordCount: number
  resultCount: number
  lastActivity: string | null
  issueLabels: string[]
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  return date.toLocaleString('az-AZ', {
    timeZone: 'Asia/Baku',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function UsersPage() {
  const [profiles, setProfiles] = useState<UserProfile[]>([])
  const [authUsers, setAuthUsers] = useState<AuthUser[]>([])
  const [monitors, setMonitors] = useState<UserMonitor[]>([])
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [matches, setMatches] = useState<MonitorMatch[]>([])
  const [plans, setPlans] = useState<SubscriptionPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null)
  const [resettingUserId, setResettingUserId] = useState<string | null>(null)
  const [temporaryPassword, setTemporaryPassword] = useState<{
    email: string
    password: string
  } | null>(null)
  const pageSize = 20

  async function loadUsers() {
    setLoading(true)
    setMessage('')

    const [
      profilesRes,
      monitorsRes,
      keywordsRes,
      matchesRes,
      authUsersRes,
      plansRes,
    ] = await Promise.all([
      supabase
        .from('user_profiles')
        .select('user_id,email,telegram_chat_id,plan_id,created_at,updated_at')
        .order('updated_at', { ascending: false, nullsFirst: false }),
      supabase
        .from('user_monitors')
        .select('id,user_id,name,status,created_at')
        .order('created_at', { ascending: false }),
      supabase.from('monitor_keywords').select('id,monitor_id,keyword'),
      supabase
        .from('monitor_matches')
        .select('id,monitor_id,created_at')
        .order('created_at', { ascending: false })
        .limit(5000),
      supabase.functions.invoke<{ users: AuthUser[] }>('admin-users', {
        body: {},
      }),
      supabase.from('subscription_plans').select('id,name'),
    ])

    const errors = [
      profilesRes.error,
      monitorsRes.error,
      keywordsRes.error,
      matchesRes.error,
      authUsersRes.error,
      plansRes.error,
    ]
      .filter(Boolean)
      .map((error) => error?.message)

    if (errors.length > 0) {
      setMessage(errors.join(' | '))
    }

    setProfiles((profilesRes.data || []) as UserProfile[])
    setAuthUsers((authUsersRes.data?.users || []) as AuthUser[])
    setMonitors((monitorsRes.data || []) as UserMonitor[])
    setKeywords((keywordsRes.data || []) as Keyword[])
    setMatches((matchesRes.data || []) as MonitorMatch[])
    setPlans((plansRes.data || []) as SubscriptionPlan[])
    setLoading(false)
  }

  const rows = useMemo<UserRow[]>(() => {
    const profileByUserId = new Map(
      profiles.map((profile) => [profile.user_id, profile])
    )
    const authByUserId = new Map(authUsers.map((user) => [user.id, user]))
    const userIds = new Set([
      ...authUsers.map((user) => user.id),
      ...profiles.map((profile) => profile.user_id),
      ...monitors.map((monitor) => monitor.user_id),
    ])

    return Array.from(userIds).map((userId) => {
      const authUser = authByUserId.get(userId)
      const profile = profileByUserId.get(userId) || {
        user_id: userId,
        email: authUser?.email || null,
        telegram_chat_id: null,
        plan_id: null,
        created_at: authUser?.created_at || null,
        updated_at: authUser?.updated_at || authUser?.last_sign_in_at || null,
      }
      const userMonitors = monitors.filter(
        (monitor) => monitor.user_id === userId
      )
      const monitorIds = new Set(userMonitors.map((monitor) => monitor.id))
      const userMatches = matches.filter((match) =>
        monitorIds.has(match.monitor_id)
      )
      const keywordCount = keywords.filter((keyword) =>
        monitorIds.has(keyword.monitor_id)
      ).length
      const activeCount = userMonitors.filter(
        (monitor) => monitor.status === 'active'
      ).length
      const issueLabels = [
        !profile.telegram_chat_id ? 'Telegram yoxdur' : '',
        userMonitors.length === 0 ? 'Monitor yoxdur' : '',
        userMonitors.length > 0 && activeCount === 0
          ? 'Aktiv monitor yoxdur'
          : '',
        userMonitors.length > 0 && keywordCount === 0 ? 'Açar söz yoxdur' : '',
      ].filter(Boolean)

      return {
        ...profile,
        monitors: userMonitors,
        keywordCount,
        resultCount: userMatches.length,
        issueLabels,
        lastActivity:
          userMatches[0]?.created_at ||
          userMonitors[0]?.created_at ||
          profile.updated_at ||
          authUser?.last_sign_in_at ||
          profile.created_at ||
          null,
      }
    })
  }, [authUsers, profiles, monitors, keywords, matches])

  const planNameById = useMemo(
    () => new Map(plans.map((plan) => [plan.id, plan.name])),
    [plans]
  )

  const filteredRows = useMemo(() => {
    const q = search.toLowerCase().trim()

    return rows.filter((row) => {
      const hasTelegram = Boolean(row.telegram_chat_id)
      const hasProblem = row.issueLabels.length > 0
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'problem' && hasProblem) ||
        (statusFilter === 'telegram' && hasTelegram) ||
        (statusFilter === 'no_telegram' && !hasTelegram) ||
        (statusFilter === 'has_monitor' && row.monitors.length > 0) ||
        (statusFilter === 'no_monitor' && row.monitors.length === 0)

      if (!matchesStatus) return false
      if (!q) return true

      return (
        (row.email || '').toLowerCase().includes(q) ||
        (row.user_id || '').toLowerCase().includes(q) ||
        (row.telegram_chat_id || '').toLowerCase().includes(q) ||
        row.monitors.some((monitor) =>
          (monitor.name || '').toLowerCase().includes(q)
        )
      )
    })
  }, [rows, search, statusFilter])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paginatedRows = filteredRows.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  )

  const stats = useMemo(() => {
    return {
      total: rows.length,
      problem: rows.filter((row) => row.issueLabels.length > 0).length,
      telegram: rows.filter((row) => row.telegram_chat_id).length,
      withMonitor: rows.filter((row) => row.monitors.length > 0).length,
    }
  }, [rows])

  function resetFilteredView() {
    setPage(1)
  }

  async function deleteUser(row: UserRow) {
    const label = row.email || row.user_id
    const confirmed = window.confirm(
      `${label} istifadəçisi silinsin?\n\nBu əməliyyat istifadəçinin monitorlarını, açar sözlərini, nəticələrini, bildirişlərini və varsa veb izləmələrini siləcək.`
    )

    if (!confirmed) return

    setDeletingUserId(row.user_id)
    setMessage('')

    const { error } = await supabase.functions.invoke('admin-users', {
      body: {
        action: 'delete_user',
        user_id: row.user_id,
      },
    })

    if (error) {
      setMessage(`İstifadəçi silinmədi: ${error.message}`)
      setDeletingUserId(null)
      return
    }

    setMessage('İstifadəçi silindi.')
    setDeletingUserId(null)
    await loadUsers()
  }

  async function createTemporaryPassword(row: UserRow) {
    const label = row.email || row.user_id
    const confirmed = window.confirm(
      `${label} üçün yeni müvəqqəti parol yaradılsın?\n\nKöhnə parol görünməyəcək. Yeni parol yalnız bu dəfə göstəriləcək.`
    )

    if (!confirmed) return

    setResettingUserId(row.user_id)
    setTemporaryPassword(null)
    setMessage('')

    const { data, error } = await supabase.functions.invoke<{
      temporary_password?: string
    }>('admin-users', {
      body: {
        action: 'create_temporary_password',
        user_id: row.user_id,
      },
    })

    if (error || !data?.temporary_password) {
      setMessage(
        `Müvəqqəti parol yaradılmadı: ${error?.message || 'Naməlum xəta'}`
      )
      setResettingUserId(null)
      return
    }

    setTemporaryPassword({
      email: label,
      password: data.temporary_password,
    })
    setMessage(
      'Müvəqqəti parol yaradıldı. Parolu yalnız bir dəfə görünən bu pəncərədən götürün.'
    )
    setResettingUserId(null)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadUsers()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [])

  if (loading) {
    return (
      <div className='flex min-h-[320px] items-center justify-center p-6 text-sm text-muted-foreground'>
        İstifadəçilər yüklənir...
      </div>
    )
  }

  return (
    <div className='grid gap-4 p-4 md:p-6'>
      <div>
        <h1 className='text-xl font-semibold tracking-tight'>İstifadəçilər</h1>
        <p className='mt-1 text-sm text-muted-foreground'>
          Hesablar, monitorlar və bağlantı vəziyyəti.
        </p>
      </div>

      {message ? (
        <div className='rounded-lg border bg-card p-4 text-sm text-warning'>
          {message}
        </div>
      ) : null}

      {temporaryPassword ? (
        <div className='rounded-lg border border-success/25 bg-success/10 p-4 text-sm text-success'>
          <div className='font-semibold'>Müvəqqəti parol yaradıldı</div>
          <div className='mt-1'>İstifadəçi: {temporaryPassword.email}</div>
          <div className='mt-2 flex flex-wrap items-center gap-2'>
            <code className='rounded-md bg-background px-3 py-2 font-mono text-base'>
              {temporaryPassword.password}
            </code>
            <button
              type='button'
              onClick={() =>
                void navigator.clipboard?.writeText(temporaryPassword.password)
              }
              className='rounded-lg border border-success/25 bg-background px-3 py-2 font-medium hover:bg-success/10'
            >
              Kopyala
            </button>
            <button
              type='button'
              onClick={() => setTemporaryPassword(null)}
              className='rounded-lg border border-success/25 bg-background px-3 py-2 font-medium hover:bg-success/10'
            >
              Bağla
            </button>
          </div>
          <div className='mt-2 text-xs text-success'>
            Bu parol bazada saxlanmır və yenidən göstərilməyəcək.
          </div>
        </div>
      ) : null}

      <div className='grid grid-cols-2 gap-3 xl:grid-cols-4'>
        <button
          type='button'
          onClick={() => {
            setStatusFilter('all')
            resetFilteredView()
          }}
          className='rounded-lg border bg-card p-3 text-left hover:bg-muted'
        >
          <div className='text-sm text-muted-foreground'>Ümumi istifadəçi</div>
          <div className='text-2xl font-bold text-foreground'>
            {stats.total}
          </div>
        </button>
        <button
          type='button'
          onClick={() => {
            setStatusFilter('problem')
            resetFilteredView()
          }}
          className='rounded-lg border bg-card p-3 text-left hover:bg-muted'
        >
          <div className='text-sm text-muted-foreground'>Müdaxilə lazımdır</div>
          <div className='text-2xl font-bold text-warning'>{stats.problem}</div>
        </button>
        <button
          type='button'
          onClick={() => {
            setStatusFilter('telegram')
            resetFilteredView()
          }}
          className='rounded-lg border bg-card p-3 text-left hover:bg-muted'
        >
          <div className='text-sm text-muted-foreground'>Telegram bağlı</div>
          <div className='text-2xl font-bold text-success'>
            {stats.telegram}
          </div>
        </button>
        <button
          type='button'
          onClick={() => {
            setStatusFilter('has_monitor')
            resetFilteredView()
          }}
          className='rounded-lg border bg-card p-3 text-left hover:bg-muted'
        >
          <div className='text-sm text-muted-foreground'>Monitoru olan</div>
          <div className='text-2xl font-bold text-foreground'>
            {stats.withMonitor}
          </div>
        </button>
      </div>

      <div className='grid gap-3 rounded-lg border bg-card p-3 md:grid-cols-[1fr_auto]'>
        <input
          aria-label='Email, user id, Telegram və ya monitor üzrə axtar...'
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            resetFilteredView()
          }}
          placeholder='Email, user id, Telegram və ya monitor üzrə axtar...'
          className='rounded-lg border bg-background px-3 py-2'
        />

        <select
          aria-label='İstifadəçi vəziyyəti'
          value={statusFilter}
          onChange={(event) => {
            setStatusFilter(event.target.value)
            resetFilteredView()
          }}
          className='rounded-lg border bg-background px-3 py-2'
        >
          <option value='all'>Bütün istifadəçilər</option>
          <option value='problem'>Müdaxilə lazımdır</option>
          <option value='telegram'>Telegram bağlıdır</option>
          <option value='no_telegram'>Telegram yoxdur</option>
          <option value='has_monitor'>Monitoru var</option>
          <option value='no_monitor'>Monitoru yoxdur</option>
        </select>
      </div>

      <ResponsiveTable label='İstifadəçi siyahısı' mobileLayout='cards'>
        <table role='table' className='min-w-[860px] text-left'>
          <thead>
            <tr role='row' className='border-b'>
              <th>İstifadəçi</th>
              <th>Plan</th>
              <th>Monitor / Açar söz / Nəticə</th>
              <th>Telegram</th>
              <th>Son aktivlik</th>
              <th className='text-right'>Əməliyyatlar</th>
            </tr>
          </thead>
          <tbody role='rowgroup'>
            {paginatedRows.map((row) => (
              <tr role='row' key={row.user_id}>
                <td role='cell' data-label='İstifadəçi'>
                  <div
                    className='max-w-64 truncate font-medium'
                    title={row.email || row.user_id}
                  >
                    {row.email || 'Email qeyd edilməyib'}
                  </div>
                  <div
                    className='max-w-64 truncate text-xs text-muted-foreground'
                    title={row.user_id}
                  >
                    {row.user_id}
                  </div>
                  {row.issueLabels.length > 0 && (
                    <div className='mt-1 max-w-64 text-xs text-warning'>
                      {row.issueLabels.join(' · ')}
                    </div>
                  )}
                </td>
                <td role='cell' data-label='Plan' className='whitespace-nowrap'>
                  {row.plan_id
                    ? planNameById.get(row.plan_id) || 'Naməlum'
                    : 'Təyin edilməyib'}
                </td>
                <td
                  role='cell'
                  data-label='Monitor / Açar söz / Nəticə'
                  className='tabular-nums'
                >
                  {row.monitors.length} / {row.keywordCount} / {row.resultCount}
                </td>
                <td
                  role='cell'
                  data-label='Telegram'
                  className='whitespace-nowrap'
                >
                  <span
                    className={
                      row.telegram_chat_id
                        ? 'text-success'
                        : 'text-muted-foreground'
                    }
                  >
                    {row.telegram_chat_id ? 'Qoşulub' : 'Qoşulmayıb'}
                  </span>
                </td>
                <td
                  role='cell'
                  data-label='Son aktivlik'
                  className='whitespace-nowrap text-muted-foreground'
                >
                  {formatDate(row.lastActivity)}
                </td>
                <td role='cell' data-label='Əməliyyatlar'>
                  <div className='flex items-center justify-end gap-1'>
                    <Button variant='outline' size='sm' asChild>
                      <Link
                        to='/admin/users/$userId'
                        params={{ userId: row.user_id }}
                      >
                        İdarə et
                      </Link>
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='size-8'
                          aria-label={`İstifadəçi əməliyyatları: ${row.email || row.user_id}`}
                        >
                          <MoreHorizontal className='size-4' />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end'>
                        <DropdownMenuItem
                          disabled={resettingUserId === row.user_id}
                          onSelect={() => void createTemporaryPassword(row)}
                        >
                          {resettingUserId === row.user_id
                            ? 'Yaradılır...'
                            : 'Parol yarat'}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant='destructive'
                          disabled={deletingUserId === row.user_id}
                          onSelect={() => void deleteUser(row)}
                        >
                          {deletingUserId === row.user_id
                            ? 'Silinir...'
                            : 'Sil'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </td>
              </tr>
            ))}
            {filteredRows.length === 0 && (
              <tr role='row'>
                <td colSpan={6} className='h-28 text-center'>
                  <div className='font-medium'>İstifadəçi tapılmadı</div>
                  <div className='mt-1 text-sm text-muted-foreground'>
                    Axtarışı və ya status filtrini dəyişib yenidən yoxlayın.
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ResponsiveTable>
      <div className='flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4'>
        <div className='text-sm text-muted-foreground'>
          Səhifə <b>{safePage}</b> / <b>{totalPages}</b> · Hər səhifədə{' '}
          <b>{pageSize}</b> istifadəçi
        </div>

        <div className='flex gap-2'>
          <button
            type='button'
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={safePage <= 1}
            className='rounded-md border px-4 py-2 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
          >
            Əvvəlki
          </button>
          <button
            type='button'
            onClick={() =>
              setPage((current) => Math.min(totalPages, current + 1))
            }
            disabled={safePage >= totalPages}
            className='rounded-md border px-4 py-2 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
          >
            Növbəti
          </button>
        </div>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/(auth)/admin/users/')({
  component: UsersPage,
})
