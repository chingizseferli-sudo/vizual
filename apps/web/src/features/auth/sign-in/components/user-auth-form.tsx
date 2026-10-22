import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Loader2, LogIn } from 'lucide-react'
import { toast } from 'sonner'
import { adminMfaPath } from '@/lib/admin-mfa'
import { supabase } from '@/lib/supabase'
import { useCaptcha } from '@/hooks/use-captcha'
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
import { t } from '@/lib/i18n'

const formSchema = z.object({
  email: z.email({
    error: (iss) =>
      iss.input === '' ? t("Email ünvanınızı daxil edin.") : undefined,
  }),
  password: z
    .string()
    .min(1, t("Şifrənizi daxil edin."))
    .min(7, t("Şifrə ən azı 7 simvol olmalıdır.")),
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
  const captcha = useCaptcha()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  async function onSubmit(data: z.infer<typeof formSchema>) {
    if (captcha.missing) {
      toast.error(t("Təhlükəsizlik yoxlamasını tamamlayın."))
      return
    }
    setIsLoading(true)

    const { data: authData, error: signInError } =
      await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
        ...(captcha.token ? { options: captcha.options } : {}),
      })
    captcha.reset()

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
          ? t("Admin icazəsi tapılmadı.")
          : t("İstifadəçi profili tapılmadı. Adminlə əlaqə saxlayın.")
      )
      return
    }

    if (profile.status === 'rejected') {
      await supabase.auth.signOut()
      setIsLoading(false)
      toast.error(t("Qeydiyyat müraciətiniz təsdiqlənmədi. Bizimlə əlaqə saxlayın."))
      return
    }

    if (profile.status === 'blocked' || profile.status === 'inactive') {
      await supabase.auth.signOut()
      setIsLoading(false)
      toast.error(t("Hesab aktiv deyil."))
      return
    }

    const role = profile.role || 'customer'

    if (mode === 'admin' && !isAdminRole(role)) {
      await supabase.auth.signOut()
      setIsLoading(false)
      toast.error(t("Bu giriş yalnız admin hesabları üçündür."))
      return
    }

    const safeRedirect = getSafeRedirect(mode, redirectTo)

    // Anything cached before this sign-in (an empty or failed load from the
    // signed-out page, or another account's data) must not be shown now.
    queryClient.clear()
    setIsLoading(false)

    // The password is only the first step for admins: the database grants
    // admin rights to two-step (aal2) sessions only.
    if (mode === 'admin') {
      await navigate(adminMfaPath(safeRedirect))
      return
    }

    toast.success(t("Giriş uğurludur."))
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
              <FormLabel>{t("Email")}</FormLabel>
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
              <FormLabel>{t("Şifrə")}</FormLabel>
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
              >{t("Şifrəni unutmusunuz?")}</Link>
            </FormItem>
          )}
        />
        {captcha.widget}
        <Button
          className='mt-2 h-10 font-medium'
          disabled={isLoading || captcha.missing}
        >
          {isLoading ? <Loader2 className='animate-spin' /> : <LogIn />}
          {isLoading ? t("Daxil olunur...") : t("Daxil ol")}
        </Button>
      </form>
    </Form>
  )
}
