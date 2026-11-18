import type { AVATAR_TYPES } from '@vidflare/shared'

export type ImageType = (typeof AVATAR_TYPES)[number]

export const IMAGE_EXTENSIONS: Record<ImageType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((b, i) => bytes[offset + i] === b)

// The image type from the file's magic bytes, or null for anything else. The declared
// Content-Type is never trusted: what we store is served back with this type, so a file that
// is really HTML or SVG must not get through as an "image".
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  // "RIFF" <size> "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return 'image/webp'
  return null
}
