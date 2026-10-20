import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, UserPlus } from 'lucide-react'
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
import { t } from '@/lib/i18n'

const formSchema = z
  .object({
    email: z.email({
      error: (iss) =>
        iss.input === '' ? t("Email ünvanınızı daxil edin.") : undefined,
    }),
    password: z
      .string()
      .min(1, t("Şifrənizi daxil edin."))
      .min(7, t("Şifrə ən azı 7 simvol olmalıdır.")),
    confirmPassword: z.string().min(1, t("Şifrənizi təsdiqləyin.")),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: t("Şifrələr uyğun gəlmir."),
    path: ['confirmPassword'],
  })

export function SignUpForm({
  className,
  ...props
}: React.HTMLAttributes<HTMLFormElement>) {
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      password: '',
      confirmPassword: '',
    },
  })

  async function onSubmit(data: z.infer<typeof formSchema>) {
    setIsLoading(true)

    const { data: signUpData, error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/sign-in`,
      },
    })

    if (error) {
      setIsLoading(false)
      toast.error(getAuthErrorMessage(error.message))
      return
    }

    setIsLoading(false)

    if (signUpData.session) {
      toast.success(
        t("Müraciətiniz göndərildi. Admin təsdiqindən sonra hesabınız aktiv olacaq.")
      )
      await navigate({ to: '/monitor', replace: true })
      return
    }

    toast.success(
      t(
        "Müraciətiniz göndərildi. Emailinizi təsdiqləyin; admin təsdiqindən sonra hesabınız aktiv olacaq."
      )
    )
    await navigate({ to: '/sign-in', replace: true })
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
            <FormItem>
              <FormLabel>{t("Şifrə")}</FormLabel>
              <FormControl>
                <PasswordInput
                  placeholder='••••••••'
                  autoComplete='new-password'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='confirmPassword'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("Şifrəni təsdiqləyin")}</FormLabel>
              <FormControl>
                <PasswordInput
                  placeholder='••••••••'
                  autoComplete='new-password'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          className='mt-2 h-11 bg-[#1463ff] font-bold hover:bg-blue-700'
          disabled={isLoading}
        >
          {isLoading ? <Loader2 className='animate-spin' /> : <UserPlus />}
          {isLoading ? t("Hesab yaradılır...") : t("İş masası hesabı yarat")}
        </Button>
      </form>
    </Form>
  )
}
