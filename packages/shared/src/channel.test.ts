import { describe, expect, it } from 'vitest'

import { channelHandleParam } from './channel'

describe('channelHandleParam', () => {
  it('normalizes to lowercase', () => {
    expect(channelHandleParam.parse({ handle: ' Alice_01 ' })).toEqual({ handle: 'alice_01' })
  })

  it.each(['ab', 'has-dash', 'x'.repeat(31), ''])('rejects %j', (handle) => {
    expect(channelHandleParam.safeParse({ handle }).success).toBe(false)
  })
})
