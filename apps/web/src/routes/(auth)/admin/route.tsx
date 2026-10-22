import { createFileRoute } from '@tanstack/react-router'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'
import { ProtectedRoute } from '@/features/auth/components/protected-route'

export const Route = createFileRoute('/(auth)/admin')({
  component: AdminLayout,
})

function AdminLayout() {
  return (
    <ProtectedRoute
      allowedRoles={['admin', 'superadmin']}
      unauthorizedRedirect='/admin/sign-in'
      unauthenticatedRedirect='/admin/sign-in'
      requireAdminMfa
    >
      <AuthenticatedLayout />
    </ProtectedRoute>
  )
}
