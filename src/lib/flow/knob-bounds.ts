/**
 * The ranges a Flow order's pricing knobs must fall within — the same ranges the
 * builder's form has always shown next to each field, now the one place both the
 * builder and the server check them against.
 *
 * Pure and client-safe: NOT a 'use server' module.
 */
export type FlowKnobKey =
  | 'marginPct'
  | 'financePct'
  | 'purchaseTaxPct'
  | 'recoverByMonth'
  | 'deprPct'
  | 'lifeMonths'
  | 'stepPct'

export const FLOW_KNOB_BOUNDS: Record<FlowKnobKey, { label: string; min: number; max: number; whole?: boolean }> = {
  marginPct: { label: 'Margin %', min: 0, max: 500 },
  financePct: { label: 'Finance %', min: 0, max: 100 },
  purchaseTaxPct: { label: 'Purchase tax %', min: 0, max: 100 },
  recoverByMonth: { label: 'Recover by month', min: 1, max: 12, whole: true },
  deprPct: { label: 'Depreciation %/yr', min: 0, max: 100 },
  lifeMonths: { label: 'Life (months)', min: 1, max: 240, whole: true },
  stepPct: { label: 'Step % from month 13', min: 1, max: 100 },
}

/** A single knob's problem, or null when it is blank/undefined or within bounds. */
export function flowKnobProblem(key: FlowKnobKey, value: number | null | undefined): string | null {
  if (value == null) return null
  const { label, min, max, whole } = FLOW_KNOB_BOUNDS[key]
  if (!Number.isFinite(value) || value < min || value > max || (whole && !Number.isInteger(value))) {
    return `${label} must be ${whole ? 'a whole number ' : ''}between ${min} and ${max}.`
  }
  return null
}

/** The first problem across a draft's knobs, or null when every set one is fine. */
export function flowKnobsProblem(knobs: Partial<Record<FlowKnobKey, number | null | undefined>>): string | null {
  for (const key of Object.keys(FLOW_KNOB_BOUNDS) as FlowKnobKey[]) {
    const problem = flowKnobProblem(key, knobs[key])
    if (problem) return problem
  }
  return null
}

/**
 * The first problem with an order's stored Flow knobs (the columns on the
 * order), or null. Every path that writes them — the builder, createReservation
 * and updateReservation — checks here, so a value the form would refuse can't
 * reach the pricing engine by another route. Also refuses a recover-by month
 * past the term: the engine can't recover the cost after the contract ends.
 * `termMonths` is the order's (new or existing) term; null skips that check.
 * Values may be numbers or stored decimals; anything Number() can read.
 */
export function flowOrderKnobsProblem(
  knobs: {
    flowMarginPct?: unknown
    flowFinancePct?: unknown
    flowPurchaseTaxPct?: unknown
    flowRecoverByMonth?: unknown
    flowDeprPct?: unknown
    flowLifeMonths?: unknown
    flowStepPct?: unknown
  },
  termMonths: number | null | undefined,
): string | null {
  const num = (v: unknown) => (v == null ? v : Number(v)) as number | null | undefined
  const problem = flowKnobsProblem({
    marginPct: num(knobs.flowMarginPct),
    financePct: num(knobs.flowFinancePct),
    purchaseTaxPct: num(knobs.flowPurchaseTaxPct),
    recoverByMonth: num(knobs.flowRecoverByMonth),
    deprPct: num(knobs.flowDeprPct),
    lifeMonths: num(knobs.flowLifeMonths),
    stepPct: num(knobs.flowStepPct),
  })
  if (problem) return problem
  const recover = num(knobs.flowRecoverByMonth)
  if (recover != null && termMonths != null && termMonths > 0 && recover > termMonths) {
    return `Recover by month can't be later than the term (${termMonths} months).`
  }
  return null
}
