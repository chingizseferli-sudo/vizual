import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useLocation } from '@tanstack/react-router'
import {
  BarChart3,
  Bell,
  Eye,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Radio,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import {
  type CurrentProfile,
  getCurrentSupabaseProfile,
} from '@/lib/auth-session'
import { prefetchCustomerRoute } from '@/lib/customer-prefetch'
import useDialogState from '@/hooks/use-dialog-state'
import { usePublicSiteBrand } from '@/hooks/use-public-site-brand'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { BrandMark } from '@/components/brand-mark'
import { SignOutDialog } from '@/components/sign-out-dialog'

const customerNavItems = [
  {
    title: 'Panel',
    url: '/monitor',
    icon: LayoutDashboard,
  },
  {
    title: 'Monitorlar',
    url: '/monitor/monitors',
    icon: Radio,
  },
  {
    title: 'İş masası',
    url: '/monitor/workspace-preview',
    icon: ShieldCheck,
  },
  {
    title: 'Veb izləmə',
    url: '/monitor/watch-monitor',
    icon: Eye,
  },
  {
    title: 'Xəbər xəritəsi',
    url: '/monitor/story-intelligence',
    icon: MapPinned,
  },
  {
    title: 'Nəticələr',
    url: '/monitor/results',
    icon: BarChart3,
  },
  {
    title: 'Bildirişlər',
    url: '/monitor/alerts',
    icon: Bell,
  },
  {
    title: 'Profil',
    url: '/monitor/profile',
    icon: UserRound,
  },
] as const

function isActivePath(href: string, url: string) {
  const pathname = href.split('?')[0]

  if (url === '/monitor') {
    return pathname === url
  }

  return pathname === url || pathname.startsWith(`${url}/`)
}

function getDisplayEmail(session: CurrentProfile | null) {
  return session?.profile?.email ?? session?.user?.email ?? '-'
}

function getDisplayRole(session: CurrentProfile | null) {
  const role = session?.profile?.role

  if (role === 'superadmin') return 'Superadmin'
  if (role === 'admin') return 'Admin'

  return 'İstifadəçi'
}

export function CustomerSidebar() {
  const href = useLocation({ select: (location) => location.href })
  const { setOpenMobile } = useSidebar()
  const queryClient = useQueryClient()
  const { siteName, logoUrl, iconUrl } = usePublicSiteBrand()
  const [openSignOut, setOpenSignOut] = useDialogState()
  const [sessionProfile, setSessionProfile] = useState<CurrentProfile | null>(
    null
  )

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
    <>
      <Sidebar collapsible='icon' className='border-border bg-card/95'>
        <SidebarHeader>
          <div className='flex items-center gap-2 rounded-2xl px-2 py-2'>
            <BrandMark
              logoUrl={logoUrl}
              iconUrl={iconUrl}
              siteName={siteName}
              variant='icon'
              className='size-10 rounded-xl'
              imageClassName='size-10'
            />
            <div className='grid min-w-0 group-data-[collapsible=icon]:hidden'>
              <span className='truncate text-sm font-semibold text-foreground'>
                {siteName}
              </span>
              <span className='truncate text-xs text-muted-foreground'>
                İstifadəçi iş masası
              </span>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel className='text-muted-foreground'>
              Monitorinq
            </SidebarGroupLabel>
            <SidebarMenu>
              {customerNavItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActivePath(href, item.url)}
                    tooltip={item.title}
                    className='rounded-xl'
                  >
                    <Link
                      to={item.url}
                      aria-current={
                        isActivePath(href, item.url) ? 'page' : undefined
                      }
                      preload='intent'
                      onMouseEnter={() =>
                        prefetchCustomerRoute(queryClient, item.url)
                      }
                      onFocus={() =>
                        prefetchCustomerRoute(queryClient, item.url)
                      }
                      onClick={() => setOpenMobile(false)}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <div className='grid gap-2 rounded-2xl border border-border bg-muted/40 p-3 group-data-[collapsible=icon]:hidden'>
            <div className='min-w-0'>
              <div className='truncate text-sm font-semibold text-foreground'>
                {getDisplayRole(sessionProfile)}
              </div>
              <div className='truncate text-xs text-muted-foreground'>
                {getDisplayEmail(sessionProfile)}
              </div>
            </div>
            <button
              type='button'
              onClick={() => setOpenSignOut(true)}
              className='inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold hover:bg-muted/50'
            >
              <LogOut className='size-4' />
              Çıxış
            </button>
          </div>
          <SidebarMenu className='hidden group-data-[collapsible=icon]:flex'>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip='Çıxış'
                onClick={() => setOpenSignOut(true)}
              >
                <LogOut />
                <span>Çıxış</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SignOutDialog open={!!openSignOut} onOpenChange={setOpenSignOut} />
    </>
  )
}
