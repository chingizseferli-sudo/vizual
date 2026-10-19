import { collectContent } from './collector.mjs'
import { ContentError } from './http.mjs'

export async function runContentBatch(
  repository,
  {
    enabled = false,
    signal,
    collector = collectContent,
    inlineAdapter = async () => ({}),
    maxJobMs = 240000,
  } = {}
) {
  if (!enabled) throw new ContentError('collection_disabled')
  if (signal?.aborted) throw new ContentError('cancelled')
  if (!Number.isInteger(maxJobMs) || maxJobMs < 1 || maxJobMs > 240000)
    throw new ContentError('invalid_job_deadline')
  const jobs = await repository.claim(1)
  const stats = { claimed: jobs.length, completed: 0, failed: 0, stale: 0 }
  for (const job of jobs) {
    const deadline = AbortSignal.timeout(maxJobMs)
    const localSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
    const bound = async (promise) => {
      let onAbort
      return Promise.race([
        promise,
        new Promise((_, reject) => {
          onAbort = () =>
            reject(
              new ContentError(
                signal?.aborted ? 'cancelled' : 'request_budget_exhausted'
              )
            )
          localSignal.addEventListener('abort', onAbort, { once: true })
          if (localSignal.aborted) onAbort()
        }),
      ]).finally(() => localSignal.removeEventListener('abort', onAbort))
    }
    try {
      if (signal?.aborted) throw new ContentError('cancelled')
      const inline = await bound(inlineAdapter(job, { signal: localSignal }))
      const record = {
        source_id: job.source_id,
        url: job.item_url,
        title: job.item_title || '',
        ...(inline.feed ? { feed: inline.feed } : {}),
        ...(inline.api ? { api: inline.api } : {}),
      }
      const policy = {
        enabled: true,
        sourceId: job.source_id,
        origins: [job.permission.allowed_origin],
        rights: {
          basis: job.permission.basis,
          reference: job.permission.reference,
          verified: true,
        },
      }
      const payload = await bound(
        collector(record, policy, { signal: localSignal })
      )
      if (signal?.aborted) throw new ContentError('cancelled')
      if (localSignal.aborted)
        throw new ContentError(
          signal?.aborted ? 'cancelled' : 'request_budget_exhausted'
        )
      const done = await repository.complete(job, payload)
      if (done) stats.completed++
      else stats.stale++
    } catch (error) {
      const code =
        error instanceof ContentError ? error.code : 'extraction_failed'
      const safe =
        code === 'cancelled'
          ? 'cancelled'
          : code === 'rate_limited'
            ? 'rate_limited'
            : code === 'request_budget_exhausted'
              ? 'budget_exhausted'
              : error instanceof ContentError && error.retryable
                ? 'network_failed'
                : 'extraction_failed'
      const done = await repository.fail(job, safe)
      if (done) stats.failed++
      else stats.stale++
    }
  }
  if (repository.prune && !signal?.aborted)
    stats.pruned = await repository.prune(100)
  return stats
}
