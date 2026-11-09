import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // cloudflare() runs the Worker (src/worker) inside the Vite dev server,
  // in the real Workers runtime with local bindings.
  plugins: [react(), cloudflare()],
})
