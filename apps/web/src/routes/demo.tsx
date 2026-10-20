import { useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { PlayCircle } from 'lucide-react'
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

function DemoPage() {
  const [content, setContent] = useState(defaultPublicSiteContent)

  useEffect(() => {
    loadPublicSiteContent().then(setContent)
  }, [])

  return (
    <PublicPageShell>
      <main>
        <PublicPageHero
          eyebrow={content.demo.eyebrow}
          title={content.demo.title}
          description={content.demo.description}
        >
          <div className='flex flex-wrap gap-3'>
            <Link
              to='/monitor/workspace-preview'
              className='inline-flex h-11 items-center gap-2 rounded-lg bg-[#1463ff] px-5 text-sm font-bold text-white transition hover:bg-blue-700'
            >
              <PlayCircle className='h-4 w-4' />
              {content.demo.primaryCta}
            </Link>
            <Link
              to='/contact'
              className='inline-flex h-11 items-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-bold text-slate-800 transition hover:bg-slate-50'
            >
              {content.demo.secondaryCta}
            </Link>
          </div>
        </PublicPageHero>
        <section className='mx-auto grid max-w-7xl gap-6 px-5 pb-20 md:px-8 lg:grid-cols-[0.9fr_1.1fr]'>
          <PublicCard>
            <h2 className='text-xl font-extrabold text-slate-950'>
              {content.demo.placeholderTitle}
            </h2>
            <div className='mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center'>
              <PlayCircle className='mx-auto h-12 w-12 text-slate-500' />
              <p className='mx-auto mt-4 max-w-xl text-sm leading-6 font-semibold text-slate-600'>
                {content.demo.placeholderDescription}
              </p>
            </div>
          </PublicCard>
          <PublicCard>
            <h2 className='text-xl font-extrabold text-slate-950'>{t("Demo iş axını")}</h2>
            <div className='mt-6 grid gap-3'>
              {content.demo.items.map((row) => (
                <article
                  key={row.title}
                  className='rounded-xl border border-slate-200 bg-slate-50 p-4'
                >
                  <p className='text-xs font-bold text-slate-500'>
                    {row.source} • {row.keyword} • {row.time}
                  </p>
                  <h3 className='mt-2 text-sm leading-6 font-extrabold text-slate-950'>
                    {row.title}
                  </h3>
                </article>
              ))}
            </div>
          </PublicCard>
        </section>
      </main>
    </PublicPageShell>
  )
}

export const Route = createFileRoute('/demo')({ component: DemoPage })
