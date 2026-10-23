import { describe, expect, it } from 'vitest'
import {
  formatDuration,
  formatSocialInterval,
  isValidCustomSocialInterval,
} from './social-intervals'

describe('social intervals', () => {
  it('formats any number of minutes', () => {
    expect(formatSocialInterval(null)).toBe('-')
    expect(formatSocialInterval(120)).toBe('hər 2 saatdan bir')
    expect(formatSocialInterval(45)).toBe('hər 45 dəqiqədən bir')
    expect(formatSocialInterval(90)).toBe('hər 1 saat 30 dəqiqədən bir')
    expect(formatDuration(1440)).toBe('24 saat')
  })

  it('accepts custom intervals from 10 minutes to 7 days', () => {
    expect(isValidCustomSocialInterval(10)).toBe(true)
    expect(isValidCustomSocialInterval(10080)).toBe(true)
    expect(isValidCustomSocialInterval(9)).toBe(false)
    expect(isValidCustomSocialInterval(10081)).toBe(false)
    expect(isValidCustomSocialInterval(45.5)).toBe(false)
  })
})
