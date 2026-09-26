/**
 * Validate and normalize the name a client types to sign a quote. The public
 * approve action treats this — never the raw browser input — as the name of
 * record downstream: the signed document, the signed PDF, status history, the
 * internal notification, and (for Flow) the autopay authorization.
 *
 * Pure — no prisma, no 'use server', no next/*.
 */

export type SignerNameResult = { ok: true; name: string } | { ok: false; error: string }

export function validateSignerName(name: unknown): SignerNameResult {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed) return { ok: false, error: 'Enter your full name to sign.' }
  if (trimmed.length > 200) return { ok: false, error: 'That name is too long.' }
  return { ok: true, name: trimmed }
}
