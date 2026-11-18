import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Bell,
  ExternalLink,
  Loader2,
  Mail,
  Send,
  type LucideIcon,
} from 'lucide-react'
import { t } from '@/lib/i18n'
import { customerQueryKeys } from '@/lib/query-keys'
import { openExternalUrl } from '@/lib/utils'
import { EmailReportPreferences } from '@/features/email-reports/report-preferences'
import {
  createTelegramLinkUrl,
  fetchProfileData,
  getTelegramBotUrl,
} from '@/features/profile/data'
import { planReportFrequencies } from '@/features/subscriptions/model'

function NotificationChannelCard({
  title,
  status,
  statusTone,
  icon: Icon,
  href,
  onAction,
  actionDisabled,
  actionLabel,
}: {
  title: string
  status: string
  statusTone: 'active' | 'ready' | 'soon'
  icon: LucideIcon
  href?: string
  onAction?: () => void
  actionDisabled?: boolean
  actionLabel?: string
}) {
  const toneClass =
    statusTone === 'active'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : statusTone === 'ready'
        ? 'border-primary/20 bg-primary/10 text-primary'
        : 'border-border bg-muted/50 text-muted-foreground'

  const content = (
    <div className='flex items-center justify-between gap-3'>
      <div className='flex items-center gap-3'>
        <div className='grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted/50 text-foreground'>
          <Icon className='h-5 w-5' />
        </div>
        <div>
          <h3 className='font-semibold text-foreground'>{title}</h3>
          {actionLabel ? (
            <div className='mt-1 inline-flex items-center gap-1 text-xs font-bold text-primary'>
              {actionLabel}
              <ExternalLink className='h-3.5 w-3.5' />
            </div>
          ) : null}
        </div>
      </div>
      <span
        className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClass}`}
      >
        {status}
      </span>
    </div>
  )

  if (onAction) {
    return (
      <button
        type='button'
        onClick={onAction}
        disabled={actionDisabled}
        className='rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-md disabled:pointer-events-none disabled:opacity-60'
      >
        {content}
      </button>
    )
  }

  if (href) {
    return (
      <a
        href={href}
        target='_blank'
        rel='noreferrer'
        className='rounded-2xl border border-border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-md'
      >
        {content}
      </a>
    )
  }

  return (
    <div className='rounded-2xl border border-border bg-card p-4 shadow-sm'>
      {content}
    </div>
  )
}

// Where alerts and email reports go: Telegram link and the email report
// settings. Lives on the alerts page, above the alert history.
export function NotificationChannels() {
  const { data, isLoading } = useQuery({
    queryKey: customerQueryKeys.profile(),
    queryFn: fetchProfileData,
    staleTime: 5 * 60 * 1000,
  })
  const telegramLink = useMutation({
    mutationFn: createTelegramLinkUrl,
    onSuccess: (url) => {
      openExternalUrl(url)
    },
  })
  const profile = data?.profileState

  if (isLoading) {
    return (
      <div className='flex items-center gap-2 rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground shadow-sm'>
        <Loader2 className='h-4 w-4 animate-spin' />
        {t('Bildiriş ayarları yüklənir...')}
      </div>
    )
  }
  if (!profile) return null

  const telegramActive = Boolean(profile.telegramChatId)
  const emailReady = profile.email !== '-'
  const telegramBotUrl = getTelegramBotUrl()

  return (
    <>
      <section className='rounded-2xl border border-border bg-card p-5 shadow-sm'>
        <div className='mb-4 flex items-center gap-2'>
          <Bell className='h-5 w-5 text-muted-foreground' />
          <h2 className='text-lg font-semibold'>{t('Bildiriş kanalları')}</h2>
        </div>

        <div className='grid gap-3 xl:grid-cols-2'>
          <NotificationChannelCard
            title={t('Telegram')}
            status={telegramActive ? t('Aktiv') : t('Aktiv deyil')}
            statusTone={telegramActive ? 'active' : 'soon'}
            icon={Send}
            href={telegramActive ? telegramBotUrl : undefined}
            onAction={
              telegramBotUrl && !telegramActive
                ? () => telegramLink.mutate()
                : undefined
            }
            actionDisabled={telegramLink.isPending}
            actionLabel={
              telegramBotUrl
                ? telegramActive
                  ? t('Botu aç')
                  : telegramLink.isPending
                    ? t('Link yaradılır...')
                    : t('Telegram-ı qoş')
                : undefined
            }
          />
          <NotificationChannelCard
            title={t('Email')}
            status={emailReady ? t('Hazır') : t('Aktiv deyil')}
            statusTone={emailReady ? 'ready' : 'soon'}
            icon={Mail}
          />
        </div>

        {telegramLink.data ? (
          <p className='mt-3 text-sm text-muted-foreground'>
            {t(
              'Link 15 dəqiqə etibarlıdır və bir dəfə istifadə olunur. Telegram açılmadısa,'
            )}{' '}
            <a
              href={telegramLink.data}
              target='_blank'
              rel='noopener noreferrer'
              className='font-medium text-primary underline'
            >
              {t('bu linkə keçin')}
            </a>{' '}
            {t('və')} <span className='font-medium'>Start</span>
            {t(' düyməsini basın.')}
          </p>
        ) : null}
        {telegramLink.isError ? (
          <p className='mt-3 text-sm text-destructive' role='alert'>
            {t('Telegram linki yaradılmadı. Bir az sonra yenidən cəhd edin.')}
          </p>
        ) : null}
        {telegramActive ? (
          <p className='mt-3 text-sm text-muted-foreground'>
            {t('Bildirişləri dayandırmaq üçün botda /stop yazın.')}
          </p>
        ) : null}
      </section>

      {emailReady ? (
        <EmailReportPreferences
          userId={profile.userId}
          email={profile.email}
          planFrequencies={planReportFrequencies({
            limits: profile.plan?.limits ?? {},
          })}
        />
      ) : null}
    </>
  )
}
