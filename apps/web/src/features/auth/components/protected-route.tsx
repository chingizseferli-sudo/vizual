import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  type CurrentProfile,
  getCurrentSupabaseProfile,
} from '@/lib/auth-session'

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

    getCurrentSupabaseProfile().then((profile) => {
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
      <div className='p-6 text-sm text-muted-foreground'>
        Sessiya yoxlanılır...
      </div>
    )
  }

  if (
    !sessionProfile.isAuthenticated ||
    sessionProfile.isBlocked ||
    sessionProfile.error ||
    !sessionProfile.profile
  ) {
    return (
      <div className='p-6 text-sm text-muted-foreground'>
        Sessiya yoxlanılır...
      </div>
    )
  }

  const role = sessionProfile.profile.role ?? 'customer'

  if (!allowedRoles.includes(role)) {
    return (
      <div className='p-6 text-sm text-muted-foreground'>
        Sessiya yoxlanılır...
      </div>
    )
  }

  return children
}
