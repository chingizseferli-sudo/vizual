import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Mail, MessageCircle, Phone } from 'lucide-react'
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

function ContactPage() {
  const [content, setContent] = useState(defaultPublicSiteContent)

  useEffect(() => {
    loadPublicSiteContent().then(setContent)
  }, [])

  const contactItems = [
    { title: t("Email"), value: content.contact.email, icon: Mail },
    {
      title: 'Demo',
      value: content.contact.cardDescription,
      icon: MessageCircle,
    },
    {
      title: t("Əməkdaşlıq"),
      value: t("Fərdi ehtiyaclar üçün danışaq"),
      icon: Phone,
    },
  ]

  return (
    <PublicPageShell>
      <main>
        <PublicPageHero
          eyebrow={content.contact.eyebrow}
          title={content.contact.title}
          description={content.contact.description}
        />
        <section className='mx-auto grid max-w-7xl gap-6 px-5 pb-20 md:px-8 lg:grid-cols-[0.8fr_1.2fr]'>
          <div className='grid gap-4'>
            {contactItems.map((item) => (
              <PublicCard key={item.title}>
                <div className='flex items-start gap-4'>
                  <div className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#1463ff]'>
                    <item.icon className='h-5 w-5' />
                  </div>
                  <div>
                    <h2 className='font-extrabold text-slate-950'>
                      {item.title}
                    </h2>
                    <p className='mt-1 text-sm leading-6 text-slate-600'>
                      {item.value}
                    </p>
                  </div>
                </div>
              </PublicCard>
            ))}
          </div>
          <PublicCard>
            <h2 className='text-2xl font-extrabold text-slate-950'>
              {content.contact.cardTitle}
            </h2>
            <p className='mt-3 max-w-2xl text-sm leading-6 text-slate-600'>
              {content.contact.cardDescription}
            </p>
            <a
              href={`mailto:${content.contact.email}`}
              className='mt-6 inline-flex h-11 items-center rounded-lg bg-[#1463ff] px-5 text-sm font-bold text-white transition hover:bg-blue-700'
            >
              {content.contact.email}
            </a>
          </PublicCard>
        </section>
      </main>
    </PublicPageShell>
  )
}

export const Route = createFileRoute('/contact')({ component: ContactPage })
