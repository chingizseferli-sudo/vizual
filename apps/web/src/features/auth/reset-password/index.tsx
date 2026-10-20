import { Link } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AuthLayout } from '../auth-layout'
import { ResetPasswordForm } from './components/reset-password-form'
import { t } from '@/lib/i18n'

export function ResetPassword() {
  return (
    <AuthLayout>
      <Card className='max-w-sm gap-4 sm:min-w-sm'>
        <CardHeader>
          <CardTitle className='text-lg tracking-tight'>{t("Şifrəni yenilə")}</CardTitle>
          <CardDescription>{t("Hesabınıza yenidən giriş üçün yeni şifrənizi yazın və təsdiqləyin.")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ResetPasswordForm />
        </CardContent>
        <CardFooter>
          <p className='mx-auto px-8 text-center text-sm text-balance text-muted-foreground'>{t("Şifrənizi xatırladınız?")}{' '}
            <Link
              to='/sign-in'
              className='underline underline-offset-4 hover:text-primary'
            >{t("Daxil olun")}</Link>
            .
          </p>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
