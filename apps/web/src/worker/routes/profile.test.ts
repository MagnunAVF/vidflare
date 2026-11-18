import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { getDb } from '../db/client'
import { channels } from '../db/schema'
import { callApi, signUp } from '../test/helpers'

const db = getDb(env.DB)

const patchMe = (cookie: string | undefined, body: unknown) =>
  callApi('/api/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })

const channelRow = (id: string) => db.select().from(channels).where(eq(channels.id, id)).get()

let seq = 0
const freshHandle = () => `new_${Date.now().toString(36)}${(seq++).toString(36)}`

describe('PATCH /api/me', () => {
  it('requires a session', async () => {
    expect((await patchMe(undefined, { name: 'X' })).status).toBe(401)
  })

  it('renames the channel', async () => {
    const { cookie, channelId } = await signUp()

    const res = await patchMe(cookie, { name: '  My New Name ' })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ channel: { id: channelId, name: 'My New Name' } })
    expect((await channelRow(channelId))?.name).toBe('My New Name')
    // The session picks up the change on the next request.
    const me = await (await callApi('/api/me', { headers: { cookie } })).json()
    expect(me).toMatchObject({ channel: { name: 'My New Name' } })
  })

  it('changes the handle (normalized), which moves the channel page', async () => {
    const { cookie, channelId } = await signUp()
    const old = (await channelRow(channelId))!.handle
    const handle = freshHandle()

    const res = await patchMe(cookie, { handle: handle.toUpperCase() })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ channel: { handle } })
    expect((await callApi(`/api/channels/${handle}`)).status).toBe(200)
    expect((await callApi(`/api/channels/${old}`)).status).toBe(404)
  })

  it('accepts keeping the same handle', async () => {
    const { cookie, channelId } = await signUp()
    const { handle } = (await channelRow(channelId))!
    const res = await patchMe(cookie, { handle, name: 'Same handle' })
    expect(res.status).toBe(200)
  })

  it("refuses someone else's handle with 409 and changes nothing", async () => {
    const a = await signUp()
    const b = await signUp()
    const before = (await channelRow(a.channelId))!
    const taken = (await channelRow(b.channelId))!.handle

    const res = await patchMe(a.cookie, { handle: taken, name: 'Should not apply' })

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'handle_taken' })
    expect(await channelRow(a.channelId)).toEqual(before)
  })

  it.each([
    [{}],
    [{ name: '   ' }],
    [{ handle: 'ab' }],
    [{ handle: 'bad-handle' }],
    [{ name: 'x'.repeat(51) }],
  ])('rejects invalid input %j', async (body) => {
    const { cookie } = await signUp()
    expect((await patchMe(cookie, body)).status).toBe(400)
  })

  it('ignores fields it does not own', async () => {
    const { cookie, channelId } = await signUp()
    const before = (await channelRow(channelId))!
    await patchMe(cookie, { name: 'Ok', subscriberCount: 1_000_000, avatarKey: 'avatars/x' })
    const after = (await channelRow(channelId))!
    expect(after.subscriberCount).toBe(before.subscriberCount)
    expect(after.avatarKey).toBe(before.avatarKey)
  })
})
