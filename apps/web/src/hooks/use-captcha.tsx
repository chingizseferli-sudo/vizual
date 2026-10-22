import { useCallback, useState } from 'react'
import { TurnstileWidget } from '@/components/turnstile-widget'

function captchaSiteKey() {
  return (
    (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() ||
    ''
  )
}

// Tokens are single-use: call reset() after every auth request.
export function useCaptcha() {
  const siteKey = captchaSiteKey()
  const [token, setToken] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)

  const reset = useCallback(() => {
    setToken(null)
    setGeneration((value) => value + 1)
  }, [])

  return {
    token,
    // Supabase auth options to spread into the request; empty when disabled.
    options: token ? { captchaToken: token } : {},
    // Blocks submit until the widget has produced a token.
    missing: Boolean(siteKey) && !token,
    reset,
    widget: siteKey ? (
      <TurnstileWidget key={generation} siteKey={siteKey} onToken={setToken} />
    ) : null,
  }
}
