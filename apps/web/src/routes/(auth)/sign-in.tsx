import { createFileRoute } from '@tanstack/react-router'
import { SignIn } from '@/features/auth/sign-in'

// A plain validator keeps zod out of the entry bundle: route options other
// than the component are loaded eagerly with the route tree.
function searchSchema(search: Record<string, unknown>): { redirect?: string } {
  return typeof search.redirect === 'string'
    ? { redirect: search.redirect }
    : {}
}

function CustomerSignInRoute() {
  const { redirect } = Route.useSearch()
  return <SignIn mode='customer' redirectTo={redirect} />
}

export const Route = createFileRoute('/(auth)/sign-in')({
  component: CustomerSignInRoute,
  validateSearch: searchSchema,
})
