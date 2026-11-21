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
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            // Fixed test values so tests never depend on a developer's .dev.vars.
            AUTH_SECRET: 'test-auth-secret',
            TURNSTILE_SECRET: 'test-turnstile-secret',
            STREAM_ACCOUNT_ID: 'test-account',
            STREAM_API_TOKEN: 'test-token',
            STREAM_WEBHOOK_SECRET: 'test-webhook-secret',
            SENTRY_DSN: '',
            MODERATION_TOKEN: 'test-moderation-token',
          },
        },
      }),
    ],
    test: {
      include: ['src/worker/**/*.test.ts'],
      setupFiles: ['./src/worker/test/apply-migrations.ts'],
    },
  }
})
