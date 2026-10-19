import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { SignIn } from '@/features/auth/sign-in'

const searchSchema = z.object({
  redirect: z.string().optional(),
})

function AdminSignInRoute() {
  const { redirect } = Route.useSearch()
  return <SignIn mode='admin' redirectTo={redirect} />
}

export const Route = createFileRoute('/admin/sign-in')({
  component: AdminSignInRoute,
  validateSearch: searchSchema,
})
