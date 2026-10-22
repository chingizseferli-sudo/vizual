import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleServerError } from './handle-server-error'

const toastError = vi.hoisted(() => vi.fn())

vi.mock('sonner', () => ({
  toast: {
    error: toastError,
  },
}))

beforeEach(() => {
  vi.mocked(toastError).mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('handleServerError', () => {
  it('shows the generic Azerbaijani message for an unknown error', () => {
    handleServerError(new Error('relation "x" does not exist'))

    expect(toastError).toHaveBeenCalledWith(
      'Xəta baş verdi. Bir az sonra yenidən cəhd edin.'
    )
  })

  it('maps a rate limit status to the retry message', () => {
    handleServerError({ status: 429 })

    expect(toastError).toHaveBeenCalledWith(
      'Cəhd sayı aşıldı. Bir neçə dəqiqədən sonra yenidən cəhd edin.'
    )
  })
})
