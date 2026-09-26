# Rental monthly payment + billing run fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A recurring rental shows the client exactly what they pay each cycle ("Monthly payment: $X + tax = $Y × N months · Term total $Z") on the order, the quote PDF and the online quote, and the billing run invoices exactly that.

**Architecture:** One pure function, `cycleInvoice()`, prices one billing stretch of an order: which lines, the discount, tax, and the one-time charges on the first invoice. `paymentSchedule()` walks the term through v2's anchored calendar and calls `cycleInvoice()` for each stretch. The display, the billing run and the manual first invoice all use these, so a quote can't promise a figure the invoices don't charge. This recreates v1's a0cd5ff **on v2's rules**: v2 has no `billsFromSchedule` flag, because recurring is derived (`src/lib/orders/recurring.ts`) and the committed term is `Reservation.termMonths`.

**Tech Stack:** Next.js, Prisma 7, @react-pdf/renderer, `node:test` via `npx tsx --test`.

## Global Constraints

- v1 is read-only. No schema change in this plan.
- **Owner rules (2026-09-16/17):** monthly anchor = the business setting (default the 1st); a mid-period start bills a prorated stub; a percentage discount comes off every period; **a fixed discount comes off once per order** (the first invoice), matching `src/lib/billing/earned.ts`.
- **Owner decisions (2026-09-26):**
  - Fix the billing run now: apply the discount; skip `includedInParent` parts and lines from unchosen options; stop at the end of the term.
  - With no committed term, the line reads "billed each month until cancelled".
- Applies to RENTAL and CLOUD orders that recur on an anchored cycle (MONTHLY, WEEKLY). RTO keeps its installment path unchanged. SALE, ONE_TIME and FLOW get no payment line.
- Delivery and return (after shipping margin) are charged once, on the first invoice, untaxed, matching `computeReservationFinancials`.
- Tests: `node:test`, run with `npx tsx --test <file>`.
- Commits: prose messages ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; stage explicit paths under `flock /tmp/vfxnow-v2-git.lock`.

---

### Task 1: `cycleInvoice()` — one billing stretch, priced

**Files:**
- Create: `src/lib/billing/cycle-invoice.ts`
- Test: `src/lib/billing/cycle-invoice.test.ts`

**Interfaces:**
- Produces:
  - `type CycleLine = { description: string; assetId: string | null; rate: number; quantity: number; pricingType: string; isOneTime: boolean; includedInParent: boolean }`
  - `type CycleTerms = { discountType: string | null; discountValue: number; taxRate: number; deliveryCost: number; returnCost: number }` (delivery and return already after shipping margin)
  - `type CycleInvoiceLine = { description: string; quantity: number; unitPrice: number; amount: number; assetId: string | null }`
  - `type CycleInvoice = { items: CycleInvoiceLine[]; itemsSubtotal: number; discount: number; taxable: number; taxAmount: number; oneTimeCharges: number; subtotal: number; total: number }`
  - `cycleInvoice(input: { lines: CycleLine[]; share: number; first: boolean; terms: CycleTerms; shareNote?: string }): CycleInvoice`
  - `toCycleLine(item: { asset?: { name: string } | null; description?: string | null; assetId: string | null; rate: unknown; quantity?: number | null; pricingType: string; isOneTime?: boolean | null; includedInParent?: boolean | null }): CycleLine`
  - `cycleTermsFor(order: { discountType: string | null; discountValue: unknown; taxRate: unknown; deliveryCost: unknown; returnCost: unknown; shippingMarginType?: string | null; shippingMargin?: unknown }): CycleTerms`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/billing/cycle-invoice.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cycleInvoice, cycleTermsFor, type CycleLine, type CycleTerms } from './cycle-invoice'

const line = (over: Partial<CycleLine> = {}): CycleLine => ({
  description: 'Lenovo P620', assetId: 'a1', rate: 1000, quantity: 1, pricingType: 'MONTHLY',
  isOneTime: false, includedInParent: false, ...over,
})
const terms = (over: Partial<CycleTerms> = {}): CycleTerms => ({
  discountType: null, discountValue: 0, taxRate: 10, deliveryCost: 0, returnCost: 0, ...over,
})

test('a whole period: rate × qty, taxed', () => {
  const inv = cycleInvoice({ lines: [line({ quantity: 2 })], share: 1, first: false, terms: terms() })
  assert.equal(inv.itemsSubtotal, 2000)
  assert.equal(inv.taxAmount, 200)
  assert.equal(inv.total, 2200)
})

test('a stub bills its share of the rate', () => {
  const inv = cycleInvoice({ lines: [line()], share: 11 / 30, first: true, terms: terms() })
  assert.equal(inv.itemsSubtotal, 366.67)
  assert.equal(inv.taxAmount, 36.67)
  assert.equal(inv.total, 403.34)
})

test('a part included in its system price is not billed', () => {
  const inv = cycleInvoice({ lines: [line(), line({ description: 'RTX A6000', rate: 400, includedInParent: true })], share: 1, first: false, terms: terms() })
  assert.equal(inv.itemsSubtotal, 1000)
  assert.equal(inv.items.length, 1)
})

test('a one-time line is billed on the first invoice only, whole', () => {
  const setup = line({ description: 'Imaging', rate: 300, isOneTime: true })
  assert.equal(cycleInvoice({ lines: [line(), setup], share: 0.5, first: true, terms: terms() }).itemsSubtotal, 800)
  assert.equal(cycleInvoice({ lines: [line(), setup], share: 1, first: false, terms: terms() }).itemsSubtotal, 1000)
})

test('a percentage discount comes off every period, as its own line, before tax', () => {
  const inv = cycleInvoice({ lines: [line()], share: 1, first: false, terms: terms({ discountType: 'PERCENTAGE', discountValue: 10 }) })
  assert.equal(inv.discount, 100)
  assert.equal(inv.taxable, 900)
  assert.equal(inv.taxAmount, 90)
  assert.equal(inv.total, 990)
  assert.deepEqual(inv.items.at(-1), { description: 'Discount (10%)', quantity: 1, unitPrice: -100, amount: -100, assetId: null })
})

test('a fixed discount comes off once, on the first invoice', () => {
  const t = terms({ discountType: 'FIXED', discountValue: 250 })
  assert.equal(cycleInvoice({ lines: [line()], share: 1, first: true, terms: t }).total, 825)
  assert.equal(cycleInvoice({ lines: [line()], share: 1, first: false, terms: t }).total, 1100)
})

test('a fixed discount never exceeds what the invoice bills', () => {
  const inv = cycleInvoice({ lines: [line({ rate: 100 })], share: 1, first: true, terms: terms({ discountType: 'FIXED', discountValue: 500 }) })
  assert.equal(inv.discount, 100)
  assert.equal(inv.total, 0)
})

test('delivery and return ride on the first invoice, untaxed', () => {
  const t = terms({ deliveryCost: 150, returnCost: 50 })
  const first = cycleInvoice({ lines: [line()], share: 1, first: true, terms: t })
  assert.equal(first.oneTimeCharges, 200)
  assert.equal(first.taxAmount, 100)
  assert.equal(first.total, 1300)
  assert.equal(first.subtotal, 1200)
  assert.equal(cycleInvoice({ lines: [line()], share: 1, first: false, terms: t }).total, 1100)
})

test('shareNote labels recurring lines only', () => {
  const inv = cycleInvoice({ lines: [line(), line({ description: 'Imaging', rate: 300, isOneTime: true })], share: 0.5, first: true, terms: terms(), shareNote: ' × 0.5' })
  assert.equal(inv.items[0].description, 'Lenovo P620 (MONTHLY rate × 0.5)')
  assert.equal(inv.items[1].description, 'Imaging (one-time)')
})

test('cycleTermsFor applies the shipping margin', () => {
  const t = cycleTermsFor({ discountType: null, discountValue: null, taxRate: '9.5', deliveryCost: '100', returnCost: '100', shippingMarginType: 'PERCENTAGE', shippingMargin: 20 })
  assert.deepEqual(t, { discountType: null, discountValue: 0, taxRate: 9.5, deliveryCost: 120, returnCost: 120 })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx --test src/lib/billing/cycle-invoice.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/billing/cycle-invoice.ts
/**
 * One billing stretch of a recurring order, priced: which lines bill, the
 * discount, tax, and what rides on the first invoice only.
 *
 * The quote's "Monthly payment" line, the billing run and the manual first
 * invoice all price through here, so what the client is told each month is
 * what they are invoiced. Before this the billing run summed rate × qty over
 * every line on the order — parts already in a system's price, lines from quote
 * options the client didn't choose, one-time charges every month — and never
 * applied the discount (found 2026-09-26).
 *
 * Owner rules: a percentage discount comes off every period; a fixed amount
 * comes off once, on the first invoice (as revenue earned counts it,
 * lib/billing/earned.ts). Delivery and return are charged once, untaxed, as
 * computeReservationFinancials treats them. Pure — no prisma, no next.
 */
import { applyShippingMargin } from '@/lib/pricing/financials'
import { roundMoney } from '@/lib/pricing/periods'

export type CycleLine = {
  description: string
  assetId: string | null
  rate: number
  quantity: number
  pricingType: string
  isOneTime: boolean
  includedInParent: boolean
}

export type CycleTerms = {
  discountType: string | null
  discountValue: number
  taxRate: number
  /** Client-facing, after the shipping margin. */
  deliveryCost: number
  returnCost: number
}

export type CycleInvoiceLine = { description: string; quantity: number; unitPrice: number; amount: number; assetId: string | null }

export type CycleInvoice = {
  items: CycleInvoiceLine[]
  itemsSubtotal: number
  discount: number
  taxable: number
  taxAmount: number
  oneTimeCharges: number
  subtotal: number
  total: number
}

export function cycleInvoice(input: {
  lines: CycleLine[]
  /** Periods' worth this stretch bills: 1 for a whole period, 11/30 for a Sep 20–30 stub. */
  share: number
  first: boolean
  terms: CycleTerms
  /** Appended inside each recurring line's "(… rate)" label, e.g. " × 0.37, Sep 20 – Sep 30". */
  shareNote?: string
}): CycleInvoice {
  const { share, first, terms } = input
  const items: CycleInvoiceLine[] = []
  let itemsSubtotal = 0
  for (const l of input.lines) {
    if (l.includedInParent) continue
    if (l.isOneTime && !first) continue
    const quantity = l.quantity || 1
    const amount = roundMoney(quantity * l.rate * (l.isOneTime ? 1 : share))
    itemsSubtotal += amount
    items.push({
      description: l.isOneTime ? `${l.description} (one-time)` : `${l.description} (${l.pricingType} rate${input.shareNote ?? ''})`,
      quantity,
      unitPrice: l.rate,
      amount,
      assetId: l.assetId,
    })
  }
  itemsSubtotal = roundMoney(itemsSubtotal)

  let discount = 0
  if (terms.discountType === 'PERCENTAGE' && terms.discountValue > 0) {
    discount = roundMoney((itemsSubtotal * terms.discountValue) / 100)
  } else if (terms.discountType === 'FIXED' && terms.discountValue > 0 && first) {
    discount = roundMoney(Math.min(terms.discountValue, itemsSubtotal))
  }
  if (discount > 0) {
    items.push({
      description: terms.discountType === 'PERCENTAGE' ? `Discount (${terms.discountValue}%)` : 'Discount',
      quantity: 1,
      unitPrice: -discount,
      amount: -discount,
      assetId: null,
    })
  }

  const taxable = roundMoney(itemsSubtotal - discount)
  const taxAmount = roundMoney((taxable * terms.taxRate) / 100)

  let oneTimeCharges = 0
  if (first) {
    for (const [label, cost] of [['Delivery', terms.deliveryCost], ['Return', terms.returnCost]] as const) {
      if (cost > 0) {
        items.push({ description: label, quantity: 1, unitPrice: cost, amount: cost, assetId: null })
        oneTimeCharges += cost
      }
    }
  }
  oneTimeCharges = roundMoney(oneTimeCharges)

  const subtotal = roundMoney(taxable + oneTimeCharges)
  return { items, itemsSubtotal, discount, taxable, taxAmount, oneTimeCharges, subtotal, total: roundMoney(subtotal + taxAmount) }
}

export function toCycleLine(item: {
  asset?: { name: string } | null
  description?: string | null
  assetId: string | null
  rate: unknown
  quantity?: number | null
  pricingType: string
  isOneTime?: boolean | null
  includedInParent?: boolean | null
}): CycleLine {
  return {
    description: item.asset?.name || item.description || 'Ad-hoc item',
    assetId: item.assetId,
    rate: Number(item.rate) || 0,
    quantity: Number(item.quantity) || 1,
    pricingType: item.pricingType,
    isOneTime: !!item.isOneTime,
    includedInParent: !!item.includedInParent,
  }
}

export function cycleTermsFor(order: {
  discountType: string | null
  discountValue: unknown
  taxRate: unknown
  deliveryCost: unknown
  returnCost: unknown
  shippingMarginType?: string | null
  shippingMargin?: unknown
}): CycleTerms {
  const marginType = order.shippingMarginType ?? null
  const margin = Number(order.shippingMargin) || 0
  return {
    discountType: order.discountType,
    discountValue: Number(order.discountValue) || 0,
    taxRate: Number(order.taxRate) || 0,
    deliveryCost: applyShippingMargin(Number(order.deliveryCost) || 0, marginType, margin),
    returnCost: applyShippingMargin(Number(order.returnCost) || 0, marginType, margin),
  }
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx tsx --test src/lib/billing/cycle-invoice.test.ts`
Expected: `# pass 10`, `# fail 0`. If `financials.ts` pulls in a server-only import and the test can't load it, move `applyShippingMargin` into `periods.ts` and re-export it from `financials.ts`; don't copy it.

- [ ] **Step 5: Commit**: "feat(billing): price one billing stretch in one place". Prose: what the billing run got wrong, and the owner's discount rules.

---

### Task 2: `paymentSchedule()` and the payment line

**Files:**
- Create: `src/lib/billing/payment-schedule.ts`
- Test: `src/lib/billing/payment-schedule.test.ts`

**Interfaces:**
- Consumes: `cycleInvoice`, `CycleLine`, `CycleTerms` (Task 1); from `src/lib/billing/calendar.ts`: `anchorAfter`, `billedPeriods`, `intendedDay`, `isAnchoredCycle`, `addDays`, `calendarDay`, `stretchLabel`, `type BillingAnchor`.
- Produces:
  - `termEnd(start: Date, termMonths: number): Date` (exclusive; same day-of-month N months on, clamped to month end)
  - `type ScheduleRow = { start: Date; end: Date; share: number; total: number }` (`end` inclusive)
  - `type PaymentSchedule = { cycle: 'MONTHLY' | 'WEEKLY'; regular: { subtotal: number; tax: number; total: number }; months: number | null; rows: ScheduleRow[] | null; first: ScheduleRow | null; final: ScheduleRow | null; termTotal: number | null }`
  - `paymentSchedule(input: { type: string; isRecurring: boolean; cycle: string; start: Date; termMonths: number | null; anchor: BillingAnchor; lines: CycleLine[]; terms: CycleTerms }): PaymentSchedule | null`
  - `type PaymentLine = { headline: string; notes: string[] }`
  - `paymentLine(s: PaymentSchedule): PaymentLine`
  - `usd(n: number): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/billing/payment-schedule.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calendarDay } from './calendar'
import { paymentLine, paymentSchedule, termEnd } from './payment-schedule'
import type { CycleLine, CycleTerms } from './cycle-invoice'

const anchor = { monthly: 1 as const, weekly: 1 }
const lines: CycleLine[] = [{ description: 'Lenovo P620', assetId: 'a1', rate: 1000, quantity: 1, pricingType: 'MONTHLY', isOneTime: false, includedInParent: false }]
const terms = (over: Partial<CycleTerms> = {}): CycleTerms => ({ discountType: null, discountValue: 0, taxRate: 10, deliveryCost: 0, returnCost: 0, ...over })
const base = { type: 'RENTAL', isRecurring: true, cycle: 'MONTHLY', anchor, lines }

test('termEnd: same day N months on, clamped to month end', () => {
  assert.deepEqual(termEnd(calendarDay(2026, 8, 20), 6), calendarDay(2027, 2, 20))
  assert.deepEqual(termEnd(calendarDay(2026, 7, 31), 1), calendarDay(2026, 8, 30))
})

test('6 months starting on the 1st: six equal payments', () => {
  const s = paymentSchedule({ ...base, start: calendarDay(2026, 9, 1), termMonths: 6, terms: terms() })!
  assert.equal(s.rows!.length, 6)
  assert.deepEqual(s.regular, { subtotal: 1000, tax: 100, total: 1100 })
  assert.equal(s.termTotal, 6600)
  assert.equal(s.first, null)
  assert.equal(s.final, null)
  assert.equal(paymentLine(s).headline, 'Monthly payment: $1,000.00 + tax = $1,100.00 × 6 months · Term total $6,600.00')
})

test('6 months starting Sep 20: stub, five whole months, final stub', () => {
  const s = paymentSchedule({ ...base, start: calendarDay(2026, 8, 20), termMonths: 6, terms: terms() })!
  assert.equal(s.rows!.length, 7)
  assert.equal(s.first!.total, 403.34)   // Sep 20–30: 11/30 of $1,000 + 10%
  assert.equal(s.final!.total, 674.19)   // Mar 1–19: 19/31 of $1,000 + 10%
  assert.equal(s.termTotal, 6577.53)
  assert.deepEqual(paymentLine(s).notes, [
    'First invoice (Sep 20 – Sep 30): $403.34',
    'Final invoice (Mar 1 – Mar 19): $674.19',
  ])
})

test('delivery and a fixed discount show up on the first invoice only', () => {
  const s = paymentSchedule({ ...base, start: calendarDay(2026, 9, 1), termMonths: 3, terms: terms({ deliveryCost: 200, discountType: 'FIXED', discountValue: 100 }) })!
  assert.equal(s.regular.total, 1100)
  assert.equal(s.first!.total, 1190)     // 1000 − 100, +90 tax, +200 delivery
  assert.equal(s.termTotal, 3390)
})

test('no committed term: billed until cancelled', () => {
  const s = paymentSchedule({ ...base, start: calendarDay(2026, 9, 1), termMonths: null, terms: terms() })!
  assert.equal(s.rows, null)
  assert.equal(s.termTotal, null)
  assert.equal(paymentLine(s).headline, 'Monthly payment: $1,000.00 + tax = $1,100.00, billed each month until cancelled')
})

test('no tax: no "+ tax =" clause', () => {
  const s = paymentSchedule({ ...base, start: calendarDay(2026, 9, 1), termMonths: 2, terms: terms({ taxRate: 0 }) })!
  assert.equal(paymentLine(s).headline, 'Monthly payment: $1,000.00 × 2 months · Term total $2,000.00')
})

test('weekly cycles say weekly and give the term in months', () => {
  const s = paymentSchedule({ ...base, cycle: 'WEEKLY', lines: [{ ...lines[0], rate: 300, pricingType: 'WEEKLY' }], start: calendarDay(2026, 9, 5), termMonths: 1, terms: terms({ taxRate: 0 }) })!
  assert.match(paymentLine(s).headline, /^Weekly payment: \$300\.00 · 1-month term · Term total \$/)
})

test('no payment line for one-time, sale, rent-to-own or non-anchored cycles', () => {
  assert.equal(paymentSchedule({ ...base, cycle: 'ONE_TIME', start: calendarDay(2026, 9, 1), termMonths: 6, terms: terms() }), null)
  assert.equal(paymentSchedule({ ...base, type: 'SALE', start: calendarDay(2026, 9, 1), termMonths: null, terms: terms() }), null)
  assert.equal(paymentSchedule({ ...base, type: 'RENT_TO_OWN', start: calendarDay(2026, 9, 1), termMonths: 12, terms: terms() }), null)
  assert.equal(paymentSchedule({ ...base, cycle: 'DAILY', start: calendarDay(2026, 9, 1), termMonths: 1, terms: terms() }), null)
  assert.equal(paymentSchedule({ ...base, isRecurring: false, start: calendarDay(2026, 9, 1), termMonths: 6, terms: terms() }), null)
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx --test src/lib/billing/payment-schedule.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/billing/payment-schedule.ts
/**
 * What a recurring rental costs the client each cycle, over its committed term.
 *
 * v1 (a0cd5ff, 2026-09-25) added this behind a `billsFromSchedule` flag,
 * because v1 billed a fixed-term rental once for the whole term. v2 already
 * treats every rental that bills on a cycle as recurring and keeps the
 * committed term in `termMonths`, so no flag: the schedule is the anchored
 * calendar (a prorated first stub, whole periods, a prorated last stretch)
 * priced stretch by stretch through cycleInvoice(), which is also what the
 * billing run invoices. Pure.
 */
import {
  addDays, anchorAfter, billedPeriods, calendarDay, intendedDay, isAnchoredCycle, stretchLabel,
  type BillingAnchor,
} from './calendar'
import { cycleInvoice, type CycleLine, type CycleTerms } from './cycle-invoice'
import { roundMoney } from '@/lib/pricing/periods'

export type ScheduleRow = { start: Date; end: Date; share: number; total: number }

export type PaymentSchedule = {
  cycle: 'MONTHLY' | 'WEEKLY'
  /** One whole period, after discount: what the client pays each cycle. */
  regular: { subtotal: number; tax: number; total: number }
  months: number | null
  rows: ScheduleRow[] | null
  /** The first invoice, when it differs from a regular one (a stub, delivery, a fixed discount). */
  first: ScheduleRow | null
  /** A prorated last stretch, when the term doesn't end on an anchor. */
  final: ScheduleRow | null
  termTotal: number | null
}

/** Where a term of `termMonths` ends, exclusive: the same day N months on, clamped to the month's end. */
export function termEnd(start: Date, termMonths: number): Date {
  const d = intendedDay(start)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + termMonths
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return calendarDay(y, m, Math.min(d.getUTCDate(), last))
}

export function paymentSchedule(input: {
  type: string
  isRecurring: boolean
  cycle: string
  start: Date
  termMonths: number | null
  anchor: BillingAnchor
  lines: CycleLine[]
  terms: CycleTerms
}): PaymentSchedule | null {
  if (input.type !== 'RENTAL' && input.type !== 'CLOUD') return null
  if (!input.isRecurring || !isAnchoredCycle(input.cycle)) return null
  const cycle = input.cycle

  const whole = cycleInvoice({ lines: input.lines, share: 1, first: false, terms: input.terms })
  const regular = { subtotal: whole.taxable, tax: whole.taxAmount, total: whole.total }
  const rowFor = (s: Date, e: Date, isFirst: boolean): ScheduleRow => {
    const share = billedPeriods(s, e, cycle, input.anchor)
    const inv = cycleInvoice({ lines: input.lines, share, first: isFirst, terms: input.terms })
    return { start: s, end: addDays(e, -1), share, total: inv.total }
  }
  const differs = (r: ScheduleRow) => Math.abs(r.total - regular.total) >= 0.005

  const start = intendedDay(input.start)
  const months = input.termMonths && input.termMonths > 0 ? input.termMonths : null
  if (!months) {
    const first = rowFor(start, anchorAfter(start, cycle, input.anchor), true)
    return { cycle, regular, months: null, rows: null, first: differs(first) ? first : null, final: null, termTotal: null }
  }

  const end = termEnd(start, months)
  const rows: ScheduleRow[] = []
  let s = start
  for (let guard = 0; guard < 2000 && s.getTime() < end.getTime(); guard++) {
    const next = anchorAfter(s, cycle, input.anchor)
    const e = next.getTime() < end.getTime() ? next : end
    rows.push(rowFor(s, e, rows.length === 0))
    s = e
  }
  const last = rows.length > 1 ? rows[rows.length - 1] : null
  return {
    cycle,
    regular,
    months,
    rows,
    first: rows[0] && differs(rows[0]) ? rows[0] : null,
    final: last && differs(last) ? last : null,
    termTotal: roundMoney(rows.reduce((sum, r) => sum + r.total, 0)),
  }
}

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
export const usd = (n: number) => USD.format(n)

export type PaymentLine = { headline: string; notes: string[] }

/** The sentence every surface prints: order page, quote PDF, online quote. */
export function paymentLine(s: PaymentSchedule): PaymentLine {
  const unit = s.cycle === 'MONTHLY' ? 'month' : 'week'
  const label = s.cycle === 'MONTHLY' ? 'Monthly' : 'Weekly'
  const amount = s.regular.tax > 0
    ? `${usd(s.regular.subtotal)} + tax = ${usd(s.regular.total)}`
    : usd(s.regular.total)
  let headline = `${label} payment: ${amount}`
  if (s.months && s.termTotal !== null) {
    headline += s.cycle === 'MONTHLY'
      ? ` × ${s.months} ${s.months === 1 ? 'month' : 'months'} · Term total ${usd(s.termTotal)}`
      : ` · ${s.months}-month term · Term total ${usd(s.termTotal)}`
  } else {
    headline += `, billed each ${unit} until cancelled`
  }
  const notes: string[] = []
  if (s.first) notes.push(`First invoice (${stretchLabel(s.first.start, s.first.end)}): ${usd(s.first.total)}`)
  if (s.final) notes.push(`Final invoice (${stretchLabel(s.final.start, s.final.end)}): ${usd(s.final.total)}`)
  return { headline, notes }
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx tsx --test src/lib/billing/payment-schedule.test.ts src/lib/billing/cycle-invoice.test.ts`
Expected: `# fail 0`. If a hand-worked figure differs by a cent, recompute it by hand from `billedPeriods` before touching the code; the figure in the test must be derived, not pasted from the output.

- [ ] **Step 5: Commit**: "feat(billing): the payment schedule a recurring rental is quoted and billed on".

---

### Task 3: The billing run and the manual first invoice bill the schedule

**Files:**
- Modify: `src/lib/actions/billing.ts:27-40` (query), `:44-47` (term check), `:69-106` (non-RTO pricing), `:108-110` (tax/total), `:150-165` (next date)
- Modify: `src/lib/actions/invoices.ts:14-34` (`InvoiceFormData`), `:167-180` (`createInvoice` totals), `:476-525` (`createInvoiceFromReservation`)

**Interfaces:**
- Consumes: `cycleInvoice`, `toCycleLine`, `cycleTermsFor` (Task 1); `termEnd` (Task 2).
- Produces: `InvoiceFormData.taxAmount?: number` (when set, `createInvoice` uses it instead of taxing every line).

- [ ] **Step 1: Scope what the run loads** — in `runBillingCycle`'s `findMany`, replace `items: { include: { asset: true } }` with:

```ts
      // Only the quote option the client went ahead with bills.
      items: {
        where: { OR: [{ packageId: null }, { package: { isActive: true } }] },
        include: { asset: true },
      },
      packages: { where: { isActive: true }, select: { deliveryCost: true, returnCost: true } },
```

- [ ] **Step 2: Stop at the end of the term** — replace the `recurrenceEndDate` skip block with the following, and add `termEnd` / `intendedDay` imports:

```ts
    // Skip if recurrence end date has passed
    if (reservation.recurrenceEndDate && new Date(reservation.recurrenceEndDate) < now) {
      continue
    }
    // A committed term ends billing (owner, 2026-09-26). RTO counts installments instead.
    const termStop = reservation.reservationType !== 'RENT_TO_OWN' && reservation.termMonths
      ? termEnd(reservation.startDate, reservation.termMonths)
      : null
    if (termStop && reservation.nextBillingDate && intendedDay(reservation.nextBillingDate).getTime() >= termStop.getTime()) {
      await prisma.reservation.update({ where: { id: reservation.id }, data: { nextBillingDate: null } })
      continue
    }
```

- [ ] **Step 3: Price the stretch through `cycleInvoice`** — inside the transaction, after `anchoredNext` is computed, clip it to the term and count prior invoices:

```ts
        const stretchEnd = anchoredNext && termStop && anchoredNext.getTime() > termStop.getTime() ? termStop : anchoredNext
        const share = isAnchoredCycle(cycle) && stretchEnd
          ? billedPeriods(billingDate, stretchEnd, cycle, anchor)
          : 1
        const priorInvoices = await tx.invoice.count({
          where: { reservationId: reservation.id, status: { notIn: ['VOID', 'CANCELLED'] } },
        })
```

(Delete the old `const share = …` statement.) Then replace the non-RTO `else { invoiceItems = … }` branch, and the three `resTaxRate / taxAmount / total` lines, with:

```ts
        } else {
          const priced = cycleInvoice({
            lines: reservation.items.map(toCycleLine),
            share,
            first: priorInvoices === 0,
            terms: cycleTermsFor({
              ...reservation,
              deliveryCost: reservation.packages[0]?.deliveryCost ?? reservation.deliveryCost,
              returnCost: reservation.packages[0]?.returnCost ?? reservation.returnCost,
            }),
            shareNote: Math.abs(share - 1) < 0.0005 ? '' : ` × ${formatPeriodCount(share)}`,
          })
          invoiceItems = priced.items
          subtotal = priced.subtotal
          cycleTax = priced.taxAmount
        }

        const resTaxRate = Number(reservation.taxRate) || 0
        const taxAmount = cycleTax ?? roundMoney(subtotal * (resTaxRate / 100))
        const total = roundMoney(subtotal + taxAmount)
```

Declare `let cycleTax: number | null = null` beside `let subtotal = 0`. The RTO branch is unchanged, so `cycleTax` stays null and RTO tax is computed as before.

- [ ] **Step 4: Clip the invoice period and stop after the last stretch** — after `getBillingPeriod(...)`, clip `periodEnd`:

```ts
        const billedTo = termStop && periodEnd.getTime() >= termStop.getTime() ? addDays(termStop, -1) : periodEnd
```

Pass `periodEndDate: billedTo` to `tx.invoice.create`. When computing `resUpdate`, end the schedule once the term is billed:

```ts
          nextBillingDate: termStop && nextBilling && nextBilling.getTime() >= termStop.getTime() ? null : nextBilling,
```

(`addDays` from `date-fns` is already imported in this file and works on these dates.)

- [ ] **Step 5: `createInvoice` honours a computed tax** — add to `InvoiceFormData`:

```ts
  /** Tax already worked out (e.g. by cycleInvoice, which doesn't tax delivery); overrides subtotal × taxRate. */
  taxAmount?: number
```

and in `createInvoice` replace `const taxAmount = subtotal * (taxRate / 100)` with:

```ts
  const taxAmount = data.taxAmount ?? subtotal * (taxRate / 100)
```

- [ ] **Step 6: The manual first invoice** — in `createInvoiceFromReservation`:
  - Scope `items` in the `findUnique` include the same way as Step 1 (the `where` on items, plus `packages`).
  - Replace the `const items = reservation.items.map(...)` block and the `createInvoice({...})` call with a branch. When the order is a recurring RENTAL or CLOUD (`stretch` non-null, or `reservation.isRecurring && ['RENTAL', 'CLOUD'].includes(reservation.reservationType)`), use `cycleInvoice`:

```ts
  const effectiveTaxRate = taxRate ?? (Number(reservation.taxRate) || 0)
  const recurringRental = reservation.isRecurring && ['RENTAL', 'CLOUD'].includes(reservation.reservationType)
  if (recurringRental) {
    const priced = cycleInvoice({
      lines: reservation.items.map(toCycleLine),
      share: stretch?.periods ?? 1,
      first: priorInvoices === 0,
      terms: {
        ...cycleTermsFor({
          ...reservation,
          deliveryCost: reservation.packages[0]?.deliveryCost ?? reservation.deliveryCost,
          returnCost: reservation.packages[0]?.returnCost ?? reservation.returnCost,
        }),
        taxRate: effectiveTaxRate,
      },
      shareNote: stretchNote,
    })
    return createInvoice({
      clientId: reservation.clientId,
      reservationId: reservation.id,
      dueDate,
      taxRate: effectiveTaxRate,
      taxAmount: priced.taxAmount,
      items: priced.items.map((i) => ({ ...i, assetId: i.assetId || undefined })),
      ...(stretch ? { periodStartDate: stretch.start, periodEndDate: stretch.end } : {}),
      notes: reservation.projectName ? `Project: ${reservation.projectName}` : undefined,
    })
  }
```

  - Leave the existing code below it as the path for everything else (sale, one-time, RTO). The one-time "bills one period not the term" bug on the roadmap is **not** in scope; don't touch it here.

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "billing.ts|invoices.ts|cycle-invoice|payment-schedule" ; echo done`
Expected: only `done`.

- [ ] **Step 8: Prove it on a copy, never on the live v2 rows.** v2 data is expendable, but prove this without spending it: write `scripts/check-billing-run.ts`. It opens a Prisma transaction and, for every ACTIVE recurring RENTAL/CLOUD order, prints what `cycleInvoice` would bill next (lines, discount, tax, total) next to the old `Σ rate × qty × share` figure. It then **throws at the end to roll back** and writes nothing. Run `npx tsx scripts/check-billing-run.ts` and report:
  - how many orders change;
  - how many because of a discount;
  - how many because of included parts;
  - how many because of unchosen options;
  - how many because of one-time lines.

  Put those counts in the commit message. Don't run `runBillingCycle` itself.

- [ ] **Step 9: Commit**: "fix(billing): invoice what the quote says each month". Prose: the four faults (discount ignored, included parts billed, unchosen options billed, one-time lines billed monthly) plus no stop at the term; the counts from Step 8; the run is still not scheduled.

---

### Task 4: Show the payment line on the order, the quote PDF and the online quote

**Files:**
- Create: `src/lib/billing/order-payment-schedule.ts` (server loader)
- Modify: `src/components/orders/billing-card.tsx:208` (Billing card field)
- Modify: `src/components/documents/order-detail-pdf.tsx` (`OrderDetailData.paymentLine`)
- Modify: `src/components/documents/quote-pdf.tsx` (render after the totals block)
- Modify: `src/lib/actions/documents.ts:409-455` (signed quote data)
- Modify: `src/components/quote/quote-portal.tsx:53-83` (`QuoteData.paymentLine`) and `:253` (render)
- Modify: `src/lib/actions/quote-tokens.ts:337-370` (`buildQuote` return)

**Interfaces:**
- Consumes: `paymentSchedule`, `paymentLine`, `PaymentLine` (Task 2); `toCycleLine`, `cycleTermsFor` (Task 1); `getBillingAnchor` from `@/lib/settings/business`.
- Produces: `paymentLineForOrder(reservationId: string): Promise<PaymentLine | null>`

- [ ] **Step 1: Server loader**

```ts
// src/lib/billing/order-payment-schedule.ts
import 'server-only'
import { prisma } from '@/lib/prisma'
import { getBillingAnchor } from '@/lib/settings/business'
import { cycleTermsFor, toCycleLine } from './cycle-invoice'
import { paymentLine, paymentSchedule, type PaymentLine } from './payment-schedule'

/** The "Monthly payment …" line for an order, or null when it has none (sale, one-time, RTO, Flow). */
export async function paymentLineForOrder(reservationId: string): Promise<PaymentLine | null> {
  const order = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      items: { where: { OR: [{ packageId: null }, { package: { isActive: true } }] }, include: { asset: { select: { name: true } } } },
      packages: { where: { isActive: true }, select: { deliveryCost: true, returnCost: true } },
    },
  })
  if (!order) return null
  const schedule = paymentSchedule({
    type: order.reservationType,
    isRecurring: order.isRecurring,
    cycle: order.billingCycleType,
    start: order.startDate,
    termMonths: order.termMonths,
    anchor: await getBillingAnchor(),
    lines: order.items.map(toCycleLine),
    terms: cycleTermsFor({
      ...order,
      deliveryCost: order.packages[0]?.deliveryCost ?? order.deliveryCost,
      returnCost: order.packages[0]?.returnCost ?? order.returnCost,
    }),
  })
  return schedule ? paymentLine(schedule) : null
}
```

Check `server-only` is installed (`ls node_modules/server-only`). If it isn't, omit the import; don't add a dependency.

- [ ] **Step 2: Billing card** — in `OrderBillingCard`, after `const anchor = await getBillingAnchor();` add `const payment = await paymentLineForOrder(id);`, and directly after the `<Field label={deal.recurring ? "Per cycle" : "Order value"}>` element add:

```tsx
        {payment ? (
          <Field label="Payment">
            {payment.headline}
            {payment.notes.map((note) => (
              <span key={note} className="block text-micro text-ink-faint">{note}</span>
            ))}
          </Field>
        ) : null}
```

- [ ] **Step 3: Quote PDF** — add to `OrderDetailData` in `order-detail-pdf.tsx`:

```ts
  /** "Monthly payment: $X + tax = $Y × N months · Term total $Z", and first/final invoice notes. */
  paymentLine?: { headline: string; notes: string[] }
```

In `quote-pdf.tsx`, immediately after the RTO section closes (the `{rtoData && (…)}` block ending after the payment schedule table), add:

```tsx
          {data.paymentLine && (
            <View style={{ marginTop: 12, backgroundColor: '#f9fafb', padding: 10, borderRadius: 4 }} wrap={false}>
              <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#111827' }}>{data.paymentLine.headline}</Text>
              {data.paymentLine.notes.map((note, i) => (
                <Text key={i} style={{ fontSize: 8, color: '#6b7280', marginTop: 2 }}>{note}</Text>
              ))}
            </View>
          )}
```

- [ ] **Step 4: Signed quote data** — in `documents.ts`, before `const quoteData = {`, add `const payment = await paymentLineForOrder(reservation.id)`, and in `quoteData` add `paymentLine: payment ?? undefined,`.

- [ ] **Step 5: Online quote** — add `paymentLine: { headline: string; notes: string[] } | null;` to `QuoteData` in `quote-portal.tsx`. In `quote-tokens.ts` `buildQuote`, add `paymentLine: await paymentLineForOrder(reservation.id),` to the returned object. In `quote-portal.tsx`, directly after `<Totals quote={quote} shown={shown} />` add:

```tsx
      {quote.paymentLine ? (
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold">{quote.paymentLine.headline}</p>
          {quote.paymentLine.notes.map((note) => (
            <p key={note} className="mt-1 text-xs text-[#71717a]">{note}</p>
          ))}
        </section>
      ) : null}
```

When a monthly rental shows the payment line, leave `CYCLE_TERM` alone. The line replaces nothing; "Billed monthly for the duration." still describes the cycle.

- [ ] **Step 6: Type-check, smoke, look**

Run: `npx tsc --noEmit 2>&1 | grep -E "billing-card|order-detail-pdf|quote-pdf|documents.ts|quote-portal|quote-tokens|order-payment-schedule" ; echo done` → only `done`.
Run: `npx tsx scripts/smoke-routes.ts` → no new broken routes.
Pick an ACTIVE monthly rental with a term and one without (`select "reservationNumber","termMonths" from reservations where status='ACTIVE' and "reservationType"='RENTAL' and "billingCycleType"='MONTHLY' limit 5`). Check that the Billing card, the Quote PDF and `/quote/preview/<id>` show the same headline, and that the no-term one says "until cancelled".

- [ ] **Step 7: Commit**: "feat(orders): show the monthly payment on the order and its quotes". Prose: v1 a0cd5ff recreated on v2's rules; no flag; same figures the billing run now invoices.
