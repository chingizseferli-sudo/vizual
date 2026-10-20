import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
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

function BlogPage() {
  const [content, setContent] = useState(defaultPublicSiteContent)

  useEffect(() => {
    loadPublicSiteContent().then(setContent)
  }, [])

  return (
    <PublicPageShell>
      <main>
        <PublicPageHero
          eyebrow={content.blog.eyebrow}
          title={content.blog.title}
          description={content.blog.description}
        />
        <section className='mx-auto max-w-7xl px-5 pb-20 md:px-8'>
          <div className='grid gap-5 md:grid-cols-3'>
            {content.blog.items.map((post, index) => (
              <PublicCard key={post} className='h-full'>
                <span className='rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-[#1463ff]'>{t("Mövzu")}{' '}{index + 1}
                </span>
                <h2 className='mt-5 text-xl leading-7 font-extrabold text-slate-950'>
                  {post}
                </h2>
                <p className='mt-3 text-sm leading-6 text-slate-600'>{t("Bu mövzu üzrə məqalə və ya izah mətni admin paneldən genişləndirilə bilər.")}</p>
              </PublicCard>
            ))}
          </div>
        </section>
      </main>
    </PublicPageShell>
  )
}

export const Route = createFileRoute('/blog')({ component: BlogPage })
