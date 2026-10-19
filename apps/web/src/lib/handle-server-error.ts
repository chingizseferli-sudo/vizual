import { toast } from 'sonner'
import { getErrorStatus, getErrorTitle } from '@/lib/errors'

export function handleServerError(error: unknown) {
  let errMsg = 'Something went wrong!'

  if (getErrorStatus(error) === 204) {
    errMsg = 'No content.'
  }

  errMsg = getErrorTitle(error) ?? errMsg

  toast.error(errMsg)
}
