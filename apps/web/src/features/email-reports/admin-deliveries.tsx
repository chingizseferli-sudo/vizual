import { useQuery } from '@tanstack/react-query'
import { Mail, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ResponsiveTable } from '@/components/ui/responsive-table'
import {
  REPORT_FREQUENCY_LABELS,
  type ReportFrequency,
} from '@/features/subscriptions/model'

type DeliveryRow = {
  id: string
  kind: ReportFrequency
  period_start: string
  period_end: string
  recipient: string | null
  status: 'sending' | 'sent' | 'skipped' | 'failed'
  mention_count: number | null
  attempts: number
  error: string | null
  updated_at: string
}

const STATUS: Record<DeliveryRow['status'], { label: string; tone: string }> = {
  sent: { label: 'Göndərildi', tone: 'bg-success/10 text-success' },
  skipped: { label: 'Xəbər yox idi', tone: 'bg-muted text-muted-foreground' },
  sending: { label: 'Göndərilir', tone: 'bg-primary/10 text-primary' },
  failed: { label: 'Xəta', tone: 'bg-destructive/10 text-destructive' },
}

async function fetchDeliveries() {
  const { data, error } = await supabase
    .from('email_report_deliveries')
    .select(
      'id,kind,period_start,period_end,recipient,status,mention_count,attempts,error,updated_at'
    )
    .order('updated_at', { ascending: false })
    .limit(30)
  if (error) throw error
  return (data || []) as DeliveryRow[]
}

function formatTime(value: string) {
  return new Date(value).toLocaleString('az-AZ', {
    timeZone: 'Asia/Baku',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatPeriod(row: DeliveryRow) {
  return row.period_start === row.period_end
    ? row.period_start
    : `${row.period_start} – ${row.period_end}`
}

// Last email reports the rss worker sent; SMTP itself lives only in the worker.
export function EmailReportDeliveries() {
  const { data, error, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['admin', 'email-report-deliveries'],
    queryFn: fetchDeliveries,
    staleTime: 30 * 1000,
  })
  const rows = data || []
  const failed = rows.filter((row) => row.status === 'failed').length

  return (
    <section className='rounded-lg border bg-card'>
      <div className='flex flex-wrap items-center justify-between gap-3 border-b p-4'>
        <div>
          <h2 className='flex items-center gap-2 text-lg font-semibold'>
            <Mail className='h-5 w-5 text-muted-foreground' />
            Email hesabatları
          </h2>
          <p className='text-sm text-muted-foreground'>
            Gündəlik hesabat hər gün, həftəlik bazar ertəsi, aylıq ayın 1-i
            müştərinin seçdiyi saatda (standart 09:00, Bakı vaxtı) göndərilir.
            Hesabatlar Railway-dəki rss xidmətindən
            SMTP ilə gedir.
          </p>
        </div>
        <button
          type='button'
          onClick={() => void refetch()}
          className='inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm hover:bg-muted'
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`}
          />
          Yenilə
        </button>
      </div>

      {error ? (
        <p className='p-4 text-sm text-muted-foreground'>
          Hesabat jurnalı oxunmadı. Verilənlər bazası miqrasiyası tətbiq
          olunmayıbsa, `npx supabase db push` edin.
        </p>
      ) : isLoading ? (
        <p className='p-4 text-sm text-muted-foreground'>Yüklənir...</p>
      ) : rows.length === 0 ? (
        <p className='p-4 text-sm text-muted-foreground'>
          Hələ hesabat göndərilməyib. SMTP dəyişənləri Railway-də yoxdursa,
          worker hesabatları göndərmir.
        </p>
      ) : (
        <>
          {failed ? (
            <p className='border-b bg-destructive/5 px-4 py-2 text-sm text-destructive'>
              Son {rows.length} hesabatdan {failed} göndərilmədi. Xəta
              sütununa baxın: çox vaxt SMTP şifrəsi və ya Zoho limiti olur.
            </p>
          ) : null}
          <ResponsiveTable label='Email hesabatları' mobileLayout='cards'>
            <table role='table' className='w-full min-w-[760px] text-left text-sm'>
              <thead
                role='rowgroup'
                className='border-b bg-muted/50 text-xs text-muted-foreground'
              >
                <tr role='row'>
                  <th className='px-4 py-3 font-medium'>Vaxt</th>
                  <th className='px-4 py-3 font-medium'>Alıcı</th>
                  <th className='px-4 py-3 font-medium'>Hesabat</th>
                  <th className='px-4 py-3 font-medium'>Status</th>
                  <th className='px-4 py-3 font-medium'>Xəbər</th>
                  <th className='px-4 py-3 font-medium'>Xəta</th>
                </tr>
              </thead>
              <tbody role='rowgroup'>
                {rows.map((row) => (
                  <tr role='row' key={row.id} className='border-b last:border-0'>
                    <td role='cell' data-label='Vaxt' className='px-4 py-3 whitespace-nowrap'>
                      {formatTime(row.updated_at)}
                    </td>
                    <td role='cell' data-label='Alıcı' className='px-4 py-3 break-all'>
                      {row.recipient || '—'}
                    </td>
                    <td role='cell' data-label='Hesabat' className='px-4 py-3'>
                      <div className='font-medium'>
                        {REPORT_FREQUENCY_LABELS[row.kind]}
                      </div>
                      <div className='text-xs text-muted-foreground'>
                        {formatPeriod(row)}
                      </div>
                    </td>
                    <td role='cell' data-label='Status' className='px-4 py-3'>
                      <span
                        className={`rounded-full px-2 py-1 text-xs ${STATUS[row.status].tone}`}
                      >
                        {STATUS[row.status].label}
                      </span>
                    </td>
                    <td role='cell' data-label='Xəbər' className='px-4 py-3'>
                      {row.mention_count ?? '—'}
                    </td>
                    <td
                      role='cell'
                      data-label='Xəta'
                      className='max-w-72 px-4 py-3 text-xs break-words text-muted-foreground'
                    >
                      {row.error
                        ? `${row.error} (cəhd: ${row.attempts})`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        </>
      )}
    </section>
  )
}
