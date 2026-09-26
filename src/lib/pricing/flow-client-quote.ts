/**
 * The client's view of a Flow order: what they pay each month, and nothing about what
 * the gear cost us. Pure — no prisma, no 'use server', no next/*.
 *
 * Extras follow the order's stored total (contract − discount + tax + delivery + return):
 *  - the discount is spread across every monthly payment (each row scaled by one factor)
 *  - sales tax is charged on each monthly payment
 *  - delivery and return are one-time charges on the first invoice
 */

export type FlowClientQuoteInput = {
  /** Contract rates per month, month 1 first (FlowOrderSchedule.rows[].rate). */
  rates: number[]
  discountAmount: number
  taxRate: number
  deliveryCost: number
  returnCost: number
  feasible: boolean
}

export type FlowClientQuoteRow = { month: number; payment: number; tax: number; total: number; remaining: number }
export type FlowClientQuoteTier = { fromMonth: number; toMonth: number; payment: number; tax: number }

export type FlowClientQuote = {
  feasible: boolean
  termMonths: number
  tiers: FlowClientQuoteTier[]
  rows: FlowClientQuoteRow[]
  oneTime: { label: 'Delivery' | 'Return'; amount: number }[]
  totals: { contract: number; discount: number; contractAfterDiscount: number; tax: number; oneTime: number; total: number }
}

const cents = (n: number) => Math.round(n * 100)
const money = (c: number) => c / 100

/** Split `total` cents across `weights` so the parts sum exactly (remainder to the last). */
function spread(totalCents: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (!sum) return weights.map(() => 0)
  let running = 0
  let allocated = 0
  return weights.map((w, i) => {
    running += w
    const upTo = i === weights.length - 1 ? totalCents : Math.round((totalCents * running) / sum)
    const part = upTo - allocated
    allocated = upTo
    return part
  })
}

export function flowClientQuote(input: FlowClientQuoteInput): FlowClientQuote {
  const empty: FlowClientQuote = {
    feasible: false, termMonths: 0, tiers: [], rows: [], oneTime: [],
    totals: { contract: 0, discount: 0, contractAfterDiscount: 0, tax: 0, oneTime: 0, total: 0 },
  }
  const rateCents = input.rates.map(cents)
  const contractCents = rateCents.reduce((a, b) => a + b, 0)
  if (!input.feasible || contractCents <= 0) return empty

  const discountCents = Math.min(Math.max(0, cents(input.discountAmount || 0)), contractCents)
  const afterCents = contractCents - discountCents
  const taxRate = Math.max(0, Number(input.taxRate) || 0)

  const paymentCents = spread(afterCents, rateCents)
  const taxTotalCents = Math.round((afterCents * taxRate) / 100)
  const taxCents = spread(taxTotalCents, paymentCents)

  let remaining = afterCents
  const rows: FlowClientQuoteRow[] = paymentCents.map((p, i) => {
    remaining -= p
    return { month: i + 1, payment: money(p), tax: money(taxCents[i]), total: money(p + taxCents[i]), remaining: money(remaining) }
  })

  // Consecutive runs of the same contract rate form one tier. The schedule bills whole
  // cents that telescope to the contract, so a flat run alternates by a cent
  // (2403.17 / 2403.16) — anything within a cent of the run's first month is the same
  // tier; the tier shows the run's first payment.
  const tiers: FlowClientQuoteTier[] = []
  let tierRate = Number.NaN
  rateCents.forEach((r, i) => {
    const last = tiers[tiers.length - 1]
    if (last && Math.abs(r - tierRate) <= 1) last.toMonth = i + 1
    else {
      tierRate = r
      tiers.push({ fromMonth: i + 1, toMonth: i + 1, payment: rows[i].payment, tax: rows[i].tax })
    }
  })

  const oneTime: FlowClientQuote['oneTime'] = []
  if (cents(input.deliveryCost || 0) > 0) oneTime.push({ label: 'Delivery', amount: money(cents(input.deliveryCost)) })
  if (cents(input.returnCost || 0) > 0) oneTime.push({ label: 'Return', amount: money(cents(input.returnCost)) })
  const oneTimeCents = oneTime.reduce((s, o) => s + cents(o.amount), 0)

  return {
    feasible: true,
    termMonths: rows.length,
    tiers,
    rows,
    oneTime,
    totals: {
      contract: money(contractCents),
      discount: money(discountCents),
      contractAfterDiscount: money(afterCents),
      tax: money(taxTotalCents),
      oneTime: money(oneTimeCents),
      total: money(afterCents + taxTotalCents + oneTimeCents),
    },
  }
}
