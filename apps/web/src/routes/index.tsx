import { useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  BadgeCheck,
  Building2,
  Check,
  ChevronRight,
  Contact,
  FileText,
  Landmark,
  Megaphone,
  Newspaper,
  PlayCircle,
  RadioTower,
  Search,
  ShieldCheck,
  Sparkles,
  University,
} from 'lucide-react'
import {
  initialPublicSiteContent,
  loadPublicSiteContent,
  type PublicService,
} from '@/lib/public-site-content'
import {
  PublicFooter,
  PublicHeader,
  SectionHeading,
} from '@/components/public-site/public-site-shell'
import { DemoRequestForm } from '@/components/public-site/demo-request-form'
import { t } from '@/lib/i18n'

const serviceIcons: Record<PublicService['icon'], typeof Newspaper> = {
  file: FileText,
  megaphone: Megaphone,
  newspaper: Newspaper,
  radio: RadioTower,
  search: Search,
}

const audienceIcons = [
  Landmark,
  University,
  ShieldCheck,
  Building2,
  Megaphone,
  Newspaper,
]

function IndexPage() {
  const [content, setContent] = useState(initialPublicSiteContent)

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
        <section className='mx-auto grid max-w-7xl gap-12 px-5 py-20 md:px-8 md:py-28 lg:grid-cols-[0.92fr_1.08fr] lg:items-center'>
          <div>
            <div className='inline-flex items-center gap-2 rounded-full border border-blue-100 bg-white px-3 py-1 text-sm font-bold text-[#1463ff]'>
              <Sparkles className='h-4 w-4' />
              {content.hero.badge}
            </div>
            <h1 className='mt-7 max-w-4xl text-5xl font-black tracking-tight text-slate-950 md:text-7xl'>
              {content.hero.brand}
            </h1>
            <p className='mt-5 max-w-3xl text-3xl font-extrabold tracking-tight text-slate-900 md:text-5xl'>
              {content.hero.tagline}
            </p>
            <p className='mt-6 max-w-2xl text-lg leading-8 text-slate-600'>
              {content.hero.description}
            </p>
            <div className='mt-9 flex flex-wrap gap-3'>
              <Link
                to='/demo'
                className='inline-flex h-12 items-center gap-2 rounded-lg bg-[#1463ff] px-5 text-sm font-bold text-white shadow-[0_16px_34px_rgba(20,99,255,0.24)] hover:bg-blue-700'
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

          <div className='relative rounded-[28px] bg-gradient-to-br from-slate-950 via-blue-900 to-cyan-700 p-5 shadow-[0_34px_90px_rgba(22,42,84,0.25)]'>
            <div className='grid gap-4 rounded-2xl border border-white/15 bg-white/90 p-5'>
              <div className='flex items-center justify-between gap-4 border-b border-slate-200 pb-4'>
                <div>
                  <p className='text-sm font-bold text-slate-500'>{t("İş masası nümunəsi")}</p>
                  <p className='text-xl font-extrabold text-slate-950'>{t("Bu gün təşkilatınız haqqında nə baş verir?")}</p>
                </div>
                <span className='rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700'>{t("Aktiv")}</span>
              </div>
              <div className='grid gap-3 sm:grid-cols-3'>
                <div className='rounded-xl bg-slate-50 p-3'>
                  <p className='text-xs font-bold text-slate-500'>{t("Yeni material")}</p>
                  <p className='mt-1 text-2xl font-black'>14</p>
                </div>
                <div className='rounded-xl bg-slate-50 p-3'>
                  <p className='text-xs font-bold text-slate-500'>{t("Bildiriş")}</p>
                  <p className='mt-1 text-2xl font-black'>2</p>
                </div>
                <div className='rounded-xl bg-slate-50 p-3'>
                  <p className='text-xs font-bold text-slate-500'>{t("Aktiv açar söz")}</p>
                  <p className='mt-1 text-2xl font-black'>3</p>
                </div>
              </div>
              <div className='grid gap-3'>
                {content.demo.items.map((item) => (
                  <article
                    key={item.title}
                    className='rounded-xl border border-slate-200 bg-white p-4'
                  >
                    <div className='flex flex-wrap gap-2 text-xs font-semibold text-slate-500'>
                      <span>{item.source}</span>
                      <span>•</span>
                      <span>{item.keyword}</span>
                      <span>•</span>
                      <span>{item.time}</span>
                    </div>
                    <p className='mt-2 text-sm leading-6 font-extrabold text-slate-950'>
                      {item.title}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id='services' className='mx-auto max-w-7xl px-5 py-20 md:px-8'>
          <SectionHeading
            eyebrow={content.services.eyebrow}
            title={content.services.title}
            description={content.services.description}
          />
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-6'>
            {content.services.items.map((service, index) => {
              const ServiceIcon = serviceIcons[service.icon] || Newspaper

              return (
                <article
                  key={service.title}
                  // Five services: three on top, the last two centred below.
                  className={`flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/40 lg:col-span-2 ${index === 3 && content.services.items.length === 5 ? 'lg:col-start-2' : ''}`}
                >
                  <div className='flex items-center justify-between gap-3'>
                    <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#1463ff]'>
                      <ServiceIcon className='h-5 w-5' />
                    </div>
                    <span className='rounded-full border border-slate-200 px-2 py-0.5 text-xs font-bold whitespace-nowrap text-slate-600'>
                      {service.status}
                    </span>
                  </div>
                  <h3 className='mt-4 text-base font-extrabold text-slate-950'>
                    {service.title}
                  </h3>
                  <p className='mt-1.5 text-sm leading-6 text-slate-600'>
                    {service.description}
                  </p>
                </article>
              )
            })}
          </div>
        </section>

        <section id='audience' className='mx-auto max-w-7xl px-5 py-20 md:px-8'>
          <SectionHeading
            eyebrow={content.audiences.eyebrow}
            title={content.audiences.title}
          />
          <div className='grid gap-5 sm:grid-cols-2 lg:grid-cols-3'>
            {content.audiences.items.map((audience, index) => {
              const AudienceIcon = audienceIcons[index] || Building2

              return (
                <article
                  key={audience.title}
                  className='flex items-start gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm shadow-slate-200/40'
                >
                  <div className='flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-700'>
                    <AudienceIcon className='h-5 w-5' />
                  </div>
                  <div>
                    <h3 className='font-extrabold text-slate-950'>
                      {audience.title}
                    </h3>
                    <p className='mt-1 text-sm text-slate-600'>
                      {audience.description}
                    </p>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <section id='demo' className='mx-auto max-w-7xl px-5 py-20 md:px-8'>
          <div className='grid gap-8 rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm shadow-slate-200/40 md:p-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-center'>
            <div>
              <p className='text-sm font-extrabold tracking-wide text-[#1463ff] uppercase'>
                {content.demo.eyebrow}
              </p>
              <h2 className='mt-3 text-3xl font-extrabold tracking-tight text-slate-950 md:text-5xl'>
                {content.demo.title}
              </h2>
              <p className='mt-4 text-base leading-7 text-slate-600'>
                {content.demo.description}
              </p>
              <div className='mt-6 flex flex-wrap gap-3'>
                <Link
                  to='/monitor/workspace-preview'
                  className='inline-flex h-11 items-center gap-2 rounded-lg bg-[#1463ff] px-4 text-sm font-bold text-white hover:bg-blue-700'
                >
                  {content.demo.primaryCta}
                  <PlayCircle className='h-4 w-4' />
                </Link>
                <Link
                  to='/contact'
                  className='inline-flex h-11 items-center rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-800 hover:bg-slate-50'
                >
                  {content.demo.secondaryCta}
                </Link>
              </div>
            </div>
            <div className='rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center'>
              <PlayCircle className='mx-auto h-12 w-12 text-slate-500' />
              <p className='mt-4 text-lg font-extrabold text-slate-950'>
                {content.demo.placeholderTitle}
              </p>
              <p className='mt-2 text-sm leading-6 text-slate-600'>
                {content.demo.placeholderDescription}
              </p>
            </div>
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
                <p className='mt-3 text-sm leading-6 text-slate-600'>
                  {plan.description}
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
        </section>

        <section className='mx-auto max-w-7xl px-5 py-20 md:px-8'>
          <div className='grid gap-5 lg:grid-cols-2'>
            <article className='rounded-2xl border border-slate-200 bg-white p-6 shadow-sm shadow-slate-200/40'>
              <div className='flex items-center gap-3 text-[#1463ff]'>
                <BadgeCheck className='h-5 w-5' />
                <p className='text-sm font-extrabold tracking-wide uppercase'>
                  {content.campaigns.eyebrow}
                </p>
              </div>
              <h2 className='mt-4 text-2xl font-extrabold text-slate-950'>
                {content.campaigns.title}
              </h2>
              <p className='mt-3 text-sm leading-6 text-slate-600'>
                {content.campaigns.description}
              </p>
            </article>
            <article
              id='blog'
              className='rounded-2xl border border-slate-200 bg-white p-6 shadow-sm shadow-slate-200/40'
            >
              <div className='flex items-center gap-3 text-[#1463ff]'>
                <FileText className='h-5 w-5' />
                <p className='text-sm font-extrabold tracking-wide uppercase'>
                  {content.blog.eyebrow}
                </p>
              </div>
              <h2 className='mt-4 text-2xl font-extrabold text-slate-950'>
                {content.blog.title}
              </h2>
              <div className='mt-4 grid gap-2'>
                {content.blog.items.map((item) => (
                  <p
                    key={item}
                    className='rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700'
                  >
                    {item}
                  </p>
                ))}
              </div>
            </article>
          </div>
        </section>

        <section id='contact' className='mx-auto max-w-7xl px-5 py-20 md:px-8'>
          <div className='rounded-[28px] bg-gradient-to-br from-slate-950 via-blue-900 to-cyan-700 p-6 text-white md:p-10'>
            <div className='grid gap-8 lg:grid-cols-2 lg:items-center'>
              <div>
                <p className='text-sm font-extrabold tracking-wide text-cyan-100 uppercase'>
                  {content.contact.eyebrow}
                </p>
                <h2 className='mt-3 text-3xl font-extrabold tracking-tight md:text-5xl'>
                  {content.contact.title}
                </h2>
                <p className='mt-4 max-w-2xl text-base leading-7 text-blue-50'>
                  {content.contact.description}
                </p>
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
