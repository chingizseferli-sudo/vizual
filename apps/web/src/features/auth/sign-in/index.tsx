import { Link } from '@tanstack/react-router'
import { ShieldCheck } from 'lucide-react'
import { usePublicSiteBrand } from '@/hooks/use-public-site-brand'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { BrandMark } from '@/components/brand-mark'
import { ThemeSwitch } from '@/components/theme-switch'
import { AuthLayout } from '../auth-layout'
import { UserAuthForm } from './components/user-auth-form'
import { t } from '@/lib/i18n'

type SignInProps = {
  mode?: 'customer' | 'admin'
  redirectTo?: string
}

type AdminAuthShellProps = {
  title: string
  description: string
  footer?: string
  children: React.ReactNode
}

// The admin sign-in page and its two-step login page share this frame.
export function AdminAuthShell({
  title,
  description,
  footer,
  children,
}: AdminAuthShellProps) {
  const { siteName, logoUrl, iconUrl } = usePublicSiteBrand()

  return (
    <main className='relative flex min-h-svh items-center justify-center bg-muted/30 px-4 py-10 text-foreground'>
      <div className='absolute top-4 right-4'>
        <ThemeSwitch />
      </div>
      <div className='w-full max-w-md'>
        <div className='mb-6 flex items-center justify-center gap-3'>
          <BrandMark
            logoUrl={logoUrl}
            iconUrl={iconUrl}
            siteName={siteName}
            variant='icon'
            className='size-11'
            imageClassName='size-11'
          />
          <div>
            <div className='text-lg font-semibold'>{siteName}</div>
            <div className='text-xs font-medium text-muted-foreground'>
              Admin panel
            </div>
          </div>
        </div>

        <Card className='rounded-lg shadow-none'>
          <CardHeader className='space-y-3'>
            <div className='grid size-9 place-items-center rounded-md bg-muted text-foreground'>
              <ShieldCheck className='size-4' />
            </div>
            <div>
              <CardTitle className='text-xl font-semibold tracking-tight'>
                {title}
              </CardTitle>
              <CardDescription className='mt-2 leading-6'>
                {description}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>{children}</CardContent>
          {footer && (
            <CardFooter>
              <p className='w-full text-center text-xs leading-5 text-muted-foreground'>
                {footer}
              </p>
            </CardFooter>
          )}
        </Card>

        <div className='mt-5 text-center text-sm text-muted-foreground'>
          <Link to='/' className='font-medium hover:text-foreground'>{t("Sayta qayıt")}</Link>
        </div>
      </div>
    </main>
  )
}

function AdminSignIn({ redirectTo }: { redirectTo?: string }) {
  return (
    <AdminAuthShell
      title={t("Admin panelə giriş")}
      description={t("Bu giriş yalnız admin və superadmin hesabları üçündür.")}
      footer={t("Admin icazəsi ayrıca yoxlanılır. İstifadəçi iş masası üçün ayrıca girişdən istifadə edin.")}
    >
      <UserAuthForm redirectTo={redirectTo} mode='admin' />
    </AdminAuthShell>
  )
}

export function SignIn({ mode = 'customer', redirectTo }: SignInProps) {
  if (mode === 'admin') {
    return <AdminSignIn redirectTo={redirectTo} />
  }

  return (
    <AuthLayout>
      <Card className='gap-4 rounded-lg shadow-none'>
        <CardHeader className='space-y-3'>
          <div className='text-xs font-medium text-muted-foreground'>{t("İstifadəçi iş masası")}</div>
          <CardTitle className='text-xl font-semibold tracking-tight text-foreground'>{t("Hesabınıza daxil olun")}</CardTitle>
          <CardDescription className='leading-6'>{t("Monitorlarınızı, nəticələri və bildirişləri görmək üçün email və şifrənizi yazın. Hesabınız yoxdur?")}{' '}
            <Link
              to='/sign-up'
              className='font-medium text-primary underline underline-offset-4 hover:opacity-80'
            >{t("Hesab yaradın")}</Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UserAuthForm redirectTo={redirectTo} mode='customer' />
        </CardContent>
        <CardFooter className='flex-col gap-2 border-t pt-4'>
          <p className='text-sm text-muted-foreground'>{t("Hesabınız yoxdur?")}</p>
          <Link
            to='/sign-up'
            className='inline-flex h-10 w-full items-center justify-center rounded-md border border-input bg-background text-sm font-medium text-foreground transition-colors hover:bg-muted'
          >{t("Qeydiyyatdan keçin")}</Link>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
