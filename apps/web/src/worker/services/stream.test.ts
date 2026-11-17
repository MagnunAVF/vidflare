import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDirectUpload, deleteVideo, getVideo, StreamApiError } from './stream'

const cfg = { accountId: 'acc123', apiToken: 'secret-token' }
const base = 'https://api.cloudflare.com/client/v4/accounts/acc123/stream'

function mockStream(respond: (req: Request) => Response) {
  const requests: Request[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const req = new Request(input, init)
    requests.push(req)
    return respond(req)
  })
  return requests
}

const decodeMetadata = (header: string) =>
  Object.fromEntries(
    header.split(',').map((pair) => {
      const [key, value = ''] = pair.split(' ')
      return [key, atob(value)]
    }),
  )

afterEach(() => vi.restoreAllMocks())

describe('createDirectUpload', () => {
  it('creates a tus upload tagged with env and videoId', async () => {
    const requests = mockStream(
      () =>
        new Response(null, {
          status: 201,
          headers: { Location: 'https://upload.example/tus/abc', 'stream-media-id': 'uid-1' },
        }),
    )

    const upload = await createDirectUpload(cfg, {
      sizeBytes: 1234,
      maxDurationSeconds: 900,
      meta: { env: 'stage', videoId: 'video-1' },
    })

    expect(upload).toEqual({ uid: 'uid-1', uploadUrl: 'https://upload.example/tus/abc' })
    const req = requests[0]!
    expect(req.method).toBe('POST')
    expect(req.url).toBe(`${base}?direct_user=true`)
    expect(req.headers.get('Authorization')).toBe('Bearer secret-token')
    expect(req.headers.get('Tus-Resumable')).toBe('1.0.0')
    expect(req.headers.get('Upload-Length')).toBe('1234')
    expect(decodeMetadata(req.headers.get('Upload-Metadata')!)).toEqual({
      maxDurationSeconds: '900',
      env: 'stage',
      videoId: 'video-1',
    })
  })

  it('throws with Stream error codes but without the token', async () => {
    mockStream(() => Response.json({ errors: [{ code: 10005, message: 'bad' }] }, { status: 400 }))

    const err = await createDirectUpload(cfg, {
      sizeBytes: 1,
      maxDurationSeconds: 1,
      meta: { env: 'local', videoId: 'v' },
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(StreamApiError)
    expect((err as StreamApiError).status).toBe(400)
    expect((err as Error).message).toContain('10005')
    expect((err as Error).message).not.toContain('secret-token')
  })

  it('throws when Stream omits the upload URL or uid', async () => {
    mockStream(() => new Response(null, { status: 201 }))
    await expect(
      createDirectUpload(cfg, {
        sizeBytes: 1,
        maxDurationSeconds: 1,
        meta: { env: 'local', videoId: 'v' },
      }),
    ).rejects.toBeInstanceOf(StreamApiError)
  })
})

describe('getVideo', () => {
  it('maps the fields the app uses', async () => {
    const requests = mockStream(() =>
      Response.json({
        result: {
          uid: 'uid-1',
          status: { state: 'ready', errorReasonCode: '' },
          readyToStream: true,
          duration: 312.4,
          thumbnail: 'https://thumb.example/uid-1.jpg',
          meta: { env: 'stage', videoId: 'video-1' },
        },
      }),
    )

    expect(await getVideo(cfg, 'uid-1')).toEqual({
      uid: 'uid-1',
      state: 'ready',
      errorReasonCode: null,
      readyToStream: true,
      durationS: 312,
      thumbnailUrl: 'https://thumb.example/uid-1.jpg',
      meta: { env: 'stage', videoId: 'video-1' },
    })
    expect(requests[0]!.url).toBe(`${base}/uid-1`)
  })

  it('reports an unknown duration as null', async () => {
    mockStream(() =>
      Response.json({ result: { uid: 'u', status: { state: 'inprogress' }, duration: -1 } }),
    )
    expect(await getVideo(cfg, 'u')).toMatchObject({ state: 'inprogress', durationS: null })
  })

  it('returns null for an unknown uid', async () => {
    mockStream(() => new Response(null, { status: 404 }))
    expect(await getVideo(cfg, 'gone')).toBeNull()
  })
})

describe('deleteVideo', () => {
  it('deletes by uid and treats an already-deleted video as done', async () => {
    const requests = mockStream(() => new Response(null, { status: 404 }))
    await expect(deleteVideo(cfg, 'uid-1')).resolves.toBeUndefined()
    expect(requests[0]!.method).toBe('DELETE')
    expect(requests[0]!.url).toBe(`${base}/uid-1`)
  })

  it('throws on other failures', async () => {
    mockStream(() => new Response(null, { status: 500 }))
    await expect(deleteVideo(cfg, 'uid-1')).rejects.toBeInstanceOf(StreamApiError)
  })
})
