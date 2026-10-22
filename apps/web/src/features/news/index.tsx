import { useEffect, useMemo, useState } from 'react'
import { Plus, Star } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { ResponsiveTable } from '@/components/ui/responsive-table'
import { NewsDialogs } from './components/news-dialogs'
import { NewsProvider, useNews } from './components/news-provider'
import { NewsRowActions } from './components/news-row-actions'
import { friendlyError } from '@/lib/friendly-error'

type NewsItem = {
  id: number
  title: string
  slug: string | null
  summary: string | null
  content: string | null
  image_url: string | null
  source: string | null
  category: string | null
  status: string | null
  scheduled_at: string | null
  created_at: string | null
  featured: boolean | null
}

const statusLabels: Record<string, string> = {
  published: 'Yayımlanıb',
  pending: 'Təsdiq gözləyir',
  scheduled: 'Planlaşdırılıb',
  draft: 'Qaralama',
}

function getStatusLabel(status: string | null) {
  return statusLabels[status || 'draft'] || 'Qaralama'
}

function getStatusClass(status: string | null) {
  switch (status) {
    case 'published':
      return 'bg-success/10 text-success'
    case 'pending':
      return 'bg-warning/10 text-warning'
    case 'scheduled':
      return 'bg-muted text-foreground'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

function NewsPageContent({
  news,
  reload,
}: {
  news: NewsItem[]
  reload: () => void
}) {
  const { setOpen, setCurrentRow } = useNews()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')

  async function updateStatus(id: number, status: string) {
    const { error } = await supabase
      .from('news')
      .update({
        status,
        published_at: status === 'published' ? new Date().toISOString() : null,
      })
      .eq('id', id)

    if (error) {
      alert('Xəta: ' + friendlyError(error))
      return
    }

    reload()
  }

  async function toggleFeatured(id: number, featured: boolean | null) {
    const { error } = await supabase
      .from('news')
      .update({
        featured: !featured,
      })
      .eq('id', id)

    if (error) {
      alert('Xəta: ' + friendlyError(error))
      return
    }

    reload()
  }

  const filteredNews = useMemo(() => {
    return news.filter((item) => {
      const matchesSearch = item.title
        .toLowerCase()
        .includes(search.toLowerCase())

      const matchesStatus = status === 'all' || item.status === status

      return matchesSearch && matchesStatus
    })
  }, [news, search, status])

  return (
    <div className='portal-page grid gap-6'>
      <div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <h1 className='text-xl font-semibold tracking-tight'>Xəbərlər</h1>
          <p className='text-muted-foreground'>
            Supabase-dən gələn xəbərləri idarə et
          </p>
        </div>

        <Button
          onClick={() => {
            setCurrentRow(null)
            setOpen('create')
          }}
        >
          <Plus className='mr-2 h-4 w-4' />
          Yeni xəbər
        </Button>
      </div>

      <div className='grid grid-cols-2 gap-3 xl:grid-cols-4'>
        <div className='rounded-lg border bg-card p-4'>
          <div className='text-sm text-muted-foreground'>Ümumi</div>
          <div className='text-2xl font-bold'>{news.length}</div>
        </div>

        <div className='rounded-lg border bg-card p-4'>
          <div className='text-sm text-muted-foreground'>Yayımlanan</div>
          <div className='text-2xl font-bold text-success'>
            {news.filter((item) => item.status === 'published').length}
          </div>
        </div>

        <div className='rounded-lg border bg-card p-4'>
          <div className='text-sm text-muted-foreground'>Təsdiq gözləyən</div>
          <div className='text-2xl font-bold text-warning'>
            {news.filter((item) => item.status === 'pending').length}
          </div>
        </div>

        <div className='rounded-lg border bg-card p-4'>
          <div className='text-sm text-muted-foreground'>Featured</div>
          <div className='text-2xl font-bold text-warning'>
            {news.filter((item) => item.featured).length}
          </div>
        </div>
      </div>

      <div className='grid gap-3 rounded-lg border bg-card p-4 md:grid-cols-[1fr_220px]'>
        <input
          aria-label='Başlığa görə axtar...'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Başlığa görə axtar...'
          className='rounded-lg border bg-background px-3 py-2'
        />

        <select
          aria-label='Status'
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className='rounded-lg border bg-background px-3 py-2'
        >
          <option value='all'>Bütün statuslar</option>
          <option value='draft'>Qaralama</option>
          <option value='pending'>Təsdiq gözləyir</option>
          <option value='scheduled'>Planlaşdırılıb</option>
          <option value='published'>Yayımlanıb</option>
        </select>
      </div>

      <ResponsiveTable label='Xəbərlər'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/50'>
            <tr>
              <th className='p-4 text-left'>ID</th>
              <th className='p-4 text-left'>Şəkil</th>
              <th className='p-4 text-left'>Başlıq</th>
              <th className='p-4 text-left'>Kateqoriya</th>
              <th className='p-4 text-left'>Status</th>
              <th className='p-4 text-left'>Featured</th>
              <th className='p-4 text-left'>Tarix</th>
              <th className='p-4 text-right'>Əməliyyatlar</th>
            </tr>
          </thead>

          <tbody>
            {filteredNews.map((item) => (
              <tr key={item.id} className='border-t hover:bg-muted/50'>
                <td className='p-4'>#{item.id}</td>

                <td className='p-4'>
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt={item.title}
                      className='h-14 w-20 rounded-md object-cover'
                    />
                  ) : (
                    <div className='h-14 w-20 rounded-md bg-muted' />
                  )}
                </td>

                <td className='max-w-md p-4'>
                  <div className='line-clamp-2 font-medium'>{item.title}</div>
                  <div className='line-clamp-1 text-muted-foreground'>
                    {item.summary}
                  </div>
                </td>

                <td className='p-4'>
                  <span className='rounded-full bg-muted px-2 py-1 text-xs'>
                    {item.category || 'Ümumi'}
                  </span>
                </td>

                <td className='p-4'>
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-medium ${getStatusClass(
                      item.status
                    )}`}
                  >
                    {getStatusLabel(item.status)}
                  </span>
                </td>

                <td className='p-4'>
                  {item.featured ? (
                    <span className='inline-flex items-center rounded-full bg-warning/10 px-2 py-1 text-xs font-medium text-warning'>
                      <Star className='mr-1 h-3 w-3 fill-current' />
                      Featured
                    </span>
                  ) : (
                    <span className='text-muted-foreground'>—</span>
                  )}
                </td>

                <td className='p-4'>
                  {item.created_at
                    ? new Date(item.created_at).toLocaleDateString('az-AZ')
                    : '-'}
                </td>

                <td className='p-4 text-right'>
                  <div className='flex flex-wrap justify-end gap-2'>
                    {item.status !== 'published' && (
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() => updateStatus(item.id, 'published')}
                      >
                        Yayımla
                      </Button>
                    )}

                    {item.status === 'published' && (
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() => updateStatus(item.id, 'pending')}
                      >
                        Gözləməyə al
                      </Button>
                    )}

                    <Button
                      size='sm'
                      variant={item.featured ? 'default' : 'outline'}
                      onClick={() => toggleFeatured(item.id, item.featured)}
                    >
                      <Star className='mr-1 h-4 w-4' />
                      {item.featured ? 'Featured-dən çıxar' : 'Featured et'}
                    </Button>

                    <NewsRowActions news={item} />
                  </div>
                </td>
              </tr>
            ))}

            {filteredNews.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className='p-10 text-center text-muted-foreground'
                >
                  Nəticə tapılmadı.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ResponsiveTable>

      <NewsDialogs />
    </div>
  )
}

export function NewsPage() {
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)

  async function loadNews() {
    const { data, error } = await supabase
      .from('news')
      .select(
        'id,title,slug,summary,content,image_url,source,category,status,scheduled_at,created_at,featured'
      )
      .order('created_at', {
        ascending: false,
      })

    if (!error && data) {
      setNews(data)
    }

    setLoading(false)
  }

  useEffect(() => {
    loadNews()
  }, [])

  if (loading) {
    return <div className='p-6'>Yüklənir...</div>
  }

  return (
    <NewsProvider reload={loadNews}>
      <NewsPageContent news={news} reload={loadNews} />
    </NewsProvider>
  )
}
