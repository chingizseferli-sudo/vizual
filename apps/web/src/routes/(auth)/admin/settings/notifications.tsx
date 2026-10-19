import { createFileRoute } from '@tanstack/react-router'
import { SettingsNotifications } from '@/features/settings/notifications'

export const Route = createFileRoute('/(auth)/admin/settings/notifications')({
  component: SettingsNotifications,
})
