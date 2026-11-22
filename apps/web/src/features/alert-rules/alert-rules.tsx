import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Search, Siren, Star } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { customerQueryKeys } from '@/lib/query-keys'
import { t } from '@/lib/i18n'
import {
  fetchAlertRules,
  MAX_PRIORITY_SOURCES,
  saveAlertSettings,
  setPrioritySource,
  type AlertRules as AlertRulesData,
} from './data'

function SettingsForm({ rules }: { rules: AlertRulesData }) {
  const queryClient = useQueryClient()
  const [alertEmail, setAlertEmail] = useState(rules.alertEmail)
  const [threshold, setThreshold] = useState(
    rules.engagementThreshold != null ? String(rules.engagementThreshold) : ''
  )
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  async function save() {
    const value = threshold.trim() ? Number(threshold) : null
    if (value !== null && (!Number.isInteger(value) || value < 10)) {
      setMessage(t("Engagement həddi 10 və ya daha çox olmalıdır."))
      return
    }
    setSaving(true)
    const error = await saveAlertSettings(alertEmail, value)
    setSaving(false)
    setMessage(error || t("Saxlanıldı."))
    if (!error) await queryClient.invalidateQueries({ queryKey: customerQueryKeys.alertSettings() })
  }

  return (
    <div className='grid gap-3'>
      <label className='flex items-start gap-3 text-sm'>
        <Checkbox
          checked={alertEmail}
          onCheckedChange={(checked) => setAlertEmail(checked === true)}
          className='mt-0.5'
        />
        <span>
          <span className='font-medium text-foreground'>{t("İşarələnmiş bildirişləri emailə də göndər")}</span>
          <span className='block text-muted-foreground'>{t("Kritik açar söz, prioritet mənbə və yüksək engagement bildirişləri profil emailinizə də gəlir (gündə ən çox 50).")}</span>
        </span>
      </label>
      <label className='grid gap-1 text-sm sm:max-w-xs'>
        <span className='font-medium text-foreground'>{t("Yüksək engagement həddi")}</span>
        <input
          type='number'
          min={10}
          inputMode='numeric'
          value={threshold}
          onChange={(event) => setThreshold(event.target.value)}
          placeholder={t("Boş: söndürülüb")}
          className='h-10 rounded-xl border border-border bg-card px-3 text-sm'
        />
        <span className='text-xs text-muted-foreground'>{t("Bəyənmə + şərh + paylaşım bu rəqəmə çatan sosial post bildirişi işarələnir.")}</span>
      </label>
      <div className='flex flex-wrap items-center gap-3'>
        <button
          type='button'
          onClick={() => void save()}
          disabled={saving}
          className='inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
        >
          {saving ? <Loader2 className='h-4 w-4 animate-spin' /> : null}
          {t("Saxla")}
        </button>
        {message ? <span className='text-sm text-muted-foreground'>{message}</span> : null}
      </div>
    </div>
  )
}

function PrioritySources({ rules }: { rules: AlertRulesData }) {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const selected = rules.sources.filter((source) => source.is_priority)
  const visible = useMemo(() => {
    const q = query.toLocaleLowerCase('az-AZ').trim()
    const list = q
      ? rules.sources.filter(
          (source) =>
            source.name.toLocaleLowerCase('az-AZ').includes(q) || source.host.includes(q)
        )
      : rules.sources
    // Chosen sites first, then the rest; a long list is cut until the user searches.
    return [...list].sort((a, b) => Number(b.is_priority) - Number(a.is_priority)).slice(0, 60)
  }, [rules.sources, query])

  async function toggle(id: string, next: boolean) {
    setBusyId(id)
    const error = await setPrioritySource(id, next)
    setBusyId(null)
    setMessage(error || '')
    await queryClient.invalidateQueries({ queryKey: customerQueryKeys.alertSettings() })
  }

  return (
    <div className='grid gap-3'>
      <p className='text-sm text-muted-foreground'>
        {t("Seçdiyiniz saytlar hər dəqiqə yoxlanır və onlardan gələn bildirişlər işarələnir. Seçilib: {0} / {1}", [
          selected.length,
          MAX_PRIORITY_SOURCES,
        ])}
      </p>
      <div className='relative sm:max-w-sm'>
        <Search className='pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
        <input
          aria-label={t("Sayt axtar")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("Sayt axtar")}
          className='h-10 w-full rounded-xl border border-border bg-card pr-3 pl-9 text-sm'
        />
      </div>
      {message ? <p className='text-sm text-destructive'>{message}</p> : null}
      <ul className='grid max-h-72 gap-1 overflow-y-auto rounded-xl border border-border p-2 sm:grid-cols-2'>
        {visible.map((source) => {
          const disabled =
            busyId !== null || (!source.is_priority && selected.length >= MAX_PRIORITY_SOURCES)
          return (
            <li key={source.id}>
              <label className='flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50'>
                <Checkbox
                  checked={source.is_priority}
                  disabled={disabled}
                  onCheckedChange={(checked) => void toggle(source.id, checked === true)}
                />
                <span className='min-w-0 truncate'>
                  {source.name}
                  <span className='ml-1 text-xs text-muted-foreground'>{source.host}</span>
                </span>
                {busyId === source.id ? <Loader2 className='ml-auto h-3.5 w-3.5 animate-spin' /> : null}
              </label>
            </li>
          )
        })}
        {visible.length === 0 ? (
          <li className='p-2 text-sm text-muted-foreground'>{t("Sayt tapılmadı.")}</li>
        ) : null}
      </ul>
    </div>
  )
}

export function AlertRules() {
  const { data: rules, isLoading } = useQuery({
    queryKey: customerQueryKeys.alertSettings(),
    queryFn: fetchAlertRules,
    staleTime: 60 * 1000,
  })
  if (isLoading || !rules) return null

  return (
    <section className='grid gap-5 rounded-2xl border border-border bg-card p-5 shadow-sm'>
      <div>
        <div className='flex items-center gap-2'>
          <Siren className='h-5 w-5 text-muted-foreground' />
          <h2 className='text-lg font-semibold'>{t("Bildiriş qaydaları")}</h2>
        </div>
        <p className='mt-1 text-sm text-muted-foreground'>{t("Vacib bildirişlər Telegram-da yuxarıda işarə ilə gəlir. Açar sözü kritik etmək üçün Açar sözlər səhifəsində siren düyməsini basın.")}</p>
      </div>
      <SettingsForm
        key={`${rules.alertEmail}-${rules.engagementThreshold}`}
        rules={rules}
      />
      <div className='grid gap-2'>
        <div className='flex items-center gap-2'>
          <Star className='h-4 w-4 text-muted-foreground' />
          <h3 className='font-semibold'>{t("Prioritet mənbələr")}</h3>
        </div>
        <PrioritySources rules={rules} />
      </div>
    </section>
  )
}
