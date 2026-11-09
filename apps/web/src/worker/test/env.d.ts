// Test-only bindings and module types (see vitest.config.ts).
declare namespace Cloudflare {
  interface Env {
    // Shape of D1Migration from cloudflare:test; inlined so this file stays a global declaration.
    TEST_MIGRATIONS: { name: string; queries: string[] }[]
  }
}

declare module '*.sql?raw' {
  const sql: string
  export default sql
}
