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
