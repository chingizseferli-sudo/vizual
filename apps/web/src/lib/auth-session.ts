import { supabase } from '@/lib/supabase'

export type CurrentProfile = {
  user: {
    id: string
    email: string | null
  } | null
  profile: {
    user_id: string
    email: string | null
    role: string | null
    status: string | null
    telegram_chat_id: string | null
  } | null
  isAuthenticated: boolean
  isAdmin: boolean
  isBlocked: boolean
  error: string | null
}

type SupabaseQueryError = {
  code?: string | null
  message?: string | null
}

type ProfileRow = {
  user_id: string
  email: string | null
  role: string | null
  status: string | null
  telegram_chat_id?: string | null
}

const unauthenticatedProfile: CurrentProfile = {
  user: null,
  profile: null,
  isAuthenticated: false,
  isAdmin: false,
  isBlocked: false,
  error: null,
}

function isAdminAuthScope() {
  if (typeof window === 'undefined') return false
  return window.location.pathname.startsWith('/admin')
}

function isMissingAdminUsersTable(error: SupabaseQueryError | null) {
  return (
    error?.code === '42P01' ||
    error?.code === 'PGRST205' ||
    error?.message?.includes('admin_users') === true
  )
}

async function loadProfile(userId: string) {
  if (isAdminAuthScope()) {
    const { data, error } = await supabase
      .from('admin_users')
      .select('user_id,email,role,status')
      .eq('user_id', userId)
      .maybeSingle()

    if (isMissingAdminUsersTable(error)) {
      const fallback = await supabase
        .from('user_profiles')
        .select('user_id,email,role,status')
        .eq('user_id', userId)
        .maybeSingle()

      return {
        profile: fallback.data
          ? ({ ...fallback.data, telegram_chat_id: null } as ProfileRow)
          : null,
        error: fallback.error,
      }
    }

    return {
      profile: data
        ? ({ ...data, telegram_chat_id: null } as ProfileRow)
        : null,
      error,
    }
  }

  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id,email,role,status,telegram_chat_id')
    .eq('user_id', userId)
    .maybeSingle()

  return { profile: data as ProfileRow | null, error }
}

export async function getCurrentSupabaseProfile(): Promise<CurrentProfile> {
  try {
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession()

    if (sessionError) {
      return { ...unauthenticatedProfile, error: sessionError.message }
    }

    if (!sessionData.session) {
      return unauthenticatedProfile
    }

    const { data: userData, error: userError } = await supabase.auth.getUser()

    if (userError || !userData.user) {
      return {
        ...unauthenticatedProfile,
        error: userError?.message ?? 'Session user could not be loaded.',
      }
    }

    const user = {
      id: userData.user.id,
      email: userData.user.email ?? null,
    }

    const { profile, error: profileError } = await loadProfile(user.id)

    if (profileError || !profile) {
      return {
        user,
        profile: null,
        isAuthenticated: true,
        isAdmin: false,
        isBlocked: false,
        error: profileError?.message ?? 'Profile not found.',
      }
    }

    const role = profile.role ?? ''
    const status = profile.status ?? ''

    return {
      user,
      profile: {
        user_id: profile.user_id,
        email: profile.email,
        role: profile.role,
        status: profile.status,
        telegram_chat_id: profile.telegram_chat_id ?? null,
      },
      isAuthenticated: true,
      isAdmin: role === 'admin' || role === 'superadmin',
      isBlocked: status === 'blocked' || status === 'inactive',
      error: null,
    }
  } catch (error) {
    return {
      ...unauthenticatedProfile,
      error:
        error instanceof Error
          ? error.message
          : 'Session could not be restored.',
    }
  }
}
