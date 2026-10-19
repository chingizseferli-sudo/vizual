import { createFileRoute } from '@tanstack/react-router'
import { SettingsAccount } from '@/features/settings/account'

export const Route = createFileRoute('/(auth)/admin/settings/account')({
  component: SettingsAccount,
})
