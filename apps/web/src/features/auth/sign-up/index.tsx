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
        <CardFooter>
          <p className='px-2 text-center text-xs leading-5 text-muted-foreground'>{t("Qeydiyyatdan sonra hesabınız email təsdiqi və profil statusuna uyğun aktivləşir. Plan və limitlər iş masasında göstərilir.")}</p>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
