import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/(auth)/admin/monitor/monitors')({
  component: MonitorsLayout,
})

function MonitorsLayout() {
  return <Outlet />
}
