import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

type HeaderProps = React.HTMLAttributes<HTMLElement> & {
  fixed?: boolean
  ref?: React.Ref<HTMLElement>
}

export function Header({ className, fixed, children, ...props }: HeaderProps) {
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    const onScroll = () => {
      setOffset(document.body.scrollTop || document.documentElement.scrollTop)
    }

    // Add scroll listener to the body
    document.addEventListener('scroll', onScroll, { passive: true })

    // Clean up the event listener on unmount
    return () => document.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={cn(
        'z-30 h-14 shrink-0 border-b bg-background',
        fixed && 'header-fixed peer/header sticky top-0 w-full',
        offset > 10 && fixed ? 'shadow-xs' : 'shadow-none',
        className
      )}
      {...props}
    >
      <div
        className={cn(
          'relative flex h-full min-w-0 items-center gap-3 px-4 sm:gap-4'
        )}
      >
        <SidebarTrigger variant='ghost' className='size-11 shrink-0' />
        <Separator orientation='vertical' className='h-6' />
        {children}
      </div>
    </header>
  )
}
