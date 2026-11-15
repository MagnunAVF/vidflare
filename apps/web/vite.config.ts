import { fileURLToPath, URL } from 'node:url'

import { cloudflare } from '@cloudflare/vite-plugin'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The client reports the same environment as the Worker (CLOUDFLARE_ENV picks the env).
process.env.VITE_ENVIRONMENT ??= process.env.CLOUDFLARE_ENV || 'local'

// Source maps are only built when they can be uploaded to Sentry (CI deploys). They are
// `hidden` (no sourceMappingURL), and the client's are deleted after upload because
// dist/client is served as public assets.
const uploadSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN)

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // Must run before react(): generates routeTree.gen.ts and splits each route.
    tanstackRouter({
      target: 'react',
      routesDirectory: './src/client/routes',
      generatedRouteTree: './src/client/routeTree.gen.ts',
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
    // cloudflare() runs the Worker (src/worker) inside the Vite dev server,
    // in the real Workers runtime with local bindings.
    cloudflare(),
    // Last, so it sees the final bundles of both the client and the Worker.
    sentryVitePlugin({
      disable: !uploadSourceMaps,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      // The git sha: the same release the client (VITE_RELEASE) and Worker (deploy tag) report.
      release: { name: process.env.VITE_RELEASE },
      sourcemaps: { filesToDeleteAfterUpload: ['./dist/client/**/*.map'] },
      telemetry: false,
    }),
  ],
  build: {
    sourcemap: uploadSourceMaps ? 'hidden' : false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/client', import.meta.url)),
    },
  },
})
