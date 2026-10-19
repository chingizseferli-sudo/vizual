import { describe, expect, it } from 'vitest'
import {
  analyticsKey,
  analyticsSchema,
  defaultFilters,
  evidenceUrl,
  requestWindow,
  summarize,
  type AnalyticsData,
  type ContentItem,
} from './model'
import {
  defaultPopularityPolicy,
  metricState,
  popularityGroups,
} from './popularity'

const now = new Date('2026-10-12T12:00:00Z')
function item(id: string, overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id,
    title: 'Bakı Dövlət Universitetində yeni proqram',
    url: `https://example.invalid/${id}`,
    source_id: 'source1',
    publisher: 'Publisher',
    platform: 'rss',
    published_at: '2026-10-10T00:00:00Z',
    detected_at: '2026-10-11T12:00:00Z',
    metadata: null,
    matches: [{ monitor_id: 'm1', name: 'BDU', keyword: 'BDU' }],
    ...overrides,
  }
}
function data(items: ContentItem[]): AnalyticsData {
  return {
    version: 1,
    owner_id: 'tenant1',
    items,
    truncated: false,
    limit: 500,
    collected_at: now.toISOString(),
    start: '2026-10-08T00:00:00Z',
    end: now.toISOString(),
    retention_days: 30,
    monitors: [{ id: 'm1', name: 'BDU' }],
  }
}
function measured(
  id: string,
  comments: number | null,
  extra: Partial<ContentItem> = {}
): ContentItem {
  return item(id, {
    platform: 'telegram',
    metadata: {
      content_type: 'post',
      metrics: [
        {
          observed_at: '2026-10-12T10:00:00Z',
          provider: 'permitted-api',
          method: 'api',
          comments,
        },
      ],
    },
    ...extra,
  })
}
describe('bounded analytics', () => {
  it('partitions tenant keys and filters', () => {
    const f = defaultFilters(now)
    expect(analyticsKey('a', f)).not.toEqual(analyticsKey('b', f))
    expect(analyticsKey('a', f)).not.toEqual(
      analyticsKey('a', { ...f, source: 'different' })
    )
  })
  it('uses an inclusive date end bounded by now', () => {
    expect(requestWindow(defaultFilters(now), now)).toEqual({
      start: '2026-10-12T00:00:00.000Z',
      end: now.toISOString(),
    })
  })
  it.each([
    { start: '2026-10-13', end: '2026-10-14' },
    { start: '2026-09-01', end: '2026-10-12' },
    { start: '2026-10-11', end: '2026-10-10' },
    { start: 'invalid', end: '2026-10-12' },
    { start: '2026-02-30', end: '2026-03-01' },
  ])('rejects invalid window %j', (f) =>
    expect(() =>
      requestWindow({ ...f, source: '', monitor: '' }, now)
    ).toThrow()
  )
  it('counts distinct items and each monitor once despite multiple keyword matches', () => {
    const first = item('1')
    first.matches.push({ ...first.matches[0], keyword: 'University' })
    const result = summarize(
      data([first, first, item('2', { source_id: 'source2' })])
    )
    expect(result.items).toHaveLength(2)
    expect(result.topics[0].items.size).toBe(2)
    expect(result.topics[0].current).toBe(2)
    expect(result.sources).toHaveLength(2)
  })
  it('keeps separate publications as unconfirmed headline candidates', () => {
    const result = summarize(
      data([
        item('1'),
        item('2'),
        item('3', { title: 'A different report on the university' }),
      ])
    )
    expect(result.items).toHaveLength(3)
    expect(result.related).toHaveLength(1)
    expect(result.related[0]).toHaveLength(2)
  })
  it('fills missing timeline days with actual zero detections', () => {
    const result = summarize(data([item('1')]))
    expect(result.days.find((d) => d.name === '2026-10-08')?.count).toBe(0)
  })
  it('rejects executable and credential-bearing evidence URLs', () => {
    expect(evidenceUrl('javascript:alert(1)')).toBeNull()
    expect(evidenceUrl('https://user:password@example.invalid')).toBeNull()
    expect(evidenceUrl('https://example.invalid')).toBe(
      'https://example.invalid/'
    )
  })
})
describe('explainable engagement cohorts', () => {
  it('preserves unknown versus real zero and excludes missing ranks', () => {
    expect(metricState(measured('zero', 0), now).snapshot?.comments).toBe(0)
    expect(
      popularityGroups(
        [measured('null', null), measured('zero', 0)],
        'most',
        now
      )[0].rows.map((row) => row.item.id)
    ).toEqual(['zero'])
  })
  it('requires attributed valid metrics', () => {
    const invalid = item('bad', {
      metadata: { metrics: [{ comments: 20, observed_at: now.toISOString() }] },
    })
    expect(metricState(invalid, now).snapshot).toBeNull()
    expect(popularityGroups([invalid], 'most', now)).toEqual([])
  })
  it('excludes stale metrics, future samples and young least-performing content', () => {
    const stale = measured('old', 1, {
      metadata: {
        metrics: [
          {
            provider: 'p',
            method: 'api',
            observed_at: '2026-10-10T00:00:00Z',
            comments: 1,
          },
        ],
      },
    })
    expect(metricState(stale, now).stale).toBe(true)
    expect(popularityGroups([stale], 'most', now)).toEqual([])
    expect(
      popularityGroups(
        [measured('young', 0, { published_at: '2026-10-12T00:00:00Z' })],
        'least',
        now
      )
    ).toEqual([])
    expect(
      popularityGroups(
        [
          measured('future', 1, {
            metadata: {
              metrics: [
                {
                  provider: 'p',
                  method: 'api',
                  observed_at: '2026-10-13T00:00:00Z',
                  comments: 1,
                },
              ],
            },
          }),
        ],
        'most',
        now
      )
    ).toEqual([])
  })
  it('separates platform, type, metric availability, age and measurement provenance', () => {
    const others = [
      measured('1', 1),
      measured('2', 2, { platform: 'x' }),
      measured('3', 2, {
        metadata: {
          content_type: 'video',
          metrics: [
            {
              provider: 'permitted-api',
              method: 'api',
              observed_at: now.toISOString(),
              comments: 2,
            },
          ],
        },
      }),
      measured('4', 2, { published_at: '2026-10-11T18:00:00Z' }),
      measured('5', 2, {
        metadata: {
          content_type: 'post',
          metrics: [
            {
              provider: 'permitted-api',
              method: 'api',
              observed_at: now.toISOString(),
              likes: 3,
              comments: 2,
            },
          ],
        },
      }),
    ]
    expect(popularityGroups(others, 'most', now)).toHaveLength(5)
  })
  it('normalizes only within sufficiently populated compatible cohorts', () => {
    const rows = popularityGroups(
      [measured('a', 0), measured('b', 1), measured('c', 2)],
      'most',
      now
    )[0].rows
    expect(rows.map((r) => r.item.id)).toEqual(['c', 'b', 'a'])
    expect(rows.map((r) => r.normalized)).toEqual([100, 50, 0])
    expect(
      popularityGroups([measured('a', 0)], 'most', now)[0].rows[0].normalized
    ).toBeNull()
  })
  it('computes growth per hour from two compatible observations', () => {
    const growing = measured('growth', 4, {
      metadata: {
        content_type: 'post',
        metrics: [
          {
            provider: 'p',
            method: 'api',
            observed_at: '2026-10-12T08:00:00Z',
            comments: 2,
          },
          {
            provider: 'p',
            method: 'api',
            observed_at: '2026-10-12T10:00:00Z',
            comments: 4,
          },
        ],
      },
    })
    expect(popularityGroups([growing], 'growth', now)[0].rows[0].score).toBe(2)
  })
  it('does not infer growth from single observations or counter resets', () => {
    expect(popularityGroups([measured('single', 1)], 'growth', now)).toEqual([])
    const reset = measured('reset', 1, {
      metadata: {
        metrics: [
          {
            provider: 'p',
            method: 'api',
            observed_at: '2026-10-12T08:00:00Z',
            comments: 3,
          },
          {
            provider: 'p',
            method: 'api',
            observed_at: '2026-10-12T10:00:00Z',
            comments: 1,
          },
        ],
      },
    })
    expect(popularityGroups([reset], 'growth', now)).toEqual([])
  })
  it('supports configurable weights and refuses negative weights', () => {
    const policy = {
      ...defaultPopularityPolicy,
      weights: { ...defaultPopularityPolicy.weights, comments: 5 },
    }
    expect(
      popularityGroups([measured('a', 3)], 'most', now, policy)[0].rows[0].score
    ).toBe(15)
    expect(() =>
      popularityGroups([], 'most', now, {
        ...policy,
        weights: { ...policy.weights, comments: -1 },
      })
    ).toThrow()
  })
})

it('rejects unbounded analytics responses and invalid timestamps', () => {
  expect(
    analyticsSchema.safeParse(
      data(Array.from({ length: 501 }, (_, i) => item(String(i))))
    ).success
  ).toBe(false)
  expect(
    analyticsSchema.safeParse({
      ...data([]),
      start: '2026-10-12T00:00:00',
      end: '2026-10-13T00:00:00Z',
    }).success
  ).toBe(false)
})
it('does not present a singleton as least popular', () => {
  expect(popularityGroups([measured('single', 0)], 'least', now)).toEqual([])
  expect(
    popularityGroups(
      [measured('1', 0), measured('2', 1), measured('3', 2)],
      'least',
      now
    )[0].rows[0].item.id
  ).toBe('1')
})
it('rejects unattributed whitespace or timezone-free metric snapshots', () => {
  expect(
    metricState(
      measured('bad', 1, {
        metadata: {
          metrics: [
            {
              provider: ' ',
              method: 'api',
              observed_at: now.toISOString(),
              comments: 1,
            },
          ],
        },
      }),
      now
    ).snapshot
  ).toBeNull()
  expect(
    metricState(
      measured('badtime', 1, {
        metadata: {
          metrics: [
            {
              provider: 'p',
              method: 'api',
              observed_at: '2026-10-12T10:00:00',
              comments: 1,
            },
          ],
        },
      }),
      now
    ).snapshot
  ).toBeNull()
})
