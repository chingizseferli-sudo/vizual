type StatusTone =
  | 'green'
  | 'gray'
  | 'amber'
  | 'orange'
  | 'red'
  | 'blue'
  | 'slate'

const STATUS_LABELS: Record<string, string> = {
  active: 'Aktiv',
  inactive: 'Passiv',
  paused: 'Dayandırılıb',
  blocked: 'Bloklanıb',
  suspended: 'Dayandırılıb',
  invited: 'Dəvət edilib',
  new: 'Yeni',
  seen: 'Görüldü',
  read: 'Oxundu',
  sent: 'Göndərildi',
  delivered: 'Çatdırıldı',
  queued: 'Növbədə',
  failed: 'Xəta',
  pending: 'Gözləyir',
  processing: 'Emal olunur',
  running: 'İcra olunur',
  completed: 'Tamamlandı',
  success: 'Uğurlu',
  warning: 'Xəbərdarlıq',
  error: 'Xəta',
  draft: 'Qaralama',
  published: 'Yayımlanıb',
  scheduled: 'Planlaşdırılıb',
  unknown: 'Naməlum',
  archived: 'Arxivləşdirilib',
  duplicate: 'Təkrar',
  no_candidate: 'Uyğun xəbər tapılmadı',
  old_news: 'Köhnə xəbər',
  site_error: 'Sayt oxunmadı',
  timeout: 'Vaxt limiti',
  parse_error: 'Emal xətası',
  fetch_failed: 'Oxunmadı',
  fallback_empty: 'Nəticə yoxdur',
  selector_empty: 'Selector boşdur',
  invalid_xml: 'XML xətası',
  sitemap_empty: 'Sitemap boşdur',
  no_article: 'Xəbər tapılmadı',
  no_date: 'Tarix yoxdur',
  repair_ok: 'Bərpa yoxlanılır',
  repair_failed: 'Bərpa alınmadı',
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
    telegram: 'Telegram',
    web: 'Panel',
    email: 'Email',
  }

  return labels[normalized] || value || 'Panel'
}
