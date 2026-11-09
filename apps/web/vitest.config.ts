import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

// Worker tests run inside workerd with the bindings from wrangler.jsonc.
export default defineConfig(async () => {
  // Read in Node and handed to the runtime, where the setup file applies them to the test D1.
  const migrations = await readD1Migrations(new URL('./migrations', import.meta.url).pathname)

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      }),
    ],
    test: {
      include: ['src/worker/**/*.test.ts'],
      setupFiles: ['./src/worker/test/apply-migrations.ts'],
    },
  }
})
