import { beforeEach, describe, expect, it, vi } from 'vitest'
import { friendlyError, GENERIC_ERROR } from './friendly-error'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('friendlyError', () => {
  it('maps Supabase Auth rate limits by code and by text', () => {
    expect(
      friendlyError({ code: 'over_email_send_rate_limit', status: 429 })
    ).toBe('Çox sayda email göndərildi. Bir neçə dəqiqədən sonra yenidən cəhd edin.')
    expect(friendlyError(new Error('email rate limit exceeded'))).toBe(
      'Çox sayda email göndərildi. Bir neçə dəqiqədən sonra yenidən cəhd edin.'
    )
    expect(friendlyError({ message: 'Request rate limit reached', status: 429 })).toBe(
      'Cəhd sayı aşıldı. Bir neçə dəqiqədən sonra yenidən cəhd edin.'
    )
  })

  it('maps common sign-in errors', () => {
    expect(friendlyError({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(
      'Email və ya şifrə yanlışdır.'
    )
    expect(friendlyError(new Error('User already registered'))).toBe(
      'Bu email ilə hesab artıq mövcuddur.'
    )
    expect(friendlyError({ code: 'captcha_failed' })).toBe(
      'Robot yoxlaması alınmadı. Yoxlamanı yenidən keçib təkrar cəhd edin.'
    )
  })

  it('maps our SQL raise codes and Postgres codes', () => {
    expect(
      friendlyError({ code: 'P0001', message: 'PLAN_KEYWORD_LIMIT_REACHED' })
    ).toContain('açar söz limiti dolub')
    expect(friendlyError({ code: '42501', message: 'ADMIN_ACCESS_REQUIRED' })).toContain(
      'admin icazəsi'
    )
    expect(
      friendlyError({ code: '42501', message: 'permission denied for table x' })
    ).toBe('Bu əməliyyat üçün icazəniz yoxdur.')
    expect(
      friendlyError({ code: '23505', message: 'duplicate key value violates unique constraint "x"' })
    ).toBe('Bu məlumat artıq mövcuddur.')
  })

  it('maps network failures', () => {
    expect(friendlyError(new TypeError('Failed to fetch'))).toBe(
      'Serverə qoşulmaq olmadı. İnternet bağlantısını yoxlayıb yenidən cəhd edin.'
    )
  })

  it('never shows raw technical text', () => {
    const message = friendlyError({
      code: 'XX000',
      message: 'error happened while executing sql: relation "public.x" does not exist',
    })
    expect(message).toBe(GENERIC_ERROR)
    expect(console.error).toHaveBeenCalled()
  })

  it('keeps our own Azerbaijani messages and uses the fallback otherwise', () => {
    expect(friendlyError(new Error('Telegram linki yaradılmadı.'))).toBe(
      'Telegram linki yaradılmadı.'
    )
    expect(friendlyError(new Error('boom'), 'Plan saxlanmadı.')).toBe('Plan saxlanmadı.')
    expect(friendlyError(null, 'Plan saxlanmadı.')).toBe('Plan saxlanmadı.')
  })
})
