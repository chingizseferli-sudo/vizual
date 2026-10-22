import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Copy, Loader2, LogOut, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { getAdminMfaState } from '@/lib/admin-mfa'
import { t } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '@/components/ui/input-otp'
import { AdminAuthShell } from '../sign-in'

type Enrollment = {
  factorId: string
  qrCode: string
  secret: string
}

type Step =
  | { kind: 'loading' }
  | { kind: 'enroll'; enrollment: Enrollment }
  | { kind: 'challenge'; factorId: string }
  | { kind: 'error'; message: string }

function safeAdminRedirect(redirectTo: string | undefined) {
  return redirectTo &&
    redirectTo.startsWith('/admin') &&
    !redirectTo.startsWith('/admin/sign-in') &&
    !redirectTo.startsWith('/admin/mfa')
    ? redirectTo
    : '/admin'
}

// Starts a fresh authenticator setup. Factors left unverified by an earlier,
// abandoned setup are removed first; they cannot be used to sign in.
async function startEnrollment(): Promise<Enrollment> {
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors()
  if (listError) throw listError
  for (const factor of factors.all) {
    if (factor.factor_type === 'totp' && factor.status === 'unverified') {
      await supabase.auth.mfa.unenroll({ factorId: factor.id })
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    // Names must be unique per user; React may run this twice in development.
    friendlyName: `Vizual admin ${Date.now().toString(36)}`,
  })
  if (error) throw error
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret }
}

async function verifiedFactorId() {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) throw error
  const factor = data.totp.find((item) => item.status === 'verified')
  if (!factor) throw new Error('No verified authenticator')
  return factor.id
}

// Stays enabled while a code is checked: disabling it drops focus, and after
// a wrong code the admin should be able to type the next one straight away.
function CodeInput({
  value,
  onChange,
  inputRef,
}: {
  value: string
  onChange: (value: string) => void
  inputRef: React.Ref<HTMLInputElement>
}) {
  return (
    <InputOTP
      ref={inputRef}
      maxLength={6}
      value={value}
      onChange={onChange}
      inputMode='numeric'
      pattern='^[0-9]*$'
      autoComplete='one-time-code'
      autoFocus
      containerClassName='justify-center'
    >
      <InputOTPGroup>
        <InputOTPSlot index={0} />
        <InputOTPSlot index={1} />
        <InputOTPSlot index={2} />
      </InputOTPGroup>
      <InputOTPSeparator />
      <InputOTPGroup>
        <InputOTPSlot index={3} />
        <InputOTPSlot index={4} />
        <InputOTPSlot index={5} />
      </InputOTPGroup>
    </InputOTP>
  )
}

export function AdminMfa({ redirectTo }: { redirectTo?: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>({ kind: 'loading' })
  const [code, setCode] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)
  const codeInputRef = useRef<HTMLInputElement>(null)
  const target = safeAdminRedirect(redirectTo)

  useEffect(() => {
    let mounted = true

    async function load() {
      const { data } = await supabase.auth.getSession()
      if (!data.session) {
        await navigate({ to: '/admin/sign-in', search: { redirect: target }, replace: true })
        return
      }
      const state = await getAdminMfaState()
      if (state === 'verified') {
        await navigate({ to: target, replace: true })
        return
      }
      const next: Step =
        state === 'challenge'
          ? { kind: 'challenge', factorId: await verifiedFactorId() }
          : { kind: 'enroll', enrollment: await startEnrollment() }
      if (mounted) setStep(next)
    }

    load().catch((error: unknown) => {
      console.error('Admin MFA load error:', error)
      if (mounted) {
        setStep({
          kind: 'error',
          message: t("İki addımlı girişi yükləmək mümkün olmadı. Səhifəni yeniləyin."),
        })
      }
    })

    return () => {
      mounted = false
    }
  }, [navigate, target])

  async function verify(factorId: string) {
    if (code.length !== 6) return
    setIsVerifying(true)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
    setIsVerifying(false)
    if (error) {
      setCode('')
      codeInputRef.current?.focus()
      toast.error(t("Kod yanlışdır və ya vaxtı keçib. Tətbiqdəki yeni kodu yazın."))
      return
    }
    // Admin data loaded before the two-step check was refused by the database.
    queryClient.clear()
    toast.success(t("Giriş təsdiqləndi."))
    await navigate({ to: target, replace: true })
  }

  async function signOut() {
    await supabase.auth.signOut()
    queryClient.clear()
    await navigate({ to: '/admin/sign-in', replace: true })
  }

  async function copySecret(secret: string) {
    try {
      await navigator.clipboard.writeText(secret)
      toast.success(t("Açar kopyalandı."))
    } catch {
      toast.error(t("Kopyalamaq mümkün olmadı, açarı əl ilə yazın."))
    }
  }

  const isEnroll = step.kind === 'enroll'
  const factorId =
    step.kind === 'enroll'
      ? step.enrollment.factorId
      : step.kind === 'challenge'
        ? step.factorId
        : null

  return (
    <AdminAuthShell
      title={isEnroll ? t("İki addımlı girişi qurun") : t("İki addımlı giriş")}
      description={
        isEnroll
          ? t("Admin panel üçün telefonunuzda autentifikator tətbiqi (Google Authenticator, Microsoft Authenticator və s.) lazımdır. Bunu bir dəfə qurursunuz.")
          : t("Telefonunuzdakı autentifikator tətbiqində göstərilən 6 rəqəmli kodu yazın.")
      }
    >
      {step.kind === 'loading' && (
        <div className='flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground'>
          <Loader2 className='size-4 animate-spin' />
          {t("Yoxlanılır...")}
        </div>
      )}

      {step.kind === 'error' && (
        <p className='rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive'>
          {step.message}
        </p>
      )}

      {factorId && (
        <form
          className='grid gap-5'
          onSubmit={(event) => {
            event.preventDefault()
            void verify(factorId)
          }}
        >
          {step.kind === 'enroll' && (
            <ol className='grid gap-4 text-sm'>
              <li className='grid gap-3'>
                <span>
                  <span className='font-semibold'>1.</span>{' '}
                  {t("Tətbiqdə \"+\" düyməsini basın və bu QR kodu skan edin.")}
                </span>
                <img
                  src={step.enrollment.qrCode}
                  alt={t("İki addımlı giriş üçün QR kod")}
                  className='mx-auto size-44 rounded-md border bg-white p-2'
                />
                <div className='grid gap-1'>
                  <span className='text-xs text-muted-foreground'>
                    {t("Skan alınmırsa, bu açarı əl ilə yazın:")}
                  </span>
                  <div className='flex items-center gap-2'>
                    <code className='min-w-0 flex-1 rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all'>
                      {step.enrollment.secret}
                    </code>
                    <Button
                      type='button'
                      variant='outline'
                      size='icon'
                      className='size-8 shrink-0'
                      aria-label={t("Açarı kopyala")}
                      onClick={() => void copySecret(step.enrollment.secret)}
                    >
                      <Copy className='size-4' />
                    </Button>
                  </div>
                </div>
              </li>
              <li>
                <span className='font-semibold'>2.</span>{' '}
                {t("Tətbiqdə görünən 6 rəqəmli kodu aşağıya yazın.")}
              </li>
            </ol>
          )}

          <CodeInput value={code} onChange={setCode} inputRef={codeInputRef} />

          <Button className='h-10 font-medium' disabled={isVerifying || code.length !== 6}>
            {isVerifying ? <Loader2 className='animate-spin' /> : <ShieldCheck />}
            {isVerifying ? t("Yoxlanılır...") : t("Təsdiqlə")}
          </Button>
        </form>
      )}

      <Button
        type='button'
        variant='ghost'
        className='mt-3 w-full text-muted-foreground'
        onClick={() => void signOut()}
      >
        <LogOut className='size-4' />
        {t("Başqa hesabla daxil ol")}
      </Button>
    </AdminAuthShell>
  )
}
