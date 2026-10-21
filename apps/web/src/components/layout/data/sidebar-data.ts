import {
  Calculator,
  CreditCard,
  Eye,
  FileText,
  Inbox,
  Globe,
  LayoutDashboard,
  Send,
  Settings,
  Share2,
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
          title: 'Demo müraciətləri',
          url: '/admin/demo-requests',
          icon: Inbox,
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
          title: 'Veb izləmə',
          url: '/monitor/watch-monitor',
          icon: Eye,
        },
        {
          title: 'Bot logları',
          url: '/admin/monitor/logs',
          icon: FileText,
        },
        {
          title: 'Telegram bot',
          url: '/admin/telegram',
          icon: Send,
        },
        {
          title: 'Sosial monitorinq',
          url: '/admin/social',
          icon: Share2,
        },
        {
          title: 'Kalkulyator',
          url: '/admin/calculator',
          icon: Calculator,
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
