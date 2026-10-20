import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  buildPixelPickerHtml,
  type PixelPickedElement,
} from '@/lib/selector-picker'
import { supabase } from '@/lib/supabase'

type Source = {
  id: string
  name: string
  base_url: string
  latest_url: string | null
  selector: string | null
  article_pattern: string | null
}

type PickedElement = PixelPickedElement

type SelectorTestResult = {
  ok: boolean
  matchedCount: number
  previewText: string
  previewItems?: string[]
  error?: string | null
}

function buildPickerHtml(html: string, baseUrl?: string) {
  return buildPixelPickerHtml(html, { baseUrl, autoSuggest: false })
}

function makeArticlePattern(selection: PickedElement | null) {
  if (!selection?.selector) return ''

  if (selection.tag === 'a') {
    return selection.selector
  }

  return `${selection.selector} a[href]`
}

function isVisualPageUrl(url: string | null | undefined) {
  const value = String(url || '')
    .toLowerCase()
    .trim()
  if (!value) return false

  return !(
    value.endsWith('.xml') ||
    value.includes('/rss') ||
    value.includes('/feed') ||
    value.includes('sitemap') ||
    value.includes('atom.xml')
  )
}

function getVisualTargetUrl(source: Source | null) {
  if (!source) return ''
  if (isVisualPageUrl(source.base_url)) return source.base_url || ''
  if (isVisualPageUrl(source.latest_url)) return source.latest_url || ''
  return source.base_url || source.latest_url || ''
}

function SelectorPickerPage() {
  const [source, setSource] = useState<Source | null>(null)
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingPage, setLoadingPage] = useState(false)
  const [message, setMessage] = useState('')
  const [selection, setSelection] = useState<PickedElement | null>(null)
  const [testResult, setTestResult] = useState<SelectorTestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectorMode, setSelectorMode] = useState(false)
  const [currentUrl, setCurrentUrl] = useState('')
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const navigate = useNavigate()

  const sourceId = useMemo(() => {
    return new URLSearchParams(window.location.search).get('sourceId') || ''
  }, [])

  const targetUrl = getVisualTargetUrl(source)
  const articlePattern = makeArticlePattern(selection)

  async function loadSource() {
    if (!sourceId) {
      setMessage('sourceId yoxdur.')
      setLoading(false)
      return
    }

    setLoading(true)

    const { data, error } = await supabase
      .from('sources')
      .select('id,name,base_url,latest_url,selector,article_pattern')
      .eq('id', sourceId)
      .single()

    if (error) {
      setMessage('Mənbə oxunmadı: ' + error.message)
      setLoading(false)
      return
    }

    setSource(data as Source)
    setLoading(false)
  }

  async function loadPage(url: string) {
    setCurrentUrl(url)
    setSelectorMode(false)
    setLoadingPage(true)
    setMessage('')
    setSelection(null)
    setTestResult(null)

    const { data, error } = await supabase.functions.invoke('selector-proxy', {
      body: { url },
    })

    if (error) {
      setMessage(
        `Proxy xətası: ${error.message}. Sayt pəncərədə açılmırsa, real brauzerdə açıb extension ilə selector seçin.`
      )
      setHtml('')
      setLoadingPage(false)
      return
    }

    if (!data?.html) {
      setMessage(
        data?.error ||
          'HTML tapılmadı. Saytı real brauzerdə açıb extension ilə selector seçin və ya başqa səhifə URL-i ilə yenidən cəhd edin.'
      )
      setHtml('')
      setLoadingPage(false)
      return
    }

    if (data.finalUrl) {
      setCurrentUrl(data.finalUrl)
    }

    if (data.canonicalFallback) {
      setMessage('Sayt canonical domenlə açıldı. İşlək ünvan: ' + data.finalUrl)
    }

    setHtml(buildPickerHtml(data.html, data.finalUrl || url))
    setLoadingPage(false)
  }

  async function testSelector(picked = selection) {
    if (!picked?.selector) {
      setMessage('Əvvəl izlənəcək hissəni seçin.')
      return null
    }

    const url = currentUrl || targetUrl
    if (!url) {
      setMessage('Test üçün URL tapılmadı.')
      return null
    }

    setTesting(true)
    setMessage('Selector test edilir...')
    const { data, error } = await supabase.functions.invoke(
      'change-selector-test',
      {
        body: { url, selector: picked.selector },
      }
    )
    setTesting(false)

    if (error) {
      const result = {
        ok: false,
        matchedCount: 0,
        previewText: '',
        error: error.message,
      }
      setTestResult(result)
      setMessage('Selector test edilmədi: ' + error.message)
      return result
    }

    const result = {
      ok: Boolean(data?.ok),
      matchedCount: Number(data?.matchedCount || 0),
      previewText: String(data?.previewText || ''),
      previewItems: data?.previewItems || [],
      error: data?.error || null,
    }

    setTestResult(result)
    if (!result.ok || result.matchedCount < 1) {
      setMessage(result.error || 'Selector bu səhifədə element tapmadı.')
      return result
    }

    setMessage(
      result.matchedCount === 1
        ? 'Selector test edildi: 1 uyğun element tapıldı.'
        : `Selector test edildi: bu selector səhifədə ${result.matchedCount} elementə uyğundur.`
    )
    return result
  }

  async function saveSelector(picked = selection, redirectAfterSave = false) {
    if (!source || !picked?.selector) return

    const result =
      testResult?.ok && testResult.matchedCount > 0
        ? testResult
        : await testSelector(picked)
    if (!result?.ok || result.matchedCount < 1) {
      setMessage('Boş selector saxlanmadı. Əvvəl işlək seçim test edilməlidir.')
      return
    }

    const pattern = makeArticlePattern(picked) || picked.selector
    setSaving(true)
    setMessage('Selector saxlanılır...')

    const { error } = await supabase
      .from('sources')
      .update({
        status: 'active',
        monitor_method: 'selector',
        selector: picked.selector,
        article_pattern: pattern,
        consecutive_fail_count: 0,
        last_error: null,
        last_result: 'selector_configured',
        discovery_status: 'accepted',
        notes: `Visual picker ilə selector seçildi: ${picked.selector}. Test nəticəsi: ${result.matchedCount} uyğun element.`,
      })
      .eq('id', source.id)

    setSaving(false)

    if (error) {
      setMessage('Selector saxlanmadı: ' + error.message)
      return
    }

    setMessage(
      `Selector saxlandı. Bot bu blokdakı linkləri oxuyacaq: ${pattern}`
    )

    if (redirectAfterSave) {
      await navigate({ to: '/admin/monitor/sources' })
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSource()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Only trust messages from the sandboxed picker frame.
      if (
        !iframeRef.current ||
        event.source !== iframeRef.current.contentWindow
      )
        return

      if (event.data?.type === 'visual-monitor-navigate') {
        const nextUrl = event.data.url || ''
        if (nextUrl) void loadPage(nextUrl)
        return
      }

      if (event.data?.type !== 'visual-monitor-selector-picked') return

      const picked = {
        selector: event.data.selector || '',
        text: event.data.text || '',
        html: event.data.html || '',
        href: event.data.href || null,
        tag: event.data.tag || '',
        matchCount: Number(event.data.matchCount || 0),
      }

      setSelection(picked)
      setTestResult(null)
      setMessage(
        picked.matchCount === 1
          ? 'Element seçildi. 1 uyğun element görünür. Təsdiqdən əvvəl test edə bilərsən.'
          : `Element seçildi. İlkin yoxlamada ${picked.matchCount || 0} uyğun element görünür.`
      )
    }

    window.addEventListener('message', handleMessage)

    return () => window.removeEventListener('message', handleMessage)
  }, [])

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'visual-monitor-selector-mode', enabled: selectorMode },
      '*'
    )
  }, [selectorMode, html])

  function adjustSelection(direction: 'parent' | 'child') {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'visual-monitor-selector-adjust', direction },
      '*'
    )
  }

  useEffect(() => {
    if (targetUrl) {
      const timer = window.setTimeout(() => {
        void loadPage(targetUrl)
      }, 0)

      return () => window.clearTimeout(timer)
    }
  }, [targetUrl])

  if (loading) {
    return <div className='p-6'>Yüklənir...</div>
  }

  return (
    <div className='grid h-screen grid-rows-[auto_1fr]'>
      <div className='border-b bg-background p-4'>
        <div className='flex flex-wrap items-start justify-between gap-4'>
          <div>
            <h1 className='text-xl font-semibold'>Selector seç</h1>
            <div className='text-sm text-muted-foreground'>
              {source?.name || 'Mənbə'} | {targetUrl}
            </div>
          </div>

          <div className='flex flex-wrap gap-2'>
            <Link
              to='/admin/monitor/sources'
              className='rounded-md border px-3 py-2 text-sm hover:bg-muted'
            >
              Mənbələrə qayıt
            </Link>

            <a
              href={currentUrl || targetUrl}
              target='_blank'
              rel='noreferrer'
              className='rounded-md border px-3 py-2 text-sm hover:bg-muted'
            >
              Saytı ayrıca aç
            </a>

            <button
              type='button'
              onClick={() => setSelectorMode((value) => !value)}
              className={`rounded-md border px-3 py-2 text-sm font-medium ${
                selectorMode
                  ? 'border-amber-300 bg-warning/10 text-warning hover:bg-warning/10'
                  : 'border-success/25 bg-success/10 text-success hover:bg-success/10'
              }`}
            >
              {selectorMode
                ? 'Gəzinti rejiminə keç'
                : 'Selector rejimini aktiv et'}
            </button>

            <button
              type='button'
              onClick={() =>
                (currentUrl || targetUrl) && loadPage(currentUrl || targetUrl)
              }
              className='rounded-md border px-3 py-2 text-sm hover:bg-muted'
            >
              Yenilə
            </button>
          </div>
        </div>

        {message ? (
          <div className='mt-3 rounded-md border bg-muted/50 p-3 text-sm'>
            {message}
          </div>
        ) : null}

        <div className='mt-3 grid gap-3 border-t pt-3 xl:grid-cols-[minmax(0,1fr)_360px]'>
          <div className='flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted px-3 py-2 text-sm text-foreground'>
            <span>
              {selectorMode
                ? 'Selector rejimi aktivdir. Xəbər bloku, kartı və ya başlığı seç.'
                : 'Gəzinti rejimindəsən. Saytın bölmələrinə daxil ola bilərsən.'}
            </span>
            <button
              type='button'
              onClick={() => setSelectorMode((value) => !value)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                selectorMode
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'border bg-background text-foreground hover:bg-muted'
              }`}
            >
              {selectorMode ? 'Gəzintiyə qayıt' : 'Selectoru aktiv et'}
            </button>
          </div>
          <div className='rounded-md border bg-background p-3 text-sm'>
            {selection ? (
              <div className='grid gap-2'>
                <div className='font-semibold'>Seçilmiş element</div>
                <div className='flex flex-wrap gap-2 text-xs'>
                  <span className='rounded-full bg-muted px-2 py-1'>
                    Tag: {selection.tag || '-'}
                  </span>
                  <span className='rounded-full bg-muted px-2 py-1'>
                    Uyğun element sayı:{' '}
                    {testResult?.matchedCount ?? selection.matchCount ?? 0}
                  </span>
                </div>
                <div className='max-h-20 overflow-auto rounded bg-muted p-2 text-xs text-muted-foreground'>
                  {selection.text || selection.href || 'Mətn tapılmadı'}
                </div>
                <div className='text-xs break-all'>
                  <b>Selector:</b> {selection.selector}
                </div>
                <div className='text-xs break-all'>
                  <b>Article pattern:</b> {articlePattern || '-'}
                </div>
                {selection.html ? (
                  <details className='rounded bg-muted/50 p-2 text-xs'>
                    <summary className='cursor-pointer font-medium'>
                      HTML önizləməsi
                    </summary>
                    <pre className='mt-2 max-h-24 overflow-auto break-all whitespace-pre-wrap text-muted-foreground'>
                      {selection.html}
                    </pre>
                  </details>
                ) : null}
                {testResult ? (
                  <div
                    className={`rounded-md border p-2 text-xs ${
                      testResult.ok
                        ? 'border-success/25 bg-success/10'
                        : 'border-destructive/25 bg-destructive/10'
                    }`}
                  >
                    {testResult.ok
                      ? testResult.matchedCount === 1
                        ? '1 uyğun element tapıldı.'
                        : `Bu selector səhifədə ${testResult.matchedCount} elementə uyğundur.`
                      : testResult.error || 'Selector element tapmadı.'}
                    {testResult.previewText ? (
                      <div className='mt-1 max-h-16 overflow-auto text-muted-foreground'>
                        {testResult.previewText}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className='grid grid-cols-2 gap-2'>
                  <button
                    type='button'
                    onClick={() => adjustSelection('child')}
                    className='rounded-md border px-3 py-2 text-xs hover:bg-muted'
                  >
                    Daha kiçik element
                  </button>
                  <button
                    type='button'
                    onClick={() => adjustSelection('parent')}
                    className='rounded-md border px-3 py-2 text-xs hover:bg-muted'
                  >
                    Üst elementi seç
                  </button>
                </div>
                <button
                  type='button'
                  onClick={() => testSelector(selection)}
                  disabled={testing}
                  className='rounded-md border px-4 py-2 text-sm hover:bg-muted disabled:opacity-60'
                >
                  {testing ? 'Test edilir...' : 'Test et'}
                </button>
                <button
                  type='button'
                  onClick={() => saveSelector(selection, true)}
                  disabled={saving || testing}
                  className='rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60'
                >
                  {saving ? 'Saxlanır...' : 'Seçimi təsdiqlə'}
                </button>
              </div>
            ) : (
              <div className='text-muted-foreground'>
                Seçilmiş elementin önizləməsi burada görünəcək.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className='min-h-[calc(100vh-260px)] overflow-hidden bg-muted/50'>
        {loadingPage ? (
          <div className='p-6'>Sayt açılır...</div>
        ) : html ? (
          <iframe
            ref={iframeRef}
            title='Selector picker'
            srcDoc={html}
            sandbox='allow-scripts allow-popups'
            className='h-full min-h-[calc(100vh-260px)] w-full bg-white'
          />
        ) : (
          <div className='p-6 text-muted-foreground'>
            Sayt göstərilə bilmədi.
          </div>
        )}
      </div>
    </div>
  )
}

export const Route = createFileRoute('/(auth)/admin/monitor/picker')({
  component: SelectorPickerPage,
})
