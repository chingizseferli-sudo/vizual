import { createClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

const requests: string[] = []

vi.mock('@/lib/supabase', () => ({
  supabase: createClient('https://mock.supabase.test', 'anon', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input: RequestInfo | URL) => {
        const url = String(input)
        requests.push(url)
        if (url.includes('/auth/v1/user')) {
          return Response.json({ id: 'user-1', aud: 'authenticated' })
        }
        return Response.json([])
      },
    },
  }),
}))

const { customerAlertsQuery } = await import('./alerts')

describe('customerAlertsQuery', () => {
  it('filters by owner through joins, so the URL does not grow with matches', async () => {
    requests.length = 0
    const { error } = await customerAlertsQuery('user-1', 300)
    expect(error).toBeNull()

    const url = new URL(requests[requests.length - 1])
    expect(url.pathname).toBe('/rest/v1/monitor_alerts')
    expect(url.searchParams.get('monitor_matches.user_monitors.user_id')).toBe(
      'eq.user-1'
    )
    expect(url.searchParams.get('select')).toContain('monitor_matches!inner(')
    expect(url.searchParams.get('select')).toContain('user_monitors!inner(user_id)')
    expect(url.searchParams.get('limit')).toBe('300')
    expect(url.search).not.toContain('in.(')
  })
})
