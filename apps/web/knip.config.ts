import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  entry: [
    'chrome-extension/visual-monitor-selector/{background,content-script,popup}.js',
  ],
  ignore: ['src/tanstack-table.d.ts'],
}

export default config
