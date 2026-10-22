import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
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
import { friendlyError } from '@/lib/friendly-error'
import { t } from '@/lib/i18n'

const formSchema = z.object({
  email: z.email({
    error: (iss) =>
      iss.input === '' ? t("Email ünvanınızı daxil edin.") : undefined,
  }),
})

export function ForgotPasswordForm({
  className,
  ...props
}: React.HTMLAttributes<HTMLFormElement>) {
  const [isLoading, setIsLoading] = useState(false)
  const captcha = useCaptcha()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: '' },
  })

  async function onSubmit(data: z.infer<typeof formSchema>) {
    if (captcha.missing) {
      toast.error(t("Təhlükəsizlik yoxlamasını tamamlayın."))
      return
    }
    setIsLoading(true)

    const { error } = await supabase.auth.resetPasswordForEmail(data.email, {
      redirectTo: `${window.location.origin}/reset-password`,
      ...captcha.options,
    })

    setIsLoading(false)
    captcha.reset()

    if (error) {
      toast.error(friendlyError(error))
      return
    }

    form.reset()
    toast.success(t("Şifrə bərpası üçün link email ünvanınıza göndərildi."))
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('grid gap-2', className)}
        {...props}
      >
        <FormField
          control={form.control}
          name='email'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("Email")}</FormLabel>
              <FormControl>
                <Input placeholder='name@example.com' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {captcha.widget}
        <Button className='mt-2' disabled={isLoading || captcha.missing}>
          {isLoading ? t("Email göndərilir...") : t("Bərpa linki göndər")}
          {isLoading ? <Loader2 className='animate-spin' /> : <ArrowRight />}
        </Button>
      </form>
    </Form>
  )
}
