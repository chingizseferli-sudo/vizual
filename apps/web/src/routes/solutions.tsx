import { useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  FileText,
  Megaphone,
  Newspaper,
  RadioTower,
  Search,
} from 'lucide-react'
import {
  defaultPublicSiteContent,
  loadPublicSiteContent,
  type PublicService,
} from '@/lib/public-site-content'
import {
  PublicCard,
  PublicPageHero,
  PublicPageShell,
  SectionHeading,
} from '@/components/public-site/public-site-shell'
import { t } from '@/lib/i18n'

const serviceIcons: Record<PublicService['icon'], typeof Newspaper> = {
  file: FileText,
  megaphone: Megaphone,
  newspaper: Newspaper,
  radio: RadioTower,
  search: Search,
}

function SolutionsPage() {
  const [content, setContent] = useState(defaultPublicSiteContent)

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
    <PublicPageShell>
      <main>
        <PublicPageHero
          eyebrow={content.services.eyebrow}
          title={content.services.title}
          description={content.services.description}
        >
          <Link
            to='/demo'
            className='inline-flex h-11 items-center rounded-lg bg-[#1463ff] px-5 text-sm font-bold text-white transition hover:bg-blue-700'
          >{t("15 gün pulsuz sına")}</Link>
        </PublicPageHero>

        <section className='mx-auto max-w-7xl px-5 pb-20 md:px-8'>
          <div className='grid gap-5 md:grid-cols-2 xl:grid-cols-5'>
            {content.services.items.map((service) => {
              const ServiceIcon = serviceIcons[service.icon] || Newspaper

              return (
                <PublicCard key={service.title} className='h-full'>
                  <div className='flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-[#1463ff]'>
                    <ServiceIcon className='h-5 w-5' />
                  </div>
                  <h2 className='mt-5 leading-6 font-extrabold text-slate-950'>
                    {service.title}
                  </h2>
                  <p className='mt-3 text-sm leading-6 text-slate-600'>
                    {service.description}
                  </p>
                  <span className='mt-5 inline-flex rounded-full border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-600'>
                    {service.status}
                  </span>
                </PublicCard>
              )
            })}
          </div>
        </section>

        <section className='mx-auto max-w-7xl px-5 py-20 md:px-8'>
          <SectionHeading
            eyebrow={t("İstifadə ssenariləri")}
            title={t("Hər modul konkret iş problemini həll edir")}
          />
          <div className='grid gap-5 md:grid-cols-3'>
            <PublicCard>
              <h3 className='font-extrabold text-slate-950'>{t("Gündəlik media xülasəsi")}</h3>
              <p className='mt-3 text-sm leading-6 text-slate-600'>{t("Komanda səhər ilk olaraq yeni media materiallarını və vacib bildirişləri görür.")}</p>
            </PublicCard>
            <PublicCard>
              <h3 className='font-extrabold text-slate-950'>{t("Reputasiya izləmə")}</h3>
              <p className='mt-3 text-sm leading-6 text-slate-600'>{t("Təşkilat adı, rəhbər şəxs, layihə və kampaniya mövzuları ardıcıl izlənir.")}</p>
            </PublicCard>
            <PublicCard>
              <h3 className='font-extrabold text-slate-950'>{t("Veb dəyişiklik izləmə")}</h3>
              <p className='mt-3 text-sm leading-6 text-slate-600'>{t("Seçilmiş səhifə sahələri dəyişdikdə tarixçə və bildiriş yaranır.")}</p>
            </PublicCard>
          </div>
        </section>
      </main>
    </PublicPageShell>
  )
}

export const Route = createFileRoute('/solutions')({ component: SolutionsPage })
