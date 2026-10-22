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
import { SignUpForm } from './components/sign-up-form'
import { t } from '@/lib/i18n'

export function SignUp() {
  return (
    <AuthLayout>
      <Card className='gap-4 rounded-lg shadow-none'>
        <CardHeader className='space-y-3'>
          <div className='text-xs font-medium text-muted-foreground'>{t("İstifadəçi qeydiyyatı")}</div>
          <CardTitle className='text-xl font-semibold tracking-tight text-foreground'>{t("İş masası hesabı yaradın")}</CardTitle>
          <CardDescription className='leading-6'>{t("Qeydiyyat yalnız istifadəçi iş masası üçündür. Admin hesabı bu formadan yaradılmır. Artıq hesabınız var?")}{' '}
            <Link
              to='/sign-in'
              className='font-medium text-primary underline underline-offset-4 hover:opacity-80'
            >{t("Daxil olun")}</Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignUpForm />
        </CardContent>
        <CardFooter className='flex-col gap-2 border-t pt-4'>
          <p className='text-sm text-muted-foreground'>{t("Artıq hesabınız var?")}</p>
          <Link
            to='/sign-in'
            className='inline-flex h-10 w-full items-center justify-center rounded-md border border-input bg-background text-sm font-medium text-foreground transition-colors hover:bg-muted'
          >{t("Daxil olun")}</Link>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
