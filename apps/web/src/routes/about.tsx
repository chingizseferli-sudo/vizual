import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Building2, ShieldCheck, Sparkles } from 'lucide-react'
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
import { t } from '@/lib/i18n'

const principleIcons = [Building2, ShieldCheck, Sparkles]

function AboutPage() {
  const [content, setContent] = useState(initialPublicSiteContent)

  useEffect(() => {
    loadPublicSiteContent().then(setContent)
  }, [])

  return (
    <PublicPageShell>
      <main>
        <PublicPageHero
          eyebrow={content.about.eyebrow}
          title={content.about.title}
          description={content.about.description}
        />
        <section className='mx-auto max-w-7xl px-5 pb-20 md:px-8'>
          <SectionHeading
            eyebrow={t("Prinsiplər")}
            title={t("Public sayt tətbiqin özü deyil")}
            description={t("Vizual.Az-da public sayt, istifadəçi workspace-i və admin paneli ayrı məqsədlər üçün istifadə olunur.")}
          />
          <div className='grid gap-5 md:grid-cols-3'>
            {content.about.principles.map((item, index) => {
              const Icon = principleIcons[index] ?? Sparkles

              return (
                <PublicCard key={item.title} className='h-full'>
                  <div className='flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-[#1463ff]'>
                    <Icon className='h-5 w-5' />
                  </div>
                  <h2 className='mt-5 text-xl font-extrabold text-slate-950'>
                    {item.title}
                  </h2>
                  <p className='mt-3 text-sm leading-6 text-slate-600'>
                    {item.description}
                  </p>
                </PublicCard>
              )
            })}
          </div>
        </section>
      </main>
    </PublicPageShell>
  )
}

export const Route = createFileRoute('/about')({ component: AboutPage })
