import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Check, Loader2, Mail, RefreshCw, RotateCcw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { friendlyError } from '@/lib/friendly-error'

type FeedbackMessage = {
  id: string
  kind: 'suggestion' | 'complaint'
  name: string | null
  email: string | null
  message: string
  page: string | null
  lang: string
  status: 'new' | 'handled'
  handled_at: string | null
  created_at: string
}

type Filter = 'new' | 'all'

const feedbackQueryKey = (filter: Filter) =>
  ['admin', 'feedback', filter] as const

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

async function fetchFeedback(filter: Filter) {
  let query = supabase
    .from('feedback_messages')
    .select(
      'id,kind,name,email,message,page,lang,status,handled_at,created_at'
    )
    .order('created_at', { ascending: false })
    .limit(200)
  if (filter === 'new') query = query.eq('status', 'new')
  const { data, error } = await query
  if (error) throw error
  return (data || []) as FeedbackMessage[]
}

async function setRequestStatus({
  id,
  status,
}: {
  id: string
  status: FeedbackMessage['status']
}) {
  const { error } = await supabase
    .from('feedback_messages')
    .update({
      status,
      handled_at: status === 'handled' ? new Date().toISOString() : null,
    })
    .eq('id', id)
  if (error) throw error
}

function FeedbackPage() {
  const [filter, setFilter] = useState<Filter>('new')
  const queryClient = useQueryClient()
  const { data, error, isLoading, isFetching, refetch } = useQuery({
    queryKey: feedbackQueryKey(filter),
    queryFn: () => fetchFeedback(filter),
    refetchInterval: 60 * 1000,
  })
  const statusMutation = useMutation({
    mutationFn: setRequestStatus,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ['admin', 'feedback'] }),
  })

  return (
    <div className='grid gap-6 p-4 md:p-6'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h1 className='text-xl font-semibold tracking-tight'>
            Təklif və iradlar
          </h1>
          <p className='text-muted-foreground'>
            Əlaqə səhifəsindəki formdan gələn mesajlar. Yenisi gələndə
            adminlərə Telegram bildirişi gedir.
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
          Mesajlar yüklənmədi: {friendlyError(error)}
          <div className='mt-1 text-xs'>
            Migrasiya (20261118000001_feedback_and_simpler_site) tətbiq
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
            ? 'Baxılmamış mesaj yoxdur.'
            : 'Hələ mesaj gəlməyib.'}
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
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                        request.kind === 'complaint'
                          ? 'border-destructive/25 bg-destructive/10 text-destructive'
                          : 'border-primary/25 bg-primary/10 text-primary'
                      }`}
                    >
                      {request.kind === 'complaint' ? 'İrad' : 'Təklif'}
                    </span>
                    <h2 className='font-semibold'>
                      {request.name || 'Adsız'}
                    </h2>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                        request.status === 'new'
                          ? 'border-amber-300 bg-amber-50 text-amber-700'
                          : 'border-success/25 bg-success/10 text-success'
                      }`}
                    >
                      {request.status === 'new' ? 'Yeni' : 'Baxıldı'}
                    </span>
                    {request.lang !== 'az' ? (
                      <span className='rounded-full border px-2 py-0.5 text-xs text-muted-foreground uppercase'>
                        {request.lang}
                      </span>
                    ) : null}
                  </div>
                  {request.email ? (
                    <a
                      href={`mailto:${request.email}`}
                      className='mt-2 inline-flex items-center gap-1.5 text-sm break-all text-primary hover:underline'
                    >
                      <Mail className='h-4 w-4 shrink-0' />
                      {request.email}
                    </a>
                  ) : null}
                  <p className='mt-2 text-sm whitespace-pre-line break-words'>
                    {request.message}
                  </p>
                  <p className='mt-2 text-xs text-muted-foreground'>
                    Göndərilib: {formatDate(request.created_at)}
                    {request.page ? ` · Səhifə: ${request.page}` : ''}
                    {request.handled_at
                      ? ` · Baxıldı: ${formatDate(request.handled_at)}`
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
                    ? 'Baxıldı kimi qeyd et'
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

export const Route = createFileRoute('/(auth)/admin/feedback')({
  component: FeedbackPage,
})
