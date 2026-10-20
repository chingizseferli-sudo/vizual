import { t } from '@/lib/i18n'
type StatusTone =
  | 'green'
  | 'gray'
  | 'amber'
  | 'orange'
  | 'red'
  | 'blue'
  | 'slate'

const STATUS_LABELS: Record<string, string> = {
  active: t("Aktiv"),
  inactive: t("Passiv"),
  paused: t("Dayandırılıb"),
  blocked: t("Bloklanıb"),
  suspended: t("Dayandırılıb"),
  invited: t("Dəvət edilib"),
  new: t("Yeni"),
  seen: t("Görüldü"),
  read: 'Oxundu',
  sent: t("Göndərildi"),
  delivered: t("Çatdırıldı"),
  queued: t("Növbədə"),
  failed: t("Xəta"),
  pending: t("Gözləyir"),
  processing: 'Emal olunur',
  running: t("İcra olunur"),
  completed: t("Tamamlandı"),
  success: t("Uğurlu"),
  warning: t("Xəbərdarlıq"),
  error: t("Xəta"),
  draft: 'Qaralama',
  published: t("Yayımlanıb"),
  scheduled: t("Planlaşdırılıb"),
  unknown: t("Naməlum"),
  archived: t("Arxivləşdirilib"),
  duplicate: t("Təkrar"),
  no_candidate: t("Uyğun xəbər tapılmadı"),
  old_news: t("Köhnə xəbər"),
  site_error: t("Sayt oxunmadı"),
  timeout: 'Vaxt limiti',
  parse_error: t("Emal xətası"),
  fetch_failed: t("Oxunmadı"),
  fallback_empty: t("Nəticə yoxdur"),
  selector_empty: t("Selector boşdur"),
  invalid_xml: t("XML xətası"),
  sitemap_empty: t("Sitemap boşdur"),
  no_article: t("Xəbər tapılmadı"),
  no_date: t("Tarix yoxdur"),
  repair_ok: t("Bərpa yoxlanılır"),
  repair_failed: t("Bərpa alınmadı"),
}

const STATUS_TONES: Record<string, StatusTone> = {
  active: 'green',
  success: 'green',
  sent: 'green',
  delivered: 'green',
  published: 'green',
  inactive: 'gray',
  paused: 'gray',
  blocked: 'gray',
  suspended: 'gray',
  draft: 'gray',
  seen: 'gray',
  read: 'gray',
  unknown: 'gray',
  archived: 'gray',
  duplicate: 'gray',
  no_candidate: 'amber',
  old_news: 'gray',
  site_error: 'red',
  timeout: 'red',
  parse_error: 'red',
  fetch_failed: 'red',
  fallback_empty: 'amber',
  selector_empty: 'amber',
  invalid_xml: 'red',
  sitemap_empty: 'amber',
  no_article: 'amber',
  no_date: 'amber',
  repair_ok: 'amber',
  repair_failed: 'red',
  pending: 'amber',
  queued: 'amber',
  invited: 'amber',
  processing: 'amber',
  warning: 'orange',
  failed: 'red',
  error: 'red',
  new: 'blue',
  running: 'blue',
  completed: 'blue',
  scheduled: 'blue',
}

const TONE_CLASSES: Record<StatusTone, string> = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  gray: 'border-slate-200 bg-slate-50 text-slate-600',
  amber: 'border-amber-200 bg-amber-50 text-amber-700',
  orange: 'border-orange-200 bg-orange-50 text-orange-700',
  red: 'border-red-200 bg-red-50 text-red-700',
  blue: 'border-blue-200 bg-blue-50 text-blue-700',
  slate: 'border-slate-200 bg-slate-50 text-slate-700',
}

function normalizeStatus(
  value: string | null | undefined,
  fallback = 'unknown'
) {
  const normalized = String(value || fallback)
    .trim()
    .toLowerCase()
  return normalized || fallback
}

export function getStatusLabel(
  value: string | null | undefined,
  fallback = 'unknown'
) {
  const normalized = normalizeStatus(value, fallback)
  return STATUS_LABELS[normalized] || value || STATUS_LABELS[fallback] || '-'
}

export function getStatusBadgeClass(
  value: string | null | undefined,
  fallback = 'unknown'
) {
  const normalized = normalizeStatus(value, fallback)
  return TONE_CLASSES[STATUS_TONES[normalized] || 'slate']
}

export function getChannelLabel(value: string | null | undefined) {
  const normalized = normalizeStatus(value, 'web')
  const labels: Record<string, string> = {
    telegram: t("Telegram"),
    web: 'Panel',
    email: t("Email"),
  }

  return labels[normalized] || value || 'Panel'
}
