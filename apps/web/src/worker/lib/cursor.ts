import { base64url, fromBase64url } from './encoding'

// The position after the last item of a page, for lists ordered by (<time>, id) DESC: the
// home feed sorts on published_at, the studio on created_at.
export interface FeedCursor {
  at: number
  id: string
}

// Opaque to the client: base64url of `<time>.<id>`.
export const encodeCursor = (c: FeedCursor) =>
  base64url(new TextEncoder().encode(`${c.at}.${c.id}`))

// null for anything that isn't a cursor this API produced.
export function decodeCursor(cursor: string): FeedCursor | null {
  let text: string
  try {
    text = new TextDecoder().decode(fromBase64url(cursor))
  } catch {
    // Not base64url.
    return null
  }
  // Undecodable bytes become U+FFFD and fail this pattern.
  const match = /^(\d{1,16})\.([0-9a-f-]{36})$/.exec(text)
  if (!match) return null
  return { at: Number(match[1]), id: match[2]! }
}
