import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  type CurrentProfile,
  getCurrentSupabaseProfile,
} from '@/lib/auth-session'
import { t } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import { AccountStatusScreen } from './account-status-screen'

type ProtectedRouteProps = {
  allowedRoles: string[]
  unauthorizedRedirect?: '/monitor' | '/sign-in' | '/admin/sign-in'
  unauthenticatedRedirect?: '/sign-in' | '/admin/sign-in'
  children: React.ReactNode
}

export function ProtectedRoute({
  allowedRoles,
  unauthorizedRedirect = '/sign-in',
  unauthenticatedRedirect = '/sign-in',
  children,
}: ProtectedRouteProps) {
  const navigate = useNavigate()
  const [sessionProfile, setSessionProfile] = useState<CurrentProfile | null>(
    null
  )
  const [isChecking, setIsChecking] = useState(true)

  useEffect(() => {
    let mounted = true

    getCurrentSupabaseProfile()
      .then(async (profile) => {
        if ((profile.profile?.role ?? 'customer') !== 'customer') return profile
        // The demo end is enforced in SQL too; this catches a demo that ran out
        // before the hourly expiry job. Without the RPC, keep the profile status.
        const { data } = await supabase.rpc('current_user_account_state')
        const state = Array.isArray(data) ? data[0] : null
        return state?.status && profile.profile
          ? { ...profile, profile: { ...profile.profile, status: state.status } }
          : profile
      })
      .then((profile) => {
        if (!mounted) return

        setSessionProfile(profile)
        setIsChecking(false)
      })

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (isChecking || !sessionProfile) return

    if (
      !sessionProfile.isAuthenticated ||
      sessionProfile.isBlocked ||
      sessionProfile.error ||
      !sessionProfile.profile
    ) {
      void navigate({ to: unauthenticatedRedirect, replace: true })
      return
    }

    const role = sessionProfile.profile.role ?? 'customer'

    if (!allowedRoles.includes(role)) {
      void navigate({ to: unauthorizedRedirect, replace: true })
    }
  }, [
    allowedRoles,
    isChecking,
    navigate,
    sessionProfile,
    unauthenticatedRedirect,
    unauthorizedRedirect,
  ])

  if (isChecking || !sessionProfile) {
    return (
      <div className='p-6 text-sm text-muted-foreground'>{t("Sessiya yoxlanılır...")}</div>
    )
  }

  if (
    !sessionProfile.isAuthenticated ||
    sessionProfile.isBlocked ||
    sessionProfile.error ||
    !sessionProfile.profile
  ) {
    return (
      <div className='p-6 text-sm text-muted-foreground'>{t("Sessiya yoxlanılır...")}</div>
    )
  }

  const role = sessionProfile.profile.role ?? 'customer'

  if (!allowedRoles.includes(role)) {
    return (
      <div className='p-6 text-sm text-muted-foreground'>{t("Sessiya yoxlanılır...")}</div>
    )
  }

  const status = sessionProfile.profile.status
  if (role === 'customer' && (status === 'pending' || status === 'expired')) {
    return (
      <AccountStatusScreen
        status={status}
        email={sessionProfile.profile.email}
      />
    )
  }

  return children
}
