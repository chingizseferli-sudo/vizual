import { clientEnv } from '@/config/env'
import { createClient } from '@supabase/supabase-js'

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

export const supabase = createClient(
  clientEnv.supabaseUrl,
  clientEnv.supabaseAnonKey,
  {
    auth: {
      storageKey: getAuthStorageKey(),
      persistSession: clientEnv.isConfigured,
      autoRefreshToken: clientEnv.isConfigured,
      detectSessionInUrl: clientEnv.isConfigured,
    },
  }
)
