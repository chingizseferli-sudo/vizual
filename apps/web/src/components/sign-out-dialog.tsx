import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useLocation } from '@tanstack/react-router'
import { supabase } from '@/lib/supabase'
import { ConfirmDialog } from '@/components/confirm-dialog'

interface SignOutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SignOutDialog({ open, onOpenChange }: SignOutDialogProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut()

    if (error) {
      return
    }
    queryClient.clear()

    const currentPath = location.href
    const isAdminArea = currentPath.startsWith('/admin')

    navigate({
      to: isAdminArea ? '/admin/sign-in' : '/sign-in',
      search: { redirect: currentPath },
      replace: true,
    })
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Çıxış'
      desc='Çıxmaq istədiyinizə əminsiniz? Hesabınıza yenidən daxil olmalı olacaqsınız.'
      confirmText='Çıxış'
      destructive
      handleConfirm={handleSignOut}
      className='sm:max-w-sm'
    />
  )
}
