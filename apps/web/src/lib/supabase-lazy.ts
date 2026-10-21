import { clientEnv } from '@/config/env'

const ADMIN_AUTH_STORAGE_KEY = 'visual-monitor-admin-auth'
const CUSTOMER_AUTH_STORAGE_KEY = 'visual-monitor-customer-auth'

function getAuthStorageKey() {
  if (typeof window !== 'undefined') {
    const path = window.location.pathname || ''

    if (path.startsWith('/admin')) {
      return ADMIN_AUTH_STORAGE_KEY
    }
  }

  return CUSTOMER_AUTH_STORAGE_KEY
}

// Evaluated once from main.tsx, so the key follows the page the app was
// opened on even though the Supabase client is created later, on first use.
export const authStorageKey = getAuthStorageKey()

// For code on the public pages' startup path: keeps supabase-js out of the
// entry bundle so the landing page paints before it downloads.
export function loadSupabase() {
  return import('@/lib/supabase').then((module) => module.supabase)
}

// Anonymous read of a public table through PostgREST. The public pages use it
// so the landing page never downloads supabase-js. Returns null on any error.
export async function fetchPublicRows<T>(
  table: string,
  query: Record<string, string>
): Promise<T[] | null> {
  if (!clientEnv.isConfigured) return null
  try {
    const response = await fetch(
      `${clientEnv.supabaseUrl}/rest/v1/${table}?${new URLSearchParams(query)}`,
      {
        headers: {
          apikey: clientEnv.supabaseAnonKey,
          Authorization: `Bearer ${clientEnv.supabaseAnonKey}`,
        },
      }
    )
    return response.ok ? ((await response.json()) as T[]) : null
  } catch {
    return null
  }
}

export type DemoRequestInput = {
  name: string
  company: string
  email: string
  phone: string
  message: string
  lang: string
  // Hidden from people; bots fill it, and the server then drops the request.
  website: string
}

// Sends the public demo request form (submit_demo_request in SQL) without
// loading supabase-js on the public pages.
export async function submitDemoRequest(
  input: DemoRequestInput
): Promise<'ok' | 'rate_limited' | 'error'> {
  if (!clientEnv.isConfigured) return 'error'
  try {
    const response = await fetch(
      `${clientEnv.supabaseUrl}/rest/v1/rpc/submit_demo_request`,
      {
        method: 'POST',
        headers: {
          apikey: clientEnv.supabaseAnonKey,
          Authorization: `Bearer ${clientEnv.supabaseAnonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_name: input.name,
          p_company: input.company,
          p_email: input.email,
          p_phone: input.phone,
          p_message: input.message,
          p_lang: input.lang,
          p_website: input.website,
        }),
      }
    )
    if (response.ok) return 'ok'
    const body = await response.text()
    return body.includes('too_many_requests') ? 'rate_limited' : 'error'
  } catch {
    return 'error'
  }
}
