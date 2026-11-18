import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ArrowRight,
  Bell,
  CalendarDays,
  CreditCard,
  Loader2,
  Mail,
  Radio,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { fetchProfileData, type SocialAccess } from '@/features/profile/data'
import { customerQueryKeys } from '@/lib/query-keys'
import { formatSocialInterval } from '@/lib/social-intervals'
import { dateLocale, t } from '@/lib/i18n'

function formatDate(value: string | null) {
  if (!value) return '-'

  return new Date(value).toLocaleString(dateLocale(), {
    timeZone: 'Asia/Baku',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function socialIntervalText(social: SocialAccess | null) {
  if (!social) return '-'
  if (!social.facebook_enabled && !social.instagram_enabled) {
    return t("Hələ aktiv deyil")
  }
  return formatSocialInterval(social.interval_minutes)
}

function InfoTile({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string | number
  icon?: LucideIcon
}) {
  return (
    <div className='rounded-xl border border-border bg-card p-4'>
      <div className='flex items-center gap-2 text-sm text-muted-foreground'>
        {Icon ? <Icon className='h-4 w-4' /> : null}
        {label}
      </div>
      <div className='mt-2 font-medium break-all text-foreground'>{value}</div>
    </div>
  )
}

function ProfilePage() {
  const { data, isLoading } = useQuery({
    queryKey: customerQueryKeys.profile(),
    queryFn: fetchProfileData,
    staleTime: 5 * 60 * 1000,
  })
  const profileState = data?.profileState || null
  const errorMessage = data?.errorMessage || ''

  if (isLoading) {
    return (
      <div className='flex min-h-[360px] items-center justify-center p-6'>
        <Loader2 className='mr-2 h-5 w-5 animate-spin' />
        <span>{t("Profil məlumatları yüklənir...")}</span>
      </div>
    )
  }

  if (!profileState) {
    return (
      <div className='grid gap-4 p-6'>
        <h1 className='text-2xl font-bold tracking-tight'>{t("Profil və ayarlar")}</h1>
        <div className='rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive'>
          {errorMessage || t("Profil məlumatları yüklənmədi.")}
        </div>
      </div>
    )
  }

  const planLimit = profileState.keywordLimit
  const hasReachedPlanLimit =
    typeof planLimit === 'number' && profileState.keywordCount >= planLimit

  return (
    <div className='grid gap-4 p-4 md:p-6'>
      <div>
        <h1 className='text-2xl font-bold tracking-tight'>{t("Profil və ayarlar")}</h1>
        <p className='text-muted-foreground'>{t("Hesab məlumatları və plan istifadəsi bu bölmədə göstərilir.")}</p>
      </div>

      {errorMessage ? (
        <div className='rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700'>
          {errorMessage}
        </div>
      ) : null}

      <div className='grid gap-4 lg:grid-cols-3'>
        <section className='rounded-2xl border border-border bg-card p-5 shadow-sm lg:col-span-2'>
          <div className='mb-4 flex items-center gap-2'>
            <ShieldCheck className='h-5 w-5 text-muted-foreground' />
            <h2 className='text-lg font-semibold'>{t("Hesab məlumatları")}</h2>
          </div>
          <p className='mb-4 text-sm text-muted-foreground'>{t("Bu məlumatlar hesabınızın platformada hansı rol və statusla istifadə olunduğunu göstərir.")}</p>

          <div className='grid gap-3 sm:grid-cols-2'>
            <InfoTile label={t("Email")} value={profileState.email} icon={Mail} />
            <InfoTile label={t("Hesab rolu")} value={profileState.role} />
            <InfoTile label={t("Hesab statusu")} value={profileState.status} />
            <InfoTile
              label={t("Qeydiyyat tarixi")}
              value={formatDate(profileState.createdAt)}
              icon={CalendarDays}
            />
          </div>
        </section>

        <section className='rounded-2xl border border-border bg-card p-5 shadow-sm'>
          <div className='mb-4 flex items-center gap-2'>
            <Radio className='h-5 w-5 text-muted-foreground' />
            <h2 className='text-lg font-semibold'>{t("İstifadə")}</h2>
          </div>

          <div className='rounded-xl border border-border bg-card p-4'>
            <div className='text-sm text-muted-foreground'>{t("Aktiv açar sözlər")}</div>
            <div className='mt-2 text-2xl font-semibold'>
              {profileState.keywordCount}
            </div>
            <div className='mt-1 text-sm text-muted-foreground'>
              {planLimit !== null
                ? t("{0} açar söz limitindən {1} istifadə olunur", [planLimit, profileState.keywordCount])
                : t("Açar söz limiti yoxdur")}
            </div>
          </div>
        </section>
      </div>

      <Link
        to='/monitor/alerts'
        className='flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:border-primary/20'
      >
        <div className='flex items-center gap-2'>
          <Bell className='h-5 w-5 text-muted-foreground' />
          <div>
            <h2 className='text-lg font-semibold'>{t("Bildiriş ayarları")}</h2>
            <p className='text-sm text-muted-foreground'>{t("Telegram və email hesabatları Bildirişlər bölməsində idarə olunur.")}</p>
          </div>
        </div>
        <ArrowRight className='h-4 w-4 shrink-0 text-muted-foreground' />
      </Link>

      <section className='rounded-2xl border border-border bg-card p-5 shadow-sm'>
        <div className='mb-4 flex items-center gap-2'>
          <CreditCard className='h-5 w-5 text-muted-foreground' />
          <h2 className='text-lg font-semibold'>{t("Plan və limitlər")}</h2>
        </div>
        <p className='mb-4 text-sm text-muted-foreground'>{t("Planınız neçə açar sözü izləyə biləcəyinizi və Facebook, Instagram axtarışının tezliyini müəyyən edir. Xəbər saytları bütün planlarda təxminən hər 5-20 dəqiqədən bir yoxlanır.")}</p>

        {profileState.planAvailable && profileState.plan ? (
          <div className='grid gap-3'>
            <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
              <InfoTile
                label={t("Cari plan")}
                value={profileState.plan.name || '-'}
              />
              <InfoTile
                label={t("Açar söz limiti")}
                value={planLimit ?? t("Limitsiz")}
              />
              <InfoTile
                label={t("Facebook və Instagram yoxlaması")}
                value={socialIntervalText(profileState.social)}
              />
              <InfoTile
                label={t("Nəticə tarixçəsi")}
                value={
                  profileState.plan.history_days
                    ? t("{0} gün", [profileState.plan.history_days])
                    : '-'
                }
              />
            </div>

            <div className='rounded-2xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground'>
              {hasReachedPlanLimit
                ? t("Açar söz limitinə çatmısınız. Yeni açar söz üçün birini silin, dayandırın və ya planı genişləndirin.")
                : t("Limitə çatmadığınız müddətdə yeni açar sözlər əlavə edə bilərsiniz. Dayandırılmış açar sözlər limitə daxil deyil.")}
            </div>
          </div>
        ) : (
          <div className='rounded-2xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground'>{t("Plan məlumatı hələ aktiv deyil.")}</div>
        )}
      </section>
    </div>
  )
}

export const Route = createFileRoute('/(auth)/monitor/profile')({
  component: ProfilePage,
})
