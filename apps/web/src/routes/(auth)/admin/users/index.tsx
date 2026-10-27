import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { MoreHorizontal, RefreshCw, UserPlus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ResponsiveTable } from '@/components/ui/responsive-table'
import { friendlyError } from '@/lib/friendly-error'

type UserProfile = {
  user_id: string
  email: string | null
  telegram_chat_id: string | null
  plan_id: string | null
  status: string | null
  created_at?: string | null
  updated_at?: string | null
}

type SubscriptionPlan = {
  id: string
  code: string
  name: string
  is_active: boolean
}

type NewAccountForm = {
  email: string
  password: string
  planId: string
  status: 'active' | 'trialing'
  periodEnd: string
}

const EMPTY_NEW_ACCOUNT: NewAccountForm = {
  email: '',
  password: '',
  planId: '',
  status: 'active',
  periodEnd: '',
}

const PASSWORD_GROUPS = [
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  'abcdefghijkmnopqrstuvwxyz',
  '23456789',
  '!@#$%',
]

// Unbiased random index below max, from the browser's secure generator.
function randomIndex(max: number) {
  const limit = 256 - (256 % max)
  const byte = new Uint8Array(1)
  do {
    crypto.getRandomValues(byte)
  } while (byte[0] >= limit)
  return byte[0] % max
}

// One character from every group (upper, lower, digit, symbol), the rest
// from all of them, then shuffled. No look-alike characters (0/O, 1/l/I).
function generatePassword(length = 8) {
  const all = PASSWORD_GROUPS.join('')
  const chars = PASSWORD_GROUPS.map((group) => group[randomIndex(group.length)])
  while (chars.length < length) chars.push(all[randomIndex(all.length)])
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

function dateInputValue(daysFromToday: number) {
  const date = new Date()
  date.setDate(date.getDate() + daysFromToday)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

// supabase-js hides the edge function's JSON body behind error.context.
async function functionErrorMessage(error: unknown) {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as { error?: string }
      if (body?.error) return friendlyError({ message: body.error })
    } catch {
      // Fall through to the generic message.
    }
  }
  return friendlyError(error)
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

const ACCOUNT_STATUS_BADGES: Record<string, { label: string; className: string }> = {
  pending: { label: 'Təsdiq gözləyir', className: 'bg-warning/15 text-warning' },
  rejected: { label: 'Rədd edilib', className: 'bg-destructive/10 text-destructive' },
  expired: { label: 'Demo bitib', className: 'bg-muted text-muted-foreground' },
  inactive: { label: 'Passiv', className: 'bg-muted text-muted-foreground' },
  blocked: { label: 'Bloklanıb', className: 'bg-destructive/10 text-destructive' },
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
  const [reviewingUserId, setReviewingUserId] = useState<string | null>(null)
  const [temporaryPassword, setTemporaryPassword] = useState<{
    email: string
    password: string
    isNewAccount: boolean
  } | null>(null)
  const [newAccountOpen, setNewAccountOpen] = useState(false)
  const [newAccount, setNewAccount] =
    useState<NewAccountForm>(EMPTY_NEW_ACCOUNT)
  const [newAccountError, setNewAccountError] = useState('')
  const [creatingAccount, setCreatingAccount] = useState(false)
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
        .select(
          'user_id,email,telegram_chat_id,plan_id,status,created_at,updated_at'
        )
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
      supabase
        .from('subscription_plans')
        .select('id,code,name,is_active')
        .order('display_order')
        .order('name'),
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
      .map((error) => friendlyError(error))

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
        status: null,
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
      // Archived monitors only keep old results; their keywords are not tracked.
      const liveMonitorIds = new Set(
        userMonitors
          .filter((monitor) => monitor.status !== 'archived')
          .map((monitor) => monitor.id)
      )
      const keywordCount = keywords.filter((keyword) =>
        liveMonitorIds.has(keyword.monitor_id)
      ).length
      const issueLabels = [
        !profile.telegram_chat_id ? 'Telegram yoxdur' : '',
        keywordCount === 0 ? 'Açar söz yoxdur' : '',
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

    const matching = rows.filter((row) => {
      const hasTelegram = Boolean(row.telegram_chat_id)
      const hasProblem = row.issueLabels.length > 0
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'pending' && row.status === 'pending') ||
        (statusFilter === 'problem' && hasProblem) ||
        (statusFilter === 'telegram' && hasTelegram) ||
        (statusFilter === 'no_telegram' && !hasTelegram) ||
        (statusFilter === 'has_keywords' && row.keywordCount > 0) ||
        (statusFilter === 'no_keywords' && row.keywordCount === 0)

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

    // Sign-up requests waiting for approval come first.
    return matching.sort(
      (a, b) =>
        Number(b.status === 'pending') - Number(a.status === 'pending')
    )
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
      pending: rows.filter((row) => row.status === 'pending').length,
      problem: rows.filter((row) => row.issueLabels.length > 0).length,
      telegram: rows.filter((row) => row.telegram_chat_id).length,
      withKeywords: rows.filter((row) => row.keywordCount > 0).length,
    }
  }, [rows])

  function resetFilteredView() {
    setPage(1)
  }

  async function reviewSignup(row: UserRow, approve: boolean) {
    const label = row.email || row.user_id
    const confirmed = window.confirm(
      approve
        ? `${label} müraciəti təsdiqlənsin?\n\nHesab aktiv olacaq və 7 günlük demo başlayacaq.`
        : `${label} müraciəti rədd edilsin?\n\nİstifadəçi hesaba daxil ola bilməyəcək.`
    )

    if (!confirmed) return

    setReviewingUserId(row.user_id)
    setMessage('')

    const { error } = approve
      ? await supabase.rpc('admin_approve_signup', { p_user_id: row.user_id })
      : await supabase.rpc('admin_reject_signup', { p_user_id: row.user_id })

    setReviewingUserId(null)

    if (error) {
      setMessage(
        `${approve ? 'Təsdiqlənmədi' : 'Rədd edilmədi'}: ${friendlyError(error)}`
      )
      return
    }

    setMessage(
      approve
        ? `${label} təsdiqləndi: 7 günlük demo başladı.`
        : `${label} müraciəti rədd edildi.`
    )
    await loadUsers()
  }

  async function deleteUser(row: UserRow) {
    const label = row.email || row.user_id
    const confirmed = window.confirm(
      `${label} istifadəçisi silinsin?\n\nBu əməliyyat istifadəçinin monitorlarını, açar sözlərini, nəticələrini və bildirişlərini siləcək.`
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
      setMessage(`İstifadəçi silinmədi: ${friendlyError(error)}`)
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
        `Müvəqqəti parol yaradılmadı: ${friendlyError(error)}`
      )
      setResettingUserId(null)
      return
    }

    setTemporaryPassword({
      email: label,
      password: data.temporary_password,
      isNewAccount: false,
    })
    setMessage(
      'Müvəqqəti parol yaradıldı. Parolu yalnız bir dəfə görünən bu pəncərədən götürün.'
    )
    setResettingUserId(null)
  }

  function openNewAccount() {
    setNewAccount({ ...EMPTY_NEW_ACCOUNT, password: generatePassword() })
    setNewAccountError('')
    setNewAccountOpen(true)
  }

  function selectNewAccountPlan(planId: string) {
    const plan = plans.find((item) => item.id === planId)
    // Demo is a 7-day trial; other plans start active with no end date.
    setNewAccount((current) =>
      plan?.code === 'demo'
        ? {
            ...current,
            planId,
            status: 'trialing',
            periodEnd: dateInputValue(7),
          }
        : { ...current, planId, status: 'active', periodEnd: '' }
    )
  }

  async function createAccount() {
    setCreatingAccount(true)
    setNewAccountError('')

    const { data, error } = await supabase.functions.invoke<{
      email?: string
      password?: string
    }>('admin-users', {
      body: {
        action: 'create_user',
        email: newAccount.email,
        password: newAccount.password,
        plan_id: newAccount.planId,
        subscription_status: newAccount.status,
        current_period_end: newAccount.periodEnd
          ? new Date(`${newAccount.periodEnd}T23:59:59`).toISOString()
          : null,
      },
    })

    setCreatingAccount(false)

    if (error || !data?.password) {
      setNewAccountError(
        `Hesab yaradılmadı: ${await functionErrorMessage(error)}`
      )
      return
    }

    setNewAccountOpen(false)
    setTemporaryPassword({
      email: data.email || newAccount.email,
      password: data.password,
      isNewAccount: true,
    })
    setMessage('')
    await loadUsers()
  }

  function copyLoginDetails() {
    if (!temporaryPassword) return
    const text = temporaryPassword.isNewAccount
      ? `Giriş: ${window.location.origin}/sign-in\nEmail: ${temporaryPassword.email}\nParol: ${temporaryPassword.password}`
      : temporaryPassword.password
    void navigator.clipboard?.writeText(text)
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
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h1 className='text-xl font-semibold tracking-tight'>
            İstifadəçilər
          </h1>
          <p className='mt-1 text-sm text-muted-foreground'>
            Hesablar, monitorlar və bağlantı vəziyyəti.
          </p>
        </div>
        <Button onClick={openNewAccount}>
          <UserPlus className='size-4' />
          Yeni hesab
        </Button>
      </div>

      <Dialog open={newAccountOpen} onOpenChange={setNewAccountOpen}>
        <DialogContent>
          <form
            className='grid gap-4'
            onSubmit={(event) => {
              event.preventDefault()
              void createAccount()
            }}
          >
            <DialogHeader>
              <DialogTitle>Yeni müştəri hesabı</DialogTitle>
              <DialogDescription>
                Hesab təsdiq gözləmədən aktiv olur. Email təsdiqi tələb
                olunmur; giriş məlumatlarını müştəriyə özünüz verin.
              </DialogDescription>
            </DialogHeader>

            <label className='grid gap-1.5 text-sm font-medium'>
              Email
              <input
                type='email'
                required
                autoComplete='off'
                value={newAccount.email}
                onChange={(event) =>
                  setNewAccount((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                className='rounded-lg border bg-background px-3 py-2 font-normal'
                placeholder='musteri@sirket.az'
              />
            </label>

            <label className='grid gap-1.5 text-sm font-medium'>
              Parol
              <div className='flex gap-2'>
                <input
                  type='text'
                  autoComplete='new-password'
                  minLength={8}
                  maxLength={72}
                  value={newAccount.password}
                  onChange={(event) =>
                    setNewAccount((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                  className='min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 font-mono font-normal'
                  placeholder='Boş qalsa təsadüfi parol yaradılacaq'
                />
                <Button
                  type='button'
                  variant='outline'
                  onClick={() =>
                    setNewAccount((current) => ({
                      ...current,
                      password: generatePassword(),
                    }))
                  }
                >
                  <RefreshCw className='size-4' />
                  Təsadüfi
                </Button>
              </div>
            </label>

            <div className='grid gap-3 sm:grid-cols-2'>
              <label className='grid gap-1.5 text-sm font-medium sm:col-span-2'>
                Plan
                <select
                  required
                  value={newAccount.planId}
                  onChange={(event) => selectNewAccountPlan(event.target.value)}
                  className='rounded-lg border bg-background px-3 py-2 font-normal'
                >
                  <option value=''>Plan seçin</option>
                  {plans
                    .filter((plan) => plan.is_active)
                    .map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className='grid gap-1.5 text-sm font-medium'>
                Status
                <select
                  value={newAccount.status}
                  onChange={(event) =>
                    setNewAccount((current) => ({
                      ...current,
                      status: event.target.value as 'active' | 'trialing',
                    }))
                  }
                  className='rounded-lg border bg-background px-3 py-2 font-normal'
                >
                  <option value='active'>Aktiv</option>
                  <option value='trialing'>Sınaq</option>
                </select>
              </label>
              <label className='grid gap-1.5 text-sm font-medium'>
                Dövrün sonu
                <input
                  type='date'
                  min={dateInputValue(0)}
                  value={newAccount.periodEnd}
                  onChange={(event) =>
                    setNewAccount((current) => ({
                      ...current,
                      periodEnd: event.target.value,
                    }))
                  }
                  className='rounded-lg border bg-background px-3 py-2 font-normal'
                />
              </label>
            </div>

            {newAccountError ? (
              <div className='rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive'>
                {newAccountError}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() => setNewAccountOpen(false)}
              >
                Ləğv et
              </Button>
              <Button type='submit' disabled={creatingAccount}>
                {creatingAccount ? 'Yaradılır...' : 'Hesabı yarat'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {message ? (
        <div className='rounded-lg border bg-card p-4 text-sm text-warning'>
          {message}
        </div>
      ) : null}

      {temporaryPassword ? (
        <div className='rounded-lg border border-success/25 bg-success/10 p-4 text-sm text-success'>
          <div className='font-semibold'>
            {temporaryPassword.isNewAccount
              ? 'Hesab yaradıldı'
              : 'Müvəqqəti parol yaradıldı'}
          </div>
          <div className='mt-1'>İstifadəçi: {temporaryPassword.email}</div>
          <div className='mt-2 flex flex-wrap items-center gap-2'>
            <code className='rounded-md bg-background px-3 py-2 font-mono text-base'>
              {temporaryPassword.password}
            </code>
            <button
              type='button'
              onClick={copyLoginDetails}
              className='rounded-lg border border-success/25 bg-background px-3 py-2 font-medium hover:bg-success/10'
            >
              {temporaryPassword.isNewAccount
                ? 'Giriş məlumatlarını kopyala'
                : 'Kopyala'}
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

      <div className='grid grid-cols-2 gap-3 xl:grid-cols-5'>
        <button
          type='button'
          onClick={() => {
            setStatusFilter('pending')
            resetFilteredView()
          }}
          className='rounded-lg border bg-card p-3 text-left hover:bg-muted'
        >
          <div className='text-sm text-muted-foreground'>
            Gözləyən müraciətlər
          </div>
          <div
            className={
              stats.pending > 0
                ? 'text-2xl font-bold text-warning'
                : 'text-2xl font-bold text-foreground'
            }
          >
            {stats.pending}
          </div>
        </button>
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
            setStatusFilter('has_keywords')
            resetFilteredView()
          }}
          className='rounded-lg border bg-card p-3 text-left hover:bg-muted'
        >
          <div className='text-sm text-muted-foreground'>Açar sözü olan</div>
          <div className='text-2xl font-bold text-foreground'>
            {stats.withKeywords}
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
          <option value='pending'>Gözləyən müraciətlər</option>
          <option value='problem'>Müdaxilə lazımdır</option>
          <option value='telegram'>Telegram bağlıdır</option>
          <option value='no_telegram'>Telegram yoxdur</option>
          <option value='has_keywords'>Açar sözü var</option>
          <option value='no_keywords'>Açar sözü yoxdur</option>
        </select>
      </div>

      <ResponsiveTable label='İstifadəçi siyahısı' mobileLayout='cards'>
        <table role='table' className='min-w-[860px] text-left'>
          <thead>
            <tr role='row' className='border-b'>
              <th>İstifadəçi</th>
              <th>Plan</th>
              <th>Açar söz / Nəticə</th>
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
                  {row.status && ACCOUNT_STATUS_BADGES[row.status] ? (
                    <span
                      className={`mt-1 inline-block rounded px-2 py-0.5 text-xs font-medium ${ACCOUNT_STATUS_BADGES[row.status].className}`}
                    >
                      {ACCOUNT_STATUS_BADGES[row.status].label}
                    </span>
                  ) : null}
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
                  data-label='Açar söz / Nəticə'
                  className='tabular-nums'
                >
                  {row.keywordCount} / {row.resultCount}
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
                    {row.status === 'pending' ? (
                      <>
                        <Button
                          size='sm'
                          disabled={reviewingUserId === row.user_id}
                          onClick={() => void reviewSignup(row, true)}
                        >
                          Təsdiqlə
                        </Button>
                        <Button
                          variant='outline'
                          size='sm'
                          disabled={reviewingUserId === row.user_id}
                          onClick={() => void reviewSignup(row, false)}
                        >
                          Rədd et
                        </Button>
                      </>
                    ) : null}
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
