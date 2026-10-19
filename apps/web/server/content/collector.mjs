import { z } from 'zod'
import {
  contentPayload,
  extractArticle,
  extractFeedField,
  normalizePublicationDate,
  detectLanguage,
  permittedCanonical,
} from './extract.mjs'
import {
  authorizedUrl,
  safeRequest,
  ContentError,
  robotsDecision,
} from './http.mjs'

const policySchema = z
  .object({
    enabled: z.boolean(),
    sourceId: z.string().min(1).max(100),
    origins: z.array(z.string().url()).min(1).max(10),
    rights: z
      .object({
        basis: z.enum(['owned_source', 'publisher_permission', 'licensed']),
        reference: z.string().min(1).max(500),
        verified: z.boolean(),
      })
      .strict(),
    maxRequests: z.number().int().min(1).max(6).default(4),
    maxBytes: z.number().int().min(1000).max(524288).default(524288),
    timeoutMs: z.number().int().min(100).max(10000).default(5000),
    minIntervalMs: z.number().int().min(100).max(60000).default(1000),
  })
  .strict()
const recordSchema = z
  .object({
    source_id: z.string().min(1),
    url: z.string().url().max(2000),
    title: z.string().max(2000),
    feed: z
      .object({
        content_encoded: z.string().max(524288).optional(),
        content: z.string().max(524288).optional(),
        summary: z.string().max(4000).optional(),
        original_url: z.string().max(2000).optional(),
        published_at: z.string().max(100).optional(),
        language: z.string().max(20).optional(),
      })
      .strict()
      .optional(),
    api: z
      .object({
        text: z.string().max(250000),
        published_at: z.string().max(100).optional(),
        language: z.string().max(20).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
export function discoverOriginalUrl(record, policy) {
  return (
    permittedCanonical(
      record.feed?.original_url || record.url,
      record.url,
      policy.origins
    ) || authorizedUrl(record.url, policy.origins).href
  )
}
export async function collectContent(
  rawRecord,
  rawPolicy,
  {
    signal,
    request = safeRequest,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = new Date(),
  } = {}
) {
  const policy = policySchema.parse(rawPolicy),
    record = recordSchema.parse(rawRecord)
  if (
    !policy.enabled ||
    !policy.rights.verified ||
    record.source_id !== policy.sourceId
  )
    throw new ContentError('collection_not_authorized')
  if (signal?.aborted) throw new ContentError('cancelled')
  authorizedUrl(record.url, policy.origins)
  const original = discoverOriginalUrl(record, policy)
  const basis = {
    sourceId: record.source_id,
    url: record.url,
    rights: policy.rights,
    now,
    robots: { state: 'not_applicable', checked_at: null },
  }
  const full =
    record.api?.text || record.feed?.content_encoded || record.feed?.content
  if (full) {
    const method = record.api ? 'authorized_api' : 'rss_content',
      text = record.api ? full : extractFeedField(full)
    return contentPayload(
      {
        text,
        headline: record.title,
        canonical_url: original,
        published_at: normalizePublicationDate(
          record.api?.published_at || record.feed?.published_at
        ),
        language: detectLanguage(
          text,
          record.api?.language || record.feed?.language
        ),
        main_content_detected: true,
      },
      { ...basis, method }
    )
  }
  basis.robots = { state: 'unknown', checked_at: now.toISOString() }
  let used = 0,
    lastRequest = null,
    delay = policy.minIntervalMs
  const fetchBounded = async (url, maxBytes = policy.maxBytes) => {
    if (signal?.aborted) throw new ContentError('cancelled')
    if (++used > policy.maxRequests)
      throw new ContentError('request_budget_exhausted')
    authorizedUrl(url, policy.origins)
    if (lastRequest !== null) await sleep(delay)
    if (signal?.aborted) throw new ContentError('cancelled')
    lastRequest = Date.now()
    return request(url, {
      origins: policy.origins,
      signal,
      maxBytes,
      timeoutMs: policy.timeoutMs,
    })
  }
  const follow = async (url, maxBytes, allowed = () => true) => {
    for (let hop = 0; hop <= 2; hop++) {
      if (!allowed(url)) throw new ContentError('robots_denied')
      const response = await fetchBounded(url, maxBytes)
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (hop === 2 || !response.headers.location)
          throw new ContentError('redirect_limit')
        const next = new URL(response.headers.location, url)
        if (next.origin !== new URL(url).origin)
          throw new ContentError('redirect_origin_blocked')
        authorizedUrl(next.href, policy.origins)
        url = next.href
        continue
      }
      return { ...response, finalUrl: url }
    }
    throw new ContentError('redirect_limit')
  }
  try {
    const robotsUrl = new URL('/robots.txt', original).href
    const robots = await follow(robotsUrl, 524288)
    if (robots.status !== 200 && robots.status !== 404)
      throw new ContentError(
        'robots_unavailable',
        robots.status >= 500 || robots.status === 429
      )
    if (
      robots.status === 200 &&
      (/^text\/html/i.test(robots.headers['content-type'] || '') ||
        /^\s*<(?:!doctype|html|body)/i.test(robots.body))
    )
      throw new ContentError('robots_unavailable')
    const robotTarget = new URL(original)
    const decision =
      robots.status === 404
        ? { allowed: true, delayMs: 0 }
        : robotsDecision(robots.body, robotTarget.pathname + robotTarget.search)
    if (!decision.allowed) {
      basis.robots = { state: 'denied', checked_at: now.toISOString() }
      throw new ContentError('robots_denied')
    }
    delay = Math.max(delay, decision.delayMs)
    basis.robots = { state: 'allowed', checked_at: now.toISOString() }
    const article = await follow(original, policy.maxBytes, (url) => {
      const target = new URL(url)
      return (
        robots.status === 404 ||
        robotsDecision(robots.body, target.pathname + target.search).allowed
      )
    })
    // A same-origin redirect can have a different robots rule: check final path too.
    const final = new URL(article.finalUrl)
    if (
      robots.status === 200 &&
      !robotsDecision(robots.body, final.pathname + final.search).allowed
    )
      throw new ContentError('robots_denied')
    if (article.status === 429 || article.status >= 500)
      throw new ContentError(
        article.status === 429 ? 'rate_limited' : 'source_inaccessible',
        true
      )
    if (article.status !== 200) {
      if (article.status === 401)
        basis.access = { authentication_required: true, paywall: false }
      throw new ContentError('source_inaccessible')
    }
    if (
      !/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(
        article.headers['content-type'] || ''
      ) ||
      /charset\s*=\s*(?!utf-8|us-ascii)[\w-]+/i.test(
        article.headers['content-type'] || ''
      )
    )
      throw new ContentError('unsupported_content_type')
    if (
      /nosnippet|noarchive|max-snippet\s*:\s*0/i.test(
        article.headers['x-robots-tag'] || ''
      )
    )
      throw new ContentError('restricted_content')
    const extracted = extractArticle(article.body, {
      url: article.finalUrl,
      origins: policy.origins,
    })
    return contentPayload(extracted, {
      ...basis,
      method: 'article_html',
      failure:
        !extracted.main_content_detected && !extracted.restricted
          ? 'extraction_failed'
          : null,
    })
  } catch (error) {
    if (signal?.aborted) throw new ContentError('cancelled')
    if (error instanceof ContentError && error.retryable) throw error
    const summary = record.feed?.summary
      ? extractFeedField(record.feed.summary)
      : ''
    return contentPayload(
      {
        text: summary,
        headline: record.title,
        language: detectLanguage(summary, record.feed?.language),
        main_content_detected: false,
      },
      {
        ...basis,
        method: summary ? 'rss_summary' : 'article_html',
        summary: true,
        failure: summary
          ? 'title_summary'
          : error instanceof ContentError
            ? [
                'robots_denied',
                'source_inaccessible',
                'restricted_content',
                'robots_unavailable',
                'redirect_origin_blocked',
              ].includes(error.code)
              ? 'source_inaccessible'
              : 'extraction_failed'
            : 'extraction_failed',
      }
    )
  }
}
