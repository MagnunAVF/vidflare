// Display formatting for video metadata. Locale-aware through Intl; no extra dependencies.

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

// 1520 → "1.5K views", 1 → "1 view".
export const formatViews = (count: number) =>
  `${count === 1 ? '1' : compact.format(count)} ${count === 1 ? 'view' : 'views'}`

// 312 → "5:12", 3725 → "1:02:05".
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600 * 1000],
  ['month', 30 * 24 * 3600 * 1000],
  ['week', 7 * 24 * 3600 * 1000],
  ['day', 24 * 3600 * 1000],
  ['hour', 3600 * 1000],
  ['minute', 60 * 1000],
]

// Epoch ms → "3 days ago", "yesterday", "just now".
export function formatRelativeTime(epochMs: number, now = Date.now()): string {
  const diff = epochMs - now
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return relative.format(Math.round(diff / ms), unit)
  }
  return 'just now'
}
