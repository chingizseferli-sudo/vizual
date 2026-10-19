import { createFileRoute } from '@tanstack/react-router'
import { Settings } from '@/features/settings'

export const Route = createFileRoute('/(auth)/admin/settings')({
  component: Settings,
})
