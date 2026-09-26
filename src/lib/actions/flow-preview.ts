'use server'

/**
 * The staff-only economics strip on the new-order builder's Flow preview: what the
 * draft's gear cost us, what it still owes on its leases, month one's net cash and
 * the profit. The client's price is not here — the builder prices its lines in the
 * browser with priceFlowLines, the same call the server stores with.
 *
 * A 'use server' module exports async functions only; the loader lives in
 * lib/flow/draft-economics.ts.
 */
import { prisma } from '@/lib/prisma'
import { requireEditor } from '@/lib/auth-utils'
import {
  flowDraftEconomics,
  type FlowDraftEconomics,
  type FlowDraftKnobs,
  type FlowDraftLine,
} from '@/lib/flow/draft-economics'
import { isFlowTerm } from '@/lib/flow/terms'
import { flowKnobsProblem } from '@/lib/flow/knob-bounds'

const MAX_LINE_QTY = 999

/** A line the preview will price, or null when anything on it is out of bounds. */
function validLine(line: unknown): FlowDraftLine | null {
  if (!line || typeof line !== 'object') return null
  const { assetId, quantity, costBasis } = line as Record<string, unknown>
  if (typeof assetId !== 'string' || !assetId) return null
  const qty = Number(quantity)
  if (!Number.isFinite(qty) || qty < 1 || qty > MAX_LINE_QTY) return null
  if (costBasis == null) return { assetId, quantity: Math.round(qty), costBasis: null }
  const basis = Number(costBasis)
  if (!Number.isFinite(basis) || basis < 0) return null
  return { assetId, quantity: Math.round(qty), costBasis: basis }
}

/** Null when the draft cannot be priced yet, or the caller may not see costs. */
export async function previewFlowDraftEconomics(input: {
  termMonths: number
  knobs: FlowDraftKnobs
  lines: FlowDraftLine[]
}): Promise<FlowDraftEconomics | null> {
  // Unit costs and lease balances: the same role as building the order.
  const auth = await requireEditor()
  if (!auth.authorized) return null
  if (!input || !Array.isArray(input.lines)) return null

  // Not merely "positive": termMonths drives O(termMonths) loops through the Flow
  // pricing engine, and this action is called on every keystroke in the builder.
  if (!isFlowTerm(input.termMonths)) return null

  const lines: FlowDraftLine[] = []
  for (const raw of input.lines) {
    const line = validLine(raw)
    if (!line) return null
    lines.push(line)
  }

  const knobs = input.knobs ?? {}
  if (
    flowKnobsProblem({
      marginPct: knobs.marginPct,
      financePct: knobs.financePct,
      purchaseTaxPct: knobs.purchaseTaxPct,
      recoverByMonth: knobs.recoverByMonth,
      deprPct: knobs.deprPct,
      lifeMonths: knobs.lifeMonths,
      stepPct: knobs.stepPct,
    })
  ) {
    return null
  }

  return flowDraftEconomics(prisma, input.termMonths, knobs, lines)
}
