import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { KeyRound, Loader2 } from 'lucide-react'
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
import { PasswordInput } from '@/components/password-input'
import { getAuthErrorMessage } from '../../auth-messages'

const SUCCESS_MESSAGE = 'Şifrəniz uğurla yeniləndi.'

const formSchema = z
  .object({
    password: z
      .string()
      .min(1, 'Şifrənizi daxil edin.')
      .min(7, 'Şifrə ən azı 7 simvol olmalıdır.'),
    confirmPassword: z.string().min(1, 'Şifrənizi təsdiqləyin.'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Şifrələr uyğun gəlmir.',
    path: ['confirmPassword'],
  })

export function ResetPasswordForm({
  className,
  ...props
}: React.HTMLAttributes<HTMLFormElement>) {
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      password: '',
      confirmPassword: '',
    },
  })

  async function onSubmit(data: z.infer<typeof formSchema>) {
    setIsLoading(true)

    const { error } = await supabase.auth.updateUser({
      password: data.password,
    })

    setIsLoading(false)

    if (error) {
      toast.error(getAuthErrorMessage(error.message))
      return
    }

    toast.success(SUCCESS_MESSAGE)
    await navigate({ to: '/sign-in', replace: true })
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('grid gap-3', className)}
        {...props}
      >
        <FormField
          control={form.control}
          name='password'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Yeni şifrə</FormLabel>
              <FormControl>
                <PasswordInput placeholder='********' {...field} />
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
              <FormLabel>Şifrəni təsdiqləyin</FormLabel>
              <FormControl>
                <PasswordInput placeholder='********' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button className='mt-2' disabled={isLoading}>
          {isLoading ? <Loader2 className='animate-spin' /> : <KeyRound />}
          {isLoading ? 'Şifrə yenilənir...' : 'Şifrəni yenilə'}
        </Button>
      </form>
    </Form>
  )
}
