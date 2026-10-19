import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { supabase } from '@/lib/supabase'
import { ResponsiveTable } from '@/components/ui/responsive-table'
import {
  formatPlanPrice,
  normalizePlanRow,
  type SubscriptionPlan,
  type UserSubscription,
} from '@/features/subscriptions/model'

type UserProfile = {
  user_id: string
  email: string | null
  telegram_chat_id: string | null
  plan_id: string | null
  created_at?: string | null
  updated_at?: string | null
}

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
  base_url: string | null
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

function subscriptionStatusLabel(status: UserSubscription['status']) {
  return {
    active: 'Aktiv',
    trialing: 'Sınaq',
    canceled: 'Ləğv edilib',
    expired: 'Bitib',
  }[status]
}

function AdminUserDetailsPage() {
  const { userId } = Route.useParams()
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [monitors, setMonitors] = useState<Monitor[]>([])
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [plans, setPlans] = useState<SubscriptionPlan[]>([])
  const [subscriptions, setSubscriptions] = useState<UserSubscription[]>([])
  const [telegramChatId, setTelegramChatId] = useState('')
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [subscriptionStatus, setSubscriptionStatus] = useState<
    'active' | 'trialing'
  >('active')
  const [subscriptionEnd, setSubscriptionEnd] = useState('')
  const [subscriptionNotes, setSubscriptionNotes] = useState('')
  const [assigningPlan, setAssigningPlan] = useState(false)
  const [newMonitorName, setNewMonitorName] = useState('')
  const [newMonitorDescription, setNewMonitorDescription] = useState('')
  const [newKeywordByMonitor, setNewKeywordByMonitor] = useState<
    Record<string, string>
  >({})

  async function loadData() {
    setLoading(true)
    setMessage('')

    const [profileRes, monitorsRes, plansRes, subscriptionsRes] =
      await Promise.all([
        supabase
          .from('user_profiles')
          .select(
            'user_id,email,telegram_chat_id,plan_id,created_at,updated_at'
          )
          .eq('user_id', userId)
          .maybeSingle(),
        supabase
          .from('user_monitors')
          .select(
            'id,user_id,name,description,status,notify_telegram,telegram_chat_id,created_at'
          )
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
        supabase
          .from('subscription_plans')
          .select(
            'id,code,name,description,is_active,is_custom,is_public,price_amount,currency,billing_interval,display_order,max_watches,minimum_interval_minutes,history_days,telegram_enabled,features,created_at,updated_at'
          )
          .order('display_order')
          .order('name'),
        supabase
          .from('user_subscriptions')
          .select(
            'id,user_id,plan_id,status,started_at,current_period_end,ended_at,notes,created_at,updated_at'
          )
          .eq('user_id', userId)
          .order('started_at', { ascending: false }),
      ])

    const userMonitors = (monitorsRes.data || []) as Monitor[]
    const monitorIds = userMonitors.map((monitor) => monitor.id)

    let keywordData: Keyword[] = []
    let matchData: Match[] = []
    let itemData: Item[] = []
    let sourceData: Source[] = []

    if (monitorIds.length > 0) {
      const [keywordsRes, matchesRes] = await Promise.all([
        supabase
          .from('monitor_keywords')
          .select('id,monitor_id,keyword,match_type')
          .in('monitor_id', monitorIds)
          .order('keyword', { ascending: true }),
        supabase
          .from('monitor_matches')
          .select('id,monitor_id,item_id,matched_keyword,created_at')
          .in('monitor_id', monitorIds)
          .order('created_at', { ascending: false })
          .limit(200),
      ])

      keywordData = (keywordsRes.data || []) as Keyword[]
      matchData = (matchesRes.data || []) as Match[]

      const itemIds = Array.from(
        new Set(matchData.map((match) => match.item_id).filter(Boolean))
      )

      if (itemIds.length > 0) {
        const itemsRes = await supabase
          .from('monitored_items')
          .select('id,source_id,title,url,published_at,detected_at')
          .in('id', itemIds)

        itemData = (itemsRes.data || []) as Item[]

        const sourceIds = Array.from(
          new Set(itemData.map((item) => item.source_id).filter(Boolean))
        ) as string[]

        if (sourceIds.length > 0) {
          const sourcesRes = await supabase
            .from('sources')
            .select('id,name,base_url')
            .in('id', sourceIds)

          sourceData = (sourcesRes.data || []) as Source[]
        }
      }
    }

    if (profileRes.error) {
      setMessage(profileRes.error.message)
    }
    if (monitorsRes.error) {
      setMessage(monitorsRes.error.message)
    }
    if (plansRes.error) {
      setMessage(plansRes.error.message)
    }
    if (subscriptionsRes.error) {
      setMessage(subscriptionsRes.error.message)
    }

    const profileData = profileRes.data as UserProfile | null
    const planData = (
      (plansRes.data || []) as unknown as SubscriptionPlan[]
    ).map((plan) => normalizePlanRow(plan))
    setProfile(profileData)
    setTelegramChatId(profileData?.telegram_chat_id || '')
    setPlans(planData)
    setSubscriptions(
      (subscriptionsRes.data || []) as unknown as UserSubscription[]
    )
    setSelectedPlanId(
      profileData?.plan_id || planData.find((plan) => plan.is_active)?.id || ''
    )
    setMonitors(userMonitors)
    setKeywords(keywordData)
    setMatches(matchData)
    setItems(itemData)
    setSources(sourceData)
    setLoading(false)
  }

  const recentRows = useMemo(() => {
    return matches.slice(0, 20).map((match) => {
      const item = items.find((row) => row.id === match.item_id) || null
      const source = sources.find((row) => row.id === item?.source_id) || null

      return { match, item, source }
    })
  }, [matches, items, sources])

  const stats = useMemo(() => {
    return {
      activeMonitors: monitors.filter((monitor) => monitor.status === 'active')
        .length,
      inactiveMonitors: monitors.filter(
        (monitor) => monitor.status !== 'active'
      ).length,
      keywordCount: keywords.length,
      resultCount: matches.length,
    }
  }, [monitors, keywords, matches])

  const planById = useMemo(
    () => new Map(plans.map((plan) => [plan.id, plan])),
    [plans]
  )

  const currentSubscription = useMemo(
    () =>
      subscriptions.find((subscription) =>
        ['active', 'trialing'].includes(subscription.status)
      ) || null,
    [subscriptions]
  )

  async function assignSubscription() {
    if (!selectedPlanId) {
      setMessage('Təyin etmək üçün aktiv plan seçin.')
      return
    }

    const selectedPlan = planById.get(selectedPlanId)
    const confirmed = window.confirm(
      `${profile?.email || userId} istifadəçisinə “${selectedPlan?.name || 'seçilmiş'}” planı təyin edilsin? Cari abunə tarixçədə ləğv edilmiş kimi saxlanacaq.`
    )
    if (!confirmed) return

    setAssigningPlan(true)
    setMessage('')

    const endDate = subscriptionEnd
      ? new Date(`${subscriptionEnd}T23:59:59`).toISOString()
      : null

    const { error } = await supabase.rpc('admin_assign_user_subscription', {
      p_user_id: userId,
      p_plan_id: selectedPlanId,
      p_status: subscriptionStatus,
      p_current_period_end: endDate,
      p_notes: subscriptionNotes.trim() || null,
    })

    setAssigningPlan(false)

    if (error) {
      const knownErrors: Record<string, string> = {
        USER_PROFILE_NOT_FOUND:
          'Bu Auth istifadəçisi üçün user_profiles qeydi yoxdur. Əvvəlcə müştəri profilini yaradın.',
        ACTIVE_PLAN_NOT_FOUND:
          'Seçilmiş plan aktiv deyil və təyin edilə bilməz.',
        SUBSCRIPTION_END_MUST_BE_FUTURE:
          'Abunəliyin bitmə tarixi gələcəkdə olmalıdır.',
        ADMIN_ACCESS_REQUIRED:
          'Bu əməliyyat üçün aktiv admin icazəsi tələb olunur.',
      }
      setMessage(knownErrors[error.message] || error.message)
      return
    }

    setSubscriptionNotes('')
    setSubscriptionEnd('')
    await loadData()
    setMessage('Plan uğurla təyin edildi.')
  }

  async function saveTelegram() {
    const value = telegramChatId.trim() || null

    const { error: profileError } = await supabase.from('user_profiles').upsert(
      {
        user_id: userId,
        telegram_chat_id: value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )

    const { error: monitorError } = await supabase
      .from('user_monitors')
      .update({ telegram_chat_id: value, notify_telegram: Boolean(value) })
      .eq('user_id', userId)

    if (profileError || monitorError) {
      setMessage(
        profileError?.message || monitorError?.message || 'Xəta baş verdi'
      )
      return
    }

    await loadData()
  }

  async function disableTelegram() {
    const confirmed = window.confirm(
      'Bu istifadəçi üçün Telegram bağlantısı deaktiv edilsin? Monitorların Telegram bildirişi də söndürüləcək.'
    )

    if (!confirmed) return

    const { error: profileError } = await supabase.from('user_profiles').upsert(
      {
        user_id: userId,
        telegram_chat_id: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )

    const { error: monitorError } = await supabase
      .from('user_monitors')
      .update({ telegram_chat_id: null, notify_telegram: false })
      .eq('user_id', userId)

    if (profileError || monitorError) {
      setMessage(
        profileError?.message || monitorError?.message || 'Xəta baş verdi'
      )
      return
    }

    setTelegramChatId('')
    await loadData()
  }

  async function createMonitor() {
    const name = newMonitorName.trim()
    if (!name) return

    const { error } = await supabase.from('user_monitors').insert({
      user_id: userId,
      name,
      description: newMonitorDescription.trim() || null,
      status: 'active',
      notify_telegram: true,
      telegram_chat_id:
        telegramChatId.trim() || profile?.telegram_chat_id || null,
    })

    if (error) {
      setMessage(error.message)
      return
    }

    setNewMonitorName('')
    setNewMonitorDescription('')
    await loadData()
  }

  async function toggleMonitor(monitor: Monitor) {
    const nextStatus = monitor.status === 'active' ? 'inactive' : 'active'
    const { error } = await supabase
      .from('user_monitors')
      .update({ status: nextStatus })
      .eq('id', monitor.id)

    if (error) {
      setMessage(error.message)
      return
    }

    await loadData()
  }

  async function deleteMonitor(monitor: Monitor) {
    const ok = window.confirm(
      `"${monitor.name}" monitoru silinsin? Bu monitorun açar sözləri və uyğunluq qeydləri də silinəcək.`
    )

    if (!ok) return

    const monitorMatches = matches.filter(
      (match) => match.monitor_id === monitor.id
    )
    const matchIds = monitorMatches.map((match) => match.id)

    if (matchIds.length > 0) {
      const { error: alertError } = await supabase
        .from('notification_logs')
        .delete()
        .in('match_id', matchIds)

      if (alertError) {
        setMessage(alertError.message)
        return
      }
    }

    const { error: keywordError } = await supabase
      .from('monitor_keywords')
      .delete()
      .eq('monitor_id', monitor.id)

    if (keywordError) {
      setMessage(keywordError.message)
      return
    }

    const { error: matchError } = await supabase
      .from('monitor_matches')
      .delete()
      .eq('monitor_id', monitor.id)

    if (matchError) {
      setMessage(matchError.message)
      return
    }

    const { error: monitorError } = await supabase
      .from('user_monitors')
      .delete()
      .eq('id', monitor.id)

    if (monitorError) {
      setMessage(monitorError.message)
      return
    }

    await loadData()
  }

  async function addKeyword(monitorId: string) {
    const value = (newKeywordByMonitor[monitorId] || '').trim()
    if (!value) return

    const { error } = await supabase.from('monitor_keywords').insert({
      monitor_id: monitorId,
      keyword: value,
      match_type: 'contains',
    })

    if (error) {
      setMessage(error.message)
      return
    }

    setNewKeywordByMonitor((current) => ({ ...current, [monitorId]: '' }))
    await loadData()
  }

  async function deleteKeyword(keyword: Keyword) {
    const ok = window.confirm(`"${keyword.keyword}" açar sözü silinsin?`)
    if (!ok) return

    const { error } = await supabase
      .from('monitor_keywords')
      .delete()
      .eq('id', keyword.id)

    if (error) {
      setMessage(error.message)
      return
    }

    await loadData()
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [userId])

  if (loading) return <div className='p-6'>Yüklənir...</div>

  return (
    <div className='grid gap-6 p-6'>
      <div>
        <Link
          to='/admin/users'
          className='text-sm text-primary hover:underline'
        >
          ← İstifadəçilərə qayıt
        </Link>
        <h1 className='mt-3 text-xl font-semibold tracking-tight'>
          {profile?.email || 'Email qeyd edilməyib'}
        </h1>
        <p className='text-muted-foreground'>{userId}</p>
      </div>

      {message ? (
        <div className='rounded-lg border bg-card p-4 text-sm text-warning'>
          {message}
        </div>
      ) : null}

      <div className='grid gap-4 md:grid-cols-4'>
        <div className='rounded-lg border border-success/25 bg-success/10 p-4'>
          <div className='text-sm text-muted-foreground'>Aktiv monitor</div>
          <div className='text-2xl font-bold text-success'>
            {stats.activeMonitors}
          </div>
        </div>
        <div className='rounded-lg border border-destructive/25 bg-destructive/10 p-4'>
          <div className='text-sm text-muted-foreground'>Passiv monitor</div>
          <div className='text-2xl font-bold text-destructive'>
            {stats.inactiveMonitors}
          </div>
        </div>
        <div className='rounded-lg border border-border bg-muted p-4'>
          <div className='text-sm text-muted-foreground'>Açar söz</div>
          <div className='text-2xl font-bold text-foreground'>
            {stats.keywordCount}
          </div>
        </div>
        <div className='rounded-lg border border-border bg-muted p-4'>
          <div className='text-sm text-muted-foreground'>Son nəticələr</div>
          <div className='text-2xl font-bold text-foreground'>
            {stats.resultCount}
          </div>
        </div>
      </div>

      <section className='rounded-lg border bg-card p-4'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <h2 className='font-semibold'>Abunəlik planı</h2>
            <p className='text-sm text-muted-foreground'>
              Yeni təyinat cari planı əvəz edir və əvvəlki qeydi tarixçədə
              saxlayır. Dövr sonu məlumat üçündür; avtomatik ödəniş və yenilənmə
              bu mərhələyə daxil deyil.
            </p>
          </div>
          <Link
            to='/admin/subscriptions'
            className='rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted'
          >
            Planları idarə et
          </Link>
        </div>

        <div className='mt-4 rounded-lg border border-border bg-muted p-4'>
          <div className='text-xs font-medium tracking-wide text-foreground uppercase'>
            Cari plan
          </div>
          <div className='mt-1 text-lg font-semibold text-blue-950'>
            {profile?.plan_id
              ? planById.get(profile.plan_id)?.name || 'Naməlum plan'
              : 'Plan təyin edilməyib'}
          </div>
          <div className='mt-1 text-sm text-foreground'>
            {currentSubscription
              ? `${subscriptionStatusLabel(currentSubscription.status)} · ${formatDate(currentSubscription.started_at)} tarixindən`
              : 'Cari abunə tarixçəsi yoxdur.'}
          </div>
          {currentSubscription?.current_period_end ? (
            <div className='mt-1 text-sm text-foreground'>
              Bitmə tarixi: {formatDate(currentSubscription.current_period_end)}
            </div>
          ) : null}
        </div>

        {!profile ? (
          <div className='mt-4 rounded-lg border border-warning/25 bg-warning/10 p-3 text-sm text-warning'>
            Bu Auth istifadəçisi üçün müştəri profili yoxdur. Plan təyin etmək
            üçün əvvəlcə profil yaradılmalıdır.
          </div>
        ) : null}

        <div className='mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[1.4fr_0.7fr_0.8fr_1.4fr_auto] xl:items-end'>
          <label className='grid gap-1.5 text-sm font-medium'>
            Plan
            <select
              value={selectedPlanId}
              onChange={(event) => setSelectedPlanId(event.target.value)}
              className='rounded-lg border bg-background px-3 py-2 font-normal'
            >
              <option value=''>Plan seçin</option>
              {plans
                .filter((plan) => plan.is_active)
                .map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} · {formatPlanPrice(plan)}
                  </option>
                ))}
            </select>
          </label>
          <label className='grid gap-1.5 text-sm font-medium'>
            Status
            <select
              value={subscriptionStatus}
              onChange={(event) =>
                setSubscriptionStatus(
                  event.target.value as 'active' | 'trialing'
                )
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
              value={subscriptionEnd}
              onChange={(event) => setSubscriptionEnd(event.target.value)}
              className='rounded-lg border bg-background px-3 py-2 font-normal'
            />
          </label>
          <label className='grid gap-1.5 text-sm font-medium'>
            Daxili qeyd
            <input
              value={subscriptionNotes}
              maxLength={1000}
              onChange={(event) => setSubscriptionNotes(event.target.value)}
              className='rounded-lg border bg-background px-3 py-2 font-normal'
              placeholder='Məsələn, müqavilə nömrəsi'
            />
          </label>
          <button
            type='button'
            onClick={() => void assignSubscription()}
            disabled={!profile || !selectedPlanId || assigningPlan}
            className='rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50'
          >
            {assigningPlan ? 'Təyin edilir...' : 'Planı təyin et'}
          </button>
        </div>

        {subscriptions.length > 0 ? (
          <details className='mt-4 rounded-lg border'>
            <summary className='cursor-pointer px-4 py-3 text-sm font-medium'>
              Abunəlik tarixçəsi ({subscriptions.length})
            </summary>
            <ResponsiveTable label='İstifadəçinin monitorları'>
              <table className='w-full min-w-[680px] text-left text-sm'>
                <thead className='border-b bg-muted/50 text-xs text-muted-foreground'>
                  <tr>
                    <th className='px-4 py-3 font-medium'>Plan</th>
                    <th className='px-4 py-3 font-medium'>Status</th>
                    <th className='px-4 py-3 font-medium'>Başlanğıc</th>
                    <th className='px-4 py-3 font-medium'>Bitiş</th>
                    <th className='px-4 py-3 font-medium'>Qeyd</th>
                  </tr>
                </thead>
                <tbody>
                  {subscriptions.map((subscription) => (
                    <tr
                      key={subscription.id}
                      className='border-b last:border-0'
                    >
                      <td className='px-4 py-3 font-medium'>
                        {planById.get(subscription.plan_id)?.name ||
                          'Naməlum plan'}
                      </td>
                      <td className='px-4 py-3'>
                        {subscriptionStatusLabel(subscription.status)}
                      </td>
                      <td className='px-4 py-3'>
                        {formatDate(subscription.started_at)}
                      </td>
                      <td className='px-4 py-3'>
                        {formatDate(
                          subscription.current_period_end ||
                            subscription.ended_at
                        )}
                      </td>
                      <td className='max-w-64 truncate px-4 py-3 text-muted-foreground'>
                        {subscription.notes || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ResponsiveTable>
          </details>
        ) : null}
      </section>

      <div className='grid gap-3 rounded-lg border bg-card p-4 md:grid-cols-[1fr_auto]'>
        <div>
          <div className='mb-2 text-sm font-medium'>Telegram bağlantısı</div>
          <input
            aria-label='Telegram chat id'
            value={telegramChatId}
            onChange={(event) => setTelegramChatId(event.target.value)}
            placeholder='Telegram chat id'
            className='w-full rounded-lg border bg-background px-3 py-2'
          />
        </div>
        <div className='flex flex-wrap items-end gap-2 self-end'>
          <button
            type='button'
            onClick={saveTelegram}
            className='rounded-lg bg-primary px-4 py-2 text-primary-foreground'
          >
            Telegramı yenilə
          </button>
          <button
            type='button'
            onClick={disableTelegram}
            disabled={!telegramChatId.trim() && !profile?.telegram_chat_id}
            className='rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-2 text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50'
          >
            Telegramı deaktiv et
          </button>
        </div>
      </div>

      <div className='rounded-lg border bg-card p-4'>
        <div className='mb-3 font-semibold'>Yeni monitor yarat</div>
        <div className='grid gap-3 md:grid-cols-[1fr_1fr_auto]'>
          <input
            aria-label='Monitor adı'
            value={newMonitorName}
            onChange={(event) => setNewMonitorName(event.target.value)}
            placeholder='Monitor adı'
            className='rounded-lg border bg-background px-3 py-2'
          />
          <input
            aria-label='Qısa təsvir'
            value={newMonitorDescription}
            onChange={(event) => setNewMonitorDescription(event.target.value)}
            placeholder='Qısa təsvir'
            className='rounded-lg border bg-background px-3 py-2'
          />
          <button
            type='button'
            onClick={createMonitor}
            className='rounded-lg border bg-card px-4 py-2 hover:bg-muted'
          >
            Yarat
          </button>
        </div>
      </div>

      <div className='grid gap-4'>
        {monitors.map((monitor) => {
          const monitorKeywords = keywords.filter(
            (keyword) => keyword.monitor_id === monitor.id
          )
          const monitorMatches = matches.filter(
            (match) => match.monitor_id === monitor.id
          )

          return (
            <div key={monitor.id} className='rounded-lg border bg-card p-4'>
              <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                  <div className='text-lg font-semibold'>{monitor.name}</div>
                  <div className='text-sm text-muted-foreground'>
                    {monitor.description || 'Təsvir yoxdur'}
                  </div>
                </div>
                <div className='flex flex-wrap gap-2'>
                  <span
                    className={`rounded-full border px-3 py-1 text-xs ${
                      monitor.status === 'active'
                        ? 'border-success/25 bg-success/10 text-success'
                        : 'border-destructive/25 bg-destructive/10 text-destructive'
                    }`}
                  >
                    {monitor.status === 'active' ? 'Aktiv' : 'Passiv'}
                  </span>
                  <button
                    type='button'
                    onClick={() => toggleMonitor(monitor)}
                    className={`rounded-md px-3 py-1 text-xs font-medium ${
                      monitor.status === 'active'
                        ? 'bg-destructive/10 text-destructive hover:bg-destructive/10'
                        : 'bg-success/10 text-success hover:bg-success/10'
                    }`}
                  >
                    {monitor.status === 'active' ? 'Passiv et' : 'Aktiv et'}
                  </button>
                  <button
                    type='button'
                    onClick={() => deleteMonitor(monitor)}
                    className='rounded-md bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/10'
                  >
                    Sil
                  </button>
                </div>
              </div>

              <div className='mt-4 grid gap-3 md:grid-cols-3'>
                <div className='rounded-lg bg-muted p-3'>
                  <div className='text-lg font-bold text-foreground'>
                    {monitorKeywords.length}
                  </div>
                  <div className='text-xs text-muted-foreground'>Açar söz</div>
                </div>
                <div className='rounded-lg bg-muted p-3'>
                  <div className='text-lg font-bold text-foreground'>
                    {monitorMatches.length}
                  </div>
                  <div className='text-xs text-muted-foreground'>Nəticə</div>
                </div>
                <div className='rounded-lg bg-success/10 p-3'>
                  <div className='text-lg font-bold text-success'>
                    {formatDate(monitor.created_at)}
                  </div>
                  <div className='text-xs text-muted-foreground'>Yaradılıb</div>
                </div>
              </div>

              <div className='mt-4'>
                <div className='mb-2 text-sm font-medium'>Açar sözlər</div>
                <div className='flex flex-wrap gap-2'>
                  {monitorKeywords.map((keyword) => (
                    <button
                      key={keyword.id}
                      type='button'
                      onClick={() => deleteKeyword(keyword)}
                      className='rounded-full border px-3 py-1 text-sm hover:bg-destructive/10 hover:text-destructive'
                      title='Silmək üçün kliklə'
                    >
                      {keyword.keyword}
                    </button>
                  ))}
                  {monitorKeywords.length === 0 ? (
                    <span className='text-sm text-muted-foreground'>
                      Açar söz yoxdur
                    </span>
                  ) : null}
                </div>
                <div className='mt-3 grid gap-2 md:grid-cols-[1fr_auto]'>
                  <input
                    aria-label='Yeni açar söz'
                    value={newKeywordByMonitor[monitor.id] || ''}
                    onChange={(event) =>
                      setNewKeywordByMonitor((current) => ({
                        ...current,
                        [monitor.id]: event.target.value,
                      }))
                    }
                    placeholder='Yeni açar söz'
                    className='rounded-lg border bg-background px-3 py-2'
                  />
                  <button
                    type='button'
                    onClick={() => addKeyword(monitor.id)}
                    className='rounded-lg border px-4 py-2 hover:bg-muted'
                  >
                    Əlavə et
                  </button>
                </div>
              </div>
            </div>
          )
        })}

        {monitors.length === 0 ? (
          <div className='rounded-lg border bg-card p-8 text-center text-muted-foreground'>
            Bu istifadəçinin monitoru yoxdur. Buradan yeni monitor yarada
            bilərsən.
          </div>
        ) : null}
      </div>

      <div className='rounded-lg border bg-card p-4'>
        <div className='mb-3 font-semibold'>Son tapılan xəbərlər</div>
        <div className='grid gap-2'>
          {recentRows.map(({ match, item, source }) => (
            <a
              key={match.id}
              href={item?.url || '#'}
              target='_blank'
              rel='noreferrer'
              className='rounded-lg border p-3 hover:bg-muted/50'
            >
              <div className='font-medium'>
                {item?.title || 'Başlıq yoxdur'}
              </div>
              <div className='mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground'>
                <span>{source?.name || 'Mənbə yoxdur'}</span>
                <span>{match.matched_keyword || 'Açar söz yoxdur'}</span>
                <span>
                  {formatDate(item?.published_at || match.created_at)}
                </span>
              </div>
            </a>
          ))}
          {recentRows.length === 0 ? (
            <div className='text-sm text-muted-foreground'>Nəticə yoxdur.</div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/(auth)/admin/users/$userId')({
  component: AdminUserDetailsPage,
})
