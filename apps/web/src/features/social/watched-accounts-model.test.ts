import { describe, expect, it } from 'vitest'
import {
  isValidWatchedHandle,
  normalizeWatchedHandle,
  parseWatchedInterval,
  watchedAccountUrl,
} from './watched-accounts-model'

describe('watched accounts', () => {
  it('normalizes handles from @names and links', () => {
    expect(normalizeWatchedHandle('@Report.az')).toBe('report.az')
    expect(normalizeWatchedHandle('https://www.instagram.com/report.az/')).toBe('report.az')
    expect(normalizeWatchedHandle('https://instagram.com/oxu.az?igsh=abc')).toBe('oxu.az')
    expect(normalizeWatchedHandle('t.me/s/APA_az')).toBe('apa_az')
    expect(normalizeWatchedHandle('https://t.me/qafqazinfo/12345')).toBe('qafqazinfo')
  })

  it('validates handles like the database check', () => {
    expect(isValidWatchedHandle('report.az')).toBe(true)
    expect(isValidWatchedHandle('apa_az')).toBe(true)
    expect(isValidWatchedHandle('report az')).toBe(false)
    expect(isValidWatchedHandle('')).toBe(false)
  })

  it('parses intervals', () => {
    expect(parseWatchedInterval('')).toBeNull()
    expect(parseWatchedInterval('30')).toBe(30)
    expect(parseWatchedInterval('4')).toBe('invalid')
    expect(parseWatchedInterval('1.5')).toBe('invalid')
  })

  it('links to the page or the public channel preview', () => {
    expect(watchedAccountUrl('instagram', 'report.az')).toBe('https://www.instagram.com/report.az/')
    expect(watchedAccountUrl('telegram', 'apa_az')).toBe('https://t.me/s/apa_az')
  })
})
