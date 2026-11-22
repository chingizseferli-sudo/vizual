import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { dateLocale, t } from '@/lib/i18n'
import type { DashboardPost, DashboardStats } from './stats'

// Categorical slots 1 (news) and 2 (social), stepped for light and dark.
const NEWS_BAR = 'bg-[#2a78d6] dark:bg-[#3987e5]'
const SOCIAL_BAR = 'bg-[#eb6834] dark:bg-[#d95926]'

const NETWORK_LABELS: Record<string, string> = {
  web: 'Xəbər saytları',
  facebook: 'Facebook',
  instagram: 'Instagram',
  youtube: 'YouTube',
  x: 'X',
  linkedin: 'LinkedIn',
  telegram: 'Telegram',
}

function formatCount(value: number) {
  return new Intl.NumberFormat(dateLocale()).format(value)
}

function formatDay(day: string, withYear = false) {
  return new Date(`${day}T12:00:00`).toLocaleDateString(dateLocale(), {
    day: '2-digit',
    month: '2-digit',
    ...(withYear ? { year: 'numeric' } : {}),
  })
}

function decodeHtml(text: string) {
  const textarea = document.createElement('textarea')
  textarea.innerHTML = text
  return textarea.value
}

function Legend() {
  return (
    <div className='flex flex-wrap gap-3 text-xs text-muted-foreground'>
      <span className='inline-flex items-center gap-1.5'>
        <span className={`h-2.5 w-2.5 rounded-sm ${NEWS_BAR}`} />
        {t("Xəbərlər")}
      </span>
      <span className='inline-flex items-center gap-1.5'>
        <span className={`h-2.5 w-2.5 rounded-sm ${SOCIAL_BAR}`} />
        {t("Sosial postlar")}
      </span>
    </div>
  )
}

function DailyChart({ daily }: { daily: DashboardStats['daily'] }) {
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(1, ...daily.map((day) => day.news + day.social))
  const shown = active === null ? null : daily[active]

  return (
    <section className='rounded-2xl border border-border bg-card p-4 shadow-sm'>
      <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <h2 className='text-base font-bold text-foreground'>{t("Günlük dinamika")}</h2>
          <p className='text-xs text-muted-foreground'>
            {shown
              ? `${formatDay(shown.day, true)}: ${formatCount(shown.news)} ${t("xəbər")}, ${formatCount(shown.social)} ${t("post")}`
              : t("Sütunun üzərinə gələrək günün rəqəmlərini görün")}
          </p>
        </div>
        <Legend />
      </div>

      <div
        className='mt-4 flex h-40 items-end gap-[2px]'
        onMouseLeave={() => setActive(null)}
        aria-hidden='true'
      >
        {daily.map((day, index) => {
          const total = day.news + day.social
          return (
            <div
              key={day.day}
              className='flex h-full min-w-0 flex-1 cursor-default flex-col justify-end'
              onMouseEnter={() => setActive(index)}
              title={`${formatDay(day.day, true)}: ${day.news} / ${day.social}`}
            >
              <div
                className={`flex flex-col justify-end gap-[2px] ${active === null || active === index ? '' : 'opacity-60'}`}
                style={{ height: `${(total / max) * 100}%` }}
              >
                {day.social > 0 ? (
                  <div
                    className={`rounded-t-[4px] ${SOCIAL_BAR}`}
                    style={{ flexGrow: day.social, minHeight: 2 }}
                  />
                ) : null}
                {day.news > 0 ? (
                  <div
                    className={`${day.social > 0 ? '' : 'rounded-t-[4px]'} ${NEWS_BAR}`}
                    style={{ flexGrow: day.news, minHeight: 2 }}
                  />
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
      <div className='mt-1 flex justify-between text-[11px] text-muted-foreground' aria-hidden='true'>
        <span>{daily[0] ? formatDay(daily[0].day) : ''}</span>
        <span>{daily.length ? formatDay(daily[daily.length - 1].day) : ''}</span>
      </div>

      <table className='sr-only'>
        <caption>{t("Günlük dinamika")}</caption>
        <thead>
          <tr>
            <th>{t("Gün")}</th>
            <th>{t("Xəbərlər")}</th>
            <th>{t("Sosial postlar")}</th>
          </tr>
        </thead>
        <tbody>
          {daily.map((day) => (
            <tr key={day.day}>
              <td>{formatDay(day.day, true)}</td>
              <td>{day.news}</td>
              <td>{day.social}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function BarList({
  title,
  rows,
  empty,
}: {
  title: string
  rows: { label: string; count: number }[]
  empty: string
}) {
  const max = Math.max(1, ...rows.map((row) => row.count))
  return (
    <section className='rounded-2xl border border-border bg-card p-4 shadow-sm'>
      <h2 className='text-base font-bold text-foreground'>{title}</h2>
      {rows.length === 0 ? (
        <p className='mt-3 text-sm text-muted-foreground'>{empty}</p>
      ) : (
        <ul className='mt-3 grid gap-2'>
          {rows.map((row) => (
            <li key={row.label} className='grid gap-1'>
              <div className='flex items-baseline justify-between gap-3 text-sm'>
                <span className='truncate text-foreground'>{row.label}</span>
                <span className='shrink-0 font-semibold text-foreground tabular-nums'>
                  {formatCount(row.count)}
                </span>
              </div>
              <div className='h-1.5 rounded-full bg-muted'>
                <div
                  className={`h-1.5 rounded-full ${NEWS_BAR}`}
                  style={{ width: `${Math.max(2, (row.count / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function postCounts(post: DashboardPost) {
  return [
    { value: post.like_count, label: t("bəyənmə") },
    { value: post.comment_count, label: t("şərh") },
    { value: post.share_count, label: t("paylaşım") },
    { value: post.view_count, label: t("baxış") },
  ].filter((part): part is { value: number; label: string } => part.value != null)
}

function TopPosts({ posts }: { posts: DashboardPost[] }) {
  return (
    <section className='rounded-2xl border border-border bg-card p-4 shadow-sm'>
      <h2 className='text-base font-bold text-foreground'>{t("Ən çox engagement alan postlar")}</h2>
      {posts.length === 0 ? (
        <p className='mt-3 text-sm text-muted-foreground'>{t("Bu dövrdə engagement məlumatı olan sosial post yoxdur.")}</p>
      ) : (
        <ol className='mt-3 grid gap-3'>
          {posts.map((post) => (
            <li key={post.item_id} className='flex items-start justify-between gap-3'>
              <div className='min-w-0'>
                <div className='text-[11px] font-bold text-muted-foreground'>
                  {NETWORK_LABELS[post.network || ''] ?? post.network}
                  {post.author ? ` · ${post.author}` : ''}
                </div>
                <a
                  href={post.url || undefined}
                  target='_blank'
                  rel='noreferrer'
                  className='line-clamp-2 text-sm font-semibold text-foreground hover:underline'
                >
                  {decodeHtml(post.title || '')}
                </a>
                <div className='mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground'>
                  {postCounts(post).map((part) => (
                    <span key={part.label}>
                      {formatCount(part.value)} {part.label}
                    </span>
                  ))}
                </div>
              </div>
              {post.url ? (
                <a
                  href={post.url}
                  target='_blank'
                  rel='noreferrer'
                  aria-label={t("Aç")}
                  className='inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border hover:bg-muted/50'
                >
                  <ExternalLink className='h-3.5 w-3.5' />
                </a>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export function DashboardCharts({ stats }: { stats: DashboardStats }) {
  const networks = stats.by_network.map((row) => ({
    label: t(NETWORK_LABELS[row.network] ?? row.network),
    count: row.count,
  }))
  const keywords = stats.top_keywords.map((row) => ({ label: row.keyword, count: row.count }))
  const sources = stats.top_sources.map((row) => ({ label: row.host, count: row.count }))

  return (
    <div className='grid gap-3'>
      <div className='grid gap-3 sm:grid-cols-3'>
        {[
          { label: t("Xəbərlər"), value: stats.news },
          { label: t("Sosial postlar"), value: stats.social },
          { label: t("Ümumi engagement"), value: stats.engagement },
        ].map((tile) => (
          <div key={tile.label} className='rounded-xl border border-border bg-card p-4'>
            <div className='text-sm font-semibold text-muted-foreground'>{tile.label}</div>
            <div className='mt-1 text-3xl font-semibold text-foreground tabular-nums'>
              {formatCount(tile.value)}
            </div>
          </div>
        ))}
      </div>
      <DailyChart daily={stats.daily} />
      <div className='grid gap-3 lg:grid-cols-3'>
        <BarList title={t("Platformalar üzrə")} rows={networks} empty={t("Bu dövrdə nəticə yoxdur.")} />
        <BarList title={t("Ən aktiv açar sözlər")} rows={keywords} empty={t("Bu dövrdə nəticə yoxdur.")} />
        <BarList title={t("Ən çox yazan saytlar")} rows={sources} empty={t("Bu dövrdə nəticə yoxdur.")} />
      </div>
      <TopPosts posts={stats.top_engagement} />
    </div>
  )
}
