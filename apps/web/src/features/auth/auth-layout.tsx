import { Link } from '@tanstack/react-router'
import { ShieldCheck, Sparkles } from 'lucide-react'
import { usePublicSiteBrand } from '@/hooks/use-public-site-brand'
import { BrandMark } from '@/components/brand-mark'
import { ThemeSwitch } from '@/components/theme-switch'

type AuthLayoutProps = {
  children: React.ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  const { siteName, logoUrl, iconUrl } = usePublicSiteBrand()

  return (
    <main className='relative min-h-svh bg-muted/30 text-foreground'>
      <div className='absolute top-4 right-4 z-10'>
        <ThemeSwitch />
      </div>
      <div className='mx-auto grid min-h-svh max-w-7xl gap-8 px-4 py-6 md:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-10'>
        <section className='hidden lg:block'>
          <Link
            to='/'
            className='inline-flex items-center gap-3 font-semibold text-foreground'
          >
            <BrandMark
              logoUrl={logoUrl}
              iconUrl={iconUrl}
              siteName={siteName}
              imageClassName='h-11'
            />
          </Link>

          <div className='mt-16 max-w-xl'>
            <div className='inline-flex items-center gap-2 text-sm font-medium text-muted-foreground'>
              <Sparkles className='h-4 w-4' />
              Kommunikasiya və Media Monitorinq Platforması
            </div>
            <h1 className='mt-6 text-4xl font-semibold tracking-tight text-foreground'>
              İzləyin. Anlayın. Qərar verin.
            </h1>
            <p className='mt-5 text-lg leading-8 text-muted-foreground'>
              İstifadəçi iş masasına təhlükəsiz giriş edin, monitorlarınızı,
              nəticələri və bildirişləri bir yerdə izləyin.
            </p>
          </div>

          <div className='mt-10 grid max-w-xl gap-3'>
            {[
              'Media materialları açar sözlər üzrə izlənir',
              'Bildirişlər və nəticələr istifadəçi hesabına bağlıdır',
              'Admin və istifadəçi sahələri ayrı qorunur',
            ].map((item) => (
              <div
                key={item}
                className='flex items-center gap-3 border-b border-border py-3'
              >
                <ShieldCheck className='size-4 text-muted-foreground' />
                <span className='text-sm font-medium text-foreground'>
                  {item}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className='flex min-h-[calc(100svh-3rem)] items-center justify-center lg:min-h-0'>
          <div className='w-full max-w-md'>
            <div className='mb-6 flex items-center justify-center gap-3 lg:hidden'>
              <BrandMark
                logoUrl={logoUrl}
                iconUrl={iconUrl}
                siteName={siteName}
                variant='icon'
                className='size-10'
                imageClassName='size-10'
              />
              <div>
                <div className='font-semibold text-foreground'>{siteName}</div>
                <div className='text-xs text-muted-foreground'>
                  İstifadəçi girişi
                </div>
              </div>
            </div>
            {children}
          </div>
        </section>
      </div>
    </main>
  )
}
