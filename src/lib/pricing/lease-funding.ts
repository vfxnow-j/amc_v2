/**
 * What the gear on a Flow order still owes on its lease (owner, 2026-09-26):
 * "if there's hardware on a capital lease we pay, we'd need to have that
 * somewhat broken out on cost for the hardware, then place the deal against it."
 *
 * v1 designed this and never wired it — every v1 Flow order prices as owned stock.
 *
 * - A lease's balance is the present value of the payments still to come. It needs
 *   only the payment, rate, start and term. `totalAmount` is NOT used: on some
 *   leases it is the principal, on others the sum of payments.
 * - A lease's balance and payment are split across the units it financed that we
 *   still hold, in proportion to what each cost. Sold units drop out, so the debt
 *   sits on the fleet that can go on a deal.
 * - A lease with no terms recorded (a $0 payment — 15 of 20 on 2026-09-26) is
 *   priced as a note on the unit's cost from the lease start, on an assumed rate
 *   and length, and marked `assumed` so every surface labels it.
 *
 * Economics only: the client's price never reads any of this. Pure.
 */
import { payment } from './flow'

export type LeaseTerms = {
  id: string
  label: string
  status: string
  monthlyPayment: number
  /** Percent, e.g. 5.55. Lease.interestRate is stored as a fraction — multiply by 100. */
  aprPct: number
  startDate: Date
  termMonths: number
}

export type Assumption = { aprPct: number; noteMonths: number }
export const FLOW_LEASE_ASSUMPTION: Assumption = { aprPct: 8, noteMonths: 60 }

export type LeaseBalance = { balance: number; payment: number; monthsLeft: number; aprPct: number; assumed: boolean }

const round2 = (n: number) => Math.round(n * 100) / 100

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate()

/**
 * Payments made by `asOf`: payments are in arrears, and the k-th payment falls
 * on the start's day-of-month, k months later, clamped to the last day of that
 * month (a Jan 31 start pays on Feb 28, not "no payment until March"). Compared
 * by calendar Y/M/D in UTC — dates in this app are stored at noon UTC.
 */
function paymentsMade(start: Date, asOf: Date): number {
  const months = (asOf.getUTCFullYear() - start.getUTCFullYear()) * 12 + (asOf.getUTCMonth() - start.getUTCMonth())
  // `months` lands asOf's payment in the same year/month as asOf, so the
  // clamped due-day for that payment uses asOf's month length, not start's.
  const dueDay = Math.min(start.getUTCDate(), daysInMonth(asOf.getUTCFullYear(), asOf.getUTCMonth()))
  return Math.max(0, months - (asOf.getUTCDate() < dueDay ? 1 : 0))
}

/**
 * Split `totalCents` across `shares` (fractions summing to ~1) so the parts
 * always sum to exactly `totalCents` and none go negative: floor each share's
 * exact cents, then hand the leftover cents one each to the largest fractional
 * remainders (ties broken by original order).
 */
function allocateCents(totalCents: number, shares: number[]): number[] {
  const exact = shares.map((s) => s * totalCents)
  const floors = exact.map(Math.floor)
  const allocated = floors.reduce((a, b) => a + b, 0)
  const remainder = Math.max(0, Math.round(totalCents - allocated))
  const order = exact
    .map((e, i) => ({ i, frac: e - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let k = 0; k < remainder && k < order.length; k++) floors[order[k].i] += 1
  return floors
}

function presentValue(pmt: number, aprPct: number, months: number): number {
  if (months <= 0 || pmt <= 0) return 0
  const r = aprPct / 100 / 12
  return r > 0 ? (pmt * (1 - Math.pow(1 + r, -months))) / r : pmt * months
}

export function leaseBalance(l: LeaseTerms, asOf: Date, assume: Assumption, assumedPrincipal: number): LeaseBalance {
  // LeaseStatus (schema): ACTIVE, PAID_OFF, DEFAULTED, TRANSFERRED — every status
  // other than PAID_OFF is amortized from its terms below.
  if (l.status === 'PAID_OFF') return { balance: 0, payment: 0, monthsLeft: 0, aprPct: l.aprPct, assumed: false }
  const made = paymentsMade(l.startDate, asOf)
  if (l.monthlyPayment > 0) {
    const monthsLeft = Math.max(0, l.termMonths - made)
    return { balance: round2(presentValue(l.monthlyPayment, l.aprPct, monthsLeft)), payment: monthsLeft > 0 ? l.monthlyPayment : 0, monthsLeft, aprPct: l.aprPct, assumed: false }
  }
  // No terms on record: a note on the unit cost from the lease start, on the assumption.
  const monthsLeft = Math.max(0, assume.noteMonths - made)
  const pmt = assumedPrincipal > 0 ? payment(assumedPrincipal, assume.aprPct, assume.noteMonths) : 0
  return { balance: round2(presentValue(pmt, assume.aprPct, monthsLeft)), payment: monthsLeft > 0 ? round2(pmt) : 0, monthsLeft, aprPct: assume.aprPct, assumed: true }
}

export type HeldUnit = { unitId: string; assetId: string; leaseId: string | null; cost: number }

export type UnitFunding = {
  unitId: string
  leaseId: string
  leaseLabel: string
  /** This unit's fraction of its lease. */
  share: number
  balance: number
  payment: number
  monthsLeft: number
  aprPct: number
  assumed: boolean
}

/** Each held unit's part of its lease. Units with no lease are absent: owned outright. */
export function unitFunding(leases: LeaseTerms[], held: HeldUnit[], asOf: Date, assume: Assumption): Map<string, UnitFunding> {
  const out = new Map<string, UnitFunding>()
  for (const lease of leases) {
    const units = held.filter((u) => u.leaseId === lease.id)
    if (units.length === 0) continue
    const totalCost = units.reduce((s, u) => s + Math.max(0, u.cost), 0)
    // A terms-missing lease is assumed per unit (each is its own note on its own
    // cost); a lease with terms is one note split by cost.
    const whole = lease.monthlyPayment > 0 ? leaseBalance(lease, asOf, assume, 0) : null
    const shares = units.map((u) => (totalCost > 0 ? Math.max(0, u.cost) / totalCost : 1 / units.length))
    // Largest-remainder split in cents: shares always sum to the lease figure
    // exactly, and no unit's share is ever negative or off by more than a cent.
    const balanceCents = whole ? allocateCents(Math.round(whole.balance * 100), shares) : []
    const paymentCents = whole ? allocateCents(Math.round(whole.payment * 100), shares) : []
    units.forEach((u, i) => {
      const share = shares[i]
      if (whole) {
        const balance = balanceCents[i] / 100
        const pmt = paymentCents[i] / 100
        out.set(u.unitId, { unitId: u.unitId, leaseId: lease.id, leaseLabel: lease.label, share, balance, payment: pmt, monthsLeft: whole.monthsLeft, aprPct: whole.aprPct, assumed: false })
      } else {
        const b = leaseBalance(lease, asOf, assume, Math.max(0, u.cost))
        out.set(u.unitId, { unitId: u.unitId, leaseId: lease.id, leaseLabel: lease.label, share, ...b })
      }
    })
  }
  return out
}
