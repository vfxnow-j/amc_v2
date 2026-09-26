/**
 * The Flow client quote for a stored order: prices the active lines the same way the
 * order page does (flowConfigFromSettings + priceFlowLines), then reduces them to the
 * client-safe FlowClientQuote. Pure — no prisma, no 'use server', no next/*.
 */
import { flowConfigFromSettings, priceFlowLines } from '@/lib/pricing/flow-lines'
import { flowClientQuote, type FlowClientQuote } from '@/lib/pricing/flow-client-quote'

type NumLike = number | string | { toString(): string } | null | undefined

export type FlowQuoteOrderLine = {
  parentId?: string | null
  description?: string | null
  costBasis?: NumLike
  trueCost?: NumLike
  quantity?: number | null
  flowAddedAtMonth?: number | null
  asset?: { name?: string | null } | null
}

export type FlowQuoteExtras = { discountAmount: number; taxRate: number; deliveryCost: number; returnCost: number }

/** `problem` is set (and `quote` infeasible) when the order cannot be quoted to a client. */
export function flowQuoteForOrder(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  order: any,
  lines: FlowQuoteOrderLine[],
  extras: FlowQuoteExtras,
): { quote: FlowClientQuote; problem?: string } {
  const infeasible = (problem: string) => ({
    quote: flowClientQuote({ rates: [], discountAmount: 0, taxRate: 0, deliveryCost: 0, returnCost: 0, feasible: false }),
    problem,
  })
  const config = flowConfigFromSettings(order)
  if (!config) return infeasible('This Flow order has no term yet.')
  const top = lines.filter((l) => !l.parentId)
  if (!top.length) return infeasible('This Flow order has no lines.')
  const priced = priceFlowLines(
    top.map((l) => ({
      name: l.description || l.asset?.name || 'Item',
      costBasis: l.costBasis,
      trueCost: l.trueCost,
      quantity: l.quantity || 1,
      addedAtMonth: l.flowAddedAtMonth ?? null,
    })) as Parameters<typeof priceFlowLines>[0],
    config,
  )
  if (priced.unpriced.length) return infeasible(priced.problem || 'Some Flow lines have no cost basis.')
  if (!priced.result.feasible) return infeasible('This Flow schedule cannot be quoted — check the term and lines.')
  return {
    quote: flowClientQuote({
      rates: priced.result.schedule.rows.map((r) => r.rate),
      discountAmount: extras.discountAmount,
      taxRate: extras.taxRate,
      deliveryCost: extras.deliveryCost,
      returnCost: extras.returnCost,
      feasible: true,
    }),
  }
}
