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

export const VIDEO_TITLE_MAX = 100
export const VIDEO_DESCRIPTION_MAX = 5000

// Stream bills every environment's uploads to one account, so cap them everywhere.
// Stream itself rejects a video longer than this (maxDurationSeconds on the upload).
export const UPLOAD_MAX_DURATION_S = 15 * 60
export const UPLOAD_MAX_BYTES = 5 * 1024 ** 3 // 5 GiB
