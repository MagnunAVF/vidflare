import { z } from 'zod'

import { AVATAR_MAX_BYTES, AVATAR_TYPES } from './limits'

// POST /api/me/avatar (multipart form). The API also checks the file's bytes, not just the
// type the browser declared.
export const avatarUploadInput = z.object({
  file: z
    .file('Choose an image')
    .min(1, 'The file is empty')
    .max(AVATAR_MAX_BYTES, `The image is larger than ${AVATAR_MAX_BYTES / 1024 ** 2} MB`)
    .mime([...AVATAR_TYPES], 'Use a PNG, JPEG or WebP image'),
})
export type AvatarUploadInput = z.input<typeof avatarUploadInput>
