import { createFileRoute } from '@tanstack/react-router'
import { SettingsAppearance } from '@/features/settings/appearance'

export const Route = createFileRoute('/(auth)/admin/settings/appearance')({
  component: SettingsAppearance,
})
