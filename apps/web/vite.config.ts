import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { playwright } from '@vitest/browser-playwright'
import { configDefaults } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Portal browser tests navigate lazy routes. Prebundle their dependencies
  // before Chromium starts so discovery does not reload an active test.
  optimizeDeps: {
    include: [
      '@hookform/resolvers',
      '@radix-ui/react-alert-dialog',
      '@radix-ui/react-avatar',
      '@radix-ui/react-checkbox',
      '@radix-ui/react-collapsible',
      '@radix-ui/react-dialog',
      '@radix-ui/react-direction',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-icons',
      '@radix-ui/react-label',
      '@radix-ui/react-radio-group',
      '@radix-ui/react-scroll-area',
      '@radix-ui/react-select',
      '@radix-ui/react-separator',
      '@radix-ui/react-slot',
      '@radix-ui/react-tabs',
      '@radix-ui/react-tooltip',
      '@supabase/supabase-js',
      '@tanstack/react-query',
      '@tanstack/react-router',
      '@tanstack/react-table',
      '@tiptap/react',
      '@tiptap/starter-kit',
      'class-variance-authority',
      'clsx',
      'cmdk',
      'input-otp',
      'lucide-react',
      'react',
      'react-dom',
      'react-dom/client',
      'react-hook-form',
      'react-top-loading-bar',
      'sonner',
      'tailwind-merge',
      'zod',
    ],
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-core',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 30,
            },
            {
              name: 'tanstack',
              test: /node_modules[\\/]@tanstack[\\/]/,
              priority: 20,
            },
            {
              name: 'editor',
              test: /node_modules[\\/](@tiptap|prosemirror-)[\\/]/,
              priority: 20,
            },
          ],
        },
      },
    },
  },
  test: {
    exclude: [...configDefaults.exclude],
    silent: 'passed-only',
    unstubEnvs: true,
    browser: {
      enabled: true,
      headless: true,
      ui: false,
      provider: playwright({
        contextOptions: { viewport: { width: 1600, height: 1200 } },
      }),
      instances: [{ browser: 'chromium' }],
      expect: {
        toMatchScreenshot: {
          resolveScreenshotPath: ({ arg, browserName, platform, ext }) =>
            path.resolve(
              __dirname,
              'tests/visual-baselines',
              `${arg}-${browserName}-${platform}${ext}`
            ),
        },
      },
    },
    coverage: {
      // include: ['src/**/*.{js,jsx,ts,tsx}'], // Uncomment to expand the report to all src/**/* so untested modules appear as 0% coverage.
      exclude: [
        'src/components/ui/**',
        'src/assets/**',
        'src/tanstack-table.d.ts',
        'src/routeTree.gen.ts',
        'src/test-utils/**',
        'src/routes/**',
      ],
    },
  },
})
