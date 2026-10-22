import { t } from '@/lib/i18n'

// Turns any error (Supabase Auth, PostgREST, our SQL raise codes, edge
// functions, network) into a short message a customer can act on. Raw
// technical text never reaches the screen: it goes to the console only.

export const GENERIC_ERROR = 'Xəta baş verdi. Bir az sonra yenidən cəhd edin.'

type ErrorLike = {
  message?: unknown
  code?: unknown
  status?: unknown
  name?: unknown
  error_description?: unknown
}

// Codes raised by our SQL functions (supabase/migrations) and their texts.
const APP_CODES: Record<string, string> = {
  AUTH_REQUIRED: 'Sessiyanın vaxtı bitib. Zəhmət olmasa yenidən daxil olun.',
  ADMIN_ACCESS_REQUIRED:
    'Bu əməliyyat üçün admin icazəsi lazımdır. Yenidən daxil olub iki addımlı kodu yazın.',
  ACCOUNT_NOT_ACTIVE:
    'Hesabınız aktiv deyil. Hesab təsdiqləndikdən və ya plan aktivləşdikdən sonra yenidən cəhd edin.',
  ACTIVE_PLAN_NOT_FOUND: 'Aktiv plan tapılmadı. Adminlə əlaqə saxlayın.',
  DEFAULT_PLAN_REQUIRED: 'Əsas plan silinə və ya söndürülə bilməz.',
  USER_PROFILE_NOT_FOUND: 'İstifadəçi profili tapılmadı.',
  PENDING_SIGNUP_NOT_FOUND: 'Gözləyən müraciət tapılmadı. Səhifəni yeniləyin.',
  PROFILE_SENSITIVE_FIELDS_ADMIN_ONLY:
    'Bu sahələri yalnız admin dəyişə bilər.',
  SUBSCRIPTION_STATUS_INVALID: 'Abunəlik statusu yanlışdır.',
  SUBSCRIPTION_NOTES_TOO_LONG: 'Qeyd çox uzundur.',
  SUBSCRIPTION_END_MUST_BE_FUTURE: 'Bitmə tarixi gələcəkdə olmalıdır.',
  TELEGRAM_CHAT_LINK_REQUIRED:
    'Əvvəlcə Telegram-ı profildən qoşun.',
  PLAN_KEYWORD_LIMIT_REACHED:
    'Planınızda açar söz limiti dolub. Bir açar sözü silin, dayandırın və ya planınızı yüksəldin.',
  PLAN_SOCIAL_KEYWORD_LIMIT_REACHED:
    'Facebook və Instagram üçün açar söz limiti dolub. Başqa bir sözdən FB/IG-ni söndürün və ya planınızı yüksəldin.',
  PLAN_SOCIAL_NOT_INCLUDED:
    'Planınıza Facebook və Instagram monitorinqi daxil deyil.',
  PLAN_COMPETITOR_LIMIT_REACHED:
    'Planınızda rəqib limiti dolub. Bir rəqibi silin və ya planınızı yüksəldin.',
  PLAN_WATCH_LIMIT_REACHED:
    'Planınızda veb izləmə limiti dolub.',
  KEYWORD_EXISTS: 'Bu açar söz artıq əlavə edilib.',
  KEYWORD_NOT_FOUND: 'Açar söz tapılmadı. Səhifəni yeniləyin.',
  KEYWORD_LENGTH_INVALID: 'Açar söz 1-200 simvol olmalıdır.',
  KEYWORD_STATUS_INVALID: 'Açar söz statusu yanlışdır.',
  KEYWORD_MATCH_TYPE_INVALID: 'Açar söz uyğunluq növü yanlışdır.',
  USE_KEYWORD_FUNCTIONS: 'Açar sözləri yalnız Açar sözlər səhifəsindən dəyişmək olar.',
  MONITORS_MANAGED_BY_SYSTEM: 'Bu məlumatı sistem özü idarə edir.',
  MONITOR_NAME_REQUIRED: 'Ad yazılmalıdır.',
  COMPETITOR_EXISTS: 'Bu adda rəqib artıq əlavə edilib.',
  COMPETITOR_NOT_FOUND: 'Rəqib tapılmadı. Səhifəni yeniləyin.',
  COMPETITOR_KEYWORDS_TOO_MANY: 'Hər rəqib üçün ən çox 3 açar söz yazmaq olar.',
  COMPETITOR_KEYWORD_INVALID: 'Hər açar söz 2-100 simvol olmalıdır.',
  COMPETITOR_NAME_INVALID: 'Rəqibin adı 1-80 simvol olmalıdır.',
  CHANGE_SOURCE_NOT_FOUND: 'İzləmə tapılmadı. Səhifəni yeniləyin.',
  CHANGE_SOURCE_FORBIDDEN: 'Bu izləməni dəyişməyə icazəniz yoxdur.',
  too_many_requests:
    'Cəhd sayı aşıldı. Bir neçə dəqiqədən sonra yenidən cəhd edin.',
}

const RATE_LIMIT = 'Cəhd sayı aşıldı. Bir neçə dəqiqədən sonra yenidən cəhd edin.'
const EMAIL_RATE_LIMIT =
  'Çox sayda email göndərildi. Bir neçə dəqiqədən sonra yenidən cəhd edin.'
const NETWORK =
  'Serverə qoşulmaq olmadı. İnternet bağlantısını yoxlayıb yenidən cəhd edin.'
const SESSION_EXPIRED = 'Sessiyanın vaxtı bitib. Zəhmət olmasa yenidən daxil olun.'

// Supabase Auth error codes (AuthError.code).
const AUTH_CODES: Record<string, string> = {
  over_email_send_rate_limit: EMAIL_RATE_LIMIT,
  over_sms_send_rate_limit: RATE_LIMIT,
  over_request_rate_limit: RATE_LIMIT,
  invalid_credentials: 'Email və ya şifrə yanlışdır.',
  email_not_confirmed:
    'Email ünvanı təsdiqlənməyib. Zəhmət olmasa emailinizi yoxlayın.',
  user_already_exists: 'Bu email ilə hesab artıq mövcuddur.',
  email_exists: 'Bu email ilə hesab artıq mövcuddur.',
  weak_password:
    'Şifrə çox zəifdir. Ən azı 8 simvol, hərf və rəqəm istifadə edin.',
  same_password: 'Yeni şifrə köhnə şifrədən fərqli olmalıdır.',
  captcha_failed:
    'Robot yoxlaması alınmadı. Yoxlamanı yenidən keçib təkrar cəhd edin.',
  otp_expired: 'Linkin və ya kodun vaxtı bitib. Zəhmət olmasa yenisini istəyin.',
  otp_disabled: 'Bu giriş üsulu aktiv deyil.',
  bad_jwt: SESSION_EXPIRED,
  session_expired: SESSION_EXPIRED,
  session_not_found: SESSION_EXPIRED,
  refresh_token_not_found: SESSION_EXPIRED,
  refresh_token_already_used: SESSION_EXPIRED,
  user_not_found: 'Bu email ilə hesab tapılmadı.',
  user_banned: 'Hesabınız bloklanıb. Adminlə əlaqə saxlayın.',
  signup_disabled: 'Qeydiyyat hazırda bağlıdır.',
  email_address_invalid: 'Email ünvanı yanlışdır.',
  email_address_not_authorized:
    'Bu email ünvanına məktub göndərmək mümkün olmadı. Başqa ünvan yoxlayın.',
  validation_failed: 'Məlumatlar düzgün doldurulmayıb.',
  mfa_verification_failed: 'Kod yanlışdır. Tətbiqdəki yeni kodu yazın.',
  mfa_challenge_expired: 'Kodun vaxtı bitib. Yenidən cəhd edin.',
  mfa_factor_not_found: 'İki addımlı giriş tapılmadı. Yenidən qurun.',
  insufficient_aal: 'Davam etmək üçün iki addımlı kodu yazın.',
  flow_state_expired: 'Linkin vaxtı bitib. Zəhmət olmasa yenisini istəyin.',
  flow_state_not_found: 'Linkin vaxtı bitib. Zəhmət olmasa yenisini istəyin.',
}

// Postgres / PostgREST codes.
const DB_CODES: Record<string, string> = {
  '42501': 'Bu əməliyyat üçün icazəniz yoxdur.',
  '28000': SESSION_EXPIRED,
  '23505': 'Bu məlumat artıq mövcuddur.',
  '23514': 'Daxil edilən məlumat qaydalara uyğun deyil.',
  '23502': 'Vacib sahə boş qalıb.',
  '23503': 'Əlaqəli məlumat tapılmadı. Səhifəni yeniləyin.',
  '22001': 'Mətn çox uzundur.',
  '22023': 'Daxil edilən məlumat yanlışdır.',
  '22P02': 'Daxil edilən məlumat yanlışdır.',
  P0002: 'Məlumat tapılmadı. Səhifəni yeniləyin.',
  '57014': 'Sorğu çox uzun çəkdi. Bir az sonra yenidən cəhd edin.',
  PGRST301: SESSION_EXPIRED,
  PGRST303: SESSION_EXPIRED,
  PGRST116: 'Məlumat tapılmadı.',
  PGRST202: 'Bu funksiya hələ aktiv deyil. Bir az sonra yenidən cəhd edin.',
  PGRST204: 'Bu funksiya hələ aktiv deyil. Bir az sonra yenidən cəhd edin.',
  PGRST205: 'Bu funksiya hələ aktiv deyil. Bir az sonra yenidən cəhd edin.',
}

// Matches on the raw English text, for errors that arrive without a code.
const TEXT_RULES: [RegExp, string][] = [
  [/email rate limit|over_email_send_rate_limit/i, EMAIL_RATE_LIMIT],
  [/error sending (confirmation|recovery|magic link|invite|email change)|sending .*email/i, 'Təsdiq maili göndərilmədi. Bir az sonra yenidən cəhd edin və ya bizimlə əlaqə saxlayın.'],
  [/database error saving new user|database error (creating|updating)/i, 'Hesab yaradılmadı. Bir az sonra yenidən cəhd edin və ya bizimlə əlaqə saxlayın.'],
  [/rate limit|too many requests|too_many_requests/i, RATE_LIMIT],
  [/invalid login credentials/i, AUTH_CODES.invalid_credentials],
  [/email not confirmed/i, AUTH_CODES.email_not_confirmed],
  [/already registered|already been registered|already exists/i, AUTH_CODES.user_already_exists],
  [/new password should be different/i, AUTH_CODES.same_password],
  [/password should|password is too weak|weak password/i, AUTH_CODES.weak_password],
  [/captcha/i, AUTH_CODES.captcha_failed],
  [/invalid totp|invalid mfa|mfa verification/i, AUTH_CODES.mfa_verification_failed],
  [/expired|invalid or has expired|token is invalid|invalid token/i, AUTH_CODES.otp_expired],
  [/jwt|session/i, SESSION_EXPIRED],
  [/failed to fetch|networkerror|network request failed|load failed|fetch failed|err_network|timeout|timed out/i, NETWORK],
  [/permission denied|row-level security|violates row-level/i, DB_CODES['42501']],
  [/duplicate key|unique constraint/i, DB_CODES['23505']],
  [/violates check constraint/i, DB_CODES['23514']],
]

function asErrorLike(error: unknown): ErrorLike | null {
  if (error === null || error === undefined) return null
  if (typeof error === 'string') return { message: error }
  return typeof error === 'object' ? (error as ErrorLike) : null
}

function text(value: unknown) {
  return typeof value === 'string' ? value : ''
}

// Our own messages are already written in Azerbaijani (or Russian) for people.
const HUMAN_TEXT = /[əğıöüşçƏĞİÖÜŞÇЀ-ӿ]/

export function friendlyErrorKey(error: unknown): string | null {
  const value = asErrorLike(error)
  if (!value) return null

  const code = text(value.code)
  const message = text(value.message) || text(value.error_description)
  const status = Number(value.status)

  if (code && AUTH_CODES[code]) return AUTH_CODES[code]
  for (const [appCode, appText] of Object.entries(APP_CODES)) {
    if (message.includes(appCode)) return appText
  }
  if (code && DB_CODES[code]) return DB_CODES[code]
  if (status === 429) return RATE_LIMIT
  for (const [pattern, rule] of TEXT_RULES) {
    if (pattern.test(message)) return rule
  }
  if (text(value.name) === 'AuthRetryableFetchError') return NETWORK
  if (status === 401) return SESSION_EXPIRED
  if (status === 403) return DB_CODES['42501']
  return null
}

// friendlyError(error) → a translated message safe to show. Unknown errors get
// the fallback (already-translated text) or the generic message.
export function friendlyError(error: unknown, fallback?: string): string {
  const key = friendlyErrorKey(error)
  if (key) return t(key)

  const message = text(asErrorLike(error)?.message)
  if (message && HUMAN_TEXT.test(message) && !/[a-z]{3,}_[a-z]{3,}/i.test(message)) {
    return message
  }
  if (error) console.error(error)
  return fallback ?? t(GENERIC_ERROR)
}
