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

export function SignUp() {
  return (
    <AuthLayout>
      <Card className='gap-4 rounded-3xl border-slate-200 bg-white/95 shadow-[0_28px_70px_rgba(22,42,84,0.16)]'>
        <CardHeader className='space-y-3'>
          <div className='inline-flex w-fit rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-[#1463ff]'>
            İstifadəçi qeydiyyatı
          </div>
          <CardTitle className='text-2xl font-black tracking-tight text-slate-950'>
            İş masası hesabı yaradın
          </CardTitle>
          <CardDescription className='leading-6'>
            Qeydiyyat yalnız istifadəçi iş masası üçündür. Admin hesabı bu
            formadan yaradılmır. Artıq hesabınız var?{' '}
            <Link
              to='/sign-in'
              className='font-semibold text-[#1463ff] underline underline-offset-4 hover:text-blue-700'
            >
              Daxil olun
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignUpForm />
        </CardContent>
        <CardFooter>
          <p className='px-2 text-center text-xs leading-5 text-muted-foreground'>
            Qeydiyyatdan sonra hesabınız email təsdiqi və profil statusuna uyğun
            aktivləşir. Plan və limitlər iş masasında göstərilir.
          </p>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
