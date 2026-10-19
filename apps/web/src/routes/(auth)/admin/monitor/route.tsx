import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/(auth)/admin/monitor')({
  component: MonitorLayout,
})

function MonitorLayout() {
  return <Outlet />
}
