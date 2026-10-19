import { useEffect, useState } from 'react'
import { Outlet } from '@tanstack/react-router'
import {
  type CurrentProfile,
  getCurrentSupabaseProfile,
} from '@/lib/auth-session'
import { getCookie } from '@/lib/cookies'
import { cn } from '@/lib/utils'
import { LayoutProvider } from '@/context/layout-provider'
import { SearchProvider } from '@/context/search-provider'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { Header } from '@/components/layout/header'
import { SkipToMain } from '@/components/skip-to-main'
import { ThemeSwitch } from '@/components/theme-switch'

type AuthenticatedLayoutProps = {
  children?: React.ReactNode
}

function getRoleLabel(role?: string | null) {
  if (role === 'superadmin') return 'Superadmin'
  if (role === 'admin') return 'Admin'
  if (role === 'customer') return 'İstifadəçi'
  return 'Visual Monitor'
}

function getSidebarUser(session: CurrentProfile | null) {
  const email = session?.profile?.email ?? session?.user?.email

  if (!email) {
    return undefined
  }

  return {
    name: getRoleLabel(session?.profile?.role),
    email,
    avatar: '/avatars/shadcn.jpg',
  }
}

export function AuthenticatedLayout({ children }: AuthenticatedLayoutProps) {
  const [sessionProfile, setSessionProfile] = useState<CurrentProfile | null>(
    null
  )
  const defaultOpen = getCookie('sidebar_state') !== 'false'

  useEffect(() => {
    let mounted = true

    getCurrentSupabaseProfile().then((profile) => {
      if (mounted) {
        setSessionProfile(profile)
      }
    })

    return () => {
      mounted = false
    }
  }, [])

  return (
    <SearchProvider>
      <LayoutProvider>
        <SidebarProvider
          defaultOpen={defaultOpen}
          className='portal-shell admin-shell'
        >
          <SkipToMain />
          <AppSidebar user={getSidebarUser(sessionProfile)} />
          <SidebarInset
            className={cn(
              '@container/content min-w-0',
              'has-data-[layout=fixed]:h-svh',
              'peer-data-[variant=inset]:has-data-[layout=fixed]:h-[calc(100svh-(var(--spacing)*4))]'
            )}
          >
            <Header fixed className='admin-toolbar'>
              <span className='text-sm font-medium text-muted-foreground'>
                İdarəetmə
              </span>
              <div className='ms-auto flex items-center gap-2'>
                <ThemeSwitch />
              </div>
            </Header>
            <div
              id='content'
              tabIndex={-1}
              role='main'
              className='portal-content'
            >
              {children ?? <Outlet />}
            </div>
          </SidebarInset>
        </SidebarProvider>
      </LayoutProvider>
    </SearchProvider>
  )
}
