import { createFileRoute } from '@tanstack/react-router'
import { SettingsBrandSeo } from '@/features/settings/brand-seo'

export const Route = createFileRoute('/(auth)/admin/settings/brand-seo')({
  component: SettingsBrandSeo,
})
