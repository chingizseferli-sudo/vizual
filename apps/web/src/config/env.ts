const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const supabaseAnonKey = String(
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''
).trim()
const telegramBotUsername = String(
  import.meta.env.VITE_TELEGRAM_BOT_USERNAME ?? 'Tehsilli_bot'
).trim()

function isHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

const issues = [
  !isHttpUrl(supabaseUrl) ? 'VITE_SUPABASE_URL' : null,
  !supabaseAnonKey ? 'VITE_SUPABASE_ANON_KEY' : null,
].filter((issue): issue is string => Boolean(issue))

export const clientEnv =
  issues.length === 0
    ? {
        isConfigured: true as const,
        supabaseUrl: supabaseUrl.replace(/\/$/, ''),
        supabaseAnonKey,
        telegramBotUsername: telegramBotUsername || 'Tehsilli_bot',
        issues: [] as string[],
      }
    : {
        isConfigured: false as const,
        supabaseUrl: 'https://missing-supabase-url.supabase.co',
        supabaseAnonKey: 'missing-supabase-anon-key',
        telegramBotUsername: 'Tehsilli_bot',
        issues,
      }
