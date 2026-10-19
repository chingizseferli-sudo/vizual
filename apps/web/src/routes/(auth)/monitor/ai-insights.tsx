import { createFileRoute } from '@tanstack/react-router'
import { AIInsightsPage } from '@/features/ai-insights'

export const Route = createFileRoute('/(auth)/monitor/ai-insights')({
  component: AIInsightsPage,
})
