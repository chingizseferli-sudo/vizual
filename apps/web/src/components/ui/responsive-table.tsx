import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type ResponsiveTableProps = {
  children: ReactNode
  label: string
  mobileLayout?: 'cards' | 'scroll'
  className?: string
}

/** Keep real table markup and row actions; labelled cells become cards on mobile. */
export function ResponsiveTable({
  children,
  label,
  mobileLayout = 'scroll',
  className,
}: ResponsiveTableProps) {
  return (
    <div
      className={cn(
        'responsive-table min-w-0 rounded-xl border bg-card',
        className
      )}
      data-mobile-layout={mobileLayout}
    >
      {mobileLayout === 'scroll' && (
        <p className='border-b px-3 py-2 text-xs text-muted-foreground md:hidden'>
          Bütün sütunları görmək üçün cədvəli yana sürüşdürün.
        </p>
      )}
      <div
        className='responsive-table-scroll'
        role='region'
        aria-label={label}
        tabIndex={0}
      >
        {children}
      </div>
    </div>
  )
}
