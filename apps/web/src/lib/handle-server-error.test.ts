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
})

describe('handleServerError', () => {
  it('shows a generic message when the error is not recognised', () => {
    handleServerError(new Error('network'))

    expect(toastError).toHaveBeenCalledWith('Something went wrong!')
  })

  it('maps a plain object with status 204 to the no-content message', () => {
    handleServerError({ status: 204 })

    expect(toastError).toHaveBeenCalledWith('No content.')
  })

  it('prefers an API response title when it is available', () => {
    const error = {
      message: 'Bad request',
      response: { status: 422, data: { title: 'Validation failed' } },
    }

    handleServerError(error)

    expect(toastError).toHaveBeenCalledWith('Validation failed')
  })

  it('falls back to the generic message when the response has no title', () => {
    const error = { response: { status: 500, data: {} } }

    handleServerError(error)

    expect(toastError).toHaveBeenCalledWith('Something went wrong!')
  })

  it('falls back to the generic message when the response title is empty', () => {
    const error = { response: { status: 400, data: { title: '' } } }

    handleServerError(error)

    expect(toastError).toHaveBeenCalledWith('Something went wrong!')
  })
})
