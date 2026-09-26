/**
 * The Flow terms the builder offers — v1's set (12/24/36/48/60 months) — and the
 * one place that says whether a term is one of them.
 *
 * termMonths drives O(T) loops through the Flow pricing engine (lib/pricing/flow.ts):
 * every server path that accepts a term from outside (the builder's preview, order
 * creation, an order's own term edit) must check it against this set before it
 * reaches that engine, not just check it is positive. The builder's own options are
 * drawn from the same array, so the two can't drift apart.
 *
 * Pure and client-safe: NOT a 'use server' module. The external client-portal quote
 * spec offers FLOW 12–48 months for its own quotes; that is a different surface and
 * does not change the app's set here.
 */
export const FLOW_TERMS = [12, 24, 36, 48, 60] as const

export type FlowTermMonths = (typeof FLOW_TERMS)[number]

export const FLOW_TERMS_MESSAGE = 'Flow terms are 12, 24, 36, 48 or 60 months.'

/** True only for a value that is exactly one of the offered terms. */
export function isFlowTerm(value: unknown): value is FlowTermMonths {
  return typeof value === 'number' && Number.isInteger(value) && (FLOW_TERMS as readonly number[]).includes(value)
}

/** The term, or throws the plain refusal message a caller can show as-is. */
export function assertFlowTerm(value: unknown): FlowTermMonths {
  if (!isFlowTerm(value)) throw new Error(FLOW_TERMS_MESSAGE)
  return value
}
