import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Check, Loader2, Mail, Phone, RefreshCw, RotateCcw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { friendlyError } from '@/lib/friendly-error'

type DemoRequest = {
  id: string
  name: string
  company: string
  email: string
  phone: string | null
  message: string | null
  lang: string
  status: 'new' | 'handled'
  handled_at: string | null
  created_at: string
}

type Filter = 'new' | 'all'

const demoRequestsQueryKey = (filter: Filter) =>
  ['admin', 'demo-requests', filter] as const

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('az-AZ', {
    timeZone: 'Asia/Baku',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function fetchDemoRequests(filter: Filter) {
  let query = supabase
    .from('demo_requests')
    .select(
      'id,name,company,email,phone,message,lang,status,handled_at,created_at'
    )
    .order('created_at', { ascending: false })
    .limit(200)
  if (filter === 'new') query = query.eq('status', 'new')
  const { data, error } = await query
  if (error) throw error
  return (data || []) as DemoRequest[]
}

async function setRequestStatus({
  id,
  status,
}: {
  id: string
  status: DemoRequest['status']
}) {
  const { error } = await supabase
    .from('demo_requests')
    .update({
      status,
      handled_at: status === 'handled' ? new Date().toISOString() : null,
    })
    .eq('id', id)
  if (error) throw error
}

function DemoRequestsPage() {
  const [filter, setFilter] = useState<Filter>('new')
  const queryClient = useQueryClient()
  const { data, error, isLoading, isFetching, refetch } = useQuery({
    queryKey: demoRequestsQueryKey(filter),
    queryFn: () => fetchDemoRequests(filter),
    refetchInterval: 60 * 1000,
  })
  const statusMutation = useMutation({
    mutationFn: setRequestStatus,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ['admin', 'demo-requests'] }),
  })

  return (
    <div className='grid gap-6 p-4 md:p-6'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h1 className='text-xl font-semibold tracking-tight'>
            Demo müraciətləri
          </h1>
          <p className='text-muted-foreground'>
            Saytdakı formdan gələn müraciətlər. Yenisi gələndə adminlərə
            Telegram bildirişi gedir.
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <div className='inline-flex rounded-lg border bg-card p-1 text-sm'>
            {(
              [
                ['new', 'Yeni'],
                ['all', 'Hamısı'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type='button'
                onClick={() => setFilter(value)}
                className={`rounded-md px-3 py-1.5 font-medium ${
                  filter === value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type='button'
            onClick={() => void refetch()}
            disabled={isFetching}
            className='inline-flex items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60'
          >
            <RefreshCw
              className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`}
            />
            Yenilə
          </button>
        </div>
      </div>

      {error ? (
        <div
          role='alert'
          className='rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive'
        >
          Müraciətlər yüklənmədi: {friendlyError(error)}
          <div className='mt-1 text-xs'>
            Migrasiya (20261021000001_demo_requests_and_site_copy) tətbiq
            olunmayıbsa, cədvəl hələ mövcud deyil.
          </div>
        </div>
      ) : null}
      {statusMutation.error ? (
        <div
          role='alert'
          className='rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive'
        >
          Status dəyişmədi: {friendlyError(statusMutation.error)}
        </div>
      ) : null}

      {isLoading ? (
        <div className='flex min-h-[200px] items-center justify-center text-sm text-muted-foreground'>
          <Loader2 className='mr-2 h-4 w-4 animate-spin' />
          Yüklənir...
        </div>
      ) : data && data.length === 0 ? (
        <div className='rounded-lg border border-dashed bg-card p-10 text-center text-sm text-muted-foreground'>
          {filter === 'new'
            ? 'Cavab gözləyən müraciət yoxdur.'
            : 'Hələ müraciət gəlməyib.'}
        </div>
      ) : (
        <div className='grid gap-3'>
          {(data || []).map((request) => {
            const pending =
              statusMutation.isPending &&
              statusMutation.variables?.id === request.id
            return (
              <article
                key={request.id}
                className='grid gap-3 rounded-lg border bg-card p-4 md:grid-cols-[1fr_auto] md:items-start'
              >
                <div className='min-w-0'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <h2 className='font-semibold'>{request.name}</h2>
                    <span className='text-muted-foreground'>·</span>
                    <span className='font-medium break-words'>
                      {request.company}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                        request.status === 'new'
                          ? 'border-amber-300 bg-amber-50 text-amber-700'
                          : 'border-success/25 bg-success/10 text-success'
                      }`}
                    >
                      {request.status === 'new' ? 'Yeni' : 'Cavablandı'}
                    </span>
                    {request.lang === 'ru' ? (
                      <span className='rounded-full border px-2 py-0.5 text-xs text-muted-foreground'>
                        RU
                      </span>
                    ) : null}
                  </div>
                  <div className='mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm'>
                    <a
                      href={`mailto:${request.email}`}
                      className='inline-flex items-center gap-1.5 break-all text-primary hover:underline'
                    >
                      <Mail className='h-4 w-4 shrink-0' />
                      {request.email}
                    </a>
                    {request.phone ? (
                      <a
                        href={`tel:${request.phone.replace(/[^\d+]/g, '')}`}
                        className='inline-flex items-center gap-1.5 text-primary hover:underline'
                      >
                        <Phone className='h-4 w-4 shrink-0' />
                        {request.phone}
                      </a>
                    ) : null}
                  </div>
                  {request.message ? (
                    <p className='mt-2 text-sm whitespace-pre-line break-words text-muted-foreground'>
                      {request.message}
                    </p>
                  ) : null}
                  <p className='mt-2 text-xs text-muted-foreground'>
                    Göndərilib: {formatDate(request.created_at)}
                    {request.handled_at
                      ? ` · Cavablandı: ${formatDate(request.handled_at)}`
                      : ''}
                  </p>
                </div>
                <button
                  type='button'
                  disabled={pending}
                  onClick={() =>
                    statusMutation.mutate({
                      id: request.id,
                      status: request.status === 'new' ? 'handled' : 'new',
                    })
                  }
                  className='inline-flex items-center justify-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm font-medium whitespace-nowrap hover:bg-muted disabled:opacity-60'
                >
                  {pending ? (
                    <Loader2 className='h-4 w-4 animate-spin' />
                  ) : request.status === 'new' ? (
                    <Check className='h-4 w-4' />
                  ) : (
                    <RotateCcw className='h-4 w-4' />
                  )}
                  {request.status === 'new'
                    ? 'Cavablandı kimi qeyd et'
                    : 'Yenidən aç'}
                </button>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

export const Route = createFileRoute('/(auth)/admin/demo-requests')({
  component: DemoRequestsPage,
})
