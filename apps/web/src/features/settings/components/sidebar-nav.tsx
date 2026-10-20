import { type JSX } from 'react'
import { useLocation, useNavigate, Link } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type SidebarNavProps = React.HTMLAttributes<HTMLElement> & {
  items: {
    href: string
    title: string
    icon: JSX.Element
  }[]
}

export function SidebarNav({ className, items, ...props }: SidebarNavProps) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  // Routes are reached both as /admin/settings and /admin/settings/.
  const trim = (path: string) => path.replace(/\/+$/, '')
  const activeHref =
    items.find((item) => trim(item.href) === trim(pathname))?.href ?? ''

  const handleSelect = (href: string) => {
    navigate({ to: href })
  }

  return (
    <>
      <div className='p-1 md:hidden'>
        <Select value={activeHref} onValueChange={handleSelect}>
          <SelectTrigger
            aria-label='Tənzimləmə bölməsi'
            className='h-12 w-full sm:w-64'
          >
            <SelectValue placeholder='Bölmə seçin' />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.href} value={item.href}>
                <div className='flex gap-x-4 px-2 py-1'>
                  <span className='scale-125'>{item.icon}</span>
                  <span className='text-md'>{item.title}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className='hidden w-full bg-background px-1 py-2 md:block'>
        <nav
          className={cn(
            'flex flex-wrap gap-1 py-1 lg:flex-col lg:flex-nowrap',
            className
          )}
          {...props}
        >
          {items.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                buttonVariants({ variant: 'ghost' }),
                item.href === activeHref
                  ? 'bg-muted hover:bg-accent'
                  : 'hover:bg-accent hover:underline',
                'justify-start'
              )}
            >
              <span className='me-2'>{item.icon}</span>
              {item.title}
            </Link>
          ))}
        </nav>
      </div>
    </>
  )
}
