import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { routeTree } from '@/routeTree.gen'
import '@/styles/index.css'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { DirectionProvider } from '@/context/direction-provider'
import { FontProvider } from '@/context/font-provider'
import { ThemeProvider } from '@/context/theme-provider'
import { portalFixture } from './portal-fixtures'

vi.mock('@/lib/supabase', async () => ({
  supabase: (await import('./portal-fixtures')).fixtureSupabase,
}))
vi.mock('@/lib/auth-session', async () => ({
  getCurrentSupabaseProfile: async () =>
    (await import('./portal-fixtures')).fixtureProfile(),
}))
vi.mock('@/hooks/use-public-site-brand', () => ({
  usePublicSiteBrand: () => ({
    siteName: 'Vizual • UI sınağı',
    logoUrl: '',
    iconUrl: '',
  }),
}))

const widths = [320, 375, 390, 430, 768, 1024, 1280, 1440]
const routes = [
  '/monitor',
  '/monitor/workspace-preview',
  '/monitor/workspace-previe',
  '/monitor/keywords',
  '/monitor/results',
  '/monitor/alerts',
  '/monitor/profile',
  '/monitor/watch-monitor',
  '/monitor/story-intelligence',
  '/monitor/story-intelligence-preview',
  '/admin',
  '/admin/users',
  '/admin/users/fixture-user',
  '/admin/subscriptions',
  '/admin/monitor',
  '/admin/monitor/monitors',
  '/admin/monitor/monitors/fixture-monitor',
  '/admin/monitor/sources',
  '/admin/monitor/results',
  '/admin/monitor/alerts',
  '/admin/monitor/logs',
  '/admin/monitor/problems',
  '/admin/monitor/picker',
  '/admin/news',
  '/admin/news/123',
  '/admin/news/123/edit',
  '/admin/settings',
  '/admin/settings/account',
  '/admin/settings/appearance',
  '/admin/settings/display',
  '/admin/settings/notifications',
  '/admin/settings/brand-seo',
  '/admin/settings/public-site',
  '/admin/errors/forbidden',
  '/admin/errors/unauthorized',
  '/admin/errors/not-found',
  '/admin/errors/internal-server-error',
  '/admin/errors/maintenance-error',
]
const visualRoutes = new Set([
  '/monitor',
  '/admin',
  '/monitor/keywords',
  '/monitor/watch-monitor',
  '/admin/users',
  '/admin/subscriptions',
])
let queryClient: QueryClient
const realDateNow = Date.now.bind(Date)

async function openRoute(path: string, waitForData = true) {
  portalFixture.role = path.startsWith('/admin') ? 'admin' : 'customer'
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient },
  })
  await router.load()
  await render(
    <QueryClientProvider client={queryClient}>
      <DirectionProvider>
        <FontProvider>
          <ThemeProvider defaultTheme='light'>
            <RouterProvider router={router} />
          </ThemeProvider>
        </FontProvider>
      </DirectionProvider>
    </QueryClientProvider>
  )
  await expect
    .poll(() => document.querySelector('[data-slot="sidebar-inset"]'))
    .not.toBeNull()
  await expect
    .poll(() => document.body.textContent?.includes('Sessiya yoxlanılır'))
    .toBe(false)
  if (!waitForData) return
  await expect.poll(() => queryClient.isFetching()).toBe(0)
  await expect
    .poll(() =>
      /yüklənir|Yüklənir/.test(
        document.querySelector('[data-slot="sidebar-inset"]')?.textContent || ''
      )
    )
    .toBe(false)
  await document.fonts.ready
}

beforeEach(() => {
  portalFixture.state = 'ready'
  vi.useFakeTimers({ toFake: ['Date'] })
  const fixtureTime = new Date('2026-10-11T12:00:00Z').getTime()
  const startedAt = realDateNow()
  vi.setSystemTime(fixtureTime)
  // Keep dashboard buckets on the fixture date while advancing matcher deadlines.
  vi.spyOn(Date, 'now').mockImplementation(
    () => fixtureTime + realDateNow() - startedAt
  )
  document.cookie = 'sidebar_state=true; path=/'
})
afterEach(async () => {
  await cleanup()
  queryClient?.clear()
  vi.useRealTimers()
})

describe.each(widths)('Portal at %ipx', (width) => {
  it.each(routes)('%s stays usable', async (path) => {
    await page.viewport(width, 900)
    await openRoute(path)
    const inset = document.querySelector<HTMLElement>(
      '[data-slot="sidebar-inset"]'
    )!
    if (!path.includes('/errors/'))
      expect(inset.textContent).not.toMatch(
        /Something went wrong|Səhifə tapılmadı/
      )
    expect(window.innerWidth).toBe(width)
    expect(document.querySelectorAll('main, [role=main]')).toHaveLength(1)
    const overflow = document.documentElement.scrollWidth - window.innerWidth
    expect(overflow, `${path} document overflow`).toBeLessThanOrEqual(1)
    if (visualRoutes.has(path)) {
      // Capture the actual initial viewport, including desktop navigation.
      // Element screenshots taller than the Vitest iframe contain blank pixels.
      const shell = document.querySelector<HTMLElement>('.portal-shell')!
      shell.style.maxHeight = '900px'
      shell.style.overflow = 'hidden'
      window.scrollTo(0, 0)
      expect(
        shell.querySelector('header')!.getBoundingClientRect().height
      ).toBe(path.startsWith('/admin') ? 56 : 64)
      await expect
        .element(shell)
        .toMatchScreenshot(`${path.replace(/\//g, '-')}-${width}.png`)
      shell.style.removeProperty('max-height')
      shell.style.removeProperty('overflow')
    }
  })
})

it('customer mobile navigation opens and closes with Escape', async () => {
  await page.viewport(320, 700)
  await openRoute('/monitor')
  const trigger = page.getByRole('button', { name: 'Menyunu aç / bağla' })
  await userEvent.click(trigger)
  await expect
    .element(page.getByRole('dialog', { name: 'Naviqasiya' }))
    .toBeVisible()
  await expect
    .element(page.getByRole('button', { name: 'Bağla', exact: true }))
    .toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(trigger).toHaveFocus()
})

it.each(['customer', 'admin'])(
  '%s drawer follows a route and unlocks scrolling',
  async (role) => {
    await page.viewport(375, 700)
    await openRoute(role === 'admin' ? '/admin' : '/monitor')
    await userEvent.click(
      page.getByRole('button', { name: 'Menyunu aç / bağla' })
    )
    const drawer = page.getByRole('dialog', { name: 'Naviqasiya' })
    await expect.element(drawer).toBeVisible()
    await userEvent.click(
      drawer.getByRole('link', {
        name: role === 'admin' ? 'İstifadəçilər' : 'Monitorlar',
        exact: true,
      })
    )
    await expect.element(drawer).not.toBeInTheDocument()
    await expect
      .poll(() => document.body.hasAttribute('data-scroll-locked'))
      .toBe(false)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375)
  }
)

it('mobile watch cards retain bulk selection', async () => {
  await page.viewport(320, 700)
  await openRoute('/monitor/watch-monitor')
  await userEvent.click(
    page.getByRole('checkbox', { name: 'Görünən izləmələrin hamısını seç' })
  )
  await expect
    .element(
      page.getByRole('button', { name: 'Seçilənləri sil (1)', exact: true })
    )
    .toBeVisible()
})

it('news creation drawer fits mobile and closes with Escape', async () => {
  await page.viewport(320, 700)
  await openRoute('/admin/news')
  await userEvent.click(
    page.getByRole('button', { name: 'Yeni xəbər', exact: true })
  )
  const dialog = page.getByRole('dialog', { name: 'Yeni xəbər əlavə et' })
  await expect.element(dialog).toBeVisible()
  await expect
    .element(page.getByRole('textbox', { name: 'Başlıq', exact: true }))
    .toBeVisible()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320)
  await userEvent.keyboard('{Escape}')
  await expect
    .element(page.getByRole('button', { name: 'Yeni xəbər', exact: true }))
    .toHaveFocus()
})

it.each(['loading', 'empty', 'error'] as const)(
  'dashboard renders %s state on mobile',
  async (state) => {
    await page.viewport(320, 700)
    portalFixture.state = state
    await openRoute('/monitor', state !== 'loading')
    if (state === 'loading')
      await expect.element(page.getByRole('status')).toBeVisible()
    if (state === 'error')
      await expect
        .element(page.getByRole('button', { name: 'Yenidən yoxla' }))
        .toBeVisible()
    if (state === 'empty')
      await expect
        .element(
          page.getByText('Başlamaq üçün açar söz əlavə edin', { exact: true })
        )
        .toBeVisible()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320)
  }
)

it('mobile notification dialog traps focus and restores the bell', async () => {
  await page.viewport(320, 700)
  await openRoute('/monitor')
  const trigger = page.getByRole('button', { name: 'Bildirişlər', exact: true })
  await userEvent.click(trigger)
  await expect
    .element(page.getByRole('dialog', { name: 'Bildirişlər' }))
    .toBeVisible()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320)
  await userEvent.keyboard('{Tab}')
  expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull()
  await userEvent.keyboard('{Escape}')
  await expect.element(trigger).toHaveFocus()
})

it('mobile subscription fields keep their visible accessible names', async () => {
  await page.viewport(320, 700)
  await openRoute('/admin/subscriptions')
  await expect
    .element(page.getByRole('textbox', { name: 'Plan adı', exact: true }))
    .toBeVisible()
  for (const name of [
    'Qiymət',
    'Açar söz limiti',
    'Veb izləmə limiti',
    'Minimum interval (dəqiqə)',
    'Tarixçə (gün)',
  ]) {
    await expect
      .element(page.getByRole('spinbutton', { name, exact: true }))
      .toBeVisible()
  }
  await expect
    .element(
      page.getByRole('combobox', { name: 'Hesablama dövrü', exact: true })
    )
    .toBeVisible()
})

it('mobile keyword form retains keyword entry and filtering', async () => {
  await page.viewport(320, 700)
  await openRoute('/monitor/keywords')
  await expect
    .element(
      page.getByRole('textbox', { name: 'Yeni açar sözlər', exact: true })
    )
    .toBeVisible()
  const search = page.getByRole('textbox', { name: 'Açar söz axtar...' })
  await userEvent.fill(search, 'unmatched-fixture')
  await expect
    .element(page.getByText('Bakı Dövlət Universiteti', { exact: true }))
    .not.toBeInTheDocument()
})

it('desktop navigation collapses and expands', async () => {
  await page.viewport(1280, 900)
  await openRoute('/admin')
  const trigger = page.getByRole('button', { name: 'Menyunu aç / bağla' })
  await userEvent.click(trigger)
  await expect
    .poll(() =>
      document
        .querySelector('[data-slot="sidebar"]')
        ?.getAttribute('data-state')
    )
    .toBe('collapsed')
  await userEvent.click(trigger)
  await expect
    .poll(() =>
      document
        .querySelector('[data-slot="sidebar"]')
        ?.getAttribute('data-state')
    )
    .toBe('expanded')
})

it.each([320, 375, 768])(
  'watch notification dialog stays within %ipx',
  async (width) => {
    await page.viewport(width, 700)
    await openRoute('/monitor/watch-monitor')
    const trigger = page.getByRole('button', {
      name: 'Dəyişiklik bildirişləri',
      exact: true,
    })
    await userEvent.click(trigger)
    const dialog = page.getByRole('dialog', { name: 'Dəyişiklik bildirişləri' })
    await expect.element(dialog).toBeVisible()
    const rect = document
      .querySelector('[role="dialog"]')!
      .getBoundingClientRect()
    expect(rect.left).toBeGreaterThanOrEqual(0)
    expect(rect.right).toBeLessThanOrEqual(width)
    expect(rect.top).toBeGreaterThanOrEqual(0)
    expect(rect.bottom).toBeLessThanOrEqual(700)
    await userEvent.keyboard('{Escape}')
    await expect.element(trigger).toHaveFocus()
  }
)
