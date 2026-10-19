import { createFileRoute } from '@tanstack/react-router'
import { AnalyticsPage } from '@/features/analytics'

export const Route = createFileRoute('/(auth)/monitor/analytics')({
  component: AnalyticsPage,
})
