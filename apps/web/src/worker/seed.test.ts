import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'

import seedSql from '../../seed/seed.sql?raw'

// Same statements `wrangler d1 execute --file` runs, one prepared statement each.
async function runSeed() {
  const statements = seedSql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  await env.DB.batch(statements.map((s) => env.DB.prepare(s)))
}

const count = async (sql: string) =>
  (await env.DB.prepare(sql).first<{ n: number }>())?.n ?? Number.NaN

describe('seed.sql', () => {
  beforeAll(async () => {
    // Twice: the seed must reset cleanly, not fail or duplicate rows on a re-run.
    await runSeed()
    await runSeed()
  })

  it('loads users, channels and videos', async () => {
    expect(await count('select count(*) as n from users')).toBe(3)
    expect(await count('select count(*) as n from channels')).toBe(3)
    expect(await count('select count(*) as n from videos')).toBe(11)
  })

  it('has public + ready videos for feeds, plus other states', async () => {
    expect(
      await count(
        "select count(*) as n from videos where visibility = 'public' and status = 'ready'",
      ),
    ).toBe(7)
    expect(await count("select count(*) as n from videos where status != 'ready'")).toBe(3)
  })

  it('keeps denormalized counters consistent with the rows', async () => {
    const mismatches = await count(`
      select count(*) as n from videos v
      where v.like_count != (select count(*) from likes l where l.video_id = v.id)
         or v.comment_count != (
              select count(*) from comments c where c.video_id = v.id and c.deleted_at is null)
    `)
    expect(mismatches).toBe(0)
    expect(
      await count(`
        select count(*) as n from channels ch
        where ch.subscriber_count != (select count(*) from subscriptions s where s.channel_id = ch.id)
      `),
    ).toBe(0)
  })
})
