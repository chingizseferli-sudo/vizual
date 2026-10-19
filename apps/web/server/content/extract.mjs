import { createHash } from 'node:crypto'
import { parse, parseFragment } from 'parse5'

export const QUALITY_STATES = [
  'full_text',
  'substantial_excerpt',
  'title_summary',
  'title_only',
  'extraction_failed',
  'source_inaccessible',
]
const count = (text) => Array.from(text).length
const clean = (text) => text.normalize('NFKC').replace(/\s+/gu, ' ').trim()
const attr = (node, name) =>
  node.attrs?.find((x) => x.name === name)?.value || ''
const excludedTags = new Set([
  'script',
  'style',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'button',
  'noscript',
  'svg',
  'iframe',
  'template',
])
function inspect(root) {
  const nodes = [],
    stack = [[root, 0]]
  while (stack.length) {
    const [node, depth] = stack.pop()
    if (depth > 128) throw new Error('document_limit')
    nodes.push(node)
    if (nodes.length > 20000) throw new Error('document_limit')
    for (const child of node.childNodes || []) stack.push([child, depth + 1])
  }
  const texts = new Map()
  for (const node of [...nodes].reverse()) {
    const excluded =
      excludedTags.has(node.tagName) ||
      attr(node, 'aria-hidden') === 'true' ||
      (node.attrs || []).some((a) => a.name === 'hidden') ||
      /\b(related|comments|cookie|navigation|social-share|menu)\b/i.test(
        `${attr(node, 'class')} ${attr(node, 'id')}`
      )
    texts.set(
      node,
      excluded
        ? ''
        : node.nodeName === '#text'
          ? node.value
          : clean(
              (node.childNodes || []).map((c) => texts.get(c) || '').join(' ')
            )
    )
  }
  return { nodes, texts }
}
export function detectLanguage(text, declared = '') {
  const declaredCode = declared.toLowerCase().split(/[-_]/)[0]
  if (['az', 'tr', 'ru', 'en'].includes(declaredCode))
    return { code: declaredCode, method: 'declared', confidence: 'moderate' }
  if (/[\p{Script=Cyrillic}]/u.test(text))
    return { code: 'ru', method: 'heuristic', confidence: 'low' }
  if (/[əƏ]|\b(universiteti|məktəb|təhsil|tələbə)\b/iu.test(text))
    return { code: 'az', method: 'heuristic', confidence: 'low' }
  if (/\b(öğrenci|üniversitesi|değil|ders)\b/iu.test(text))
    return { code: 'tr', method: 'heuristic', confidence: 'low' }
  if (/\b(the|university|students|school)\b/iu.test(text))
    return { code: 'en', method: 'heuristic', confidence: 'low' }
  return { code: 'unknown', method: 'heuristic', confidence: 'low' }
}
export function normalizePublicationDate(value) {
  if (typeof value !== 'string' || value.length > 100) return null
  // Offset-free publisher times are unknown rather than server-local guesses.
  if (!/(?:Z|[+-]\d{2}:?\d{2}|GMT|UTC)$/i.test(value.trim())) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}
export function permittedCanonical(value, original, origins) {
  try {
    const url = new URL(value, original)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !origins.includes(url.origin)
    )
      return null
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}
export function extractArticle(html, { url, origins }) {
  if (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > 524288)
    throw new Error('document_limit')
  const { nodes, texts } = inspect(parse(html))
  const metas = nodes.filter((n) => n.tagName === 'meta')
  const directives = metas
    .filter((n) =>
      ['robots', 'vizualbot'].includes(attr(n, 'name').toLowerCase())
    )
    .map((n) => attr(n, 'content').toLowerCase())
    .join(',')
  let structuredRestricted = false
  for (const node of nodes.filter(
    (n) => n.tagName === 'script' && attr(n, 'type') === 'application/ld+json'
  )) {
    const raw = (node.childNodes || []).map((c) => c.value || '').join('')
    if (raw.length > 65536) {
      structuredRestricted = true
      continue
    }
    try {
      const values = [JSON.parse(raw)]
      let seen = 0
      while (values.length) {
        const value = values.pop()
        if (++seen > 1000) {
          structuredRestricted = true
          break
        }
        if (value && typeof value === 'object') {
          if (
            value.isAccessibleForFree === false ||
            value.isAccessibleForFree === 'false'
          )
            structuredRestricted = true
          values.push(
            ...Object.values(value).filter((v) => v && typeof v === 'object')
          )
        }
      }
    } catch {
      /* Invalid metadata does not authorize extracting its body. */
    }
  }
  const restricted =
    structuredRestricted ||
    /nosnippet|noarchive|max-snippet\s*:\s*0/.test(directives) ||
    nodes.some((n) =>
      /\b(paywall|captcha|login-wall|subscribe-wall)\b/i.test(
        `${attr(n, 'class')} ${attr(n, 'id')}`
      )
    ) ||
    metas.some(
      (n) =>
        attr(n, 'itemprop') === 'isAccessibleForFree' &&
        attr(n, 'content') === 'false'
    )
  const candidates = nodes.filter(
    (n) =>
      n.tagName === 'article' ||
      n.tagName === 'main' ||
      attr(n, 'itemprop') === 'articleBody' ||
      /\b(article-body|article-content|story-body|entry-content)\b/.test(
        attr(n, 'class')
      )
  )
  const main = candidates.sort(
    (a, b) => count(texts.get(b) || '') - count(texts.get(a) || '')
  )[0]
  const text = main ? texts.get(main) || '' : ''
  const headline =
    nodes.find((n) => n.tagName === 'h1' && texts.get(n)) ||
    nodes.find((n) => n.tagName === 'title')
  const canonicalNode = nodes.find(
    (n) =>
      n.tagName === 'link' && attr(n, 'rel').split(/\s+/).includes('canonical')
  )
  const timeNode = nodes.find(
    (n) => n.tagName === 'time' && attr(n, 'datetime')
  )
  const publication = metas.find((n) =>
    ['article:published_time', 'datePublished'].includes(
      attr(n, 'property') || attr(n, 'itemprop')
    )
  )
  const languageNode = nodes.find((n) => n.tagName === 'html')
  return {
    text: restricted ? '' : text,
    headline: headline ? texts.get(headline).slice(0, 2000) : null,
    canonical_url: canonicalNode
      ? permittedCanonical(attr(canonicalNode, 'href'), url, origins)
      : null,
    published_at: normalizePublicationDate(
      publication
        ? attr(publication, 'content')
        : timeNode
          ? attr(timeNode, 'datetime')
          : null
    ),
    language: detectLanguage(
      text,
      languageNode ? attr(languageNode, 'lang') : ''
    ),
    main_content_detected: Boolean(main),
    restricted,
    directives,
  }
}
export function extractFeedField(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 524288)
    throw new Error('document_limit')
  const result = inspect(parseFragment(value))
  return clean(result.texts.get(result.nodes[0]) || '')
}
export function contentPayload(
  {
    text = '',
    headline = null,
    canonical_url = null,
    published_at = null,
    language = null,
    main_content_detected = false,
    restricted = false,
  },
  {
    sourceId,
    url,
    method,
    rights,
    robots,
    now = new Date(),
    summary = false,
    failure = null,
    access = null,
  }
) {
  const normalized = clean(text)
  const extracted = count(normalized)
  if (extracted > 250000) throw new Error('document_limit')
  const label =
    failure ||
    (restricted
      ? 'source_inaccessible'
      : extracted >= 800 && main_content_detected && !summary
        ? 'full_text'
        : extracted >= 250 && main_content_detected && !summary
          ? 'substantial_excerpt'
          : extracted > 0
            ? 'title_summary'
            : 'title_only')
  const usable =
    ['full_text', 'substantial_excerpt'].includes(label) &&
    rights.verified &&
    ['allowed', 'not_applicable'].includes(robots.state)
  const excerpt = usable ? Array.from(normalized).slice(0, 4000).join('') : null
  return {
    version: 1,
    source_id: sourceId,
    item_url: url,
    canonical_url,
    headline,
    excerpt,
    content_hash: normalized
      ? createHash('sha256').update(normalized).digest('hex')
      : null,
    language: language || detectLanguage(normalized),
    published_at,
    collected_at: now.toISOString(),
    quality: {
      label,
      extracted_chars: extracted,
      retained_chars: excerpt ? count(excerpt) : 0,
      main_content_detected,
      reasons: [
        ...(usable
          ? ['heuristic_completeness_not_publisher_guarantee']
          : ['insufficient_or_restricted_evidence']),
        ...(extracted > 4000
          ? ['excerpt_retained_full_text_not_archived']
          : []),
      ],
    },
    provenance: {
      method,
      rights,
      robots,
      access: access || { authentication_required: false, paywall: restricted },
      original_url: url,
    },
  }
}
