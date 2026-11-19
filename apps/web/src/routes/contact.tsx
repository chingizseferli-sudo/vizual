import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Mail, MessageSquareHeart, Phone } from 'lucide-react'
import {
  initialPublicSiteContent,
  loadPublicSiteContent,
} from '@/lib/public-site-content'
import {
  PublicCard,
  PublicPageHero,
  PublicPageShell,
} from '@/components/public-site/public-site-shell'
import { CONTACT_PHONE } from '@/components/public-site/contact'
import { DemoRequestForm } from '@/components/public-site/demo-request-form'
import { FeedbackForm } from '@/components/public-site/feedback-form'
import { t } from '@/lib/i18n'

function ContactPage() {
  const [content, setContent] = useState(initialPublicSiteContent)

  useEffect(() => {
    loadPublicSiteContent().then(setContent)
  }, [])

  const contactItems = [
    {
      title: t('Email'),
      value: content.contact.email,
      href: `mailto:${content.contact.email}`,
      icon: Mail,
    },
    {
      title: t('Əməkdaşlıq'),
      value: CONTACT_PHONE,
      href: `tel:${CONTACT_PHONE.replace(/\s/g, '')}`,
      icon: Phone,
    },
  ]

  return (
    <PublicPageShell>
      <PublicPageHero
        eyebrow={content.contact.eyebrow}
        title={content.contact.title}
        description={content.contact.description}
      />
      <section className='mx-auto grid max-w-7xl gap-6 px-5 pb-12 md:px-8 lg:grid-cols-[0.8fr_1.2fr]'>
        <div className='grid content-start gap-4'>
          {contactItems.map((item) => (
            <PublicCard key={item.title}>
              <div className='flex items-start gap-4'>
                <div className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#1463ff]'>
                  <item.icon className='h-5 w-5' />
                </div>
                <div className='min-w-0'>
                  <h2 className='font-extrabold text-slate-950'>
                    {item.title}
                  </h2>
                  <a
                    href={item.href}
                    className='mt-1 block text-base font-semibold break-words text-[#1463ff] hover:underline'
                  >
                    {item.value}
                  </a>
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
          <div className='mt-6'>
            <DemoRequestForm email={content.contact.email} />
          </div>
        </PublicCard>
      </section>
      <section
        id='feedback'
        className='mx-auto max-w-7xl scroll-mt-24 px-5 pb-20 md:px-8'
      >
        <PublicCard>
          <div className='grid gap-8 lg:grid-cols-[0.8fr_1.2fr]'>
            <div>
              <div className='flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-[#1463ff]'>
                <MessageSquareHeart className='h-5 w-5' />
              </div>
              <h2 className='mt-5 text-2xl font-extrabold text-slate-950'>
                {t('Təklif və iradlarınız')}
              </h2>
              <p className='mt-3 text-sm leading-6 text-slate-600'>
                {t(
                  'Nə xoşunuza gəlmədi, nə çatışmır? Yazın, hər mesajı oxuyuruq.'
                )}
              </p>
            </div>
            <FeedbackForm />
          </div>
        </PublicCard>
      </section>
    </PublicPageShell>
  )
}

export const Route = createFileRoute('/contact')({ component: ContactPage })
