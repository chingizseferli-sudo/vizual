import { beforeEach, expect, it, vi } from 'vitest'
import { fetchAnalytics } from './api'
import { defaultFilters } from './model'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }))
beforeEach(() => mocks.rpc.mockReset())
const response = () => ({
  version: 1,
  owner_id: 'tenant-a',
  items: [],
  monitors: [],
  truncated: false,
  limit: 500,
  retention_days: 1,
  collected_at: new Date().toISOString(),
  start: new Date(Date.now() - 3600000).toISOString(),
  end: new Date().toISOString(),
})
it('uses only the bounded tenant analytics RPC', async () => {
  mocks.rpc.mockResolvedValue({ data: response(), error: null })
  await fetchAnalytics(defaultFilters(), 'tenant-a')
  expect(mocks.rpc).toHaveBeenCalledWith(
    'get_content_analytics',
    expect.objectContaining({ p_limit: 500, p_monitor: null, p_source: null })
  )
})
it('rejects a response returned under a different identity during a session race', async () => {
  mocks.rpc.mockResolvedValue({ data: response(), error: null })
  await expect(fetchAnalytics(defaultFilters(), 'tenant-b')).rejects.toThrow(
    'Sessiya dəyişib'
  )
})
it('does not fallback to legacy queries when service authorization or migration is unavailable', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
  await expect(fetchAnalytics(defaultFilters(), 'tenant-a')).rejects.toThrow(
    'əlçatan deyil'
  )
  expect(mocks.rpc).toHaveBeenCalledTimes(1)
})
it('rejects oversized or malformed server responses', async () => {
  mocks.rpc.mockResolvedValue({
    data: { ...response(), owner_id: null },
    error: null,
  })
  await expect(fetchAnalytics(defaultFilters(), 'tenant-a')).rejects.toThrow()
})
