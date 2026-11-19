import { useState, type FormEvent } from 'react'
import { CheckCircle2, Loader2, Send } from 'lucide-react'
import { getLang, t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { submitFeedback, type FeedbackInput } from '@/lib/supabase-lazy'

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const emptyForm = {
  kind: 'suggestion' as FeedbackInput['kind'],
  name: '',
  email: '',
  message: '',
  website: '',
}

type FormValues = typeof emptyForm

// Mirrors the checks on public.feedback_messages.
function validate(values: FormValues) {
  const message = values.message.trim()
  if (message.length < 5) return t('Fikrinizi bir neçə sözlə yazın.')
  const email = values.email.trim()
  if (email && !EMAIL_PATTERN.test(email))
    return t('Düzgün email ünvanı yazın.')
  return ''
}

const inputClass =
  'mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-[#1463ff] focus:ring-2 focus:ring-blue-100'

export function FeedbackForm() {
  const [values, setValues] = useState<FormValues>(emptyForm)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  const update =
    (field: keyof FormValues) =>
    (event: { target: { value: string } }) =>
      setValues((current) => ({ ...current, [field]: event.target.value }))

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const problem = validate(values)
    setError(problem)
    if (problem) return

    setSending(true)
    const result = await submitFeedback({
      ...values,
      name: values.name.trim(),
      email: values.email.trim(),
      message: values.message.trim(),
      page: window.location.pathname,
      lang: getLang(),
    })
    setSending(false)

    if (result === 'ok') {
      setSent(true)
      setValues(emptyForm)
    } else {
      setError(
        result === 'rate_limited'
          ? t('Bu gün çox mesaj göndərilib. Bir az sonra yenidən yazın.')
          : t('Mesaj göndərilmədi. Bir az sonra yenidən cəhd edin.')
      )
    }
  }

  if (sent) {
    return (
      <div className='rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900'>
        <CheckCircle2 className='h-6 w-6 text-emerald-600' />
        <p className='mt-3 font-extrabold'>{t('Təşəkkür edirik!')}</p>
        <p className='mt-1 text-sm leading-6'>
          {t('Mesajınızı aldıq və mütləq oxuyacağıq.')}
        </p>
        <button
          type='button'
          onClick={() => setSent(false)}
          className='mt-4 text-sm font-bold text-emerald-800 underline underline-offset-4'
        >
          {t('Yeni mesaj')}
        </button>
      </div>
    )
  }

  const kinds: { value: FeedbackInput['kind']; label: string }[] = [
    { value: 'suggestion', label: t('Təklif') },
    { value: 'complaint', label: t('İrad') },
  ]

  return (
    <form onSubmit={handleSubmit} noValidate className='grid gap-4'>
      <div
        role='radiogroup'
        aria-label={t('Mesajın növü')}
        className='inline-flex w-fit rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm font-bold'
      >
        {kinds.map((kind) => (
          <button
            key={kind.value}
            type='button'
            role='radio'
            aria-checked={values.kind === kind.value}
            onClick={() =>
              setValues((current) => ({ ...current, kind: kind.value }))
            }
            className={cn(
              'rounded-md px-4 py-1.5 transition-colors',
              values.kind === kind.value
                ? 'bg-white text-slate-950 shadow-sm'
                : 'text-slate-500 hover:text-slate-900'
            )}
          >
            {kind.label}
          </button>
        ))}
      </div>
      <label className='text-sm font-bold text-slate-800'>
        {t('Mesajınız')}
        <textarea
          className={`${inputClass} min-h-28 resize-y`}
          value={values.message}
          onChange={update('message')}
          maxLength={2000}
          required
          placeholder={t('Nəyi yaxşılaşdıraq? Nə çatışmır?')}
        />
      </label>
      <div className='grid gap-4 sm:grid-cols-2'>
        <label className='text-sm font-bold text-slate-800'>
          {t('Adınız')}{' '}
          <span className='font-medium text-slate-400'>
            ({t('istəyə bağlı')})
          </span>
          <input
            className={inputClass}
            value={values.name}
            onChange={update('name')}
            autoComplete='name'
            maxLength={120}
          />
        </label>
        <label className='text-sm font-bold text-slate-800'>
          {t('Email')}{' '}
          <span className='font-medium text-slate-400'>
            ({t('cavab istəyirsinizsə')})
          </span>
          <input
            className={inputClass}
            type='email'
            value={values.email}
            onChange={update('email')}
            autoComplete='email'
            maxLength={254}
          />
        </label>
      </div>
      {/* Honeypot: hidden from people and screen readers. */}
      <input
        type='text'
        name='website'
        value={values.website}
        onChange={update('website')}
        tabIndex={-1}
        autoComplete='off'
        aria-hidden='true'
        className='absolute -left-[9999px] h-px w-px opacity-0'
      />
      {error ? (
        <p role='alert' className='text-sm font-semibold text-red-600'>
          {error}
        </p>
      ) : null}
      <button
        type='submit'
        disabled={sending}
        className='inline-flex h-11 w-fit items-center gap-2 rounded-lg bg-slate-950 px-5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-60'
      >
        {sending ? (
          <Loader2 className='h-4 w-4 animate-spin' />
        ) : (
          <Send className='h-4 w-4' />
        )}
        {t('Göndər')}
      </button>
    </form>
  )
}
