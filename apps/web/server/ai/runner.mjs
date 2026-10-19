import { analyze, cacheKey, PROMPT_VERSION } from './pipeline.mjs'
import { AiError, createProvider } from './provider.mjs'

// Bounded per-process cache; never shared across tenants and never persistent.
export class ResultCache {
  constructor(ttlMs = 3600000, maxEntries = 20) {
    this.ttlMs = ttlMs
    this.maxEntries = maxEntries
    this.entries = new Map()
  }
  get(key, now = Date.now()) {
    const entry = this.entries.get(key)
    if (!entry || entry.expires <= now) {
      this.entries.delete(key)
      return null
    }
    return structuredClone(entry.value)
  }
  set(key, value, now = Date.now()) {
    if (this.maxEntries < 1 || this.ttlMs <= 0) return
    while (this.entries.size >= this.maxEntries)
      this.entries.delete(this.entries.keys().next().value)
    this.entries.set(key, {
      expires: now + this.ttlMs,
      value: structuredClone(value),
    })
  }
}
export async function runBatch(
  repository,
  config,
  {
    signal,
    cache = new ResultCache(config.cacheTtlMs),
    providerFactory = createProvider,
  } = {}
) {
  if (!config.enabled) throw new AiError('feature_disabled')
  if (signal?.aborted) throw new AiError('cancelled')
  // Validate provider authorization before claiming jobs, never silently downgrade.
  if (config.provider !== 'deterministic') providerFactory(config, { signal })
  const jobs = await repository.claim(1)
  const stats = {
    claimed: jobs.length,
    completed: 0,
    failed: 0,
    stale: 0,
    cached: 0,
  }
  for (const job of jobs) {
    try {
      if (signal?.aborted) throw new AiError('cancelled')
      const input = {
        entity: job.evidence.entity,
        items: job.evidence.items,
        start: job.period_start,
        end: job.period_end,
      }
      const perAttempt = Number(job.limits.per_attempt_cost_usd)
      if (
        !Number.isFinite(perAttempt) ||
        perAttempt < 0 ||
        job.limits.max_attempts !== 3
      )
        throw new AiError('invalid_job_limits')
      const localConfig = {
        ...config,
        maxInputChars: Math.min(
          config.maxInputChars,
          job.limits.max_input_chars
        ),
        maxCostUsd: Math.min(
          config.maxCostUsd,
          perAttempt || config.maxCostUsd
        ),
      }
      if (config.provider !== 'deterministic' && perAttempt <= 0)
        throw new AiError('budget_exceeded')
      const key = `${job.owner_id}:${cacheKey(input, localConfig)}`
      const existing = cache.get(key)
      const provider = providerFactory(localConfig, { signal })
      const output = existing
        ? { result: existing, usage: { cost_usd: 0 } }
        : await analyze(input, provider, {
            maxInputChars: localConfig.maxInputChars,
          })
      if (signal?.aborted) throw new AiError('cancelled')
      if (output.usage.cost_usd > perAttempt)
        throw new AiError('budget_exceeded')
      // Token fencing + current tenant authorization are enforced again by SQL.
      const done = await repository.complete(job, output.result, {
        provider: provider.name,
        model: provider.model,
        promptVersion: PROMPT_VERSION,
        costUsd: output.usage.cost_usd,
      })
      if (done) {
        stats.completed++
        if (existing) stats.cached++
        else cache.set(key, output.result)
      } else stats.stale++
    } catch (error) {
      const code = error instanceof AiError ? error.code : 'invalid_analysis'
      // No article, provider response, key or raw error may enter logs/job failures.
      const done = await repository.fail(
        job,
        code === 'cancelled'
          ? 'cancelled'
          : code === 'budget_exceeded'
            ? 'budget_exceeded'
            : ['rate_limited', 'provider_failed'].includes(code)
              ? 'provider_unavailable'
              : 'invalid_output'
      )
      if (done) stats.failed++
      else stats.stale++
    }
  }
  if (repository.prune && !signal?.aborted)
    stats.pruned = await repository.prune(100)
  return stats
}
