import { useLayout } from '@/context/layout-provider'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar'
// import { AppTitle } from './app-title'
import { sidebarData } from './data/sidebar-data'
import { NavGroup } from './nav-group'
import { NavUser } from './nav-user'
import { TeamSwitcher } from './team-switcher'

type SidebarUser = {
  name: string
  email: string
  avatar: string
}

type AppSidebarProps = {
  user?: SidebarUser
}

const fallbackUser: SidebarUser = {
  name: 'Visual Monitor',
  email: '—',
  avatar: '/avatars/shadcn.jpg',
}

export function AppSidebar({ user }: AppSidebarProps) {
  const { collapsible, variant } = useLayout()

  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <TeamSwitcher teams={sidebarData.teams} />

        {/* Replace <TeamSwitch /> with the following <AppTitle />
         /* if you want to use the normal app title instead of TeamSwitch dropdown */}
        {/* <AppTitle /> */}
      </SidebarHeader>
      <SidebarContent>
        {sidebarData.navGroups.map((props) => (
          <NavGroup key={props.title} {...props} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user ?? fallbackUser} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
