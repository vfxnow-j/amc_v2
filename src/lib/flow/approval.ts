/**
 * What a client's approval of a Flow quote must carry, checked on the server.
 * The quote page is public and its approve call is a direct POST, so nothing the
 * browser sends is trusted: this is the whole rule, and approveQuote applies it
 * before anything is written. Ported from v1 approveQuote (FLOW path).
 *
 * Pure — no prisma, no 'use server', no next/*.
 */
import { validateSignerName } from '@/lib/quotes/signer-name'
import { FLOW_SCHEDULE_HASH_PATTERN } from '@/lib/pricing/flow-schedule-hash'

export const FLOW_AUTOPAY_METHODS = ['ACH', 'CARD'] as const
export type FlowAutopayMethod = (typeof FLOW_AUTOPAY_METHODS)[number]

export type FlowApprovalInput = {
  signerName: unknown
  quantityChanges?: unknown
  selectedPackageId?: unknown
  /** The order's active option, if it has any. */
  activePackageId?: string | null
  autopayMethod?: unknown
  /**
   * The terms `version` the client's page rendered before they signed, and the
   * version the server would render right now (about to be frozen onto the
   * order). Both are supplied by approveQuote for the real approval path; a
   * caller that omits `currentTermsVersion` (older callers, existing tests)
   * skips this rule rather than failing closed on a value it never had.
   */
  displayedTermsVersion?: unknown
  currentTermsVersion?: number
  /**
   * The schedule fingerprint (flowScheduleHash) the client's page was sent, and
   * the one recomputed from the order as it stands now. Same opt-in as the terms
   * version: approveQuote always supplies `currentScheduleHash`.
   */
  displayedScheduleHash?: unknown
  currentScheduleHash?: string
}

export const FLOW_SCHEDULE_CHANGED = 'This quote changed since you opened it — please reload to review it.'

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

  const nameCheck = validateSignerName(input.signerName)
  if (!nameCheck.ok) return { ok: false, error: nameCheck.error }

  // The terms shown to the client must be the terms being frozen onto the order.
  // If staff edited the Flow terms settings between the client opening the quote
  // and signing it, the version the server would render now has moved on — the
  // client agreed to different wording than what's about to be recorded.
  if (input.currentTermsVersion !== undefined) {
    const displayed = input.displayedTermsVersion
    const isValidInteger = typeof displayed === 'number' && Number.isInteger(displayed)
    if (!isValidInteger || displayed !== input.currentTermsVersion) {
      return { ok: false, error: 'These terms were updated — please reload the quote to review them.' }
    }
  }

  // The schedule shown to the client must be the schedule being approved. The
  // terms version only moves when staff edit the settings; a re-price of the
  // order (a line, a knob, the discount) changes the figures without it.
  if (input.currentScheduleHash !== undefined) {
    const shown = input.displayedScheduleHash
    if (typeof shown !== 'string' || !FLOW_SCHEDULE_HASH_PATTERN.test(shown) || shown !== input.currentScheduleHash) {
      return { ok: false, error: FLOW_SCHEDULE_CHANGED }
    }
  }

  return { ok: true, signerName: nameCheck.name, autopayMethod: method as FlowAutopayMethod }
}
