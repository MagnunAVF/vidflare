import { defineConfig } from 'drizzle-kit'

// drizzle-kit only generates SQL here; wrangler applies it (`wrangler d1 migrations apply`),
// so `out` must match `migrations_dir` in wrangler.jsonc.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/worker/db/schema.ts',
  out: './migrations',
})
