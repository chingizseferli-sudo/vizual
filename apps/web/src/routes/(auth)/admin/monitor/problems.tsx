import { createFileRoute, redirect } from '@tanstack/react-router'

// Problem sources are the "Zəifləyib" and "Yoxlanmalı" filters on the Sources page.
export const Route = createFileRoute('/(auth)/admin/monitor/problems')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/monitor/sources' })
  },
})
