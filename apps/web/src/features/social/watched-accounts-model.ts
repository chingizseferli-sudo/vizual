// Watched Instagram pages and Telegram channels (social_watched_accounts).

export type WatchedPlatform = 'instagram' | 'telegram'

export const WATCHED_PLATFORM_LABELS: Record<WatchedPlatform, string> = {
  instagram: 'Instagram səhifəsi',
  telegram: 'Telegram kanalı',
}

// Worker defaults when the admin sets no interval (collector.ACCOUNT_DEFAULT_INTERVALS).
export const WATCHED_DEFAULT_INTERVAL: Record<WatchedPlatform, number> = {
  instagram: 180,
  telegram: 10,
}

// "@Report.az", "https://www.instagram.com/report.az/", "t.me/s/apa_az" → the bare handle.
export function normalizeWatchedHandle(value: string): string {
  let handle = value.trim()
  const fromUrl = handle.match(
    /(?:instagram\.com|t\.me|telegram\.me)\/(?:s\/)?([^/?#\s]+)/i
  )
  if (fromUrl) handle = fromUrl[1]
  return handle.replace(/^@+/, '').replace(/\/+$/, '').toLowerCase()
}

export function isValidWatchedHandle(handle: string) {
  return /^[a-z0-9._]{1,64}$/.test(handle)
}

export function watchedAccountUrl(platform: WatchedPlatform, handle: string) {
  return platform === 'instagram'
    ? `https://www.instagram.com/${handle}/`
    : `https://t.me/s/${handle}`
}

// Admin-entered minutes; empty means the platform default.
export function parseWatchedInterval(value: string): number | null | 'invalid' {
  const trimmed = value.trim()
  if (!trimmed) return null
  const minutes = Number(trimmed)
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 10080) return 'invalid'
  return minutes
}
