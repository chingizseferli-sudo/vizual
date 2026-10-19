export function getAuthErrorMessage(message?: string | null) {
  const normalized = (message || '').toLowerCase()

  if (!normalized)
    return 'Əməliyyat tamamlanmadı. Bir az sonra yenidən cəhd edin.'
  if (normalized.includes('invalid login credentials')) {
    return 'Email və ya şifrə yanlışdır.'
  }
  if (
    normalized.includes('invalid api key') ||
    normalized.includes('api key')
  ) {
    return 'Sistem bağlantısı düzgün qurulmayıb. Zəhmət olmasa adminlə əlaqə saxlayın.'
  }
  if (
    normalized.includes('expired') ||
    normalized.includes('invalid token') ||
    normalized.includes('token')
  ) {
    return 'Linkin vaxtı bitib və ya etibarsızdır. Zəhmət olmasa yenidən link istəyin.'
  }
  if (
    normalized.includes('network') ||
    normalized.includes('fetch') ||
    normalized.includes('failed to fetch')
  ) {
    return 'Bağlantı xətası baş verdi. İnternet bağlantısını yoxlayıb yenidən cəhd edin.'
  }
  if (normalized.includes('email not confirmed')) {
    return 'Email ünvanı təsdiqlənməyib. Zəhmət olmasa emailinizi yoxlayın.'
  }
  if (
    normalized.includes('already registered') ||
    normalized.includes('already exists')
  ) {
    return 'Bu email ilə hesab artıq mövcuddur.'
  }

  return message || 'Naməlum xəta baş verdi. Bir az sonra yenidən cəhd edin.'
}
