import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { supabase } from '@/lib/supabase'

type NewsItem = {
  id: number
  title: string
  summary: string | null
  content: string | null
  image_url: string | null
  source: string | null
  category: string | null
  status: string | null
  scheduled_at: string | null
}

export const Route = createFileRoute('/(auth)/admin/news/$id/edit')({
  component: RouteComponent,
})

function RouteComponent() {
  const { id } = Route.useParams()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState<NewsItem>({
    id: Number(id),
    title: '',
    summary: '',
    content: '',
    image_url: '',
    source: '',
    category: 'Ümumi',
    status: 'draft',
    scheduled_at: '',
  })

  useEffect(() => {
    async function loadNews() {
      const { data, error } = await supabase
        .from('news')
        .select('*')
        .eq('id', Number(id))
        .single()

      if (!error && data) {
        setForm({
          id: data.id,
          title: data.title || '',
          summary: data.summary || '',
          content: data.content || '',
          image_url: data.image_url || '',
          source: data.source || '',
          category: data.category || 'Ümumi',
          status: data.status || 'draft',
          scheduled_at: data.scheduled_at ? data.scheduled_at.slice(0, 16) : '',
        })
      }

      setLoading(false)
    }

    loadNews()
  }, [id])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)

    const { error } = await supabase
      .from('news')
      .update({
        title: form.title,
        summary: form.summary,
        content: form.content,
        image_url: form.image_url || null,
        source: form.source || null,
        category: form.category,
        status: form.status,
        scheduled_at: form.scheduled_at || null,
        published_at:
          form.status === 'published' ? new Date().toISOString() : null,
      })
      .eq('id', Number(id))

    setSaving(false)

    if (error) {
      alert('Xəta: ' + error.message)
      return
    }

    navigate({ to: '/admin/news' })
  }

  if (loading) {
    return <div className='p-6'>Yüklənir...</div>
  }

  return (
    <div className='space-y-6 p-6'>
      <div>
        <h1 className='text-xl font-semibold'>Xəbəri redaktə et</h1>
        <p className='text-muted-foreground'>Xəbər ID: #{id}</p>
      </div>

      <form
        onSubmit={handleSubmit}
        className='grid gap-6 lg:grid-cols-[1fr_340px]'
      >
        <div className='space-y-5'>
          <div className='rounded-lg border bg-card p-6'>
            <label className='mb-2 block font-medium'>Başlıq</label>
            <input
              aria-label='Başlıq'
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
              className='w-full rounded-lg border bg-background px-3 py-3 text-xl font-semibold'
            />
          </div>

          <div className='rounded-lg border bg-card p-6'>
            <label className='mb-2 block font-medium'>Qısa məzmun</label>
            <textarea
              aria-label='Qısa məzmun'
              value={form.summary || ''}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
              rows={4}
              className='w-full rounded-lg border bg-background px-3 py-3'
            />
          </div>

          <div className='rounded-lg border bg-card p-6'>
            <label className='mb-2 block font-medium'>Tam xəbər mətni</label>
            <textarea
              aria-label='Tam xəbər mətni'
              value={form.content || ''}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              rows={12}
              className='w-full rounded-lg border bg-background px-3 py-3'
            />
          </div>
        </div>

        <aside className='space-y-5'>
          <div className='rounded-lg border bg-card p-6'>
            <h2 className='mb-4 font-semibold'>Yayım ayarları</h2>

            <div className='space-y-4'>
              <div>
                <label className='mb-2 block text-sm font-medium'>Status</label>
                <select
                  aria-label='Status'
                  value={form.status || 'draft'}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className='w-full rounded-lg border bg-background px-3 py-3'
                >
                  <option value='draft'>Qaralama</option>
                  <option value='pending'>Təsdiq gözləyir</option>
                  <option value='scheduled'>Planlaşdırılıb</option>
                  <option value='published'>Yayımlanıb</option>
                </select>
              </div>

              <div>
                <label className='mb-2 block text-sm font-medium'>
                  Planlaşdırılan vaxt
                </label>
                <input
                  type='datetime-local'
                  value={form.scheduled_at || ''}
                  onChange={(e) =>
                    setForm({ ...form, scheduled_at: e.target.value })
                  }
                  className='w-full rounded-lg border bg-background px-3 py-3'
                />
              </div>

              <button
                disabled={saving}
                className='w-full rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
              >
                {saving ? 'Yadda saxlanır...' : 'Yadda saxla'}
              </button>
            </div>
          </div>

          <div className='rounded-lg border bg-card p-6'>
            <label className='mb-2 block font-medium'>Şəkil linki</label>
            <input
              value={form.image_url || ''}
              onChange={(e) => setForm({ ...form, image_url: e.target.value })}
              className='w-full rounded-lg border bg-background px-3 py-3'
            />

            {form.image_url && (
              <img
                src={form.image_url}
                alt=''
                className='mt-4 h-48 w-full rounded-lg object-cover'
              />
            )}
          </div>

          <div className='rounded-lg border bg-card p-6'>
            <label className='mb-2 block font-medium'>Kateqoriya</label>
            <select
              aria-label='Kateqoriya'
              value={form.category || 'Ümumi'}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className='w-full rounded-lg border bg-background px-3 py-3'
            >
              <option>Təhsil</option>
              <option>Elm</option>
              <option>Texnologiya</option>
              <option>Dünya</option>
              <option>Ümumi</option>
            </select>
          </div>

          <div className='rounded-lg border bg-card p-6'>
            <label className='mb-2 block font-medium'>Mənbə linki</label>
            <input
              value={form.source || ''}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              className='w-full rounded-lg border bg-background px-3 py-3'
            />
          </div>
        </aside>
      </form>
    </div>
  )
}
