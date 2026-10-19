import { lookup } from 'node:dns/promises'
import https from 'node:https'
import { isIP } from 'node:net'

export class ContentError extends Error {
  constructor(code, retryable = false) {
    super(code)
    this.code = code
    this.retryable = retryable
  }
}
export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    )
  }
  if (isIP(address) === 6) {
    const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1)
    const first = Number.parseInt(canonical.split(':')[0], 16),
      second = Number.parseInt(canonical.split(':')[1] || '0', 16)
    return (
      first >= 0x2000 &&
      first <= 0x3fff &&
      first !== 0x2002 &&
      first !== 0x3fff &&
      !(first === 0x2001 && (second < 0x200 || second === 0xdb8))
    )
  }
  return false
}
export function authorizedUrl(value, origins) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new ContentError('invalid_url')
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    isIP(url.hostname) ||
    url.hostname === 'localhost' ||
    /\.(local|internal|localhost)$/i.test(url.hostname) ||
    !origins.includes(url.origin)
  )
    throw new ContentError('unauthorized_url')
  url.hash = ''
  return url
}
// DNS lookup pinned to the checked address; TLS still validates the original hostname.
export async function safeRequest(
  value,
  {
    origins,
    signal,
    maxBytes = 524288,
    timeoutMs = 5000,
    resolve = lookup,
    request = https.request,
  } = {}
) {
  const url = authorizedUrl(value, origins)
  if (signal?.aborted) throw new ContentError('cancelled')
  const deadlineAt = Date.now() + timeoutMs
  let lookupTimer, abortLookup
  const addresses = await Promise.race([
    resolve(url.hostname, { all: true, verbatim: true }),
    new Promise((_, reject) => {
      lookupTimer = setTimeout(
        () => reject(new ContentError('timeout', true)),
        timeoutMs
      )
      abortLookup = () => reject(new ContentError('cancelled'))
      signal?.addEventListener('abort', abortLookup, { once: true })
      if (signal?.aborted) abortLookup()
    }),
  ]).finally(() => {
    clearTimeout(lookupTimer)
    if (abortLookup) signal?.removeEventListener('abort', abortLookup)
  })
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new ContentError('unsafe_address')
  const selected = addresses[0]
  return new Promise((resolveResponse, reject) => {
    let size = 0
    const chunks = []
    let settled = false
    let req
    const deadline = setTimeout(
      () => {
        const error = new ContentError('timeout', true)
        req?.destroy(error)
        finish(error)
      },
      Math.max(1, deadlineAt - Date.now())
    )
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      if (error)
        reject(
          error instanceof ContentError
            ? error
            : new ContentError(
                signal?.aborted ? 'cancelled' : 'network_failed',
                !signal?.aborted
              )
        )
      else resolveResponse(result)
    }
    try {
      req = request(
        url,
        {
          method: 'GET',
          signal,
          servername: url.hostname,
          headers: {
            'User-Agent': 'VizualBot/1.0',
            Accept: 'text/html,application/xhtml+xml,text/plain',
            'Accept-Encoding': 'identity',
          },
          lookup: (_host, options, callback) => {
            if (options.all) callback(null, [selected])
            else callback(null, selected.address, selected.family)
          },
        },
        (response) => {
          if (
            response.headers['content-encoding'] &&
            response.headers['content-encoding'] !== 'identity'
          ) {
            response.destroy()
            finish(new ContentError('unsupported_encoding'))
            return
          }
          response.on('data', (chunk) => {
            size += chunk.length
            if (size > maxBytes) {
              response.destroy()
              finish(new ContentError('response_limit'))
              return
            }
            chunks.push(chunk)
          })
          response.on('end', () => {
            try {
              finish(null, {
                status: response.statusCode,
                headers: response.headers,
                body: new TextDecoder('utf-8', { fatal: true }).decode(
                  Buffer.concat(chunks)
                ),
              })
            } catch {
              finish(new ContentError('unsupported_encoding'))
            }
          })
          response.on('error', (error) => finish(error))
        }
      )
      req.on('error', (error) => finish(error))
      req.end()
    } catch (error) {
      finish(error)
    }
  })
}
export function robotsDecision(text, path, agent = 'vizualbot') {
  if (Buffer.byteLength(text, 'utf8') > 524288 || /%(?![a-f\d]{2})/i.test(path))
    return { allowed: false, delayMs: 0 }
  const groups = []
  let group = { agents: [], rules: [], delay: 0 },
    seenDirective = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim().toLowerCase(),
      value = line.slice(colon + 1).trim()
    if (key === 'user-agent') {
      if (seenDirective) {
        groups.push(group)
        group = { agents: [], rules: [], delay: 0 }
        seenDirective = false
      }
      group.agents.push(value.toLowerCase())
    } else if (group.agents.length) {
      seenDirective = true
      if (['allow', 'disallow'].includes(key) && value)
        group.rules.push({ allow: key === 'allow', value })
      if (key === 'crawl-delay') {
        const delay = Number(value)
        if (!Number.isFinite(delay) || delay < 0 || delay > 60)
          return { allowed: false, delayMs: 0 }
        group.delay = Math.max(group.delay, delay * 1000)
      }
    }
  }
  groups.push(group)
  const score = (g) =>
    Math.max(
      -1,
      ...g.agents.map((a) =>
        a === '*' ? 0 : agent.toLowerCase().includes(a) ? a.length : -1
      )
    )
  const specificity = Math.max(-1, ...groups.map(score))
  if (specificity < 0) return { allowed: true, delayMs: 0 }
  const chosen = groups.filter((g) => score(g) === specificity),
    matches = []
  const octets = (s) =>
    Array.from(s)
      .map((c) => (c.codePointAt(0) > 127 ? encodeURIComponent(c) : c))
      .join('')
      .replace(/%([a-f\d]{2})/gi, (all, hex) =>
        /[a-z\d_.~-]/i.test(String.fromCharCode(parseInt(hex, 16)))
          ? String.fromCharCode(parseInt(hex, 16))
          : all.toUpperCase()
      )
  for (const g of chosen)
    for (const rule of g.rules) {
      const pattern = octets(rule.value)
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*')
        .replace(/\\\$$/, '$')
      if (new RegExp(`^${pattern}`).test(octets(path)))
        matches.push({
          ...rule,
          length: Buffer.byteLength(
            octets(rule.value)
              .replace(/\*|\$$/g, '')
              .replace(/%[a-f\d]{2}/gi, 'x')
          ),
        })
    }
  matches.sort(
    (a, b) => b.length - a.length || Number(b.allow) - Number(a.allow)
  )
  return {
    allowed: matches[0]?.allow ?? true,
    delayMs: Math.max(0, ...chosen.map((g) => g.delay)),
  }
}
