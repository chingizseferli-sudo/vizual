import { cn } from '@/lib/utils'
import { LANGS, getLang, setLang } from '@/lib/i18n'

type LanguageSwitcherProps = {
  className?: string
}

export function LanguageSwitcher({ className }: LanguageSwitcherProps) {
  // The admin panel is Azerbaijani only.
  if (window.location.pathname.startsWith('/admin')) return null

  const current = getLang()

  return (
    <div
      role='group'
      aria-label='Dil / Язык'
      className={cn(
        'inline-flex h-9 shrink-0 items-center rounded-lg border border-border bg-card p-0.5 text-xs font-semibold',
        className
      )}
    >
      {LANGS.map(({ code, label }) => (
        <button
          key={code}
          type='button'
          lang={code}
          aria-pressed={current === code}
          onClick={() => setLang(code)}
          className={cn(
            'h-full min-w-9 rounded-md px-2 transition-colors',
            current === code
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
