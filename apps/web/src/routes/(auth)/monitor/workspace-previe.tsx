import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/(auth)/monitor/workspace-previe')({
  beforeLoad: () => {
    throw redirect({ to: '/monitor/workspace-preview' })
  },
})
