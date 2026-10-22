import { createFileRoute } from '@tanstack/react-router'
import { AdminMfa } from '@/features/auth/admin-mfa'

// A plain validator keeps zod out of the entry bundle: route options other
// than the component are loaded eagerly with the route tree.
function searchSchema(search: Record<string, unknown>): { redirect?: string } {
  return typeof search.redirect === 'string'
    ? { redirect: search.redirect }
    : {}
}

function AdminMfaRoute() {
  const { redirect } = Route.useSearch()
  return <AdminMfa redirectTo={redirect} />
}

export const Route = createFileRoute('/admin/mfa')({
  component: AdminMfaRoute,
  validateSearch: searchSchema,
})
