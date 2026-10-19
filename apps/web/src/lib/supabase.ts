import { clientEnv } from '@/config/env'
import { createClient } from '@supabase/supabase-js'
import { authStorageKey } from '@/lib/supabase-lazy'

export const supabase = createClient(
  clientEnv.supabaseUrl,
  clientEnv.supabaseAnonKey,
  {
    auth: {
      storageKey: authStorageKey,
      persistSession: clientEnv.isConfigured,
      autoRefreshToken: clientEnv.isConfigured,
      detectSessionInUrl: clientEnv.isConfigured,
    },
  }
)
