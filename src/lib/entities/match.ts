/**
 * Identity matching for names (items, sites). Pure and database-free.
 *
 * Names are never compared with SQL ILIKE / `mode: "insensitive"` equals: in this
 * Prisma build that compiles to ILIKE, where % and _ are wildcards and \ is an
 * escape, so "Cable_A" would match "Cable-A". Callers fetch candidates and compare
 * the normalised key here instead.
 */

/** NFC-normalise (not NFKC: fullwidth stays distinct), drop zero-width characters, trim, lowercase, collapse inner whitespace. Two names are "the same" when their keys are equal. */
export function normKey(s: string | null | undefined): string {
  return (s ?? '').normalize('NFC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Escapes % _ and \ for a LIKE/ILIKE pattern, for contains-style SEARCH filters only (never identity). */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&')
}

/** The first row whose key equals the wanted key; ties go to the earliest in the given order. */
export function findByKey<T>(rows: T[], key: string, keyOf: (r: T) => string): T | undefined {
  return rows.find((r) => keyOf(r) === key)
}

/** Item identity: name + manufacturer + model, each normalised (blank equals missing). */
export const itemIdentity = (r: { name: string; manufacturer?: string | null; model?: string | null }) =>
  [r.name, r.manufacturer, r.model].map(normKey).join('\u0000')

/**
 * The existing site a typed name refers to, or undefined. Candidates are compared on the
 * normalised key only (so "%" or "Stage_9" are literal text); ties go to the oldest (createdAt), then id, so the choice is deterministic.
 */
export function findSiteMatch<T extends { id: string; name: string; createdAt: Date }>(all: T[], name: string): T | undefined {
  const want = normKey(name)
  return all
    .filter((l) => normKey(l.name) === want)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))[0]
}
