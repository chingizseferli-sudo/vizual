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
import { ForgotPasswordForm } from './components/forgot-password-form'
import { t } from '@/lib/i18n'

export function ForgotPassword() {
  return (
    <AuthLayout>
      <Card className='max-w-sm gap-4 sm:min-w-sm'>
        <CardHeader>
          <CardTitle className='text-lg tracking-tight'>{t("Şifrəni unutmusunuz?")}</CardTitle>
          <CardDescription>{t("Qeydiyyatdan keçdiyiniz email ünvanını yazın.")}{' '}<br />{t("Şifrənizi yeniləmək üçün bərpa linki göndərəcəyik.")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ForgotPasswordForm />
        </CardContent>
        <CardFooter>
          <p className='mx-auto px-8 text-center text-sm text-balance text-muted-foreground'>{t("Hesabınız yoxdur?")}{' '}
            <Link
              to='/sign-up'
              className='underline underline-offset-4 hover:text-primary'
            >{t("Hesab yaradın")}</Link>
            .
          </p>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
