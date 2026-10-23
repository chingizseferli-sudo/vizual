import { t } from '@/lib/i18n'
// Preset search intervals for the Facebook and Instagram collectors (minutes).
// Plans and the default accept only these; a customer's own interval can be any
// value in CUSTOM_SOCIAL_INTERVAL_RANGE (migration 20261023000001).
export const SOCIAL_INTERVAL_OPTIONS = [
  { minutes: 60, label: t("1 saat") },
  { minutes: 120, label: t("2 saat") },
  { minutes: 180, label: t("3 saat") },
  { minutes: 360, label: t("6 saat") },
  { minutes: 720, label: t("12 saat") },
  { minutes: 1440, label: t("24 saat") },
]

export const CUSTOM_SOCIAL_INTERVAL_RANGE = { min: 10, max: 10080 }

export function isValidCustomSocialInterval(minutes: number) {
  return (
    Number.isInteger(minutes) &&
    minutes >= CUSTOM_SOCIAL_INTERVAL_RANGE.min &&
    minutes <= CUSTOM_SOCIAL_INTERVAL_RANGE.max
  )
}

// 90 -> "1 saat 30 dəqiqə", 45 -> "45 dəqiqə", 120 -> "2 saat".
export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return t("{0} dəqiqə", [rest])
  if (!rest) return t("{0} saat", [hours])
  return t("{0} saat {1} dəqiqə", [hours, rest])
}

export function formatSocialInterval(minutes: number | null | undefined) {
  if (!minutes) return '-'
  if (minutes % 60 === 0) return t("hər {0} saatdan bir", [minutes / 60])
  if (minutes < 60) return t("hər {0} dəqiqədən bir", [minutes])
  return t("hər {0}dən bir", [formatDuration(minutes)])
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
