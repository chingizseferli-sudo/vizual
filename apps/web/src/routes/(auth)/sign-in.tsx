import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { SignIn } from '@/features/auth/sign-in'

const searchSchema = z.object({
  redirect: z.string().optional(),
})

function CustomerSignInRoute() {
  const { redirect } = Route.useSearch()
  return <SignIn mode='customer' redirectTo={redirect} />
}

export const Route = createFileRoute('/(auth)/sign-in')({
  component: CustomerSignInRoute,
  validateSearch: searchSchema,
})
