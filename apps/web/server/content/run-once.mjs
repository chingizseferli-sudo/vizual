import { createClient } from '@supabase/supabase-js'
import { runContentBatch } from './runner.mjs'

// Server-only explicit batch; never loads dotenv or activates either SQL gate.
if (process.env.CONTENT_COLLECTION_ENABLED !== 'true')
  throw new Error('collection_disabled')
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
  prune: (limit) => call('prune_content_intake', { p_limit: limit }),
  claim: (limit) => call('claim_content_intake', { p_limit: limit }),
  complete: (job, payload) =>
    call('complete_content_intake', {
      p_id: job.id,
      p_token: job.token,
      p_payload: payload,
    }),
  fail: (job, code) =>
    call('fail_content_intake', {
      p_id: job.id,
      p_token: job.token,
      p_error_code: code,
    }),
}
const controller = new AbortController()
process.once('SIGINT', () => controller.abort())
process.once('SIGTERM', () => controller.abort())
try {
  console.log(
    JSON.stringify(
      await runContentBatch(repository, {
        enabled: true,
        signal: controller.signal,
      })
    )
  )
} catch {
  console.error('content_batch_failed')
  process.exitCode = 1
}
