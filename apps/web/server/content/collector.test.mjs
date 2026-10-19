import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { collectContent } from './collector.mjs'
import {
  extractArticle,
  normalizePublicationDate,
  detectLanguage,
} from './extract.mjs'
import {
  publicAddress,
  authorizedUrl,
  robotsDecision,
  safeRequest,
} from './http.mjs'

const text =
  'Bakı Dövlət Universiteti tələbələri dərs cədvəlinin rahat olması barədə fikirlərini bölüşür. '.repeat(
    12
  )
const policy = {
  enabled: true,
  sourceId: 's1',
  origins: ['https://publisher.example.invalid'],
  rights: {
    basis: 'owned_source',
    reference: 'synthetic-license',
    verified: true,
  },
  minIntervalMs: 100,
}
const record = {
  source_id: 's1',
  url: 'https://publisher.example.invalid/news',
  title: 'Universitet xəbəri',
}
const html = `<html lang="az"><head><link rel="canonical" href="/original"><meta property="article:published_time" content="2026-10-13T09:00:00+04:00"></head><body><nav>NOISE</nav><article><h1>Universitet xəbəri</h1><p>${text}</p><aside>MORE NOISE</aside><script>fetch('secret')</script></article></body></html>`
const web = async (_url) =>
  _url.endsWith('/robots.txt')
    ? { status: 200, headers: {}, body: 'User-agent: *\nAllow: /' }
    : {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: html,
      }
test('default-disabled/unverified/mismatched permission and cancellation do not fetch', async () => {
  let calls = 0
  const request = async () => {
    calls++
    return {}
  }
  await assert.rejects(
    collectContent(record, { ...policy, enabled: false }, { request }),
    /collection_not_authorized/
  )
  await assert.rejects(
    collectContent(
      record,
      { ...policy, rights: { ...policy.rights, verified: false } },
      { request }
    ),
    /collection_not_authorized/
  )
  await assert.rejects(
    collectContent({ ...record, source_id: 'other' }, policy, { request }),
    /collection_not_authorized/
  )
  await assert.rejects(
    collectContent(record, policy, { request, signal: AbortSignal.abort() }),
    /cancelled/
  )
  assert.equal(calls, 0)
})
test('RSS full-content and authorized API text extract without fetching; summaries do not qualify', async () => {
  const request = () => {
    throw Error('must not fetch')
  }
  const rss = await collectContent(
    {
      ...record,
      feed: {
        content_encoded: `<p>${text}</p>`,
        language: 'az',
        published_at: '2026-10-13T09:00:00Z',
      },
    },
    policy,
    { request }
  )
  assert.equal(rss.quality.label, 'full_text')
  assert.equal(rss.provenance.method, 'rss_content')
  assert.equal(rss.provenance.robots.state, 'not_applicable')
  assert.equal(rss.language.code, 'az')
  const api = await collectContent(
    { ...record, api: { text: text.repeat(10) } },
    policy,
    { request }
  )
  assert.equal(Array.from(api.excerpt).length, 4000)
  assert.ok(api.content_hash)
  const summary = await collectContent(
    { ...record, feed: { summary: 'Qısa xəbər' } },
    policy,
    {
      request: async () => ({ status: 403, headers: {}, body: '' }),
      sleep: async () => {},
    }
  )
  assert.equal(summary.quality.label, 'title_summary')
  assert.equal(summary.excerpt, null)
})
test('HTML main extraction excludes navigation/scripts; canonical is recorded not crawled', async () => {
  let requests = 0
  const result = await collectContent(record, policy, {
    request: async (...args) => {
      requests++
      return web(...args)
    },
    sleep: async () => {},
  })
  assert.equal(requests, 2)
  assert.equal(
    result.canonical_url,
    'https://publisher.example.invalid/original'
  )
  assert.equal(result.published_at, '2026-10-13T05:00:00.000Z')
  assert.equal(result.quality.label, 'full_text')
  assert.equal(result.excerpt.includes('NOISE'), false)
  assert.equal(result.excerpt.includes('fetch'), false)
})
test('robots denied/unknown rules, meta restrictions and paywalls never produce excerpts', async () => {
  for (const robot of [
    { status: 200, body: 'User-agent: *\nDisallow: /news' },
    { status: 403, body: '' },
  ]) {
    let calls = 0
    const result = await collectContent(record, policy, {
      request: async () => {
        calls++
        return { ...robot, headers: {} }
      },
      sleep: async () => {},
    })
    assert.equal(result.excerpt, null)
    assert.equal(calls, 1)
  }
  for (const extra of [
    '<meta name="robots" content="nosnippet">',
    '<div class="paywall">Subscribe</div>',
  ]) {
    const result = extractArticle(html.replace('<body>', `<body>${extra}`), {
      url: record.url,
      origins: policy.origins,
    })
    assert.equal(result.restricted, true)
    assert.equal(result.text, '')
  }
})
test('redirect robots denied checked BEFORE fetching redirected article; cross origin blocked', async () => {
  const fetched = []
  const request = async (url) => {
    fetched.push(url)
    return url.endsWith('/robots.txt')
      ? { status: 200, headers: {}, body: 'User-agent: *\nDisallow: /private' }
      : { status: 302, headers: { location: '/private' }, body: '' }
  }
  const result = await collectContent(record, policy, {
    request,
    sleep: async () => {},
  })
  assert.equal(result.excerpt, null)
  assert.equal(
    fetched.some((x) => x.endsWith('/private')),
    false
  )
  const cross = await collectContent(record, policy, {
    request: async (url) =>
      url.endsWith('/robots.txt')
        ? web(url)
        : {
            status: 302,
            headers: { location: 'https://evil.example.invalid/news' },
            body: '',
          },
    sleep: async () => {},
  })
  assert.equal(cross.excerpt, null)
})
test('rate limits, request budgets and crawl delay are bounded', async () => {
  await assert.rejects(
    collectContent(record, policy, {
      request: async () => ({ status: 429, headers: {}, body: '' }),
      sleep: async () => {},
    }),
    (e) => e.retryable === true
  )
  const budget = await collectContent(
    record,
    { ...policy, maxRequests: 1 },
    { request: web, sleep: async () => {} }
  )
  assert.equal(budget.excerpt, null)
  let delay = 0
  await collectContent(record, policy, {
    request: async (url) =>
      url.endsWith('/robots.txt')
        ? { status: 200, headers: {}, body: 'User-agent: *\nCrawl-delay: 2' }
        : web(url),
    sleep: async (ms) => {
      delay = ms
    },
  })
  assert.equal(delay, 2000)
})
test('robots groups longest specificity allow tie wildcard percent/query and unicode', () => {
  assert.equal(
    robotsDecision(
      'User-agent: *\nDisallow: /\nUser-agent: VizualBot\nAllow: /news',
      '/news'
    ).allowed,
    true
  )
  assert.equal(
    robotsDecision('User-agent: *\nDisallow: /news\nAllow: /news', '/news')
      .allowed,
    true
  )
  assert.equal(
    robotsDecision('User-agent: *\nDisallow: /*?secret=*', '/news?secret=yes')
      .allowed,
    false
  )
  assert.equal(
    robotsDecision('User-agent: *\nDisallow: /təhsil', '/t%C9%99hsil').allowed,
    false
  )
  assert.equal(
    robotsDecision('User-agent: *\nDisallow: /%6eews$', '/news').allowed,
    false
  )
})
test('URL+DNS rejects private IPv4/IPv6/mapped/reserved and mixed answers', async () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '100.64.0.1',
    '169.254.169.254',
    '192.168.1.1',
    '::1',
    '::ffff:8.8.8.8',
    '2001:db8::1',
    '2002:0808:0808::1',
    '3fff::1',
  ])
    assert.equal(publicAddress(ip), false, ip)
  assert.equal(publicAddress('8.8.8.8'), true)
  assert.equal(publicAddress('2606:4700::1111'), true)
  assert.throws(
    () =>
      authorizedUrl(
        'https://user:secret@publisher.example.invalid',
        policy.origins
      ),
    /unauthorized_url/
  )
  await assert.rejects(
    safeRequest(record.url, {
      origins: policy.origins,
      resolve: async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
    }),
    /unsafe_address/
  )
})
test('HTTPS DNS is pinned while TLS hostname retained and body bound enforced', async () => {
  let pinned
  const request = (_url, options, callback) => {
    assert.equal(options.servername, 'publisher.example.invalid')
    options.lookup('ignored', { all: false }, (_error, address) => {
      pinned = address
    })
    const req = new EventEmitter()
    req.destroy = (e) => req.emit('error', e)
    req.end = () => {
      const res = new EventEmitter()
      res.statusCode = 200
      res.headers = {}
      res.destroy = () => {}
      callback(res)
      res.emit('data', Buffer.alloc(1100))
      res.emit('end')
    }
    return req
  }
  await assert.rejects(
    safeRequest(record.url, {
      origins: policy.origins,
      maxBytes: 1000,
      resolve: async () => [{ address: '8.8.8.8', family: 4 }],
      request,
    }),
    /response_limit/
  )
  assert.equal(pinned, '8.8.8.8')
})
test('publication timezone missing is unknown and language is attributed not measured accuracy', () => {
  assert.equal(normalizePublicationDate('2026-10-13 10:00:00'), null)
  assert.equal(detectLanguage('tələbə əla təhsil').code, 'az')
  assert.equal(detectLanguage('неудобное расписание').code, 'ru')
  assert.equal(detectLanguage('university students').confidence, 'low')
})
test('stalled DNS, mid-DNS abort and synchronous constructor error settle safely', async () => {
  await assert.rejects(
    safeRequest(record.url, {
      origins: policy.origins,
      timeoutMs: 10,
      resolve: () => new Promise(() => {}),
    }),
    /timeout/
  )
  const controller = new AbortController()
  const promise = safeRequest(record.url, {
    origins: policy.origins,
    signal: controller.signal,
    resolve: () => new Promise(() => {}),
  })
  controller.abort()
  await assert.rejects(promise, /cancelled/)
  await assert.rejects(
    safeRequest(record.url, {
      origins: policy.origins,
      resolve: async () => [{ address: '8.8.8.8', family: 4 }],
      request: () => {
        throw Error('untrusted raw failure')
      },
    }),
    /network_failed/
  )
})
test('normalized robots octet specificity cannot let encoded broad allow defeat narrow deny', () => {
  assert.equal(
    robotsDecision(
      'User-agent: *\nDisallow: /news/private\nAllow: /%6e%65%77%73',
      '/news/private'
    ).allowed,
    false
  )
})
test('deep nested malformed HTML is bounded by node depth', () => {
  assert.throws(
    () =>
      extractArticle(
        `<article>${'<div>'.repeat(140)}text${'</div>'.repeat(140)}</article>`,
        { url: record.url, origins: policy.origins }
      ),
    /document_limit/
  )
})
test('publisher JSON-LD explicitly inaccessible article is never reused', () => {
  const restricted = extractArticle(
    html.replace(
      '<head>',
      '<head><script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script>'
    ),
    { url: record.url, origins: policy.origins }
  )
  assert.equal(restricted.restricted, true)
  assert.equal(restricted.text, '')
})
test('HTML login page served as robots is unknown and blocks article retrieval', async () => {
  let fetched = 0
  const result = await collectContent(record, policy, {
    request: async () => {
      fetched++
      return {
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: '<!doctype html><html>Login</html>',
      }
    },
    sleep: async () => {},
  })
  assert.equal(fetched, 1)
  assert.equal(result.excerpt, null)
  assert.equal(result.provenance.robots.state, 'unknown')
})
test('invalid UTF-8 response fails safely without an uncaught callback error', async () => {
  const request = (_url, _options, callback) => {
    const req = new EventEmitter()
    req.end = () =>
      setTimeout(() => {
        const res = new EventEmitter()
        res.statusCode = 200
        res.headers = {}
        res.destroy = () => {}
        callback(res)
        res.emit('data', Buffer.from([255]))
        res.emit('end')
      }, 0)
    req.destroy = (error) => req.emit('error', error)
    return req
  }
  await assert.rejects(
    safeRequest(record.url, {
      origins: policy.origins,
      request,
      resolve: async () => [{ address: '8.8.8.8', family: 4 }],
    }),
    /unsupported_encoding/
  )
})
