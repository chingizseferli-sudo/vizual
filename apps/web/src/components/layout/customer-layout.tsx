import { Outlet } from '@tanstack/react-router'
import { LogOut } from 'lucide-react'
import { getCookie } from '@/lib/cookies'
import { LayoutProvider } from '@/context/layout-provider'
import { SearchProvider } from '@/context/search-provider'
import useDialogState from '@/hooks/use-dialog-state'
import { Button } from '@/components/ui/button'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { CustomerNotifications } from '@/components/layout/customer-notifications'
import { CustomerSidebar } from '@/components/layout/customer-sidebar'
import { SignOutDialog } from '@/components/sign-out-dialog'
import { SkipToMain } from '@/components/skip-to-main'
import { LanguageSwitcher } from '@/components/language-switcher'
import { t } from '@/lib/i18n'

export function CustomerLayout() {
  const defaultOpen = getCookie('sidebar_state') !== 'false'
  const [openSignOut, setOpenSignOut] = useDialogState()

  return (
    <SearchProvider>
      <LayoutProvider>
        <SidebarProvider
          defaultOpen={defaultOpen}
          className='portal-shell customer-shell'
        >
          <SkipToMain />
          <CustomerSidebar />
          <SidebarInset className='min-w-0 bg-transparent'>
            <header className='sticky top-0 z-40 flex h-16 min-w-0 shrink-0 items-center justify-between gap-2 border-b border-border bg-background/95 px-3 backdrop-blur md:px-6'>
              <div className='flex min-w-0 flex-1 items-center gap-2'>
                <SidebarTrigger
                  variant='outline'
                  className='size-11 shrink-0 bg-card'
                />
                <div className='min-w-0'>
                  <div className='truncate text-sm font-semibold text-foreground'>{t("İş masası")}</div>
                  <div className='hidden truncate text-xs text-muted-foreground sm:block'>{t("Monitorlar, nəticələr və bildirişlər")}</div>
                </div>
              </div>
              <div className='flex shrink-0 items-center gap-2'>
                <LanguageSwitcher className='h-11' />
                <CustomerNotifications />
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  aria-label={t("Çıxış")}
                  className='size-11 gap-2 rounded-lg border-border bg-card sm:w-auto'
                  onClick={() => setOpenSignOut(true)}
                >
                  <LogOut className='size-4' />
                  <span className='hidden sm:inline'>{t("Çıxış")}</span>
                </Button>
              </div>
            </header>
            <main id='content' tabIndex={-1} className='portal-content'>
              <Outlet />
            </main>
            <SignOutDialog open={!!openSignOut} onOpenChange={setOpenSignOut} />
          </SidebarInset>
        </SidebarProvider>
      </LayoutProvider>
    </SearchProvider>
  )
}
