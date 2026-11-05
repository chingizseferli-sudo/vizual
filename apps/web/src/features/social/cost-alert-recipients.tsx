import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { friendlyError } from '@/lib/friendly-error'
import { supabase } from '@/lib/supabase'

const recipientsQueryKey = ['admin', 'social', 'cost-alert-recipients'] as const

type Recipient = {
  user_id: string
  email: string | null
  role: string
  cost_alert_email: boolean
  cost_alert_telegram: boolean
  telegram_linked: boolean
}

type Change = { userId: string; email?: boolean; telegram?: boolean }

async function fetchRecipients(): Promise<Recipient[]> {
  const { data, error } = await supabase.rpc('admin_cost_alert_recipients')
  if (error) throw error
  return (data ?? []) as Recipient[]
}

async function saveChange(change: Change) {
  const { error } = await supabase.rpc('admin_set_cost_alerts', {
    p_user_id: change.userId,
    p_email: change.email ?? null,
    p_telegram: change.telegram ?? null,
  })
  if (error) throw error
}

function errorText(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (message.includes('SUPERADMIN_ACCESS_REQUIRED')) {
    return 'Başqa adminin ayarını yalnız superadmin dəyişə bilər.'
  }
  if (
    message.includes('admin_cost_alert_recipients') ||
    message.includes('admin_set_cost_alerts')
  ) {
    return 'Bazada xərc xəbərdarlığı funksiyaları hələ yoxdur: «npx supabase db push» edin.'
  }
  return friendlyError(error)
}

/** Which admins get API balance/budget alerts, and by which channel. */
export function CostAlertRecipients() {
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: recipientsQueryKey,
    queryFn: fetchRecipients,
  })
  const mutation = useMutation({
    mutationFn: saveChange,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: recipientsQueryKey }),
  })

  if (isLoading) {
    return (
      <p className='flex items-center text-sm text-muted-foreground'>
        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
        Adminlər yüklənir...
      </p>
    )
  }
  if (error) {
    return (
      <p className='text-sm text-destructive' role='alert'>
        {errorText(error)}
      </p>
    )
  }

  return (
    <div className='grid gap-2'>
      <div className='overflow-x-auto'>
        <table className='w-full text-sm'>
          <thead>
            <tr className='border-b text-left text-muted-foreground'>
              <th className='py-2 pr-3 font-medium'>Admin</th>
              <th className='py-2 pr-3 font-medium'>Email</th>
              <th className='py-2 font-medium'>Telegram</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((row) => (
              <tr key={row.user_id} className='border-b last:border-0'>
                <td className='py-2 pr-3'>
                  <div className='font-medium'>{row.email || row.user_id}</div>
                  {row.role === 'superadmin' ? (
                    <div className='text-xs text-muted-foreground'>
                      superadmin
                    </div>
                  ) : null}
                </td>
                <td className='py-2 pr-3'>
                  <input
                    type='checkbox'
                    className='h-4 w-4'
                    checked={row.cost_alert_email}
                    disabled={mutation.isPending || !row.email}
                    aria-label={`${row.email ?? row.user_id}: email xəbərdarlığı`}
                    onChange={(event) =>
                      mutation.mutate({
                        userId: row.user_id,
                        email: event.target.checked,
                      })
                    }
                  />
                </td>
                <td className='py-2'>
                  <label className='inline-flex items-center gap-2'>
                    <input
                      type='checkbox'
                      className='h-4 w-4'
                      checked={row.cost_alert_telegram}
                      disabled={mutation.isPending}
                      aria-label={`${row.email ?? row.user_id}: Telegram xəbərdarlığı`}
                      onChange={(event) =>
                        mutation.mutate({
                          userId: row.user_id,
                          telegram: event.target.checked,
                        })
                      }
                    />
                    {row.telegram_linked ? null : (
                      <span className='text-xs text-muted-foreground'>
                        Telegram bağlı deyil (profildən bağlayın)
                      </span>
                    )}
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mutation.isError ? (
        <p className='text-sm text-destructive' role='alert'>
          Dəyişmədi: {errorText(mutation.error)}
        </p>
      ) : null}
    </div>
  )
}
