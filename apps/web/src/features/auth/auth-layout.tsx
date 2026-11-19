import { Link } from '@tanstack/react-router'
import { ShieldCheck, Sparkles } from 'lucide-react'
import { usePublicSiteBrand } from '@/hooks/use-public-site-brand'
import { BrandMark } from '@/components/brand-mark'
import { ThemeSwitch } from '@/components/theme-switch'
import { LanguageSwitcher } from '@/components/language-switcher'
import { t } from '@/lib/i18n'

type AuthLayoutProps = {
  children: React.ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  const { siteName, logoUrl, iconUrl } = usePublicSiteBrand()

  return (
    <main className='relative min-h-svh bg-muted/30 text-foreground'>
      {/* Phones: brand on the left, switchers on the right, in the page flow.
          Desktop: a back link and the switchers float over the corners. */}
      <div className='relative z-10 flex items-center justify-between gap-2 px-4 pt-4 lg:absolute lg:inset-x-0 lg:top-0'>
        <Link
          to='/'
          aria-label={siteName}
          className='flex min-w-0 items-center gap-2.5 lg:hidden'
        >
          <BrandMark
            logoUrl={logoUrl}
            iconUrl={iconUrl}
            siteName={siteName}
            variant='icon'
            className='size-9 shrink-0'
            imageClassName='size-9'
          />
          <span className='truncate font-semibold text-foreground'>
            {siteName}
          </span>
        </Link>
        <Link
          to='/'
          className='hidden h-9 items-center rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground lg:inline-flex'
        >{t("← Sayta qayıt")}</Link>
        <div className='flex shrink-0 items-center gap-2'>
          <LanguageSwitcher />
          <ThemeSwitch />
        </div>
      </div>
      <div className='mx-auto grid max-w-7xl gap-8 px-4 pb-6 pt-2 md:px-6 lg:min-h-svh lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-10'>
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
              <Sparkles className='h-4 w-4' />{t("Kommunikasiya və Media Monitorinq Platforması")}</div>
            <h1 className='mt-6 text-4xl font-semibold tracking-tight text-foreground'>{t("Adınız xəbərə düşəndə ilk siz bilin.")}</h1>
            <p className='mt-5 text-lg leading-8 text-muted-foreground'>{t("Açar sözlərinizi, nəticələri və bildirişləri bir yerdə izləyin.")}</p>
          </div>

          <div className='mt-10 grid max-w-xl gap-3'>
            {[
              t("Media materialları açar sözlər üzrə izlənir"),
              t("Bildirişlər və nəticələr istifadəçi hesabına bağlıdır"),
              t("Admin və istifadəçi sahələri ayrı qorunur"),
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

        <section className='flex items-start justify-center pt-6 sm:min-h-[calc(100svh-5rem)] sm:items-center sm:pt-0 lg:min-h-0'>
          <div className='w-full max-w-md'>
            {children}
          </div>
        </section>
      </div>
    </main>
  )
}
