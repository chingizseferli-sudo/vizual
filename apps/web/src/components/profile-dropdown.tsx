import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  type CurrentProfile,
  getCurrentSupabaseProfile,
} from '@/lib/auth-session'
import useDialogState from '@/hooks/use-dialog-state'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SignOutDialog } from '@/components/sign-out-dialog'

function getRoleLabel(role?: string | null) {
  if (role === 'superadmin') return 'Superadmin'
  if (role === 'admin') return 'Admin'
  if (role === 'customer') return 'İstifadəçi'
  return 'Visual Monitor'
}

function getProfileDisplay(session: CurrentProfile | null) {
  const email = session?.profile?.email ?? session?.user?.email ?? '—'
  const name =
    email === '—' ? 'Visual Monitor' : getRoleLabel(session?.profile?.role)

  return {
    name,
    email,
    avatarFallback: name === 'Visual Monitor' ? 'VM' : name.slice(0, 2),
  }
}

export function ProfileDropdown() {
  const [open, setOpen] = useDialogState()
  const [sessionProfile, setSessionProfile] = useState<CurrentProfile | null>(
    null
  )
  const displayUser = getProfileDisplay(sessionProfile)

  useEffect(() => {
    let mounted = true

    getCurrentSupabaseProfile().then((profile) => {
      if (mounted) {
        setSessionProfile(profile)
      }
    })

    return () => {
      mounted = false
    }
  }, [])

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' className='relative h-8 w-8 rounded-full'>
            <Avatar className='h-8 w-8'>
              <AvatarImage src='/avatars/01.png' alt={displayUser.name} />
              <AvatarFallback>{displayUser.avatarFallback}</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className='w-56' align='end' forceMount>
          <DropdownMenuLabel className='font-normal'>
            <div className='flex flex-col gap-1.5'>
              <p className='text-sm leading-none font-medium'>
                {displayUser.name}
              </p>
              <p className='text-xs leading-none text-muted-foreground'>
                {displayUser.email}
              </p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link to='/admin/settings'>
                Profile
                <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to='/admin/settings'>
                Billing
                <DropdownMenuShortcut>⌘B</DropdownMenuShortcut>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to='/admin/settings'>
                Settings
                <DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem>New Team</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant='destructive' onClick={() => setOpen(true)}>
            Sign out
            <DropdownMenuShortcut className='text-current'>
              ⇧⌘Q
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SignOutDialog open={!!open} onOpenChange={setOpen} />
    </>
  )
}
