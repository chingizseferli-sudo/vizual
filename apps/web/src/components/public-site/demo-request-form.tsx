import { useState, type FormEvent } from 'react'
import { CheckCircle2, Loader2, Send } from 'lucide-react'
import { getLang, t } from '@/lib/i18n'
import { submitDemoRequest } from '@/lib/supabase-lazy'

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const emptyForm = {
  name: '',
  company: '',
  email: '',
  phone: '',
  message: '',
  website: '',
}

type FormValues = typeof emptyForm

// Mirrors the checks on public.demo_requests, so people see the problem
// before the server rejects the request.
function validate(values: FormValues) {
  if (values.name.trim().length < 2) return t('Adınızı yazın.')
  if (values.company.trim().length < 2) return t('Təşkilatın adını yazın.')
  if (!EMAIL_PATTERN.test(values.email.trim()))
    return t('Düzgün email ünvanı yazın.')
  const phone = values.phone.trim()
  if (phone && (phone.length < 5 || phone.length > 40))
    return t('Telefon nömrəsini yoxlayın.')
  return ''
}

const inputClass =
  'mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-[#1463ff] focus:ring-2 focus:ring-blue-100'

export function DemoRequestForm({ email }: { email: string }) {
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
    const result = await submitDemoRequest({
      ...values,
      name: values.name.trim(),
      company: values.company.trim(),
      email: values.email.trim(),
      lang: getLang(),
    })
    setSending(false)

    if (result === 'ok') {
      setSent(true)
      setValues(emptyForm)
    } else {
      setError(
        result === 'rate_limited'
          ? t('Bu email ilə bu gün kifayət qədər müraciət göndərilib. Bizə email yazın.')
          : t('Müraciət göndərilmədi. Bir az sonra yenidən cəhd edin və ya email yazın.')
      )
    }
  }

  if (sent) {
    return (
      <div className='rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900'>
        <CheckCircle2 className='h-6 w-6 text-emerald-600' />
        <p className='mt-3 font-extrabold'>{t('Müraciətiniz qəbul olundu.')}</p>
        <p className='mt-1 text-sm leading-6'>
          {t('Komandamız qısa zamanda sizinlə əlaqə saxlayacaq.')}
        </p>
        <button
          type='button'
          onClick={() => setSent(false)}
          className='mt-4 text-sm font-bold text-emerald-800 underline underline-offset-4'
        >
          {t('Yeni müraciət')}
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className='grid gap-4'>
      <div className='grid gap-4 sm:grid-cols-2'>
        <label className='text-sm font-bold text-slate-800'>
          {t('Ad, soyad')}
          <input
            className={inputClass}
            value={values.name}
            onChange={update('name')}
            autoComplete='name'
            maxLength={120}
            required
          />
        </label>
        <label className='text-sm font-bold text-slate-800'>
          {t('Təşkilat')}
          <input
            className={inputClass}
            value={values.company}
            onChange={update('company')}
            autoComplete='organization'
            maxLength={160}
            required
          />
        </label>
        <label className='text-sm font-bold text-slate-800'>
          {t('Email')}
          <input
            className={inputClass}
            type='email'
            value={values.email}
            onChange={update('email')}
            autoComplete='email'
            maxLength={254}
            required
          />
        </label>
        <label className='text-sm font-bold text-slate-800'>
          {t('Telefon')}{' '}
          <span className='font-medium text-slate-400'>
            ({t('istəyə bağlı')})
          </span>
          <input
            className={inputClass}
            type='tel'
            value={values.phone}
            onChange={update('phone')}
            autoComplete='tel'
            maxLength={40}
            placeholder='+994'
          />
        </label>
      </div>
      <label className='text-sm font-bold text-slate-800'>
        {t('Nəyi izləmək istəyirsiniz?')}{' '}
        <span className='font-medium text-slate-400'>({t('istəyə bağlı')})</span>
        <textarea
          className={`${inputClass} min-h-24 resize-y`}
          value={values.message}
          onChange={update('message')}
          maxLength={2000}
          placeholder={t('Məsələn: brendimiz, rəqiblər, sektor xəbərləri')}
        />
      </label>
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
      <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
        <button
          type='submit'
          disabled={sending}
          className='inline-flex h-11 items-center gap-2 rounded-lg bg-[#1463ff] px-5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-60'
        >
          {sending ? (
            <Loader2 className='h-4 w-4 animate-spin' />
          ) : (
            <Send className='h-4 w-4' />
          )}
          {t('Müraciət göndər')}
        </button>
        <p className='text-sm text-slate-500'>
          {t('və ya email yazın:')}{' '}
          <a
            href={`mailto:${email}`}
            className='font-bold text-[#1463ff] hover:underline'
          >
            {email}
          </a>
        </p>
      </div>
    </form>
  )
}
