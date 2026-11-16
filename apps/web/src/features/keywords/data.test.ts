import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

const { normalizeAliases, parseExcludeWords } = await import('./data')

describe('exclude words', () => {
  it('splits on commas and lines, trims and drops repeats', () => {
    expect(parseExcludeWords(' India, modi\nIndia ,, \nİndia ')).toEqual(['India', 'modi', 'İndia'])
    expect(parseExcludeWords('   ')).toEqual([])
  })
})

describe('keyword variants', () => {
  it('trims, collapses spaces and drops repeats and the keyword itself', () => {
    expect(
      normalizeAliases('AZAL', [' Azerbaijan   Airlines ', 'azerbaijan airlines', 'azal', '', 'АЗАЛ'])
    ).toEqual(['Azerbaijan Airlines', 'АЗАЛ'])
  })
})
