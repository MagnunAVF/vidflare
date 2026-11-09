import { base64url, fromBase64url, utf8 } from './encoding'

// PBKDF2-SHA256 via Web Crypto. 100k iterations is the maximum Workers allows for PBKDF2.
// Stored as `pbkdf2_sha256$<iterations>$<salt>$<hash>` so the cost can change later.
const SCHEME = 'pbkdf2_sha256'
const ITERATIONS = 100_000

async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', utf8(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  )
  return new Uint8Array(bits)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(password, salt, ITERATIONS)
  return `${SCHEME}$${ITERATIONS}$${base64url(salt)}$${base64url(hash)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, hash] = stored.split('$')
  if (scheme !== SCHEME || !iterations || !salt || !hash) return false
  const expected = fromBase64url(hash)
  const actual = await derive(password, fromBase64url(salt), Number(iterations))
  return (
    actual.byteLength === expected.byteLength && crypto.subtle.timingSafeEqual(actual, expected)
  )
}
