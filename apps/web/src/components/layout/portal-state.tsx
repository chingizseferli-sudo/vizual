import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export function PortalLoading({ label }: { label: string }) {
  return (
    <div role='status' aria-live='polite' className='portal-page space-y-5'>
      <span className='sr-only'>{label}</span>
      <Skeleton className='h-8 w-48 max-w-full' />
      <div className='grid grid-cols-2 gap-3 xl:grid-cols-4'>
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className='h-28 rounded-xl' />
        ))}
      </div>
      <Skeleton className='h-64 w-full rounded-xl' />
    </div>
  )
}

export function PortalError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div role='alert' className='portal-page'>
      <div className='rounded-xl border bg-card p-5'>
        <AlertCircle
          className='mb-3 size-6 text-destructive'
          aria-hidden='true'
        />
        <h2 className='text-lg font-semibold'>Məlumat yüklənmədi</h2>
        <p className='my-3 text-sm text-muted-foreground'>{message}</p>
        <Button variant='outline' onClick={onRetry}>
          Yenidən yoxla
        </Button>
      </div>
    </div>
  )
}
