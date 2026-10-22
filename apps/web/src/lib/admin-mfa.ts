import { supabase } from '@/lib/supabase'

// Where an admin session stands on two-step login. The database grants admin
// rights only to aal2 sessions (is_admin_user()), so the UI sends anything
// else to /admin/mfa: 'challenge' when an authenticator is already set up,
// 'enroll' when the admin has none yet.
export type AdminMfaState = 'verified' | 'challenge' | 'enroll'

export async function getAdminMfaState(): Promise<AdminMfaState> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error) throw error
  if (data.currentLevel === 'aal2') return 'verified'
  return data.nextLevel === 'aal2' ? 'challenge' : 'enroll'
}

export function adminMfaPath(redirectTo: string) {
  return {
    to: '/admin/mfa' as const,
    search: { redirect: redirectTo },
    replace: true,
  }
}
