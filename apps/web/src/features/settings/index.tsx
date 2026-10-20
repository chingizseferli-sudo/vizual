import { Outlet } from '@tanstack/react-router'
import {
  Bell,
  Monitor,
  Palette,
  SearchCheck,
  UserCog,
  Wrench,
} from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { ConfigDrawer } from '@/components/config-drawer'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { SidebarNav } from './components/sidebar-nav'

const sidebarNavItems = [
  {
    title: 'Profil',
    href: '/admin/settings/',
    icon: <UserCog size={18} />,
  },
  {
    title: 'Hesab',
    href: '/admin/settings/account',
    icon: <Wrench size={18} />,
  },
  {
    title: 'G\u00f6r\u00fcn\u00fc\u015f',
    href: '/admin/settings/appearance',
    icon: <Palette size={18} />,
  },
  {
    title: 'Bildiri\u015fl\u0259r',
    href: '/admin/settings/notifications',
    icon: <Bell size={18} />,
  },
  {
    title: 'Ekran',
    href: '/admin/settings/display',
    icon: <Monitor size={18} />,
  },
  {
    title: 'Brend v\u0259 SEO',
    href: '/admin/settings/brand-seo',
    icon: <SearchCheck size={18} />,
  },
]

export function Settings() {
  return (
    <>
      <div className='flex min-w-0 items-center gap-3 border-b px-4 py-2'>
        <Search className='me-auto' />
        <ConfigDrawer />
        <ProfileDropdown />
      </div>

      <Main>
        <div className='space-y-0.5'>
          <h1 className='text-xl font-semibold tracking-tight'>
            {'T\u0259nziml\u0259m\u0259l\u0259r'}
          </h1>
          <p className='text-muted-foreground'>
            {
              'Admin hesab\u0131, g\u00f6r\u00fcn\u00fc\u015f v\u0259 public sayt m\u0259lumatlar\u0131n\u0131 idar\u0259 edin.'
            }
          </p>
        </div>
        <Separator className='my-4 lg:my-6' />
        <div className='flex flex-1 flex-col space-y-2 lg:flex-row lg:space-y-0 lg:space-x-12'>
          <aside className='top-0 min-w-0 lg:sticky lg:w-1/5'>
            <SidebarNav items={sidebarNavItems} />
          </aside>
          <div className='flex w-full min-w-0 p-1'>
            <Outlet />
          </div>
        </div>
      </Main>
    </>
  )
}
