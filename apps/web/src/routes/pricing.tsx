import { useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import {
  defaultPublicSiteContent,
  loadPublicSiteContent,
} from '@/lib/public-site-content'
import {
  PublicCard,
  PublicPageHero,
  PublicPageShell,
} from '@/components/public-site/public-site-shell'
import { t } from '@/lib/i18n'

function PricingPage() {
  const [content, setContent] = useState(defaultPublicSiteContent)

  useEffect(() => {
    loadPublicSiteContent().then(setContent)
  }, [])

  return (
    <PublicPageShell>
      <main>
        <PublicPageHero
          eyebrow={content.pricing.eyebrow}
          title={content.pricing.title}
          description={content.pricing.description}
        />
        <section className='mx-auto max-w-7xl px-5 pb-20 md:px-8'>
          <div className='grid gap-5 md:grid-cols-2 xl:grid-cols-4'>
            {content.pricing.plans.map((plan) => (
              <PublicCard key={plan.name} className='h-full'>
                <h2 className='text-xl font-extrabold text-slate-950'>
                  {plan.name}
                </h2>
                <p className='mt-4 text-3xl font-black text-slate-950'>
                  {plan.price}
                </p>
                <p className='mt-3 text-sm leading-6 text-slate-600'>
                  {plan.description}
                </p>
                <ul className='mt-6 grid gap-3 text-sm text-slate-700'>
                  {plan.features.map((feature) => (
                    <li key={feature} className='flex gap-2'>
                      <Check className='mt-0.5 h-4 w-4 shrink-0 text-emerald-600' />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </PublicCard>
            ))}
          </div>
          <div className='mt-10 rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm shadow-slate-200/40'>
            <h2 className='text-xl font-extrabold text-slate-950'>{t("Xüsusi ehtiyacınız var?")}</h2>
            <p className='mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-600'>{t("Fərdi mənbələr, yüksək limitlər və komanda onboarding-i üçün bizimlə əlaqə saxlayın.")}</p>
            <Link
              to='/contact'
              className='mt-6 inline-flex h-11 items-center rounded-lg bg-[#1463ff] px-5 text-sm font-bold text-white transition hover:bg-blue-700'
            >{t("Əlaqə saxla")}</Link>
          </div>
        </section>
      </main>
    </PublicPageShell>
  )
}

export const Route = createFileRoute('/pricing')({ component: PricingPage })
