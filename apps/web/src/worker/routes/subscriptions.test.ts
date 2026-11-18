import { env } from 'cloudflare:workers'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { getDb } from '../db/client'
import { channels, subscriptions, videos } from '../db/schema'
import { uuidv7 } from '../lib/id'
import { callApi, signUp } from '../test/helpers'

const db = getDb(env.DB)

const subscribe = (channelId: string, cookie?: string) =>
  callApi(`/api/channels/${channelId}/subscribe`, {
    method: 'PUT',
    headers: cookie ? { cookie } : {},
  })
const unsubscribe = (channelId: string, cookie?: string) =>
  callApi(`/api/channels/${channelId}/subscribe`, {
    method: 'DELETE',
    headers: cookie ? { cookie } : {},
  })

const subscriberCount = async (channelId: string) =>
  (
    await db
      .select({ n: channels.subscriberCount })
      .from(channels)
      .where(eq(channels.id, channelId))
      .get()
  )?.n

const handleOf = async (channelId: string) =>
  (await db.select({ h: channels.handle }).from(channels).where(eq(channels.id, channelId)).get())!
    .h

describe('PUT /api/channels/:id/subscribe', () => {
  it('requires a session', async () => {
    const creator = await signUp()
    expect((await subscribe(creator.channelId)).status).toBe(401)
  })

  it('subscribes once: repeat requests keep one row and the same count', async () => {
    const creator = await signUp()
    const fan = await signUp()

    const res = await subscribe(creator.channelId, fan.cookie)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ subscribed: true, subscriberCount: 1 })
    expect(await (await subscribe(creator.channelId, fan.cookie)).json()).toEqual({
      subscribed: true,
      subscriberCount: 1,
    })

    const rows = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.subscriberId, fan.userId),
          eq(subscriptions.channelId, creator.channelId),
        ),
      )
      .all()
    expect(rows).toHaveLength(1)
    expect(await subscriberCount(creator.channelId)).toBe(1)
  })

  it('recomputes the count from the rows, repairing a drifted counter', async () => {
    const creator = await signUp()
    const a = await signUp()
    const b = await signUp()
    await subscribe(creator.channelId, a.cookie)
    await db.update(channels).set({ subscriberCount: 99 }).where(eq(channels.id, creator.channelId))

    expect(await (await subscribe(creator.channelId, b.cookie)).json()).toEqual({
      subscribed: true,
      subscriberCount: 2,
    })
  })

  it('refuses a self-subscribe without writing', async () => {
    const creator = await signUp()
    const res = await subscribe(creator.channelId, creator.cookie)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'cannot_subscribe_to_own_channel' })
    expect(
      await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.channelId, creator.channelId))
        .all(),
    ).toEqual([])
    expect(await subscriberCount(creator.channelId)).toBe(0)
  })

  it('answers 404 for a missing channel and 400 for an invalid id', async () => {
    const fan = await signUp()
    expect((await subscribe(uuidv7(), fan.cookie)).status).toBe(404)
    expect((await subscribe('alice', fan.cookie)).status).toBe(400)
  })
})

describe('DELETE /api/channels/:id/subscribe', () => {
  it('unsubscribes; repeats and never-subscribed users change nothing', async () => {
    const creator = await signUp()
    const a = await signUp()
    const b = await signUp()
    await subscribe(creator.channelId, a.cookie)
    await subscribe(creator.channelId, b.cookie)

    const res = await unsubscribe(creator.channelId, a.cookie)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ subscribed: false, subscriberCount: 1 })
    expect(await (await unsubscribe(creator.channelId, a.cookie)).json()).toEqual({
      subscribed: false,
      subscriberCount: 1,
    })
    const stranger = await signUp()
    expect(await (await unsubscribe(creator.channelId, stranger.cookie)).json()).toEqual({
      subscribed: false,
      subscriberCount: 1,
    })
  })

  it('answers 400 on one’s own channel and 404 for a missing one', async () => {
    const creator = await signUp()
    expect((await unsubscribe(creator.channelId, creator.cookie)).status).toBe(400)
    expect((await unsubscribe(uuidv7(), creator.cookie)).status).toBe(404)
  })
})

describe('subscribedByMe', () => {
  it('is reported on the channel and on its videos for the signed-in viewer only', async () => {
    const creator = await signUp()
    const fan = await signUp()
    const handle = await handleOf(creator.channelId)
    const videoId = uuidv7()
    await db.insert(videos).values({
      id: videoId,
      channelId: creator.channelId,
      streamUid: `subuid${Date.now().toString(36)}`,
      title: 'Clip',
      status: 'ready',
      createdAt: Date.now(),
      publishedAt: Date.now(),
    })

    const channelFor = async (cookie?: string) =>
      (await callApi(`/api/channels/${handle}`, { headers: cookie ? { cookie } : {} })).json<{
        subscribedByMe: boolean
        subscriberCount: number
      }>()
    const videoChannelFor = async (cookie?: string) =>
      (
        await (
          await callApi(`/api/videos/${videoId}`, { headers: cookie ? { cookie } : {} })
        ).json<{ channel: { subscribedByMe: boolean; subscriberCount: number } }>()
      ).channel

    expect(await channelFor(fan.cookie)).toMatchObject({ subscribedByMe: false })
    await subscribe(creator.channelId, fan.cookie)
    expect(await channelFor(fan.cookie)).toMatchObject({ subscribedByMe: true, subscriberCount: 1 })
    expect(await videoChannelFor(fan.cookie)).toMatchObject({ subscribedByMe: true })
    expect(await channelFor()).toMatchObject({ subscribedByMe: false })
    expect(await videoChannelFor()).toMatchObject({ subscribedByMe: false })
    expect(await channelFor(creator.cookie)).toMatchObject({ subscribedByMe: false })
  })
})
