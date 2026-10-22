import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Check, Pencil, Plus, RefreshCw, Users } from 'lucide-react'
import { SOCIAL_INTERVAL_OPTIONS } from '@/lib/social-intervals'
import { supabase } from '@/lib/supabase'
import { ResponsiveTable } from '@/components/ui/responsive-table'
import { EmailReportDeliveries } from '@/features/email-reports/admin-deliveries'
import {
  BILLING_INTERVALS,
  buildPlanPayload,
  emptyPlanForm,
  formatPlanPrice,
  normalizePlanRow,
  planCompetitorLimit,
  planKeywordLimit,
  planReportFrequencies,
  planSocialIntervalMinutes,
  REPORT_FREQUENCIES,
  REPORT_FREQUENCY_LABELS,
  planToFormValues,
  type PlanFormValues,
  type SubscriptionPlan,
  type UserSubscription,
} from '@/features/subscriptions/model'

type ProfileRow = {
  user_id: string
  email: string | null
}

type SubscriptionRow = UserSubscription & {
  subscription_plans: { name: string; code: string } | null
}

const planFields =
  'id,code,name,description,is_active,is_custom,is_public,price_amount,currency,billing_interval,display_order,max_watches,minimum_interval_minutes,history_days,telegram_enabled,features,limits,created_at,updated_at'

function formatDate(value: string | null | undefined) {
  if (!value) return 'Müddətsiz'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return date.toLocaleString('az-AZ', {
    timeZone: 'Asia/Baku',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusLabel(status: UserSubscription['status']) {
  return {
    active: 'Aktiv',
    trialing: 'Sınaq',
    canceled: 'Ləğv edilib',
    expired: 'Bitib',
  }[status]
}

function SubscriptionPlansPage() {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([])
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([])
  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [form, setForm] = useState<PlanFormValues>(emptyPlanForm)
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [messageTone, setMessageTone] = useState<'error' | 'success'>('success')

  const loadData = useCallback(async () => {
    setLoading(true)

    const [plansResult, subscriptionsResult, profilesResult] =
      await Promise.all([
        supabase
          .from('subscription_plans')
          .select(planFields)
          .order('display_order')
          .order('name'),
        supabase
          .from('user_subscriptions')
          .select(
            'id,user_id,plan_id,status,started_at,current_period_end,ended_at,notes,created_at,updated_at,subscription_plans(name,code)'
          )
          .order('started_at', { ascending: false }),
        supabase.from('user_profiles').select('user_id,email'),
      ])

    const error =
      plansResult.error || subscriptionsResult.error || profilesResult.error

    if (error) {
      setMessageTone('error')
      setMessage(`Məlumatlar yüklənmədi: ${error.message}`)
    }

    setPlans(
      ((plansResult.data || []) as unknown as SubscriptionPlan[]).map((plan) =>
        normalizePlanRow(plan)
      )
    )
    setSubscriptions(
      (subscriptionsResult.data || []) as unknown as SubscriptionRow[]
    )
    setProfiles((profilesResult.data || []) as ProfileRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadData])

  const profileEmailById = useMemo(
    () => new Map(profiles.map((profile) => [profile.user_id, profile.email])),
    [profiles]
  )

  const currentSubscriptions = useMemo(
    () =>
      subscriptions.filter((row) =>
        ['active', 'trialing'].includes(row.status)
      ),
    [subscriptions]
  )

  const planSubscriberCounts = useMemo(() => {
    const counts = new Map<string, number>()

    currentSubscriptions.forEach((subscription) => {
      counts.set(
        subscription.plan_id,
        (counts.get(subscription.plan_id) || 0) + 1
      )
    })

    return counts
  }, [currentSubscriptions])

  function updateForm<Key extends keyof PlanFormValues>(
    key: Key,
    value: PlanFormValues[Key]
  ) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function resetForm() {
    setEditingPlanId(null)
    setForm(emptyPlanForm)
  }

  function editPlan(plan: SubscriptionPlan) {
    setEditingPlanId(plan.id)
    setForm(planToFormValues(plan))
    setMessage('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function savePlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = buildPlanPayload(
      form,
      plans.find((plan) => plan.id === editingPlanId)?.limits
    )

    if (!result.data) {
      setMessageTone('error')
      setMessage(result.error || 'Plan məlumatları düzgün deyil.')
      return
    }

    const planPayload = result.data

    setSaving(true)
    setMessage('')

    const response = editingPlanId
      ? await supabase
          .from('subscription_plans')
          .update({ ...planPayload, updated_at: new Date().toISOString() })
          .eq('id', editingPlanId)
      : await supabase.from('subscription_plans').insert(planPayload)

    setSaving(false)

    if (response.error) {
      setMessageTone('error')
      setMessage(`Plan saxlanmadı: ${response.error.message}`)
      return
    }

    setMessageTone('success')
    setMessage(editingPlanId ? 'Plan yeniləndi.' : 'Yeni plan yaradıldı.')
    resetForm()
    await loadData()
  }

  async function togglePlan(plan: SubscriptionPlan) {
    const nextActive = !plan.is_active

    if (!nextActive) {
      const confirmed = window.confirm(
        `“${plan.name}” planı deaktiv edilsin? Mövcud abunələr saxlanacaq, amma plan yeni istifadəçiyə təyin edilə bilməyəcək.`
      )
      if (!confirmed) return
    }

    const { error } = await supabase
      .from('subscription_plans')
      .update({ is_active: nextActive, updated_at: new Date().toISOString() })
      .eq('id', plan.id)

    if (error) {
      setMessageTone('error')
      setMessage(`Plan statusu dəyişmədi: ${error.message}`)
      return
    }

    setMessageTone('success')
    setMessage(nextActive ? 'Plan aktiv edildi.' : 'Plan deaktiv edildi.')
    await loadData()
  }

  if (loading) {
    return (
      <div className='flex min-h-[320px] items-center justify-center p-6 text-sm text-muted-foreground'>
        Abunəliklər yüklənir...
      </div>
    )
  }

  return (
    <div className='grid gap-6 p-4 md:p-6'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h1 className='text-xl font-semibold tracking-tight'>
            Plan və abunəliklər
          </h1>
          <p className='text-muted-foreground'>
            Plan limitlərini yaradın, qiymətləri idarə edin və istifadəçi
            təyinatlarına baxın.
          </p>
        </div>
        <button
          type='button'
          onClick={() => void loadData()}
          className='inline-flex items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm font-medium hover:bg-muted'
        >
          <RefreshCw className='h-4 w-4' />
          Yenilə
        </button>
      </div>

      {message ? (
        <div
          className={`rounded-lg border p-4 text-sm ${
            messageTone === 'error'
              ? 'border-destructive/25 bg-destructive/10 text-destructive'
              : 'border-success/25 bg-success/10 text-success'
          }`}
          role='status'
        >
          {message}
        </div>
      ) : null}

      <div className='grid gap-3 sm:grid-cols-3'>
        <div className='rounded-lg border bg-card p-4'>
          <div className='text-sm text-muted-foreground'>Plan sayı</div>
          <div className='mt-1 text-2xl font-bold'>{plans.length}</div>
        </div>
        <div className='rounded-lg border bg-card p-4'>
          <div className='text-sm text-muted-foreground'>Aktiv plan</div>
          <div className='mt-1 text-2xl font-bold text-success'>
            {plans.filter((plan) => plan.is_active).length}
          </div>
        </div>
        <div className='rounded-lg border bg-card p-4'>
          <div className='text-sm text-muted-foreground'>Cari abunə</div>
          <div className='mt-1 text-2xl font-bold text-foreground'>
            {currentSubscriptions.length}
          </div>
        </div>
      </div>

      <form
        onSubmit={savePlan}
        className='rounded-lg border bg-card p-4 md:p-5'
      >
        <div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
          <div>
            <h2 className='text-lg font-semibold'>
              {editingPlanId ? 'Planı redaktə et' : 'Yeni plan yarat'}
            </h2>
            <p className='text-sm text-muted-foreground'>
              Boş limit sahəsi limitsiz dəyər kimi saxlanır.
            </p>
          </div>
          {editingPlanId ? (
            <button
              type='button'
              onClick={resetForm}
              className='rounded-lg border px-3 py-2 text-sm hover:bg-muted'
            >
              Ləğv et
            </button>
          ) : null}
        </div>

        <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
          <label className='grid gap-1.5 text-sm font-medium'>
            Plan adı
            <input
              value={form.name}
              onChange={(event) => updateForm('name', event.target.value)}
              className='rounded-lg border bg-background px-3 py-2 font-normal'
              placeholder='Professional'
              required
            />
          </label>
          <label className='grid gap-1.5 text-sm font-medium'>
            Kod
            <input
              value={form.code}
              disabled={
                editingPlanId === plans.find((plan) => plan.code === 'free')?.id
              }
              onChange={(event) => updateForm('code', event.target.value)}
              className='rounded-lg border bg-background px-3 py-2 font-normal disabled:cursor-not-allowed disabled:opacity-60'
              placeholder='Boş saxlanarsa addan yaranacaq'
            />
          </label>
          <label className='grid gap-1.5 text-sm font-medium'>
            Qiymət
            <input
              type='number'
              min='0'
              step='0.01'
              value={form.priceAmount}
              onChange={(event) =>
                updateForm('priceAmount', event.target.value)
              }
              className='rounded-lg border bg-background px-3 py-2 font-normal'
              placeholder='79'
            />
          </label>
          <label className='grid gap-1.5 text-sm font-medium'>
            Valyuta
            <input
              value={form.currency}
              maxLength={3}
              onChange={(event) =>
                updateForm('currency', event.target.value.toUpperCase())
              }
              className='rounded-lg border bg-background px-3 py-2 font-normal uppercase'
            />
          </label>
          <label className='grid gap-1.5 text-sm font-medium'>
            Hesablama dövrü
            <select
              value={form.billingInterval}
              onChange={(event) =>
                updateForm(
                  'billingInterval',
                  event.target.value as PlanFormValues['billingInterval']
                )
              }
              className='rounded-lg border bg-background px-3 py-2 font-normal'
            >
              {BILLING_INTERVALS.map((interval) => (
                <option key={interval} value={interval}>
                  {
                    {
                      month: 'Aylıq',
                      year: 'İllik',
                      one_time: 'Birdəfəlik',
                      custom: 'Fərdi',
                    }[interval]
                  }
                </option>
              ))}
            </select>
          </label>
          <label className='grid gap-1.5 text-sm font-medium'>
            Sıralama
            <input
              type='number'
              min='0'
              step='1'
              value={form.displayOrder}
              onChange={(event) =>
                updateForm('displayOrder', event.target.value)
              }
              className='rounded-lg border bg-background px-3 py-2 font-normal'
            />
          </label>
          <label className='grid gap-1.5 text-sm font-medium'>
            Açar söz limiti
            <input
              type='number'
              min='0'
              step='1'
              value={form.maxKeywords}
              onChange={(event) => updateForm('maxKeywords', event.target.value)}
              className='rounded-lg border bg-background px-3 py-2 font-normal'
              placeholder={
                form.maxWatches ? `${Number(form.maxWatches) * 20}` : 'Limitsiz'
              }
            />
          </label>
          <label className='grid gap-1.5 text-sm font-medium'>
            Rəqib limiti
            <input
              type='number'
              min='0'
              step='1'
              value={form.maxCompetitors}
              onChange={(event) =>
                updateForm('maxCompetitors', event.target.value)
              }
              className='rounded-lg border bg-background px-3 py-2 font-normal'
              placeholder='0 (yoxdur)'
            />
          </label>
          <label className='grid gap-1.5 text-sm font-medium'>
            Veb izləmə limiti
            <input
              type='number'
              min='0'
              step='1'
              value={form.maxWatches}
              onChange={(event) => updateForm('maxWatches', event.target.value)}
              className='rounded-lg border bg-background px-3 py-2 font-normal'
              placeholder='Limitsiz'
            />
          </label>
          <label className='grid gap-1.5 text-sm font-medium'>
            Minimum interval (dəqiqə)
            <input
              type='number'
              min='1'
              step='1'
              value={form.minimumIntervalMinutes}
              onChange={(event) =>
                updateForm('minimumIntervalMinutes', event.target.value)
              }
              className='rounded-lg border bg-background px-3 py-2 font-normal'
              placeholder='Limitsiz'
            />
          </label>
          <label className='grid gap-1.5 text-sm font-medium'>
            Sosial şəbəkə yoxlama tezliyi
            <select
              value={form.socialIntervalMinutes}
              onChange={(event) =>
                updateForm('socialIntervalMinutes', event.target.value)
              }
              className='rounded-lg border bg-background px-3 py-2 font-normal'
            >
              <option value=''>Standart (Sosial monitorinq səhifəsi)</option>
              {SOCIAL_INTERVAL_OPTIONS.map((option) => (
                <option key={option.minutes} value={option.minutes}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className='grid gap-1.5 text-sm font-medium'>
            Tarixçə (gün)
            <input
              type='number'
              min='0'
              step='1'
              value={form.historyDays}
              onChange={(event) =>
                updateForm('historyDays', event.target.value)
              }
              className='rounded-lg border bg-background px-3 py-2 font-normal'
              placeholder='Limitsiz'
            />
          </label>
          <label className='grid gap-1.5 text-sm font-medium md:col-span-2 xl:col-span-3'>
            Təsvir
            <input
              value={form.description}
              onChange={(event) =>
                updateForm('description', event.target.value)
              }
              className='rounded-lg border bg-background px-3 py-2 font-normal'
              placeholder='Planın qısa təsviri'
            />
          </label>
          <label className='grid gap-1.5 text-sm font-medium md:col-span-2 xl:col-span-4'>
            Üstünlüklər (hər sətirdə bir dəyər)
            <textarea
              value={form.features}
              onChange={(event) => updateForm('features', event.target.value)}
              className='min-h-24 rounded-lg border bg-background px-3 py-2 font-normal'
              placeholder={'Telegram bildirişləri\nCSV ixrac\nPrioritet dəstək'}
            />
          </label>
        </div>

        <div className='mt-4 flex flex-wrap items-center gap-5'>
          <label className='flex items-center gap-2 text-sm'>
            <input
              type='checkbox'
              checked={form.telegramEnabled}
              onChange={(event) =>
                updateForm('telegramEnabled', event.target.checked)
              }
            />
            Telegram aktivdir
          </label>
          <label className='flex items-center gap-2 text-sm'>
            <input
              type='checkbox'
              checked={form.isPublic}
              onChange={(event) => updateForm('isPublic', event.target.checked)}
            />
            İctimai plandır
          </label>
          <label className='flex items-center gap-2 text-sm'>
            <input
              type='checkbox'
              checked={form.isCustom}
              onChange={(event) => updateForm('isCustom', event.target.checked)}
            />
            Fərdi plandır
          </label>
        </div>

        <fieldset className='mt-4 flex flex-wrap items-center gap-5'>
          <legend className='mb-2 text-sm font-medium'>Email hesabatları</legend>
          {REPORT_FREQUENCIES.map((frequency) => (
            <label key={frequency} className='flex items-center gap-2 text-sm'>
              <input
                type='checkbox'
                checked={form.reportFrequencies.includes(frequency)}
                onChange={(event) =>
                  updateForm(
                    'reportFrequencies',
                    event.target.checked
                      ? [...form.reportFrequencies, frequency]
                      : form.reportFrequencies.filter(
                          (item) => item !== frequency
                        )
                  )
                }
              />
              {REPORT_FREQUENCY_LABELS[frequency]}
            </label>
          ))}
        </fieldset>

        <button
          type='submit'
          disabled={saving}
          className='mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60'
        >
          {editingPlanId ? (
            <Check className='h-4 w-4' />
          ) : (
            <Plus className='h-4 w-4' />
          )}
          {saving
            ? 'Saxlanır...'
            : editingPlanId
              ? 'Dəyişiklikləri saxla'
              : 'Plan yarat'}
        </button>
      </form>

      <section className='grid gap-3'>
        <div>
          <h2 className='text-lg font-semibold'>Mövcud planlar</h2>
          <p className='text-sm text-muted-foreground'>
            Planı silmək əvəzinə deaktiv edin ki, tarixçə qorunsun.
          </p>
        </div>
        <div className='grid gap-4 lg:grid-cols-2'>
          {plans.map((plan) => (
            <article key={plan.id} className='rounded-lg border bg-card p-4'>
              <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                  <div className='flex flex-wrap items-center gap-2'>
                    <h3 className='text-lg font-semibold'>{plan.name}</h3>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${plan.is_active ? 'border-success/25 bg-success/10 text-success' : 'border-border bg-muted text-foreground'}`}
                    >
                      {plan.is_active ? 'Aktiv' : 'Deaktiv'}
                    </span>
                    {!plan.is_public ? (
                      <span className='rounded-full border px-2 py-0.5 text-xs text-muted-foreground'>
                        Gizli
                      </span>
                    ) : null}
                  </div>
                  <div className='mt-1 font-medium text-primary'>
                    {formatPlanPrice(plan)}
                  </div>
                  <div className='text-xs text-muted-foreground'>
                    Kod: {plan.code}
                  </div>
                </div>
                <div className='flex gap-2'>
                  <button
                    type='button'
                    onClick={() => editPlan(plan)}
                    className='inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm hover:bg-muted'
                  >
                    <Pencil className='h-3.5 w-3.5' /> Redaktə et
                  </button>
                  <button
                    type='button'
                    onClick={() => void togglePlan(plan)}
                    disabled={plan.code === 'free'}
                    title={
                      plan.code === 'free'
                        ? 'Free standart plan deaktiv edilə bilməz.'
                        : undefined
                    }
                    className={`rounded-lg border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${plan.is_active ? 'border-destructive/25 text-destructive hover:bg-destructive/10' : 'border-success/25 text-success hover:bg-success/10'}`}
                  >
                    {plan.is_active ? 'Deaktiv et' : 'Aktiv et'}
                  </button>
                </div>
              </div>

              <p className='mt-3 text-sm text-muted-foreground'>
                {plan.description || 'Təsvir yoxdur.'}
              </p>
              <div className='mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3'>
                <div className='rounded-lg bg-muted/50 p-2'>
                  <div className='text-xs text-muted-foreground'>Abunə</div>
                  <div className='font-semibold'>
                    {planSubscriberCounts.get(plan.id) || 0}
                  </div>
                </div>
                <div className='rounded-lg bg-muted/50 p-2'>
                  <div className='text-xs text-muted-foreground'>Açar söz</div>
                  <div className='font-semibold'>
                    {planKeywordLimit(plan) ?? '∞'}
                  </div>
                </div>
                <div className='rounded-lg bg-muted/50 p-2'>
                  <div className='text-xs text-muted-foreground'>Rəqib</div>
                  <div className='font-semibold'>
                    {planCompetitorLimit(plan) || 'Yoxdur'}
                  </div>
                </div>
                <div className='rounded-lg bg-muted/50 p-2'>
                  <div className='text-xs text-muted-foreground'>Interval</div>
                  <div className='font-semibold'>
                    {plan.minimum_interval_minutes
                      ? `${plan.minimum_interval_minutes} dəq`
                      : 'Fərdi'}
                  </div>
                </div>
                <div className='rounded-lg bg-muted/50 p-2'>
                  <div className='text-xs text-muted-foreground'>
                    FB/IG yoxlama
                  </div>
                  <div className='font-semibold'>
                    {SOCIAL_INTERVAL_OPTIONS.find(
                      (option) =>
                        option.minutes === planSocialIntervalMinutes(plan)
                    )?.label ?? 'Standart'}
                  </div>
                </div>
                <div className='rounded-lg bg-muted/50 p-2'>
                  <div className='text-xs text-muted-foreground'>
                    Email hesabat
                  </div>
                  <div className='font-semibold'>
                    {planReportFrequencies(plan)
                      .map((frequency) => REPORT_FREQUENCY_LABELS[frequency])
                      .join(', ') || 'Yox'}
                  </div>
                </div>
                <div className='rounded-lg bg-muted/50 p-2'>
                  <div className='text-xs text-muted-foreground'>Tarixçə</div>
                  <div className='font-semibold'>
                    {plan.history_days !== null
                      ? `${plan.history_days} gün`
                      : '∞'}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <EmailReportDeliveries />

      <section className='rounded-lg border bg-card'>
        <div className='flex flex-wrap items-center justify-between gap-3 border-b p-4'>
          <div>
            <h2 className='text-lg font-semibold'>Son abunə təyinatları</h2>
            <p className='text-sm text-muted-foreground'>
              Planı dəyişmək üçün istifadəçi profilini açın.
            </p>
          </div>
          <Users className='h-5 w-5 text-muted-foreground' />
        </div>
        <ResponsiveTable label='Abunə təyinatları' mobileLayout='cards'>
          <table
            role='table'
            className='w-full min-w-[760px] text-left text-sm'
          >
            <thead
              role='rowgroup'
              className='border-b bg-muted/50 text-xs text-muted-foreground'
            >
              <tr role='row'>
                <th className='px-4 py-3 font-medium'>İstifadəçi</th>
                <th className='px-4 py-3 font-medium'>Plan</th>
                <th className='px-4 py-3 font-medium'>Status</th>
                <th className='px-4 py-3 font-medium'>Başlanğıc</th>
                <th className='px-4 py-3 font-medium'>Dövrün sonu</th>
                <th className='px-4 py-3 font-medium' />
              </tr>
            </thead>
            <tbody role='rowgroup'>
              {subscriptions.slice(0, 50).map((subscription) => (
                <tr
                  role='row'
                  key={subscription.id}
                  className='border-b last:border-0'
                >
                  <td role='cell' data-label='İstifadəçi' className='px-4 py-3'>
                    <div className='font-medium'>
                      {profileEmailById.get(subscription.user_id) ||
                        'Email yoxdur'}
                    </div>
                    <div className='max-w-52 truncate text-xs text-muted-foreground'>
                      {subscription.user_id}
                    </div>
                  </td>
                  <td role='cell' data-label='Plan' className='px-4 py-3'>
                    {subscription.subscription_plans?.name || 'Naməlum plan'}
                  </td>
                  <td role='cell' data-label='Status' className='px-4 py-3'>
                    <span
                      className={`rounded-full px-2 py-1 text-xs ${['active', 'trialing'].includes(subscription.status) ? 'bg-success/10 text-success' : 'bg-muted text-foreground'}`}
                    >
                      {statusLabel(subscription.status)}
                    </span>
                  </td>
                  <td role='cell' data-label='Başlanğıc' className='px-4 py-3'>
                    {formatDate(subscription.started_at)}
                  </td>
                  <td
                    role='cell'
                    data-label='Dövrün sonu'
                    className='px-4 py-3'
                  >
                    {formatDate(subscription.current_period_end)}
                  </td>
                  <td
                    role='cell'
                    data-label='Əməliyyatlar'
                    className='px-4 py-3 text-right'
                  >
                    <Link
                      to='/admin/users/$userId'
                      params={{ userId: subscription.user_id }}
                      className='font-medium text-primary hover:underline'
                    >
                      İdarə et
                    </Link>
                  </td>
                </tr>
              ))}
              {subscriptions.length === 0 ? (
                <tr role='row'>
                  <td
                    colSpan={6}
                    className='px-4 py-8 text-center text-muted-foreground'
                  >
                    Abunə təyinatı yoxdur.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </ResponsiveTable>
      </section>
    </div>
  )
}

export const Route = createFileRoute('/(auth)/admin/subscriptions')({
  component: SubscriptionPlansPage,
})
