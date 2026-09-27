/**
 * Portal DTO conventions (docs/portal-api-plan.md §1, "redaction by
 * construction").
 *
 * - Every response body is built by an explicit mapper from a Prisma `select`
 *   allowlist — never by spreading a row. A column added to a model later can
 *   then never leak by accident.
 * - Keys are snake_case, as in the contract (`available_now`, `rate_id`).
 * - Money is a number in dollars rounded to cents (`money`), dates are ISO
 *   strings (`isoDateTime`) or `YYYY-MM-DD` (`isoDate`).
 * - Nothing internal: cost, basis, margin, lease, financing, depreciation,
 *   landed cost or funding never reaches a portal. `assertClientSafe` is the
 *   test-side backstop — every route's tests run their response through it.
 */

/** A key matching this is internal economics and must never be sent. */
export const CLIENT_UNSAFE_KEY =
  /cost|basis|margin|lease|financ|loan|purchase|depr|trueCost|internal|funding|landed|salvage/i

/**
 * Every key path in `value` (deep, through arrays and objects) whose key
 * matches CLIENT_UNSAFE_KEY. Empty means safe.
 */
export function findClientUnsafeKeys(value: unknown, path = '$'): string[] {
  const found: string[] = []
  const seen = new WeakSet<object>()

  const walk = (node: unknown, at: string) => {
    if (node === null || typeof node !== 'object') return
    if (seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${at}[${index}]`))
      return
    }
    if (node instanceof Date) return
    for (const [key, child] of Object.entries(node)) {
      const here = `${at}.${key}`
      if (CLIENT_UNSAFE_KEY.test(key)) found.push(here)
      walk(child, here)
    }
  }

  walk(value, path)
  return found
}

/** Throws, naming every offending path, if `value` carries an internal key. */
export function assertClientSafe(value: unknown): void {
  const found = findClientUnsafeKeys(value)
  if (found.length) {
    throw new Error(`Portal response carries internal keys: ${found.join(', ')}`)
  }
}

type DecimalLike = { toString(): string } | number | string | null | undefined

/** Dollars as a number rounded to cents; null stays null. */
export function money(value: DecimalLike): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : Number(value.toString())
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100) / 100
}

export function isoDateTime(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

/** `YYYY-MM-DD` in UTC. */
export function isoDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null
}
