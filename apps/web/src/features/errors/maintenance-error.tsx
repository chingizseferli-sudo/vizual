import { t } from '@/lib/i18n'

export function MaintenanceError() {
  return (
    <div className='h-svh'>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2'>
        <h1 className='text-[7rem] leading-tight font-bold'>503</h1>
        <span className='font-medium'>{t('Saytda texniki işlər aparılır')}</span>
        <p className='text-center text-muted-foreground'>
          {t('Sayt hazırda əlçatan deyil. Tezliklə yenidən işləyəcək.')}
        </p>
      </div>
    </div>
  )
}
