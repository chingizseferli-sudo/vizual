import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/(auth)/admin/news/$id/')({
  component: RouteComponent,
})

function RouteComponent() {
  const { id } = Route.useParams()

  return (
    <div className='p-6'>
      <h1 className='text-xl font-semibold'>Xəbər səhifəsi</h1>

      <p className='mt-2 text-muted-foreground'>ID: {id}</p>
    </div>
  )
}
