import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Fixed isolated harnesses only; deliberately exclude connection/provider secrets.
for (const name of [
  'test-analytics-db.mjs',
  'test-ai-db.mjs',
  'test-content-db.mjs',
]) {
  const path = fileURLToPath(new URL(name, import.meta.url))
  const result = spawnSync(process.execPath, [path], {
    stdio: 'inherit',
    env: { PATH: process.env.PATH || '', NODE_ENV: 'test' },
  })
  if (result.status !== 0) {
    console.error('isolated_staging_fixture_failed')
    process.exit(1)
  }
}
console.log(
  'PASS isolated staging fixtures; deployed schema/native concurrency remain NOT VERIFIED'
)
