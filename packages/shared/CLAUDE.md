# packages/shared

Zod schemas and DTO types shared by the Worker (`zValidator`) and the React client (React Hook Form). Imported as `@vidflare/shared`.

## Rules

- Platform-agnostic: depends only on `zod`. No Hono, React, Drizzle, Workers or DOM imports.
- Every API input (body, params, query) has a schema here. Derive types with `z.infer`; don't hand-write duplicate interfaces.
- Response DTOs describe what the API returns, not the DB rows. Never expose `password_hash`, session ids or internal-only columns.
- Shared enums live here as the single source: video `status` (`uploading | processing | ready | error`) and `visibility` (`public | unlisted`).
- Cursor pagination types (`{ cursor?: string }` in, `{ items, nextCursor }` out) are defined once and reused.
- Limits that both sides enforce (title/description/comment length, handle format) are defined here as constants, not duplicated.
- Changing a schema changes the API contract. Update the Worker route and the client form in the same change.
