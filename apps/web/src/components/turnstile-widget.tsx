import { useEffect, useRef, useState } from 'react'
import { getLang, t } from '@/lib/i18n'
import { useTheme } from '@/context/theme-provider'

// Cloudflare Turnstile for the Supabase Auth calls that captcha protection
// covers (sign-in, sign-up, password reset). Supabase checks the token with
// the secret key set in Authentication → Attack Protection. Without
// VITE_TURNSTILE_SITE_KEY no widget is shown and no token is sent.

const SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

type TurnstileOptions = {
  sitekey: string
  theme: 'light' | 'dark'
  language: string
  size: 'flexible'
  callback: (token: string) => void
  'expired-callback': () => void
  'error-callback': () => void
}

type TurnstileApi = {
  render: (element: HTMLElement, options: TurnstileOptions) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.onload = () =>
      window.turnstile
        ? resolve(window.turnstile)
        : reject(new Error('Turnstile did not load'))
    script.onerror = () => {
      scriptPromise = null
      script.remove()
      reject(new Error('Turnstile did not load'))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

export function TurnstileWidget({
  siteKey,
  onToken,
}: {
  siteKey: string
  onToken: (token: string | null) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { resolvedTheme } = useTheme()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let widgetId: string | null = null
    let cancelled = false

    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return
        widgetId = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: resolvedTheme,
          // Turnstile has no Azerbaijani; 'auto' follows the browser.
          language: getLang() === 'ru' ? 'ru' : 'auto',
          size: 'flexible',
          callback: (token) => onToken(token),
          'expired-callback': () => onToken(null),
          'error-callback': () => onToken(null),
        })
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [siteKey, resolvedTheme, onToken])

  return (
    <div className='min-h-[65px]' data-testid='captcha'>
      <div ref={containerRef} />
      {failed ? (
        <p className='text-sm text-destructive'>
          {t('Təhlükəsizlik yoxlaması yüklənmədi. Səhifəni yeniləyin.')}
        </p>
      ) : null}
    </div>
  )
}
