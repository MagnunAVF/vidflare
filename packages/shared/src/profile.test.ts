import { describe, expect, it } from 'vitest'

import { AVATAR_MAX_BYTES } from './limits'
import { avatarUploadInput, updateProfileInput } from './profile'

describe('updateProfileInput', () => {
  it('accepts any subset, trimmed and normalized like sign-up', () => {
    expect(updateProfileInput.parse({ name: ' New ' })).toEqual({ name: 'New' })
    expect(updateProfileInput.parse({ handle: 'Alice_2' })).toEqual({ handle: 'alice_2' })
  })

  it('rejects an empty update and invalid fields', () => {
    expect(updateProfileInput.safeParse({}).success).toBe(false)
    expect(updateProfileInput.safeParse({ name: '' }).success).toBe(false)
    expect(updateProfileInput.safeParse({ handle: 'a-b' }).success).toBe(false)
  })
})

// This package compiles without DOM types; the test runtime (Node) has a global File.
const { File: NodeFile } = globalThis as unknown as {
  File: new (
    bits: Uint8Array[],
    name: string,
    options: { type: string },
  ) => { size: number; type: string }
}

describe('avatarUploadInput', () => {
  const file = (size: number, type: string) => new NodeFile([new Uint8Array(size)], 'a', { type })

  it('accepts PNG, JPEG and WebP up to the limit', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      expect(avatarUploadInput.safeParse({ file: file(10, type) }).success).toBe(true)
    }
    expect(avatarUploadInput.safeParse({ file: file(AVATAR_MAX_BYTES, 'image/png') }).success).toBe(
      true,
    )
  })

  it('rejects other types, empty and oversized files', () => {
    expect(avatarUploadInput.safeParse({ file: file(10, 'image/svg+xml') }).success).toBe(false)
    expect(avatarUploadInput.safeParse({ file: file(0, 'image/png') }).success).toBe(false)
    expect(
      avatarUploadInput.safeParse({ file: file(AVATAR_MAX_BYTES + 1, 'image/png') }).success,
    ).toBe(false)
    expect(avatarUploadInput.safeParse({ file: 'not a file' }).success).toBe(false)
  })
})
