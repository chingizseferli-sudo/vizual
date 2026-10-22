import { describe, expect, it } from 'vitest'
import { formatHour, parseReportSettings } from './report-settings'

describe('email report settings', () => {
  it('reads opt-outs and the chosen hour', () => {
    expect(
      parseReportSettings({
        email_report_opt_out: ['daily'],
        email_report_hour: 18,
      })
    ).toEqual({ optOut: ['daily'], hour: 18 })
  })

  it('falls back to 09:00 and no opt-outs', () => {
    expect(parseReportSettings(null)).toEqual({ optOut: [], hour: 9 })
    expect(parseReportSettings({ email_report_hour: 24 }).hour).toBe(9)
    expect(parseReportSettings({ email_report_hour: 0 }).hour).toBe(0)
  })

  it('formats hours as HH:00', () => {
    expect(formatHour(9)).toBe('09:00')
    expect(formatHour(18)).toBe('18:00')
  })
})
