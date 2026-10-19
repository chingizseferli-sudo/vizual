import { createFileRoute } from '@tanstack/react-router'
import { ConfigDrawer } from '@/components/config-drawer'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ForbiddenError } from '@/features/errors/forbidden'
import { GeneralError } from '@/features/errors/general-error'
import { MaintenanceError } from '@/features/errors/maintenance-error'
import { NotFoundError } from '@/features/errors/not-found-error'
import { UnauthorisedError } from '@/features/errors/unauthorized-error'

export const Route = createFileRoute('/(auth)/admin/errors/$error')({
  component: RouteComponent,
})

function RouteComponent() {
  const { error } = Route.useParams()

  const errorMap: Record<string, React.ComponentType> = {
    unauthorized: UnauthorisedError,
    forbidden: ForbiddenError,
    'not-found': NotFoundError,
    'internal-server-error': GeneralError,
    'maintenance-error': MaintenanceError,
  }
  const ErrorComponent = errorMap[error] || NotFoundError

  return (
    <>
      <div className='flex min-w-0 items-center gap-3 border-b px-4 py-2'>
        <Search className='me-auto' />
        <ConfigDrawer />
        <ProfileDropdown />
      </div>
      <div className='flex-1 [&>div]:h-full'>
        <ErrorComponent />
      </div>
    </>
  )
}
