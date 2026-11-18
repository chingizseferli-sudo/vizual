import { describe, expect, it } from 'vitest'
import { bakuHour, formatDayMonth, greeting } from './dates'

describe('dates', () => {
  it('greets by the hour in Baku (UTC+4)', () => {
    expect(bakuHour(new Date('2026-11-18T03:00:00Z'))).toBe(7)
    expect(greeting(new Date('2026-11-18T03:00:00Z'))).toBe('Sabahınız xeyir.')
    expect(greeting(new Date('2026-11-18T10:00:00Z'))).toBe('Günortanız xeyir.')
    expect(greeting(new Date('2026-11-18T16:00:00Z'))).toBe('Axşamınız xeyir.')
    expect(greeting(new Date('2026-11-18T21:30:00Z'))).toBe('Xoş gəlmisiniz.')
  })

  it('writes the month as a word', () => {
    const now = new Date()
    const value = `${now.getUTCFullYear()}-11-18T10:05:00Z`
    expect(formatDayMonth(value)).toBe('18 noyabr, 14:05')
    expect(formatDayMonth(value, { withTime: false })).toBe('18 noyabr')
    expect(
      formatDayMonth('2020-11-18T10:05:00Z', { withTime: false })
    ).toContain('2020')
    expect(formatDayMonth(null)).toBe('-')
  })
})
