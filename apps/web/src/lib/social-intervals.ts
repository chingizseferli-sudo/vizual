import { t } from '@/lib/i18n'
// Search intervals for the Facebook and Instagram collectors (minutes). The
// database accepts only these values (migration 20261020000002).
export const SOCIAL_INTERVAL_OPTIONS = [
  { minutes: 60, label: t("1 saat") },
  { minutes: 120, label: t("2 saat") },
  { minutes: 180, label: t("3 saat") },
  { minutes: 360, label: t("6 saat") },
  { minutes: 720, label: t("12 saat") },
]

export function formatSocialInterval(minutes: number | null | undefined) {
  if (!minutes) return '-'
  return t("hər {0} saatdan bir", [minutes / 60])
}

// PostgREST answers PGRST205 / 42P01 while a migration is not applied yet.
export function isMissingTableError(error: {
  code?: string
  message?: string
}) {
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /schema cache|does not exist/i.test(error.message || '')
  )
}
