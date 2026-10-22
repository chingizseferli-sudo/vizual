import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { customerQueryKeys } from '@/lib/query-keys'
import { t } from '@/lib/i18n'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  REPORT_FREQUENCIES,
  type ReportFrequency,
} from '@/features/subscriptions/model'
import {
  DEFAULT_HOUR,
  HOURS,
  formatHour,
  parseReportSettings,
  type ReportSettings,
} from './report-settings'

const LABELS: Record<
  ReportFrequency,
  (time: string) => { title: string; when: string }
> = {
  daily: (time) => ({ title: t("Gündəlik hesabat"), when: t("Hər gün saat {0}, ötən günün xəbərləri", [time]) }),
  weekly: (time) => ({ title: t("Həftəlik hesabat"), when: t("Bazar ertəsi saat {0}, ötən həftənin xülasəsi", [time]) }),
  monthly: (time) => ({ title: t("Aylıq hesabat"), when: t("Ayın 1-i saat {0}, ötən ayın xülasəsi", [time]) }),
}

const settingsKey = (userId: string) =>
  [...customerQueryKeys.profile(), 'email-report-settings', userId] as const

async function fetchSettings(userId: string) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('email_report_opt_out,email_report_hour')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return parseReportSettings(data)
}

// Email reports the plan includes, each one switchable off by the customer,
// and the Baku-time hour they arrive. The rss worker reads
// user_profiles.email_report_opt_out and email_report_hour before sending.
export function EmailReportPreferences({
  userId,
  email,
  planFrequencies,
}: {
  userId: string
  email: string
  planFrequencies: ReportFrequency[]
}) {
  const queryClient = useQueryClient()
  const settings = useQuery({
    queryKey: settingsKey(userId),
    queryFn: () => fetchSettings(userId),
    enabled: planFrequencies.length > 0,
  })
  const save = useMutation({
    mutationFn: async (next: ReportSettings) => {
      const { error } = await supabase
        .from('user_profiles')
        .update({
          email_report_opt_out: next.optOut,
          email_report_hour: next.hour,
        })
        .eq('user_id', userId)
      if (error) throw error
      return next
    },
    onSuccess: (next) => queryClient.setQueryData(settingsKey(userId), next),
  })

  const current = settings.data?.optOut ?? []
  const hour = settings.data?.hour ?? DEFAULT_HOUR
  const busy = settings.isLoading || save.isPending

  function toggle(frequency: ReportFrequency, enabled: boolean) {
    const next = enabled
      ? current.filter((item) => item !== frequency)
      : [...new Set([...current, frequency])]
    save.mutate({
      optOut: REPORT_FREQUENCIES.filter((item) => next.includes(item)),
      hour,
    })
  }

  return (
    <section className='rounded-2xl border border-border bg-card p-5 shadow-sm'>
      <div className='mb-1 flex items-center gap-2'>
        <FileText className='h-5 w-5 text-muted-foreground' />
        <h2 className='text-lg font-semibold'>{t("Email hesabatları")}</h2>
      </div>

      {planFrequencies.length === 0 ? (
        <p className='text-sm text-muted-foreground'>{t("Planınıza email hesabatları daxil deyil. Daha geniş plana keçəndə hesabatlar avtomatik başlayır.")}</p>
      ) : settings.isError ? (
        <p className='text-sm text-muted-foreground'>{t("Hesabat ayarları hələ hazır deyil. Bir az sonra yenidən baxın.")}</p>
      ) : (
        <>
          <p className='mb-4 text-sm text-muted-foreground'>
            {t("Hesabatlar {0} ünvanına göndərilir: neçə xəbər çıxıb, hansı açar sözlər və mənbələr önədir, son xəbərlər.", [email])}
          </p>
          <div className='mb-4 flex flex-wrap items-center gap-3'>
            <label
              htmlFor='email-report-hour'
              className='text-sm font-medium text-foreground'
            >
              {t("Göndərilmə saatı (Bakı vaxtı)")}
            </label>
            <Select
              value={String(hour)}
              disabled={busy}
              onValueChange={(value) =>
                save.mutate({ optOut: current, hour: Number(value) })
              }
            >
              <SelectTrigger id='email-report-hour' className='w-28'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className='max-h-72'>
                {HOURS.map((item) => (
                  <SelectItem key={item} value={String(item)}>
                    {formatHour(item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='grid gap-3 sm:grid-cols-3'>
            {planFrequencies.map((frequency) => {
              const label = LABELS[frequency](formatHour(hour))
              const enabled = !current.includes(frequency)
              const id = `email-report-${frequency}`
              return (
                <label
                  key={frequency}
                  htmlFor={id}
                  className='flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-4 transition hover:border-primary/30'
                >
                  <Checkbox
                    id={id}
                    className='mt-0.5'
                    checked={enabled}
                    disabled={busy}
                    onCheckedChange={(value) => toggle(frequency, value === true)}
                  />
                  <span>
                    <span className='block font-medium text-foreground'>
                      {label.title}
                    </span>
                    <span className='mt-0.5 block text-xs text-muted-foreground'>
                      {label.when}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
          {save.isPending ? (
            <p className='mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground'>
              <Loader2 className='h-4 w-4 animate-spin' />
              {t("Saxlanır...")}
            </p>
          ) : null}
          {save.isError ? (
            <p className='mt-3 text-sm text-destructive' role='alert'>{t("Ayar saxlanmadı. Yenidən cəhd edin.")}</p>
          ) : null}
        </>
      )}
    </section>
  )
}
