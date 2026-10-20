import { useNavigate } from '@tanstack/react-router'
import { Clock, Hourglass } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'

type AccountStatusScreenProps = {
  status: 'pending' | 'expired'
  email: string | null
}

// What a customer sees instead of the monitor while their sign-up waits for
// admin approval, or after the demo ran out without a paid plan.
export function AccountStatusScreen({ status, email }: AccountStatusScreenProps) {
  const navigate = useNavigate()
  const Icon = status === 'pending' ? Clock : Hourglass

  const signOut = async () => {
    await supabase.auth.signOut()
    void navigate({ to: '/sign-in', replace: true })
  }

  return (
    <div className='flex min-h-svh items-center justify-center p-6'>
      <div className='max-w-md space-y-4 rounded-lg border bg-card p-6 text-center shadow-sm'>
        <Icon className='mx-auto size-10 text-muted-foreground' />
        <h1 className='text-lg font-semibold'>
          {status === 'pending'
            ? t('Müraciətiniz qəbul edildi')
            : t('Demo müddəti bitdi')}
        </h1>
        <p className='text-sm text-muted-foreground'>
          {status === 'pending'
            ? t(
                'Admin təsdiqindən sonra hesabınız aktiv olacaq və 7 günlük demo başlayacaq.'
              )
            : t('Plan seçmək üçün bizimlə əlaqə saxlayın.')}
        </p>
        {email ? <p className='text-xs text-muted-foreground'>{email}</p> : null}
        <Button variant='outline' onClick={() => void signOut()}>
          {t('Çıxış')}
        </Button>
      </div>
    </div>
  )
}
