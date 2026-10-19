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
import { OtpForm } from './components/otp-form'

export function Otp() {
  return (
    <AuthLayout>
      <Card className='max-w-md gap-4'>
        <CardHeader>
          <CardTitle className='text-base tracking-tight'>
            İki mərhələli təsdiq
          </CardTitle>
          <CardDescription>
            Email ünvanınıza göndərilən təsdiq kodunu daxil edin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OtpForm />
        </CardContent>
        <CardFooter>
          <p className='px-8 text-center text-sm text-muted-foreground'>
            Kod gəlməyib?{' '}
            <Link
              to='/sign-in'
              className='underline underline-offset-4 hover:text-primary'
            >
              Yenidən daxil olun.
            </Link>
          </p>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
