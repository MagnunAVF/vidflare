// Limits enforced by both the API and the client forms. Change them here only.

export const EMAIL_MAX = 254
export const PASSWORD_MIN = 8
// PBKDF2 cost is per byte hashed, so cap the input.
export const PASSWORD_MAX = 128

export const HANDLE_MIN = 3
export const HANDLE_MAX = 30
// Lowercase letters, digits and underscores; handles appear in URLs (/c/$handle).
export const HANDLE_PATTERN = /^[a-z0-9_]+$/

export const CHANNEL_NAME_MAX = 50

// Avatars are uploaded through the Worker to R2 (they're small; only video bytes must bypass it).
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024 // 2 MiB
export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export const VIDEO_TITLE_MAX = 100
export const VIDEO_DESCRIPTION_MAX = 5000

export const COMMENT_MAX = 2000

// Long enough for any real query; the FTS query built from it stays small.
export const SEARCH_QUERY_MAX = 100

// Cloudflare documents Turnstile tokens as at most 2048 characters.
export const TURNSTILE_TOKEN_MAX = 2048

// Stream bills every environment's uploads to one account, so cap them everywhere.
// Stream itself rejects a video longer than this (maxDurationSeconds on the upload).
export const UPLOAD_MAX_DURATION_S = 15 * 60
// Stream also bills every stored minute, so each creator gets a total budget of video. An
// upload may be at most what's left of it (and never more than UPLOAD_MAX_DURATION_S); with
// less than UPLOAD_MIN_REMAINING_S left, new uploads are refused.
export const CREATOR_STORAGE_MAX_S = 2 * 60 * 60
export const UPLOAD_MIN_REMAINING_S = 60
export const UPLOAD_MAX_BYTES = 5 * 1024 ** 3 // 5 GiB
