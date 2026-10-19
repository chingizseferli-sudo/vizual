import { beforeEach, expect, it, vi } from 'vitest'
import { fetchInsights, requestInsights } from './api'
import { aiFixture, syntheticInsights } from './fixtures'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }))
beforeEach(() => {
  mocks.rpc.mockReset()
  aiFixture.state = 'ready'
  aiFixture.requests = []
  aiFixture.quality = 'substantial_excerpt'
  aiFixture.kind = 'complaint'
})
it('rejects a response belonging to a different session', async () => {
  mocks.rpc.mockResolvedValue({ data: syntheticInsights(), error: null })
  await expect(fetchInsights('other-tenant')).rejects.toThrow('Sessiya dəyişib')
})
it('does not fallback to unprotected data when the service is unavailable', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
  await expect(fetchInsights('fixture-user')).rejects.toThrow('əlçatan deyil')
  expect(mocks.rpc).toHaveBeenCalledTimes(1)
})
it('keeps the same date bounds for idempotent request retries', async () => {
  const filters = {
    monitor: 'fixture-monitor',
    source: '',
    start: '2026-10-13',
    end: '2026-10-13',
  }
  mocks.rpc.mockResolvedValue({
    data: { id: 'run', status: 'pending', reused: true },
    error: null,
  })
  const requestedAt = new Date('2026-10-13T12:00:00Z')
  await requestInsights(
    filters,
    '11111111-1111-4111-8111-111111111111',
    requestedAt
  )
  await requestInsights(
    filters,
    '11111111-1111-4111-8111-111111111111',
    requestedAt
  )
  expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1])
})
it('validates monitor and calendar dates before requesting work', async () => {
  await expect(
    requestInsights(
      { monitor: '', source: '', start: '2026-10-13', end: '2026-10-13' },
      'unused'
    )
  ).rejects.toThrow('monitor seçin')
  await expect(
    requestInsights(
      {
        monitor: 'fixture-monitor',
        source: '',
        start: '2026-02-30',
        end: '2026-03-01',
      },
      'unused'
    )
  ).rejects.toThrow('Tarix')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
