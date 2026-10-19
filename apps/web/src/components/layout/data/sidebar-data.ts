import {
  CreditCard,
  FileText,
  Globe,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: 'Superadmin',
    email: 'admin@visualmonitor.az',
    avatar: '/avatars/shadcn.jpg',
  },

  teams: [
    {
      name: 'Visual Monitor',
      logo: ShieldCheck,
      plan: 'Superadmin',
    },
  ],

  navGroups: [
    {
      title: 'Əsas idarəetmə',
      items: [
        {
          title: 'Ana panel',
          url: '/admin',
          icon: LayoutDashboard,
        },
        {
          title: 'İstifadəçilər',
          url: '/admin/users',
          icon: Users,
        },
        {
          title: 'Plan və abunəliklər',
          url: '/admin/subscriptions',
          icon: CreditCard,
        },
        {
          title: 'Mənbələr',
          url: '/admin/monitor/sources',
          icon: Globe,
        },
        {
          title: 'Bot logları',
          url: '/admin/monitor/logs',
          icon: FileText,
        },
        {
          title: 'Tənzimləmələr',
          url: '/admin/settings/public-site',
          icon: Settings,
        },
      ],
    },
  ],
}
