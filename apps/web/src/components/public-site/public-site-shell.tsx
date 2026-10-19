import { useEffect, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Menu, X } from 'lucide-react'
import {
  defaultPublicSiteSettings,
  loadPublicSiteSettings,
  type PublicSiteSettings,
} from '@/lib/public-site-settings'
import { BrandMark } from '@/components/brand-mark'

const label = {
  services: 'Xidm\u0259tl\u0259r',
  pricing: 'Qiym\u0259tl\u0259r',
  about: 'Haqq\u0131m\u0131zda',
  contact: '\u018flaq\u0259',
  login: '\u0130stifad\u0259\u00e7i giri\u015fi',
  register: 'Hesab yarat',
  demoRequest: 'S\u0131naq m\u00fcraci\u0259ti',
  demo: 'S\u0131naq',
  blog: 'Bloq',
  trial: '15 g\u00fcn pulsuz s\u0131na',
  openMenu: 'Menyunu a\u00e7',
  closeMenu: 'Menyunu ba\u011fla',
  footer:
    '\u00a9 2026 Vizual.Az. Kommunikasiya v\u0259 Media Monitorinq Platformas\u0131.',
}

const mobileMenuLinks = [
  { to: '/solutions', label: label.services },
  { to: '/demo', label: label.demo },
  { to: '/pricing', label: label.pricing },
  { to: '/blog', label: label.blog },
  { to: '/about', label: label.about },
  { to: '/contact', label: label.contact },
  { to: '/sign-in', label: label.login },
  { to: '/sign-up', label: label.register },
] as const

export function PublicHeader() {
  const [settings, setSettings] = useState<PublicSiteSettings>(
    defaultPublicSiteSettings
  )
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = () => setMenuOpen(false)

  useEffect(() => {
    let isMounted = true

    loadPublicSiteSettings().then((data) => {
      if (isMounted) setSettings(data)
    })

    return () => {
      isMounted = false
    }
  }, [])

  const logoUrl = settings.logo_url || defaultPublicSiteSettings.logo_url
  const siteName = settings.site_name || defaultPublicSiteSettings.site_name

  return (
    <header className='sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl'>
      <div className='mx-auto flex max-w-7xl items-center justify-between px-5 py-4 md:px-8'>
        <Link to='/' className='flex items-center gap-3'>
          <BrandMark
            logoUrl={logoUrl}
            iconUrl={settings.icon_url}
            siteName={siteName}
            imageClassName='h-9 sm:h-11'
          />
        </Link>
        <nav className='hidden items-center gap-7 text-sm font-semibold text-slate-600 lg:flex'>
          <Link to='/solutions'>{label.services}</Link>
          <Link to='/demo'>{label.demo}</Link>
          <Link to='/pricing'>{label.pricing}</Link>
          <Link to='/blog'>{label.blog}</Link>
          <Link to='/about'>{label.about}</Link>
          <Link to='/contact'>{label.contact}</Link>
        </nav>
        <div className='flex items-center gap-2 sm:gap-3'>
          <Link
            to='/sign-in'
            className='hidden h-10 items-center rounded-full border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700 sm:inline-flex'
          >
            {label.login}
          </Link>
          <Link
            to='/sign-up'
            className='hidden h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700 md:inline-flex'
          >
            {label.register}
          </Link>
          <Link
            to='/demo'
            className='inline-flex h-10 items-center rounded-full bg-slate-950 px-3 text-sm font-semibold whitespace-nowrap text-white shadow-lg shadow-slate-950/10 transition hover:bg-sky-700 sm:px-4'
          >
            {label.trial}
          </Link>
          <button
            type='button'
            className='inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-700 transition hover:bg-sky-50 lg:hidden'
            aria-expanded={menuOpen}
            aria-controls='public-mobile-menu'
            aria-label={menuOpen ? label.closeMenu : label.openMenu}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X className='size-5' /> : <Menu className='size-5' />}
          </button>
        </div>
      </div>
      {menuOpen ? (
        <nav
          id='public-mobile-menu'
          className='border-t border-slate-200/80 px-5 pb-4 md:px-8 lg:hidden'
        >
          <ul className='mx-auto grid max-w-7xl text-base font-semibold text-slate-700'>
            {mobileMenuLinks.map((link) => (
              <li key={link.to}>
                <Link
                  to={link.to}
                  onClick={closeMenu}
                  className='flex min-h-12 items-center border-b border-slate-100 hover:text-sky-700'
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </header>
  )
}

export function PublicFooter() {
  return (
    <footer className='border-t border-slate-200 bg-white'>
      <div className='mx-auto flex max-w-7xl flex-col gap-5 px-5 py-10 text-sm text-slate-500 md:flex-row md:items-center md:justify-between md:px-8'>
        <p>{label.footer}</p>
        <div className='flex flex-wrap gap-x-5 font-medium [&>a]:py-2'>
          <Link to='/solutions'>{label.services}</Link>
          <Link to='/pricing'>{label.pricing}</Link>
          <Link to='/contact'>{label.contact}</Link>
          <Link to='/sign-in'>{label.login}</Link>
          <Link to='/sign-up'>{label.register}</Link>
          <Link to='/contact'>{label.demoRequest}</Link>
        </div>
      </div>
    </footer>
  )
}

export function PublicPageShell({ children }: { children: ReactNode }) {
  return (
    <div className='min-h-screen bg-[#f7f9fd] text-slate-950'>
      <PublicHeader />
      <main>{children}</main>
      <PublicFooter />
    </div>
  )
}

export function PublicPageHero({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <section className='mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-24'>
      <div className='max-w-4xl'>
        <p className='text-xs font-extrabold tracking-[0.18em] text-sky-600 uppercase'>
          {eyebrow}
        </p>
        <h1 className='mt-4 text-4xl font-black tracking-tight text-slate-950 md:text-6xl'>
          {title}
        </h1>
        <p className='mt-5 max-w-3xl text-base leading-8 text-slate-600 md:text-lg'>
          {description}
        </p>
        {children ? <div className='mt-8'>{children}</div> : null}
      </div>
    </section>
  )
}

export function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description?: string
}) {
  return (
    <div className='mx-auto mb-10 max-w-3xl text-center'>
      <p className='text-xs font-extrabold tracking-[0.18em] text-sky-600 uppercase'>
        {eyebrow}
      </p>
      <h2 className='mt-3 text-3xl font-extrabold tracking-tight text-slate-950 md:text-5xl'>
        {title}
      </h2>
      {description ? (
        <p className='mt-4 text-base leading-8 text-slate-600'>{description}</p>
      ) : null}
    </div>
  )
}

export function PublicCard({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <article
      className={`rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm shadow-slate-200/40 ${className}`}
    >
      {children}
    </article>
  )
}
