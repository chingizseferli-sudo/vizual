import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  CUSTOM_SOCIAL_INTERVAL_RANGE,
  SOCIAL_INTERVAL_OPTIONS,
  formatDuration,
  formatSocialInterval,
  isValidCustomSocialInterval,
} from '@/lib/social-intervals'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { ResponsiveTable } from '@/components/ui/responsive-table'
import {
  formatPlanPrice,
  normalizePlanRow,
  planKeywordLimit,
  planSocialIntervalMinutes,
  planSocialKeywordLimit,
  type SubscriptionPlan,
  type UserSubscription,
} from '@/features/subscriptions/model'
import { friendlyError } from '@/lib/friendly-error'

type UserProfile = {
  user_id: string
  email: string | null
  telegram_chat_id: string | null
  plan_id: string | null
  status: string | null
  social_interval_minutes: number | null
  // Exists after migration 20261022000006.
  social_keyword_limit?: number | null
  created_at?: string | null
  updated_at?: string | null
}

type Monitor = {
  id: string
  user_id: string
  name: string
  description: string | null
  status: string | null
  inactive_reason?: string | null
  notify_telegram: boolean | null
  telegram_chat_id: string | null
  created_at: string | null
}

type Keyword = {
  id: string
  monitor_id: string
  keyword: string
  match_type: string | null
  // Added by migration 20261020000008; read with select('*').
  status?: string | null
  created_at: string | null
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
  const [socialInterval, setSocialInterval] = useState('')
  const [customSocialInterval, setCustomSocialInterval] = useState('')
  const [socialKeywordLimit, setSocialKeywordLimit] = useState('')
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [subscriptionStatus, setSubscriptionStatus] = useState<
    'active' | 'trialing'
  >('active')
  const [subscriptionEnd, setSubscriptionEnd] = useState('')
  const [subscriptionNotes, setSubscriptionNotes] = useState('')
  const [assigningPlan, setAssigningPlan] = useState(false)
  const [reviewingSignup, setReviewingSignup] = useState(false)
  const [newKeyword, setNewKeyword] = useState('')

  async function loadData() {
    setLoading(true)
    setMessage('')

    const [profileRes, monitorsRes, plansRes, subscriptionsRes] =
      await Promise.all([
        supabase
          .from('user_profiles')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle(),
        // '*': inactive_reason exists only after migration 20261020000002.
        supabase
          .from('user_monitors')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
        supabase
          .from('subscription_plans')
          .select(
            'id,code,name,description,is_active,is_custom,is_public,price_amount,currency,billing_interval,display_order,max_watches,minimum_interval_minutes,history_days,telegram_enabled,features,limits,created_at,updated_at'
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
          .select('*')
          .in(
            'monitor_id',
            userMonitors
              .filter((monitor) => monitor.status !== 'archived')
              .map((monitor) => monitor.id)
          )
          .order('created_at', { ascending: true }),
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
      setMessage(friendlyError(profileRes.error))
    }
    if (monitorsRes.error) {
      setMessage(friendlyError(monitorsRes.error))
    }
    if (plansRes.error) {
      setMessage(friendlyError(plansRes.error))
    }
    if (subscriptionsRes.error) {
      setMessage(friendlyError(subscriptionsRes.error))
    }

    const profileData = profileRes.data as UserProfile | null
    const planData = (
      (plansRes.data || []) as unknown as SubscriptionPlan[]
    ).map((plan) => normalizePlanRow(plan))
    setProfile(profileData)
    setTelegramChatId(profileData?.telegram_chat_id || '')
    const savedInterval = profileData?.social_interval_minutes ?? null
    const isPreset = SOCIAL_INTERVAL_OPTIONS.some(
      (option) => option.minutes === savedInterval
    )
    setSocialInterval(
      savedInterval === null ? '' : isPreset ? String(savedInterval) : 'custom'
    )
    setCustomSocialInterval(savedInterval === null ? '' : String(savedInterval))
    setSocialKeywordLimit(String(profileData?.social_keyword_limit ?? ''))
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

  // Customers have one non-archived monitor holding all keywords; a keyword
  // is tracked when that monitor is active and the keyword is not paused.
  const monitorStatus = useMemo(
    () => new Map(monitors.map((monitor) => [monitor.id, monitor.status])),
    [monitors]
  )
  const isKeywordActive = (keyword: Keyword) =>
    monitorStatus.get(keyword.monitor_id) === 'active' &&
    keyword.status !== 'paused'
  const keywordStatusSupported = keywords.length === 0 || 'status' in keywords[0]

  const stats = useMemo(() => {
    const active = keywords.filter(
      (keyword) =>
        monitorStatus.get(keyword.monitor_id) === 'active' &&
        keyword.status !== 'paused'
    ).length
    return {
      activeKeywords: active,
      pausedKeywords: keywords.length - active,
      resultCount: matches.length,
    }
  }, [monitorStatus, keywords, matches])

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

  const planSocialInterval = planSocialIntervalMinutes(
    profile?.plan_id ? planById.get(profile.plan_id) : undefined
  )
  const planSocialKeywords = planSocialKeywordLimit(
    profile?.plan_id ? planById.get(profile.plan_id) : undefined
  )
  const currentKeywordLimit = planKeywordLimit(
    (profile?.plan_id ? planById.get(profile.plan_id) : undefined) ??
      plans.find((plan) => plan.code === 'free')
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
      setMessage(friendlyError(error))
      return
    }

    setSubscriptionNotes('')
    setSubscriptionEnd('')
    await loadData()
    setMessage('Plan uğurla təyin edildi.')
  }

  async function reviewSignup(approve: boolean) {
    const confirmed = window.confirm(
      approve
        ? `${profile?.email || userId} müraciəti təsdiqlənsin? Hesab aktiv olacaq və 7 günlük demo başlayacaq.`
        : `${profile?.email || userId} müraciəti rədd edilsin? İstifadəçi hesaba daxil ola bilməyəcək.`
    )
    if (!confirmed) return

    setReviewingSignup(true)
    setMessage('')

    const { error } = approve
      ? await supabase.rpc('admin_approve_signup', { p_user_id: userId })
      : await supabase.rpc('admin_reject_signup', { p_user_id: userId })

    setReviewingSignup(false)

    if (error) {
      setMessage(friendlyError(error))
      return
    }

    await loadData()
    setMessage(
      approve
        ? 'Müraciət təsdiqləndi: 7 günlük demo başladı.'
        : 'Müraciət rədd edildi.'
    )
  }

  async function saveSocialInterval(value: string) {
    setSocialInterval(value)
    if (value === 'custom') return
    await writeSocialInterval(value ? Number(value) : null)
  }

  async function saveCustomSocialInterval() {
    const minutes = Number(customSocialInterval.trim())
    if (!isValidCustomSocialInterval(minutes)) {
      setMessage(
        `Fərdi tezlik ${CUSTOM_SOCIAL_INTERVAL_RANGE.min}-${CUSTOM_SOCIAL_INTERVAL_RANGE.max} dəqiqə arası tam ədəd olmalıdır.`
      )
      return
    }
    await writeSocialInterval(minutes)
  }

  async function writeSocialInterval(minutes: number | null) {
    const { error } = await supabase
      .from('user_profiles')
      .update({ social_interval_minutes: minutes })
      .eq('user_id', userId)

    if (error) {
      setMessage(friendlyError(error))
      return
    }

    await loadData()
    setMessage('Sosial yoxlama tezliyi saxlanıldı.')
  }

  async function saveSocialKeywordLimit() {
    const trimmed = socialKeywordLimit.trim()
    const value = trimmed === '' ? null : Number(trimmed)
    if (value !== null && (!Number.isInteger(value) || value < 0 || value > 1000)) {
      setMessage('Sosial açar söz limiti 0-1000 arası tam ədəd olmalıdır.')
      return
    }
    const { error } = await supabase
      .from('user_profiles')
      .update({ social_keyword_limit: value })
      .eq('user_id', userId)

    if (error) {
      setMessage(friendlyError(error))
      return
    }

    await loadData()
    setMessage('Sosial açar söz limiti saxlanıldı.')
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
        friendlyError(profileError || monitorError)
      )
      return
    }

    await loadData()
  }

  async function disableTelegram() {
    const confirmed = window.confirm(
      'Bu istifadəçi üçün Telegram bağlantısı deaktiv edilsin? Telegram bildirişləri dayanacaq.'
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
        friendlyError(profileError || monitorError)
      )
      return
    }

    setTelegramChatId('')
    await loadData()
  }

  async function addKeyword() {
    const value = newKeyword.trim()
    if (!value) return

    let monitorId = monitors.find((monitor) => monitor.status === 'active')?.id
    if (!monitorId) {
      const { data, error } = await supabase
        .from('user_monitors')
        .insert({
          user_id: userId,
          name: 'Açar sözlər',
          status: 'active',
          notify_telegram: true,
          telegram_chat_id: profile?.telegram_chat_id || null,
        })
        .select('id')
        .single()
      if (error) {
        setMessage(friendlyError(error))
        return
      }
      monitorId = data.id as string
    }

    const { error } = await supabase.from('monitor_keywords').insert({
      monitor_id: monitorId,
      keyword: value,
      match_type: 'contains',
    })

    if (error) {
      setMessage(friendlyError(error))
      return
    }

    setNewKeyword('')
    await loadData()
  }

  async function toggleKeyword(keyword: Keyword) {
    const { error } = await supabase
      .from('monitor_keywords')
      .update({ status: isKeywordActive(keyword) ? 'paused' : 'active' })
      .eq('id', keyword.id)

    if (error) {
      setMessage(friendlyError(error))
      return
    }

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
      setMessage(friendlyError(error))
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

      <div className='grid gap-4 md:grid-cols-3'>
        <div className='rounded-lg border border-success/25 bg-success/10 p-4'>
          <div className='text-sm text-muted-foreground'>Aktiv açar söz</div>
          <div className='text-2xl font-bold text-success'>
            {stats.activeKeywords}
            {currentKeywordLimit !== null ? ` / ${currentKeywordLimit}` : ''}
          </div>
        </div>
        <div className='rounded-lg border border-destructive/25 bg-destructive/10 p-4'>
          <div className='text-sm text-muted-foreground'>
            Dayandırılmış açar söz
          </div>
          <div className='text-2xl font-bold text-destructive'>
            {stats.pausedKeywords}
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
              {currentSubscription.status === 'trialing'
                ? 'Demo bitmə tarixi'
                : 'Bitmə tarixi'}
              : {formatDate(currentSubscription.current_period_end)}
            </div>
          ) : null}
          {profile?.status && profile.status !== 'active' ? (
            <div className='mt-2 text-sm font-medium text-warning'>
              Hesab:{' '}
              {{
                pending: 'Təsdiq gözləyir',
                rejected: 'Rədd edilib',
                expired: 'Demo bitib, plan təyin edilməyib',
                inactive: 'Passiv',
                blocked: 'Bloklanıb',
              }[profile.status] || profile.status}
            </div>
          ) : null}
          {profile?.status === 'pending' || profile?.status === 'rejected' ? (
            <div className='mt-3 flex flex-wrap gap-2'>
              <Button
                size='sm'
                disabled={reviewingSignup}
                onClick={() => void reviewSignup(true)}
              >
                Təsdiqlə (7 günlük demo)
              </Button>
              {profile.status === 'pending' ? (
                <Button
                  variant='outline'
                  size='sm'
                  disabled={reviewingSignup}
                  onClick={() => void reviewSignup(false)}
                >
                  Rədd et
                </Button>
              ) : null}
            </div>
          ) : null}
          {profile?.status === 'expired' ? (
            <div className='mt-1 text-xs text-muted-foreground'>
              Aşağıdan plan təyin etmək hesabı yenidən aktiv edir.
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

        <label className='mt-4 grid max-w-sm gap-1.5 text-sm font-medium'>
          Fərdi təklif (plana baxmayaraq)
          <select
            value={socialInterval}
            onChange={(event) => void saveSocialInterval(event.target.value)}
            disabled={!profile}
            className='rounded-lg border bg-background px-3 py-2 font-normal'
          >
            <option value=''>
              Plan üzrə
              {planSocialInterval
                ? ` (${formatSocialInterval(planSocialInterval)})`
                : ''}
            </option>
            {SOCIAL_INTERVAL_OPTIONS.map((option) => (
              <option key={option.minutes} value={option.minutes}>
                {option.label}
              </option>
            ))}
            <option value='custom'>Fərdi (dəqiqə)</option>
          </select>
          <span className='text-xs font-normal text-muted-foreground'>
            Facebook və Instagram-da bu müştərinin açar sözləri hansı tezliklə
            axtarılsın. Boş qalsa, plan təyin edir.
          </span>
        </label>

        {socialInterval === 'custom' ? (
          <CustomSocialIntervalInput
            value={customSocialInterval}
            onChange={setCustomSocialInterval}
            onSave={() => void saveCustomSocialInterval()}
            disabled={!profile}
          />
        ) : null}

        {profile && 'social_keyword_limit' in profile ? (
          <div className='mt-4 grid max-w-sm gap-1.5 text-sm font-medium'>
            <label htmlFor='social-keyword-limit'>
              Fərdi sosial açar söz limiti
            </label>
            <div className='flex gap-2'>
              <input
                id='social-keyword-limit'
                type='number'
                min='0'
                max='1000'
                step='1'
                value={socialKeywordLimit}
                onChange={(event) => setSocialKeywordLimit(event.target.value)}
                className='min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 font-normal'
                placeholder={`Plan üzrə (${planSocialKeywords ?? 'limitsiz'})`}
              />
              <Button
                type='button'
                variant='outline'
                onClick={() => void saveSocialKeywordLimit()}
              >
                Saxla
              </Button>
            </div>
            <span className='text-xs font-normal text-muted-foreground'>
              Neçə açar söz Facebook və Instagram-da axtarılsın. Boş qalsa,
              plan təyin edir; 0 sosial axtarışı bağlayır.
            </span>
          </div>
        ) : null}

        {subscriptions.length > 0 ? (
          <details className='mt-4 rounded-lg border'>
            <summary className='cursor-pointer px-4 py-3 text-sm font-medium'>
              Abunəlik tarixçəsi ({subscriptions.length})
            </summary>
            <ResponsiveTable label='Abunəlik tarixçəsi'>
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
        <div className='mb-3 font-semibold'>Açar sözlər</div>
        <div className='flex flex-wrap gap-2'>
          {keywords.map((keyword) => {
            const active = isKeywordActive(keyword)
            return (
              <span
                key={keyword.id}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${
                  active ? '' : 'text-muted-foreground'
                }`}
              >
                {keyword.keyword}
                {active ? null : <span className='text-xs'>(dayandırılıb)</span>}
                {keywordStatusSupported ? (
                  <button
                    type='button'
                    onClick={() => toggleKeyword(keyword)}
                    className='text-xs text-primary hover:underline'
                  >
                    {active ? 'Dayandır' : 'Davam et'}
                  </button>
                ) : null}
                <button
                  type='button'
                  onClick={() => deleteKeyword(keyword)}
                  className='text-xs text-destructive hover:underline'
                >
                  Sil
                </button>
              </span>
            )
          })}
          {keywords.length === 0 ? (
            <span className='text-sm text-muted-foreground'>
              Bu istifadəçinin açar sözü yoxdur.
            </span>
          ) : null}
        </div>
        <div className='mt-3 grid gap-2 md:grid-cols-[1fr_auto]'>
          <input
            aria-label='Yeni açar söz'
            value={newKeyword}
            onChange={(event) => setNewKeyword(event.target.value)}
            placeholder='Yeni açar söz'
            className='rounded-lg border bg-background px-3 py-2'
          />
          <button
            type='button'
            onClick={addKeyword}
            className='rounded-lg border px-4 py-2 hover:bg-muted'
          >
            Əlavə et
          </button>
        </div>
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

function CustomSocialIntervalInput({
  value,
  onChange,
  onSave,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  onSave: () => void
  disabled: boolean
}) {
  const minutes = Number(value.trim())
  const valid = value.trim() !== '' && isValidCustomSocialInterval(minutes)
  const [facebookFloor, setFacebookFloor] = useState(360)

  useEffect(() => {
    let active = true
    void supabase
      .from('social_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        const floor = Number(
          (data as { fb_min_interval_minutes?: number } | null)
            ?.fb_min_interval_minutes
        )
        if (active && Number.isFinite(floor) && floor > 0) setFacebookFloor(floor)
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <div className='mt-3 grid max-w-sm gap-1.5 text-sm font-medium'>
      <label htmlFor='custom-social-interval'>Fərdi tezlik (dəqiqə)</label>
      <div className='flex gap-2'>
        <input
          id='custom-social-interval'
          type='number'
          min={CUSTOM_SOCIAL_INTERVAL_RANGE.min}
          max={CUSTOM_SOCIAL_INTERVAL_RANGE.max}
          step='1'
          inputMode='numeric'
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          placeholder='Məsələn, 45'
          className='min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 font-normal'
        />
        <button
          type='button'
          onClick={onSave}
          disabled={disabled || !valid}
          className='rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50'
        >
          Saxla
        </button>
      </div>
      <span className='text-xs font-normal text-muted-foreground'>
        {valid
          ? `${formatDuration(minutes)} · ${formatSocialInterval(minutes)}`
          : `${CUSTOM_SOCIAL_INTERVAL_RANGE.min}-${CUSTOM_SOCIAL_INTERVAL_RANGE.max} dəqiqə (10 dəqiqədən 7 günə qədər).`}
      </span>
      <span className='text-xs font-normal text-muted-foreground'>
        Fərdi təklif Facebook-a da aiddir: planlar üçün minimum interval
        ({formatDuration(facebookFloor)}) bu müştəriyə tətbiq olunmur. Gündəlik
        post limiti və aylıq büdcə yenə qüvvədədir. Hər Facebook yoxlaması
        tapılan yeni postlara görə ödənilir.
      </span>
      {valid && minutes < 60 ? (
        <span className='rounded-md bg-amber-50 px-2 py-1.5 text-xs font-normal text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'>
          Saatdan tez yoxlama xərci artırır: Instagram-da hər yoxlama, Facebook-da
          hər yeni post ayrıca ödənilir.
        </span>
      ) : null}
    </div>
  )
}
