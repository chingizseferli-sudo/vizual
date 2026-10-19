import { createClient } from '@supabase/supabase-js'
import { readConfig } from './provider.mjs'
import { runBatch } from './runner.mjs'

// Explicit server-only opt-in; no dotenv import or automatic migration/startup.
const config = readConfig(process.env)
if (!config.enabled) throw new Error('feature_disabled')
const url = process.env.AI_SUPABASE_URL,
  key = process.env.AI_SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('backend_configuration_required')
const parsed = new URL(url)
if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
  throw new Error('invalid_backend_url')
const client = createClient(url, key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
})
const call = async (name, args) => {
  const { data, error } = await client.rpc(name, args)
  if (error) throw new Error('backend_operation_failed')
  return data
}
const repository = {
  prune: async (limit) => call('prune_ai_insight_jobs', { p_limit: limit }),
  claim: async (limit) => call('claim_ai_insight_jobs', { p_limit: limit }),
  complete: async (job, result, meta) =>
    call('complete_ai_insight_job', {
      p_id: job.id,
      p_token: job.token,
      p_result: result,
      p_provider: meta.provider,
      p_model: meta.model,
      p_prompt_version: meta.promptVersion,
      p_cost_usd: meta.costUsd,
    }),
  fail: async (job, code) =>
    call('fail_ai_insight_job', {
      p_id: job.id,
      p_token: job.token,
      p_error_code: code,
    }),
}
const controller = new AbortController()
process.once('SIGINT', () => controller.abort())
process.once('SIGTERM', () => controller.abort())
try {
  const stats = await runBatch(repository, config, {
    signal: controller.signal,
  })
  console.log(JSON.stringify(stats))
} catch {
  console.error('ai_batch_failed')
  process.exitCode = 1
}
