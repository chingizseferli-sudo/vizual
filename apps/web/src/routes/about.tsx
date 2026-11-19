import { useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Building2, Mail, ShieldCheck, Sparkles } from 'lucide-react'
import { t } from '@/lib/i18n'
import {
  initialPublicSiteContent,
  loadPublicSiteContent,
} from '@/lib/public-site-content'
import {
  PublicCard,
  PublicPageHero,
  PublicPageShell,
  SectionHeading,
} from '@/components/public-site/public-site-shell'

const principleIcons = [Building2, ShieldCheck, Sparkles]

function AboutPage() {
  const [content, setContent] = useState(initialPublicSiteContent)

  useEffect(() => {
    loadPublicSiteContent().then(setContent)
  }, [])

  const steps = [
    {
      title: t('Açar sözləri yazırsınız'),
      description: t('Təşkilatın adı, rəhbər şəxs, brend və ya rəqib.'),
    },
    {
      title: t('Biz izləyirik'),
      description: t(
        'Xəbər saytlarını və sosial şəbəkələri gecə-gündüz yoxlayırıq.'
      ),
    },
    {
      title: t('Siz xəbər tutursunuz'),
      description: t('Uyğun xəbər Telegram-a, xülasə isə email-ə gəlir.'),
    },
  ]

  const facts = [
    { value: '280+', label: t('xəbər saytı') },
    { value: '6', label: t('sosial platforma') },
    { value: '15', label: t('dəqiqədən bir yoxlama') },
    { value: '3', label: t('dil: AZ, RU, EN') },
  ]

  return (
    <PublicPageShell>
      <PublicPageHero
        eyebrow={content.about.eyebrow}
        title={content.about.title}
        description={content.about.description}
      />

      <section className='mx-auto max-w-7xl px-5 pb-16 md:px-8'>
        <dl className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
          {facts.map((fact) => (
            <div
              key={fact.label}
              className='flex flex-col rounded-2xl border border-slate-200 bg-white p-5'
            >
              <dt className='text-sm text-slate-500'>{fact.label}</dt>
              <dd className='order-first text-3xl font-black text-slate-950 md:text-4xl'>
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className='mx-auto max-w-7xl px-5 pb-16 md:px-8'>
        <SectionHeading eyebrow={t('Necə işləyir')} title={t('Üç addım')} />
        <ol className='grid gap-5 md:grid-cols-3'>
          {steps.map((step, index) => (
            <li
              key={step.title}
              className='border-l-[3px] border-[#1463ff] pl-5'
            >
              <p className='text-sm font-bold text-[#1463ff]'>{index + 1}</p>
              <h3 className='mt-1 text-lg font-extrabold text-slate-950'>
                {step.title}
              </h3>
              <p className='mt-2 text-[15px] leading-7 text-slate-600'>
                {step.description}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className='mx-auto max-w-7xl px-5 pb-16 md:px-8'>
        <SectionHeading
          eyebrow={t('Prinsiplər')}
          title={t('Nəyə önəm veririk')}
        />
        <div className='grid gap-5 md:grid-cols-3'>
          {content.about.principles.map((item, index) => {
            const Icon = principleIcons[index] ?? Sparkles

            return (
              <PublicCard key={item.title} className='h-full'>
                <div className='flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-[#1463ff]'>
                  <Icon className='h-5 w-5' />
                </div>
                <h3 className='mt-5 text-xl font-extrabold text-slate-950'>
                  {item.title}
                </h3>
                <p className='mt-3 text-sm leading-6 text-slate-600'>
                  {item.description}
                </p>
              </PublicCard>
            )
          })}
        </div>
      </section>

      <section className='mx-auto max-w-7xl px-5 pb-20 md:px-8'>
        <div className='flex flex-col gap-6 rounded-2xl bg-slate-900 p-6 text-white md:flex-row md:items-center md:justify-between md:p-10'>
          <div>
            <h2 className='text-2xl font-extrabold md:text-3xl'>
              {t('Sualınız var?')}
            </h2>
            <div className='mt-4 flex flex-wrap gap-x-6 gap-y-2 text-slate-200'>
              <a
                href={`mailto:${content.contact.email}`}
                className='inline-flex items-center gap-2 hover:text-white hover:underline'
              >
                <Mail className='h-4 w-4' />
                {content.contact.email}
              </a>
            </div>
          </div>
          <Link
            to='/demo'
            className='inline-flex h-12 w-fit shrink-0 items-center rounded-lg bg-white px-5 text-sm font-bold text-slate-950 hover:bg-slate-100'
          >
            {t('7 gün pulsuz sına')}
          </Link>
        </div>
      </section>
    </PublicPageShell>
  )
}

export const Route = createFileRoute('/about')({ component: AboutPage })
