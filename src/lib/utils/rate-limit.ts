/**
 * In-memory rate limiter for login, OTP verification, and password reset.
 *
 * For production at scale, replace with Redis-backed rate limiting.
 * This implementation is suitable for single-instance deployments.
 */

type RateLimitEntry = {
  count: number
  resetAt: number
}

const stores = new Map<string, Map<string, RateLimitEntry>>()

function getStore(namespace: string): Map<string, RateLimitEntry> {
  let store = stores.get(namespace)
  if (!store) {
    store = new Map()
    stores.set(namespace, store)
  }
  return store
}

// Periodic cleanup of expired entries (every 5 minutes)
setInterval(() => {
  const now = Date.now()
  for (const store of stores.values()) {
    for (const [key, entry] of store) {
      if (now > entry.resetAt) {
        store.delete(key)
      }
    }
  }
}, 5 * 60 * 1000).unref()

export type RateLimitResult = {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

/**
 * Check and consume a rate limit attempt.
 * @param namespace - Category (e.g., 'login', 'otp-verify')
 * @param key - Identifier (e.g., email address or IP)
 * @param maxAttempts - Max attempts in the window
 * @param windowMs - Time window in milliseconds
 */
export function checkRateLimit(
  namespace: string,
  key: string,
  maxAttempts: number,
  windowMs: number
): RateLimitResult {
  const store = getStore(namespace)
  const now = Date.now()
  const normalizedKey = key.toLowerCase().trim()

  const entry = store.get(normalizedKey)

  // No entry or expired window — allow and start fresh
  if (!entry || now > entry.resetAt) {
    store.set(normalizedKey, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: maxAttempts - 1, retryAfterSeconds: 0 }
  }

  // Within window but under limit
  if (entry.count < maxAttempts) {
    entry.count++
    return { allowed: true, remaining: maxAttempts - entry.count, retryAfterSeconds: 0 }
  }

  // Rate limited
  const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000)
  return { allowed: false, remaining: 0, retryAfterSeconds }
}

/**
 * Reset rate limit for a key (e.g., after successful login).
 */
export function resetRateLimit(namespace: string, key: string): void {
  const store = getStore(namespace)
  store.delete(key.toLowerCase().trim())
}
