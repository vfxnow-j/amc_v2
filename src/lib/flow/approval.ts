/**
 * What a client's approval of a Flow quote must carry, checked on the server.
 * The quote page is public and its approve call is a direct POST, so nothing the
 * browser sends is trusted: this is the whole rule, and approveQuote applies it
 * before anything is written. Ported from v1 approveQuote (FLOW path).
 *
 * Pure — no prisma, no 'use server', no next/*.
 */

export const FLOW_AUTOPAY_METHODS = ['ACH', 'CARD'] as const
export type FlowAutopayMethod = (typeof FLOW_AUTOPAY_METHODS)[number]

export type FlowApprovalInput = {
  signerName: unknown
  quantityChanges?: unknown
  selectedPackageId?: unknown
  /** The order's active option, if it has any. */
  activePackageId?: string | null
  autopayMethod?: unknown
}

export type FlowApprovalResult =
  | { ok: true; signerName: string; autopayMethod: FlowAutopayMethod }
  | { ok: false; error: string }

export function checkFlowApproval(input: FlowApprovalInput): FlowApprovalResult {
  // A Flow price is a fixed schedule over the chosen gear, approved as quoted.
  // A quantity edit would re-rate lines with rental maths.
  const changes = input.quantityChanges
  if (changes != null && (!Array.isArray(changes) || changes.length > 0)) {
    return { ok: false, error: 'A Flow quote is approved as quoted — contact VFXnow to change the equipment.' }
  }
  const pkg = input.selectedPackageId
  if (pkg != null && pkg !== '' && pkg !== (input.activePackageId ?? null)) {
    return { ok: false, error: 'A Flow quote is approved as quoted — contact VFXnow to change the equipment.' }
  }

  const method = input.autopayMethod
  if (typeof method !== 'string' || !(FLOW_AUTOPAY_METHODS as readonly string[]).includes(method)) {
    return { ok: false, error: 'Autopay authorization (ACH or card) is required to approve a Flow subscription.' }
  }

  const name = typeof input.signerName === 'string' ? input.signerName.trim() : ''
  if (!name) return { ok: false, error: 'Enter your full name to sign.' }
  if (name.length > 200) return { ok: false, error: 'That name is too long.' }

  return { ok: true, signerName: name, autopayMethod: method as FlowAutopayMethod }
}
