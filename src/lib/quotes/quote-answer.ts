/**
 * The rules a client's answer on a public quote link must pass before anything is
 * written. The quote page is public and its actions are direct POSTs carrying only
 * a token, so every argument is treated as hostile: these take `unknown` and hand
 * back either a clean value or the sentence to show.
 *
 * Pure — no prisma, no 'use server', no next/*. approveQuote, requestQuoteChanges
 * and denyQuote (lib/actions/quote-tokens) apply them; the same status list is the
 * guard their transactions write through, so a check that passed here against an
 * earlier read still cannot move an order that has since left these statuses.
 */

/** The only statuses a quote link can answer (approve, ask for changes, decline). */
export const QUOTE_ANSWERABLE_STATUSES = ['DRAFT', 'QUOTE_SENT'] as const

/** A line's quantity as a client may set it on approval. */
export const MAX_LINE_QUANTITY = 999

/** Longest note a client may leave when asking for changes or declining. */
export const MAX_ANSWER_NOTE = 5000

/**
 * Why this link cannot answer its quote right now, or null when it can. A link
 * answers once, before it expires, and only while the order is still a quote.
 */
export function quoteAnswerProblem(
  link: { expiresAt: Date; usedAt: Date | null },
  status: string,
  now: Date = new Date(),
): string | null {
  if (link.expiresAt < now) return 'Quote link expired'
  if (link.usedAt) return 'This quote has already been answered.'
  if (!(QUOTE_ANSWERABLE_STATUSES as readonly string[]).includes(status)) {
    return 'This quote can no longer be answered.'
  }
  return null
}

/** A change-request or decline note: a trimmed string within bounds, or null when optional and empty. */
export function cleanAnswerNote(
  value: unknown,
  opts: { required: boolean },
): { ok: true; note: string | null } | { ok: false; error: string } {
  if (value == null) {
    return opts.required ? { ok: false, error: 'Tell us what you would like changed.' } : { ok: true, note: null }
  }
  if (typeof value !== 'string') return { ok: false, error: 'That note could not be read.' }
  const note = value.trim()
  if (!note) {
    return opts.required ? { ok: false, error: 'Tell us what you would like changed.' } : { ok: true, note: null }
  }
  if (note.length > MAX_ANSWER_NOTE) {
    return { ok: false, error: `Keep the note under ${MAX_ANSWER_NOTE} characters.` }
  }
  return { ok: true, note }
}

export type ApprovalLine = {
  id: string
  packageId: string | null
  quantity: number
  /** False for rows the client never sees (hidden cloud config rows). */
  editable: boolean
}

export type ApprovalChoice = {
  /** The option to make active, or null when the active one stands. */
  switchTo: string | null
  /** The option whose lines are the order once approved (null: the order has no options). */
  scopePackageId: string | null
  changes: { itemId: string; newQuantity: number }[]
}

/**
 * The option and quantities a client chose on a rental quote, checked against the
 * order they belong to. A package must be one of this order's own; a quantity
 * change must name a visible line of the option being approved, once, with a
 * whole number from 1 to MAX_LINE_QUANTITY.
 */
export function validateApprovalChoice(input: {
  selectedPackageId: unknown
  quantityChanges: unknown
  packageIds: string[]
  activePackageId: string | null
  lines: ApprovalLine[]
}): ({ ok: true } & ApprovalChoice) | { ok: false; error: string } {
  const refuse = (error: string) => ({ ok: false as const, error })

  let switchTo: string | null = null
  const selected = input.selectedPackageId
  if (selected != null && selected !== '') {
    if (typeof selected !== 'string' || !input.packageIds.includes(selected)) {
      return refuse('That option is not part of this quote.')
    }
    if (selected !== input.activePackageId) switchTo = selected
  }
  const scopePackageId = switchTo ?? input.activePackageId ?? null

  const raw = input.quantityChanges
  if (raw == null) return { ok: true, switchTo, scopePackageId, changes: [] }
  if (!Array.isArray(raw)) return refuse('Those quantities could not be read.')
  if (raw.length > input.lines.length) return refuse('Those quantities could not be read.')

  const inScope = new Map(
    input.lines
      .filter((l) => l.editable && (scopePackageId ? l.packageId === scopePackageId : true))
      .map((l) => [l.id, l]),
  )
  const seen = new Set<string>()
  const changes: ApprovalChoice['changes'] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return refuse('Those quantities could not be read.')
    const { itemId, newQuantity } = entry as { itemId?: unknown; newQuantity?: unknown }
    if (typeof itemId !== 'string' || !inScope.has(itemId)) {
      return refuse('A quantity was changed on a line that is not part of this quote.')
    }
    if (seen.has(itemId)) return refuse('Those quantities could not be read.')
    seen.add(itemId)
    if (
      typeof newQuantity !== 'number' ||
      !Number.isInteger(newQuantity) ||
      newQuantity < 1 ||
      newQuantity > MAX_LINE_QUANTITY
    ) {
      return refuse(`Quantities must be whole numbers from 1 to ${MAX_LINE_QUANTITY}.`)
    }
    changes.push({ itemId, newQuantity })
  }
  return { ok: true, switchTo, scopePackageId, changes }
}
