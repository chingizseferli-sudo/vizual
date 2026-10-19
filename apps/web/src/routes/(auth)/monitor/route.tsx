import { createFileRoute } from '@tanstack/react-router'
import { CustomerLayout } from '@/components/layout/customer-layout'
import { ProtectedRoute } from '@/features/auth/components/protected-route'

export const Route = createFileRoute('/(auth)/monitor')({
  component: MonitorLayout,
})

function MonitorLayout() {
  return (
    <ProtectedRoute allowedRoles={['customer', 'admin', 'superadmin']}>
      <CustomerLayout />
    </ProtectedRoute>
  )
}
