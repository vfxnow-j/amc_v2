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
  return flowDraftEconomics(prisma, input.termMonths, input.knobs ?? {}, input.lines)
}
