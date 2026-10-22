import { toast } from 'sonner'
import { friendlyError } from '@/lib/friendly-error'

export function handleServerError(error: unknown) {
  toast.error(friendlyError(error))
}
