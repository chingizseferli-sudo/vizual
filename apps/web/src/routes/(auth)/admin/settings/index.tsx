import { createFileRoute } from '@tanstack/react-router'
import { SettingsProfile } from '@/features/settings/profile'

export const Route = createFileRoute('/(auth)/admin/settings/')({
  component: SettingsProfile,
})
