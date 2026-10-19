import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  entry: [
    'src/main.tsx',
    'chrome-extension/visual-monitor-selector/{background,content-script,popup}.js',
    'supabase/functions/*/index.ts',
  ],
  ignore: ['src/tanstack-table.d.ts'],
}

export default config
