import { getLang, t } from '@/lib/i18n'

const BAKU = 'Asia/Baku'

// Month names by hand: some browsers ship without Azerbaijani month names
// and print "M11" instead.
const MONTHS: Record<'az' | 'ru', string[]> = {
  az: [
    'yanvar',
    'fevral',
    'mart',
    'aprel',
    'may',
    'iyun',
    'iyul',
    'avqust',
    'sentyabr',
    'oktyabr',
    'noyabr',
    'dekabr',
  ],
  ru: [
    'января',
    'февраля',
    'марта',
    'апреля',
    'мая',
    'июня',
    'июля',
    'августа',
    'сентября',
    'октября',
    'ноября',
    'декабря',
  ],
}

function bakuParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BAKU,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value || ''
  return {
    year: get('year'),
    month: Number(get('month')),
    day: Number(get('day')),
    time: `${get('hour')}:${get('minute')}`,
  }
}

// "18 noyabr, 14:05" / "18 ноября, 14:05"; the year is added when it is not
// the current one. Baku time. A bare date ("2026-10-11") is read as that day.
export function formatDayMonth(
  value: string | null | undefined,
  { withTime = true }: { withTime?: boolean } = {}
) {
  if (!value) return '-'
  const bareDate = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const date = new Date(bareDate ? `${value}T12:00:00+04:00` : value)
  if (Number.isNaN(date.getTime())) return '-'
  const parts = bakuParts(date)
  const months = MONTHS[getLang() === 'ru' ? 'ru' : 'az']
  const year = parts.year === bakuParts(new Date()).year ? '' : ` ${parts.year}`
  const day = `${parts.day} ${months[parts.month - 1]}${year}`
  return withTime && !bareDate ? `${day}, ${parts.time}` : day
}

export function bakuHour(now = new Date()) {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: BAKU,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(now)
  )
}

// Greeting by the hour in Baku, whatever the visitor's own clock says.
export function greeting(now = new Date()) {
  const hour = bakuHour(now)
  if (hour >= 5 && hour < 12) return t('Sabahınız xeyir.')
  if (hour >= 12 && hour < 18) return t('Günortanız xeyir.')
  if (hour >= 18 && hour < 23) return t('Axşamınız xeyir.')
  return t('Xoş gəlmisiniz.')
}
