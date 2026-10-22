type ErrorLike = {
  message?: unknown
  status?: unknown
  response?: {
    status?: unknown
  }
}

function asErrorLike(error: unknown): ErrorLike | null {
  return error !== null && typeof error === 'object'
    ? (error as ErrorLike)
    : null
}

export function getErrorStatus(error: unknown): number | null {
  const value = asErrorLike(error)
  const status = value?.response?.status ?? value?.status
  const parsed = Number(status)

  return Number.isInteger(parsed) ? parsed : null
}
