import { createFileRoute, redirect } from '@tanstack/react-router'

// Old bookmark: customers now manage keywords, not monitors.
export const Route = createFileRoute('/(auth)/monitor/monitors')({
  beforeLoad: () => {
    throw redirect({ to: '/monitor/keywords', replace: true })
  },
})
