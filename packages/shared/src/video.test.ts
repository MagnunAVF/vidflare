import { describe, expect, it } from 'vitest'

import { UPLOAD_MAX_BYTES } from './limits'
import { createUploadInput, videoIdParam, videoStatus, videoVisibility } from './video'

describe('createUploadInput', () => {
  const valid = {
    title: '  My first video ',
    description: ' About it ',
    visibility: 'unlisted',
    sizeBytes: 1024,
    turnstileToken: 'token',
  }

  it('trims title and description', () => {
    expect(createUploadInput.parse(valid)).toMatchObject({
      title: 'My first video',
      description: 'About it',
    })
  })

  it.each([
    ['title', '   '],
    ['title', 'x'.repeat(101)],
    ['description', 'x'.repeat(5001)],
    ['visibility', 'private'],
    ['sizeBytes', 0],
    ['sizeBytes', 1.5],
    ['sizeBytes', UPLOAD_MAX_BYTES + 1],
    ['turnstileToken', ''],
  ])('rejects a bad %s (%j)', (field, value) => {
    const result = createUploadInput.safeParse({ ...valid, [field]: value })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual([field])
  })
})

describe('videoIdParam', () => {
  it('accepts UUIDv7 ids and rejects anything else', () => {
    expect(videoIdParam.safeParse({ id: '01a0f9e9-2000-7000-8000-000000000007' }).success).toBe(
      true,
    )
    expect(videoIdParam.safeParse({ id: 'not-an-id' }).success).toBe(false)
  })
})

describe('video enums', () => {
  it('accepts every lifecycle status', () => {
    for (const status of ['uploading', 'processing', 'ready', 'error']) {
      expect(videoStatus.parse(status)).toBe(status)
    }
  })

  it('rejects unknown values', () => {
    expect(videoStatus.safeParse('deleted').success).toBe(false)
    expect(videoVisibility.safeParse('private').success).toBe(false)
  })
})
