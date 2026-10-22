// Email report settings stored on user_profiles; see report-preferences.tsx.

export const DEFAULT_HOUR = 9
export const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

export const formatHour = (hour: number) => `${String(hour).padStart(2, '0')}:00`

export type ReportSettings = { optOut: string[]; hour: number }

export function parseReportSettings(row: unknown): ReportSettings {
  const value = (row ?? {}) as {
    email_report_opt_out?: unknown
    email_report_hour?: unknown
  }
  const hour = Number(value.email_report_hour)
  return {
    optOut: Array.isArray(value.email_report_opt_out)
      ? (value.email_report_opt_out as string[])
      : [],
    hour:
      value.email_report_hour != null &&
      Number.isInteger(hour) &&
      hour >= 0 &&
      hour <= 23
        ? hour
        : DEFAULT_HOUR,
  }
}
