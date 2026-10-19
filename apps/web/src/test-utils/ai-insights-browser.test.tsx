import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { routeTree } from '@/routeTree.gen'
import '@/styles/index.css'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { DirectionProvider } from '@/context/direction-provider'
import { FontProvider } from '@/context/font-provider'
import { ThemeProvider } from '@/context/theme-provider'
import { aiFixture } from '@/features/ai-insights/fixtures'
import { portalFixture } from './portal-fixtures'

vi.mock('@/lib/supabase', async () => ({
  supabase: (await import('@/features/ai-insights/fixtures')).aiSupabase,
}))
vi.mock('@/lib/auth-session', async () => ({
  getCurrentSupabaseProfile: async () =>
    (await import('./portal-fixtures')).fixtureProfile(),
}))
vi.mock('@/hooks/use-public-site-brand', () => ({
  usePublicSiteBrand: () => ({
    siteName: 'Vizual • AI UI sınağı',
    logoUrl: '',
    iconUrl: '',
  }),
}))
let client: QueryClient
const realNow = Date.now.bind(Date)
async function open(wait = true) {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/monitor/ai-insights'] }),
    context: { queryClient: client },
  })
  await router.load()
  await render(
    <QueryClientProvider client={client}>
      <DirectionProvider>
        <FontProvider>
          <ThemeProvider defaultTheme='light'>
            <RouterProvider router={router} />
          </ThemeProvider>
        </FontProvider>
      </DirectionProvider>
    </QueryClientProvider>
  )
  await expect.poll(() => aiFixture.calls).toBeGreaterThan(0)
  if (wait) await expect.poll(() => client.isFetching()).toBe(0)
  await document.fonts.ready
}
beforeEach(() => {
  portalFixture.role = 'customer'
  portalFixture.state = 'ready'
  aiFixture.state = 'ready'
  aiFixture.requests = []
  aiFixture.calls = 0
  aiFixture.quality = 'substantial_excerpt'
  aiFixture.kind = 'complaint'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))
  vi.spyOn(Date, 'now').mockImplementation(realNow)
  document.cookie = 'sidebar_state=true; path=/'
})
afterEach(async () => {
  await cleanup()
  client?.clear()
  vi.useRealTimers()
})
describe.each([320, 375, 390, 430, 768, 1024, 1280, 1440])(
  'AI insights %ipx',
  (width) => {
    it('renders evidence-aware analysis without document overflow', async () => {
      await page.viewport(width, 900)
      await open()
      await expect
        .element(
          page.getByRole('heading', {
            name: 'Müzakirə təhlili və tövsiyələr',
            exact: true,
          })
        )
        .toBeVisible()
      expect(window.innerWidth).toBe(width)
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
      expect(document.querySelectorAll('main,[role=main]')).toHaveLength(1)
      const shell = document.querySelector<HTMLElement>('.portal-shell')!
      shell.style.maxHeight = '900px'
      shell.style.overflow = 'hidden'
      window.scrollTo(0, 0)
      await expect
        .element(shell)
        .toMatchScreenshot(`-monitor-ai-insights-${width}.png`)
      shell.style.removeProperty('max-height')
      shell.style.removeProperty('overflow')
    })
  }
)
it('submits only the selected monitor and date window with an idempotency key', async () => {
  await page.viewport(375, 900)
  await open()
  await userEvent.selectOptions(
    page.getByRole('combobox', { name: 'Monitor / təşkilat' }),
    'fixture-monitor'
  )
  await userEvent.click(
    page.getByRole('button', { name: 'Təhlil sorğusu yarat' })
  )
  await expect.poll(() => aiFixture.requests.length).toBe(1)
  expect(aiFixture.requests[0]).toMatchObject({
    p_monitor: 'fixture-monitor',
    p_start: '2026-10-13T00:00:00.000Z',
  })
  expect(aiFixture.requests[0].p_end).toMatch(/^2026-10-13T12:00:00\.\d{3}Z$/)
  expect(aiFixture.requests[0].p_request_key).toMatch(/^[\da-f-]{36}$/)
  await expect
    .element(
      page.getByText(
        'Sorğu qəbul edildi. Nəticə hazır olduqda bu ekran yenilənəcək.'
      )
    )
    .toBeVisible()
})
it.each([
  'disabled',
  'quota',
  'empty',
  'loading',
  'error',
  'invalid',
  'foreign',
  'pending',
] as const)('shows %s state honestly on mobile', async (state) => {
  await page.viewport(320, 900)
  aiFixture.state = state
  await open(state !== 'loading')
  if (state === 'loading')
    await expect
      .element(page.getByText('Təhlil məlumatı yüklənir', { exact: true }))
      .toBeInTheDocument()
  if (state === 'disabled') {
    await expect
      .element(page.getByText('Funksiya hazırda bağlıdır', { exact: true }))
      .toBeVisible()
    await expect
      .element(page.getByRole('button', { name: 'Təhlil sorğusu yarat' }))
      .toBeDisabled()
  }
  if (state === 'quota')
    await expect
      .element(
        page.getByText(
          'Aylıq təhlil limiti bitib. Mövcud nəticələrə baxa bilərsiniz.'
        )
      )
      .toBeVisible()
  if (state === 'empty')
    await expect
      .element(page.getByText('Bu seçim üçün təhlil yoxdur', { exact: true }))
      .toBeVisible()
  if (['error', 'invalid', 'foreign'].includes(state)) {
    await expect.element(page.getByRole('alert')).toBeVisible()
    expect(document.body.textContent).not.toContain('Sintetik BDU cədvəl rəyi')
  }
  if (state === 'pending')
    await expect
      .element(
        page.getByText(
          'Təhlil arxa planda işlənir. Mövcud monitorinq davam edir.'
        )
      )
      .toBeVisible()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320)
})
it('shows original evidence links and distinguishes opinions from facts', async () => {
  await page.viewport(1280, 900)
  await open()
  await expect
    .element(
      page.getByText('Söz qaydaları ilə təhlil; semantik AI deyil.', {
        exact: true,
      })
    )
    .toBeVisible()
  const links = document.querySelectorAll<HTMLAnchorElement>(
    'a[aria-label^="Mənbəyə keç:"]'
  )
  expect(links).toHaveLength(3)
  for (const link of links) {
    expect(link.href).toContain('.example.invalid/')
    expect(link.rel).toContain('noopener')
  }
  expect(document.body.textContent).toContain('Rəy')
  expect(document.body.textContent).toContain('Orta')
})

it.each([
  'full_text',
  'substantial_excerpt',
  'title_summary',
  'title_only',
  'extraction_failed',
  'source_inaccessible',
] as const)(
  'labels actual %s quality and unknown author independence on mobile',
  async (quality) => {
    await page.viewport(375, 900)
    aiFixture.quality = quality
    await open()
    expect(document.body.textContent).toContain(
      'Müstəqil müəlliflər: Məlumat yoxdur'
    )
    if (['full_text', 'substantial_excerpt'].includes(quality)) {
      expect(document.body.textContent).toContain(
        'Mənbə mətnindən seçilmiş parça təhlil olunub.'
      )
    } else {
      await expect
        .element(
          page.getByRole('heading', {
            name: 'Dəlil kifayət etmir',
            exact: true,
          })
        )
        .toBeInTheDocument()
      expect(document.body.textContent).not.toContain(
        'Müraciətləri insan baxışı ilə yoxlayın və cədvəl ehtiyaclarını araşdırın.'
      )
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375)
  }
)
it.each([320, 1280])(
  'captures reviewable evidence quality cards at %ipx',
  async (width) => {
    await page.viewport(width, 900)
    await open()
    const evidence = document.querySelector<HTMLElement>('#analysis-evidence')!
    evidence.scrollIntoView()
    evidence.style.maxHeight = '850px'
    evidence.style.overflow = 'hidden'
    await expect
      .element(evidence)
      .toMatchScreenshot(`-monitor-ai-evidence-${width}.png`)
    evidence.style.removeProperty('max-height')
    evidence.style.removeProperty('overflow')
  }
)
