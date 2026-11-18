import { clientEnv } from '@/config/env'
import { friendlyError } from '@/lib/friendly-error'
import { t } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import { fetchKeywordsData } from '@/features/keywords/data'

// Profile data shared by the profile page, the notification settings on the
// alerts page and the sidebar prefetch, so all three cache the same shape.

type ProfileRow = {
  user_id: string
  email: string | null
  role: string | null
  status: string | null
  telegram_chat_id: string | null
}

export type PlanInfo = {
  name: string | null
  history_days: number | null
  telegram_enabled: boolean | null
  limits: Record<string, unknown> | null
}

export type SocialAccess = {
  interval_minutes: number | null
  facebook_enabled: boolean | null
  instagram_enabled: boolean | null
}

export type ProfileState = {
  userId: string
  email: string
  role: string
  status: string
  createdAt: string | null
  telegramChatId: string | null
  keywordCount: number
  keywordLimit: number | null
  plan: PlanInfo | null
  planAvailable: boolean
  social: SocialAccess | null
}

function getRoleLabel(role: string | null) {
  if (role === 'superadmin') return 'Superadmin'
  if (role === 'admin') return 'Admin'
  if (role === 'customer') return t('İstifadəçi')
  return t('İstifadəçi')
}

function getStatusLabel(status: string | null) {
  if (status === 'active') return t('Aktiv')
  if (status === 'blocked') return t('Bloklanıb')
  if (status === 'inactive') return t('Passiv')
  return status || '-'
}

export function getTelegramBotUrl(startToken?: string) {
  const username = clientEnv.telegramBotUsername.replace(/^@/, '').trim()

  if (!username) return ''

  const base = `https://t.me/${encodeURIComponent(username)}`
  return startToken ? `${base}?start=${encodeURIComponent(startToken)}` : base
}

// One-time token (15 min, single use) so a leaked user id can't link a chat.
export async function createTelegramLinkUrl() {
  const { data, error } = await supabase.rpc('create_telegram_link_token')

  if (error || typeof data !== 'string' || !data) {
    throw new Error(friendlyError(error, t('Telegram linki yaradılmadı.')))
  }

  return getTelegramBotUrl(data)
}

async function loadOptionalPlan(
  userId: string
): Promise<{ plan: PlanInfo | null; available: boolean }> {
  const profilePlan = await supabase
    .from('user_profiles')
    .select('plan_id')
    .eq('user_id', userId)
    .maybeSingle()

  const planId = (profilePlan.data as { plan_id?: string | null } | null)
    ?.plan_id

  if (profilePlan.error || !planId) {
    return { plan: null, available: false }
  }

  const planResult = await supabase
    .from('subscription_plans')
    .select('name,history_days,telegram_enabled,limits')
    .eq('id', planId)
    .maybeSingle()

  if (planResult.error || !planResult.data) {
    return { plan: null, available: false }
  }

  return { plan: planResult.data as PlanInfo, available: true }
}

export async function fetchProfileData(): Promise<{
  profileState: ProfileState | null
  errorMessage: string
}> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      profileState: null,
      errorMessage: t('Sessiya tapılmadı. Zəhmət olmasa yenidən daxil olun.'),
    }
  }

  const [profileResult, keywordsResult, planResult, socialResult] =
    await Promise.all([
      supabase
        .from('user_profiles')
        .select('user_id,email,role,status,telegram_chat_id')
        .eq('user_id', user.id)
        .maybeSingle(),
      fetchKeywordsData().catch(() => null),
      loadOptionalPlan(user.id),
      supabase.rpc('current_user_social_access').maybeSingle(),
    ])

  if (profileResult.error) {
    console.error('Customer profile load error:', profileResult.error)
  }

  const profile = (profileResult.data || null) as ProfileRow | null

  return {
    profileState: {
      userId: user.id,
      email: profile?.email || user.email || '-',
      role: getRoleLabel(profile?.role || null),
      status: getStatusLabel(profile?.status || null),
      createdAt: user.created_at || null,
      telegramChatId: profile?.telegram_chat_id || null,
      keywordCount: keywordsResult?.activeCount ?? 0,
      keywordLimit: keywordsResult?.maxKeywords ?? null,
      plan: planResult.plan,
      planAvailable: planResult.available,
      // Missing until migration 20261020000002 is applied: the tile is hidden.
      social: socialResult.error ? null : (socialResult.data as SocialAccess),
    },
    errorMessage: profileResult.error
      ? t(
          'Profil məlumatları tam yüklənmədi. Əsas hesab məlumatları göstərilir.'
        )
      : '',
  }
}
