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
