import { createFileRoute } from '@tanstack/react-router'
import { SettingsDisplay } from '@/features/settings/display'

export const Route = createFileRoute('/(auth)/admin/settings/display')({
  component: SettingsDisplay,
})
