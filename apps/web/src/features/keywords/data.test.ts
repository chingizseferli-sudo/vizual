import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

const { parseExcludeWords } = await import('./data')

describe('exclude words', () => {
  it('splits on commas and lines, trims and drops repeats', () => {
    expect(parseExcludeWords(' India, modi\nIndia ,, \nİndia ')).toEqual(['India', 'modi', 'İndia'])
    expect(parseExcludeWords('   ')).toEqual([])
  })
})
