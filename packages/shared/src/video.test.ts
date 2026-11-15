import { describe, expect, it } from 'vitest'

import { videoStatus, videoVisibility } from './video'

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
