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
import { analyticsFixture, portalFixture } from './portal-fixtures'

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

let queryClient: QueryClient
const realDateNow = Date.now.bind(Date)
async function openAnalytics(waitForData = true) {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/monitor/analytics'] }),
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
  if (waitForData) {
    await expect.poll(() => analyticsFixture.calls.length).toBeGreaterThan(0)
    await expect.poll(() => queryClient.isFetching()).toBe(0)
  }
  await document.fonts.ready
}
beforeEach(() => {
  portalFixture.role = 'customer'
  portalFixture.state = 'ready'
  analyticsFixture.calls = []
  analyticsFixture.truncated = false
  analyticsFixture.invalid = false
  analyticsFixture.metricless = false
  analyticsFixture.unsafeEvidence = false
  analyticsFixture.ownerId = 'fixture-user'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-11T12:00:00Z'))
  vi.spyOn(Date, 'now').mockImplementation(realDateNow)
  document.cookie = 'sidebar_state=true; path=/'
})
afterEach(async () => {
  await cleanup()
  queryClient?.clear()
  vi.useRealTimers()
})

describe.each([320, 375, 390, 430, 768, 1024, 1280, 1440])(
  'Analytics at %ipx',
  (width) => {
    it('renders the real customer route without overflow', async () => {
      await page.viewport(width, 900)
      await openAnalytics()
      await expect
        .element(
          page.getByRole('heading', {
            name: 'Kontent analitikası',
            exact: true,
          })
        )
        .toBeVisible()
      expect(window.innerWidth).toBe(width)
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
      expect(document.querySelectorAll('main, [role=main]')).toHaveLength(1)
      const shell = document.querySelector<HTMLElement>('.portal-shell')!
      shell.style.maxHeight = '900px'
      shell.style.overflow = 'hidden'
      window.scrollTo(0, 0)
      await expect
        .element(shell)
        .toMatchScreenshot(`-monitor-analytics-${width}.png`)
      shell.style.removeProperty('max-height')
      shell.style.removeProperty('overflow')
    })
  }
)

it('applies filters to the scoped RPC and resets the source', async () => {
  await page.viewport(375, 900)
  await openAnalytics()
  await userEvent.selectOptions(
    page.getByRole('combobox', { name: 'Mənbə', exact: true }),
    'fixture-source-1'
  )
  await userEvent.selectOptions(
    page.getByRole('combobox', { name: 'Monitor / mövzu', exact: true }),
    'fixture-monitor'
  )
  await userEvent.click(
    page.getByRole('button', { name: 'Tətbiq et', exact: true })
  )
  await expect
    .poll(
      () =>
        analyticsFixture.calls[analyticsFixture.calls.length - 1]?.args.p_source
    )
    .toBe('fixture-source-1')
  expect(
    analyticsFixture.calls[analyticsFixture.calls.length - 1]?.args.p_monitor
  ).toBe('fixture-monitor')
  await expect
    .element(
      page.getByRole('heading', {
        name: 'Engagement məlumatı olmayan ayrıca nəşr',
        exact: true,
      })
    )
    .not.toBeInTheDocument()
  await userEvent.click(
    page.getByRole('button', { name: 'Sıfırla', exact: true })
  )
  await expect
    .element(page.getByRole('combobox', { name: 'Mənbə', exact: true }))
    .toHaveValue('')
  await expect
    .element(
      page.getByRole('heading', {
        name: 'Engagement məlumatı olmayan ayrıca nəşr',
        exact: true,
      })
    )
    .toBeInTheDocument()
})

it('keeps actual zero separate from unavailable metrics and safe original evidence', async () => {
  await page.viewport(390, 900)
  await openAnalytics()
  const articles = [...document.querySelectorAll('article')]
  const zero = articles.find((article) =>
    article.querySelector('a')?.href.includes('publisher-1.example.invalid')
  )!
  const missing = articles.find((article) =>
    article.textContent?.includes('Engagement məlumatı olmayan ayrıca nəşr')
  )!
  expect(zero.textContent).toContain('Baxış: 0')
  expect(zero.textContent).toContain('Şərh: 0')
  expect(zero.textContent).toContain('Paylaşım: Məlumat yoxdur')
  expect(missing.textContent).not.toContain('Baxış: 0')
  expect(missing.textContent).toContain('Məlumat yoxdur')
  expect(zero.querySelector('a')?.getAttribute('target')).toBe('_blank')
  expect(zero.querySelector('a')?.getAttribute('rel')).toBe(
    'noopener noreferrer'
  )
  expect(zero.querySelector('a')?.href).toContain('example.invalid')
  expect(analyticsFixture.calls[0]).toEqual({
    name: 'get_content_analytics',
    args: {
      p_start: '2026-10-11T00:00:00.000Z',
      p_end: '2026-10-11T12:00:00.000Z',
      p_monitor: null,
      p_source: null,
      p_limit: 500,
    },
  })
})

it('ranks actual zero in a comparable least-engagement cohort and excludes missing data', async () => {
  await page.viewport(320, 900)
  await openAnalytics()
  await userEvent.selectOptions(
    page.getByRole('combobox', { name: 'Sıralama', exact: true }),
    'least'
  )
  const region = page.getByRole('region', {
    name: 'Auditoriya fəaliyyəti sıralaması',
    exact: true,
  })
  await expect.element(region).toBeInTheDocument()
  const section = document.querySelector(
    '[aria-label="Auditoriya fəaliyyəti sıralaması"]'
  )!
  expect(section.textContent).toContain('Bal: 0.00')
  expect(section.textContent).not.toContain(
    'Engagement məlumatı olmayan ayrıca nəşr'
  )
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320)
})

it.each(['loading', 'empty', 'error'] as const)(
  'renders truthful %s state on mobile',
  async (state) => {
    await page.viewport(320, 900)
    portalFixture.state = state
    await openAnalytics(state !== 'loading')
    if (state === 'loading')
      await expect
        .element(page.getByText('Analitika yüklənir', { exact: true }))
        .toBeInTheDocument()
    if (state === 'empty')
      await expect
        .element(
          page.getByRole('heading', {
            name: 'Bu seçim üçün məzmun yoxdur',
            exact: true,
          })
        )
        .toBeVisible()
    if (state === 'error') {
      await expect
        .element(
          page.getByRole('button', { name: 'Yenidən yoxla', exact: true })
        )
        .toBeVisible()
      portalFixture.state = 'ready'
      await userEvent.click(
        page.getByRole('button', { name: 'Yenidən yoxla', exact: true })
      )
      await expect
        .element(
          page.getByRole('combobox', { name: 'Monitor / mövzu', exact: true })
        )
        .toBeVisible()
      await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320)
  }
)

it('reports truncated evidence coverage', async () => {
  await page.viewport(320, 900)
  analyticsFixture.truncated = true
  await openAnalytics()
  await expect
    .element(page.getByText('İlk 500 nəşr göstərilir;', { exact: false }))
    .toBeVisible()
})

it('filters platforms within the bounded server evidence without an extra RPC', async () => {
  await page.viewport(320, 900)
  await openAnalytics()
  const initialCalls = analyticsFixture.calls.length
  await userEvent.selectOptions(
    page.getByRole('combobox', {
      name: 'Platforma (server seçimində)',
      exact: true,
    }),
    'website'
  )
  await expect
    .element(
      page.getByRole('heading', {
        name: 'Engagement məlumatı olmayan ayrıca nəşr',
        exact: true,
      })
    )
    .toBeInTheDocument()
  await expect
    .element(
      page.getByRole('heading', {
        name: 'Universitetdə ictimai müzakirə üçün yeni proqram',
        exact: true,
      })
    )
    .not.toBeInTheDocument()
  expect(analyticsFixture.calls).toHaveLength(initialCalls)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320)
})

it('rejects an unsupported RPC version rather than rendering fabricated counts', async () => {
  await page.viewport(320, 900)
  analyticsFixture.invalid = true
  await openAnalytics()
  await expect.element(page.getByRole('alert')).toBeVisible()
  await expect
    .element(page.getByText('Aşkarlanmış nəşrlər', { exact: true }))
    .not.toBeInTheDocument()
})

it('rejects an invalid date window before issuing another RPC', async () => {
  await page.viewport(375, 900)
  await openAnalytics()
  const initialCalls = analyticsFixture.calls.length
  await userEvent.fill(
    page.getByLabelText('Başlanğıc tarix (UTC)', { exact: true }),
    '2026-09-01'
  )
  await userEvent.click(
    page.getByRole('button', { name: 'Tətbiq et', exact: true })
  )
  await expect.element(page.getByRole('alert')).toBeVisible()
  expect(analyticsFixture.calls).toHaveLength(initialCalls)
})

it('states unavailable popularity rather than treating missing engagement as zero', async () => {
  await page.viewport(320, 900)
  analyticsFixture.metricless = true
  await openAnalytics()
  await userEvent.selectOptions(
    page.getByRole('combobox', { name: 'Sıralama', exact: true }),
    'most'
  )
  await expect
    .element(
      page.getByText(
        'Müqayisə üçün kifayət qədər təzə və uyğun auditoriya fəaliyyəti məlumatı yoxdur.',
        { exact: true }
      )
    )
    .toBeVisible()
  expect(
    document.querySelector('[aria-label="Auditoriya fəaliyyəti sıralaması"]')
      ?.textContent
  ).not.toContain('Bal: 0.00')
})

it('does not turn untrusted evidence schemes into links', async () => {
  await page.viewport(390, 900)
  analyticsFixture.unsafeEvidence = true
  await openAnalytics()
  const links = [...document.querySelectorAll<HTMLAnchorElement>('a')]
  expect(
    links.some((link) => link.getAttribute('href')?.startsWith('javascript:'))
  ).toBe(false)
  await expect
    .element(
      page.getByText('Etibarlı mənbə keçidi yoxdur.', { exact: true }).first()
    )
    .toBeInTheDocument()
})

it('rejects a mismatched RPC owner instead of caching another tenant evidence', async () => {
  await page.viewport(320, 900)
  analyticsFixture.ownerId = 'different-synthetic-user'
  await openAnalytics()
  await expect.element(page.getByRole('alert')).toBeVisible()
  await expect
    .element(page.getByText('Aşkarlanmış nəşrlər', { exact: true }))
    .not.toBeInTheDocument()
  expect(
    queryClient
      .getQueriesData({ queryKey: ['customer', 'analytics', 'fixture-user'] })
      .every(([, data]) => data === undefined)
  ).toBe(true)
})
