import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Execute the shared disposable fixture plus intake checks. No shell, network,
// real environment loading or duplicate reconstructed production baseline.
const run = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('./test-ai-db.mjs', import.meta.url)),
    '--with-content',
  ],
  { stdio: 'inherit' }
)
if (run.error) throw run.error
process.exitCode = run.status ?? 1
