import { useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Check, ChevronRight, Contact, Phone } from 'lucide-react'
import { t } from '@/lib/i18n'
import {
  initialPublicSiteContent,
  loadPublicSiteContent,
  splitServices,
  type PublicDemoItem,
} from '@/lib/public-site-content'
import { DemoRequestForm } from '@/components/public-site/demo-request-form'
import { CONTACT_PHONE } from '@/components/public-site/contact'
import {
  PublicFooter,
  PublicHeader,
  SectionHeading,
} from '@/components/public-site/public-site-shell'

// Mirrors the layout of the worker's real Telegram alert (alert_message in
// apps/worker/rss/site_monitor.py) so the hero shows what customers receive.
function TelegramAlertPreview({ items }: { items: PublicDemoItem[] }) {
  return (
    <div className='mx-auto w-full max-w-sm rounded-[2.5rem] border-[10px] border-slate-900 bg-[#dfe6ee] p-3 shadow-[0_30px_60px_rgba(15,23,42,0.18)]'>
      <div className='pt-1 pb-3 text-center'>
        <p className='text-sm font-bold text-slate-900'>Vizual</p>
        <p className='text-xs text-slate-500'>{t('Nümunə bildirişlər')}</p>
      </div>
      <div className='grid gap-2.5'>
        {items.map((item) => (
          <article
            key={item.title}
            className='rounded-2xl rounded-tl-md bg-white px-4 py-3 text-[13px] leading-5 text-slate-800 shadow-sm'
          >
            <p className='font-bold text-slate-950'>{t('Yeni uyğun xəbər')}</p>
            <p className='mt-1 font-semibold text-slate-950'>{item.title}</p>
            <p className='mt-2 text-slate-600'>
              {t('Mənbə')}: {item.source}
            </p>
            <p className='text-slate-600'>
              {t('Açar sözlər')}:{' '}
              <span className='font-semibold text-[#1463ff]'>
                {item.keyword}
              </span>
            </p>
            <p className='mt-1 text-right text-[11px] text-slate-400'>
              {item.time}
            </p>
          </article>
        ))}
      </div>
    </div>
  )
}

function IndexPage() {
  const [content, setContent] = useState(initialPublicSiteContent)
  const { live, soon } = splitServices(content.services.items)

  useEffect(() => {
    let active = true

    loadPublicSiteContent().then((nextContent) => {
      if (active) {
        setContent(nextContent)
      }
    })

    return () => {
      active = false
    }
  }, [])

  return (
    <div id='top' className='min-h-screen bg-[#f7f9fd] text-[#172033]'>
      <PublicHeader />

      <main>
        <section className='mx-auto grid max-w-7xl gap-12 px-5 pt-16 pb-14 md:px-8 md:pt-24 lg:grid-cols-[1.1fr_0.9fr] lg:items-center'>
          <div>
            <p className='text-sm font-semibold text-slate-500'>
              {content.hero.badge}
            </p>
            <h1 className='mt-4 max-w-3xl text-4xl leading-[1.08] font-black tracking-tight text-slate-950 md:text-6xl'>
              {content.hero.tagline}
            </h1>
            <p className='mt-6 max-w-2xl text-lg leading-8 text-slate-600'>
              {content.hero.description}
            </p>
            <div className='mt-9 flex flex-wrap gap-3'>
              <Link
                to='/demo'
                className='inline-flex h-12 items-center gap-2 rounded-lg bg-[#1463ff] px-5 text-sm font-bold text-white hover:bg-blue-700'
              >
                {content.hero.primaryCta}
                <ChevronRight className='h-4 w-4' />
              </Link>
              <Link
                to='/sign-in'
                className='inline-flex h-12 items-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-bold text-slate-800 hover:bg-slate-50'
              >
                {content.hero.secondaryCta}
              </Link>
            </div>
          </div>

          <TelegramAlertPreview items={content.demo.items} />
        </section>

        <section id='services' className='mx-auto max-w-7xl px-5 py-20 md:px-8'>
          <SectionHeading
            eyebrow={content.services.eyebrow}
            title={content.services.title}
            description={content.services.description}
          />
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
            {live.map((service) => (
              <article
                key={service.title}
                className='rounded-2xl border border-slate-200 bg-white p-6'
              >
                <div className='flex items-baseline justify-between gap-3'>
                  <h3 className='text-lg font-extrabold text-slate-950'>
                    {service.title}
                  </h3>
                  <span className='text-xs font-semibold whitespace-nowrap text-slate-500'>
                    {service.status}
                  </span>
                </div>
                <p className='mt-2 text-sm leading-6 text-slate-600'>
                  {service.description}
                </p>
              </article>
            ))}
          </div>
          {soon.length > 0 ? (
            <p className='mt-6 text-center text-sm text-slate-500'>
              {t('Tezliklə')}:{' '}
              {soon.map((service) => service.title).join(' · ')}
            </p>
          ) : null}
        </section>

        <section id='audience' className='mx-auto max-w-7xl px-5 py-20 md:px-8'>
          <SectionHeading
            eyebrow={content.audiences.eyebrow}
            title={content.audiences.title}
          />
          <div className='grid gap-10 md:grid-cols-3'>
            {content.audiences.items.map((audience) => (
              <article
                key={audience.title}
                className='border-l-[3px] border-slate-900 pl-5'
              >
                <h3 className='text-base font-extrabold text-slate-950'>
                  {audience.title}
                </h3>
                <p className='mt-2 text-[15px] leading-7 text-slate-600'>
                  {audience.description}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section id='pricing' className='mx-auto max-w-7xl px-5 py-20 md:px-8'>
          <SectionHeading
            eyebrow={content.pricing.eyebrow}
            title={content.pricing.title}
          />
          <div className='grid gap-5 md:grid-cols-2 xl:grid-cols-4'>
            {content.pricing.plans.map((plan) => (
              <article
                key={plan.name}
                className='rounded-2xl border border-slate-200 bg-white p-6 shadow-sm shadow-slate-200/40'
              >
                <h3 className='text-xl font-extrabold text-slate-950'>
                  {plan.name}
                </h3>
                <p className='mt-3 text-3xl font-black text-slate-950'>
                  {plan.price}
                </p>
                <ul className='mt-5 grid gap-3 text-sm text-slate-700'>
                  {plan.features.map((feature) => (
                    <li key={feature} className='flex gap-2'>
                      <Check className='mt-0.5 h-4 w-4 shrink-0 text-emerald-600' />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <p className='mt-6 text-center text-sm'>
            <Link
              to='/pricing'
              className='font-bold text-[#1463ff] hover:underline'
            >
              {t('Planları müqayisə et və suallara bax')}
            </Link>
          </p>
        </section>

        <section id='contact' className='mx-auto max-w-7xl px-5 py-20 md:px-8'>
          <div className='rounded-2xl bg-slate-900 p-6 text-white md:p-10'>
            <div className='grid gap-8 lg:grid-cols-2 lg:items-center'>
              <div>
                <p className='text-sm font-semibold text-slate-400'>
                  {content.contact.eyebrow}
                </p>
                <h2 className='mt-3 text-3xl font-extrabold tracking-tight md:text-5xl'>
                  {content.contact.title}
                </h2>
                <p className='mt-4 max-w-2xl text-base leading-7 text-slate-300'>
                  {content.contact.description}
                </p>
                <a
                  href={`tel:${CONTACT_PHONE.replace(/\s/g, '')}`}
                  className='mt-6 inline-flex items-center gap-2 text-lg font-bold text-white hover:underline'
                >
                  <Phone className='h-5 w-5' />
                  {CONTACT_PHONE}
                </a>
              </div>
              <div className='rounded-2xl bg-white p-5 text-slate-950 md:p-6'>
                <Contact className='h-6 w-6 text-[#1463ff]' />
                <h3 className='mt-4 text-xl font-extrabold'>
                  {content.contact.cardTitle}
                </h3>
                <p className='mt-2 text-sm leading-6 text-slate-600'>
                  {content.contact.cardDescription}
                </p>
                <div className='mt-5'>
                  <DemoRequestForm email={content.contact.email} />
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  )
}

export const Route = createFileRoute('/')({ component: IndexPage })
