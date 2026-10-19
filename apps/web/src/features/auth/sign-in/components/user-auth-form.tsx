import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from '@tanstack/react-router'
import { Loader2, LogIn } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/password-input'
import { getAuthErrorMessage } from '../../auth-messages'

const formSchema = z.object({
  email: z.email({
    error: (iss) =>
      iss.input === '' ? 'Email ünvanınızı daxil edin.' : undefined,
  }),
  password: z
    .string()
    .min(1, 'Şifrənizi daxil edin.')
    .min(7, 'Şifrə ən azı 7 simvol olmalıdır.'),
})

type AuthMode = 'customer' | 'admin'

interface UserAuthFormProps extends React.HTMLAttributes<HTMLFormElement> {
  redirectTo?: string
  mode?: AuthMode
}

type SupabaseQueryError = {
  code?: string | null
  message?: string | null
}

type UserProfile = {
  user_id: string
  email: string | null
  role: string | null
  status: string | null
}

function isAdminRole(role: string) {
  return role === 'admin' || role === 'superadmin'
}

function isMissingAdminUsersTable(error: SupabaseQueryError | null) {
  return (
    error?.code === '42P01' ||
    error?.code === 'PGRST205' ||
    error?.message?.includes('admin_users') === true
  )
}

function getSafeRedirect(mode: AuthMode, redirectTo: string | undefined) {
  if (mode === 'admin') {
    return redirectTo &&
      redirectTo.startsWith('/admin') &&
      redirectTo !== '/admin/sign-in'
      ? redirectTo
      : '/admin'
  }

  return redirectTo && redirectTo.startsWith('/monitor')
    ? redirectTo
    : '/monitor'
}

async function loadLoginProfile(mode: AuthMode, userId: string) {
  if (mode === 'admin') {
    const { data, error } = await supabase
      .from('admin_users')
      .select('user_id,email,role,status')
      .eq('user_id', userId)
      .maybeSingle()

    if (isMissingAdminUsersTable(error)) {
      const fallback = await supabase
        .from('user_profiles')
        .select('user_id,email,role,status')
        .eq('user_id', userId)
        .maybeSingle()

      return {
        profile: fallback.data as UserProfile | null,
        error: fallback.error,
      }
    }

    return { profile: data as UserProfile | null, error }
  }

  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id,email,role,status')
    .eq('user_id', userId)
    .maybeSingle()

  return { profile: data as UserProfile | null, error }
}

export function UserAuthForm({
  className,
  redirectTo,
  mode = 'customer',
  ...props
}: UserAuthFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  async function onSubmit(data: z.infer<typeof formSchema>) {
    setIsLoading(true)

    const { data: authData, error: signInError } =
      await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      })

    if (signInError || !authData.user) {
      setIsLoading(false)
      toast.error(getAuthErrorMessage(signInError?.message))
      return
    }

    const { profile, error: profileError } = await loadLoginProfile(
      mode,
      authData.user.id
    )

    if (profileError || !profile) {
      await supabase.auth.signOut()
      setIsLoading(false)
      toast.error(
        mode === 'admin'
          ? 'Admin icazəsi tapılmadı.'
          : 'İstifadəçi profili tapılmadı. Adminlə əlaqə saxlayın.'
      )
      return
    }

    if (profile.status === 'blocked' || profile.status === 'inactive') {
      await supabase.auth.signOut()
      setIsLoading(false)
      toast.error('Hesab aktiv deyil.')
      return
    }

    const role = profile.role || 'customer'

    if (mode === 'admin' && !isAdminRole(role)) {
      await supabase.auth.signOut()
      setIsLoading(false)
      toast.error('Bu giriş yalnız admin hesabları üçündür.')
      return
    }

    const safeRedirect = getSafeRedirect(mode, redirectTo)

    setIsLoading(false)
    toast.success('Giriş uğurludur.')
    await navigate({
      to: safeRedirect,
      replace: true,
    })
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('grid gap-4', className)}
        {...props}
      >
        <FormField
          control={form.control}
          name='email'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  inputMode='email'
                  placeholder='name@example.com'
                  autoComplete='email'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='password'
          render={({ field }) => (
            <FormItem className='relative'>
              <FormLabel>Şifrə</FormLabel>
              <FormControl>
                <PasswordInput
                  placeholder='••••••••'
                  autoComplete='current-password'
                  {...field}
                />
              </FormControl>
              <FormMessage />
              <Link
                to='/forgot-password'
                className='absolute inset-e-0 -top-0.5 text-sm font-medium text-muted-foreground hover:text-foreground'
              >
                Şifrəni unutmusunuz?
              </Link>
            </FormItem>
          )}
        />
        <Button className='mt-2 h-10 font-medium' disabled={isLoading}>
          {isLoading ? <Loader2 className='animate-spin' /> : <LogIn />}
          {isLoading ? 'Daxil olunur...' : 'Daxil ol'}
        </Button>
      </form>
    </Form>
  )
}
