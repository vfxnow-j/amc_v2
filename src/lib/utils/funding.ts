/**
 * ROI markers for an equipment funding request.
 *
 * These are the numbers accounting actually decides on: what the hardware
 * costs all-in (including the cost of the money), whether the customer's
 * rental charge covers the loan payment, and how long until the hardware has
 * paid for itself — on rentals alone, and counting the resale at the end of
 * the hold. The return is stated in months to break even rather than a
 * percentage, which swings wildly on the estimated hold period.
 *
 * Every input is optional — a request in progress is usually half-filled — so
 * each marker returns null rather than a misleading zero when the numbers it
 * needs aren't there yet.
 */

export type FundingMetricsInput = {
  totalEquipmentCost?: number | null
  amountRequested?: number | null
  amountBorrowed?: number | null
  financingFees?: number | null
  estimatedTotalInterest?: number | null
  monthlyPayment?: number | null
  /** Monthly rate billed per unit. */
  customerRentalRate?: number | null
  /** How many units bill at that rate. */
  billableUnits?: number | null
  /**
   * Total monthly charge. Derived from rate x units when both are given; used
   * directly for older requests and deals with no clean per-unit rate.
   */
  customerRentalCharge?: number | null
  expectedInitialRevenue?: number | null
  expectedGrossProfit?: number | null
  expectedAnnualRevenue?: number | null
  estimatedResaleValue?: number | null
  estimatedPaybackMonths?: number | null
  expectedHoldMonths?: number | null
}

export type FundingMetrics = {
  /** Hardware cost. Falls back to the amount requested when no itemised cost is entered. */
  hardwareCost: number
  /** Origination/other fees plus estimated total interest — the cost of the money. */
  financingCost: number
  /** Hardware + financing. The number the deal has to earn back. */
  allInCost: number
  /** Total monthly billing: rate x units, or the entered total. */
  monthlyRentalCharge: number | null
  /** Customer monthly charge ÷ loan monthly payment. >1 means the rental services the debt. */
  debtServiceCoverage: number | null
  /** Months of rental billing to repay the all-in cost. */
  paybackMonths: number | null
  /** Payback as entered on the request, when it differs from the computed figure. */
  statedPaybackMonths: number | null
  /**
   * Month the deal is whole counting the resale, which lands at the end of the
   * hold. Equals `paybackMonths` when the rentals get there first; null when
   * rentals plus resale never cover the cost.
   */
  breakEvenMonths: number | null
  /** True when neither rentals nor resale ever cover the all-in cost. */
  neverBreaksEven: boolean
  /** Rental billings across the whole hold period, plus the resale value. */
  projectedRevenue: number | null
  /** Projected revenue less all-in cost. */
  projectedNet: number | null
  /** Gross profit on the initial rental as a percentage of its revenue. */
  initialMarginPercent: number | null
}

const num = (v: number | null | undefined): number | null =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v)

const round2 = (v: number) => Math.round(v * 100) / 100

export function computeFundingMetrics(input: FundingMetricsInput): FundingMetrics {
  const equipment = num(input.totalEquipmentCost)
  const requested = num(input.amountRequested)
  // An early request often has only the ask filled in; use it until the
  // equipment list is priced out.
  const hardwareCost = equipment && equipment > 0 ? equipment : requested ?? 0

  const fees = num(input.financingFees) ?? 0
  const interest = num(input.estimatedTotalInterest) ?? 0
  const financingCost = fees + interest
  const allInCost = hardwareCost + financingCost

  const monthlyPayment = num(input.monthlyPayment)

  // Rentals are billed as a per-unit rate across a unit count; the stored
  // total is the fallback for requests entered before that split.
  const rentalRate = num(input.customerRentalRate)
  const units = num(input.billableUnits)
  const derivedCharge =
    rentalRate !== null && rentalRate > 0 && units !== null && units > 0
      ? round2(rentalRate * units)
      : null
  const rentalCharge = derivedCharge ?? num(input.customerRentalCharge)

  const debtServiceCoverage =
    monthlyPayment && monthlyPayment > 0 && rentalCharge !== null
      ? round2(rentalCharge / monthlyPayment)
      : null

  const paybackMonths =
    rentalCharge && rentalCharge > 0 && allInCost > 0
      ? Math.ceil(allInCost / rentalCharge)
      : null

  const initialRevenue = num(input.expectedInitialRevenue)
  const annualRevenue = num(input.expectedAnnualRevenue)
  const resale = num(input.estimatedResaleValue)
  const holdMonths = num(input.expectedHoldMonths)

  // Hold-period revenue = rental billings across the whole hold, plus what the
  // hardware resells for at the end. An unstated hold is treated as a year.
  //
  // The ongoing annual figure wins when it's entered, since it can account for
  // utilisation the raw rate card doesn't; otherwise the monthly billing runs
  // for the hold. Either way it covers every month of the hold, the first year
  // included. (An earlier version charged year one to `expectedInitialRevenue`
  // and counted only `holdYears - 1` of ongoing revenue, which silently
  // dropped a full year of billings whenever the initial figure was blank.)
  // The initial rental is the last resort, and is never added on top of the
  // others — that would double-count the same months.
  const effectiveHoldMonths = holdMonths && holdMonths > 0 ? holdMonths : 12
  let projectedRevenue: number | null = null
  if (initialRevenue !== null || annualRevenue !== null || resale !== null || rentalCharge !== null) {
    let rentalRevenue: number
    if (annualRevenue !== null) {
      rentalRevenue = annualRevenue * (effectiveHoldMonths / 12)
    } else if (rentalCharge !== null) {
      rentalRevenue = rentalCharge * effectiveHoldMonths
    } else {
      rentalRevenue = initialRevenue ?? 0
    }
    projectedRevenue = round2(rentalRevenue + (resale ?? 0))
  }

  const projectedNet = projectedRevenue !== null ? round2(projectedRevenue - allInCost) : null

  // Break-even counts the resale, but the resale only lands when the hardware
  // is sold at the end of the hold — so it can only pull break-even in as far
  // as the hold itself, never earlier.
  let breakEvenMonths: number | null = paybackMonths
  let neverBreaksEven = false
  if (allInCost > 0) {
    const hold = holdMonths && holdMonths > 0 ? Math.ceil(holdMonths) : null
    const rentalsByHold = hold !== null ? (rentalCharge ?? 0) * hold : null
    const coveredAtHold =
      hold !== null && rentalsByHold !== null && rentalsByHold + (resale ?? 0) >= allInCost

    if (paybackMonths !== null && hold !== null) {
      // Rentals alone repay it, but selling at the end of the hold may get
      // there sooner.
      breakEvenMonths = coveredAtHold ? Math.min(paybackMonths, hold) : paybackMonths
    } else if (paybackMonths === null && coveredAtHold) {
      breakEvenMonths = hold
    }

    // Rentals never repay it and either there's no hold to sell at or the
    // resale doesn't close the gap. A request with no revenue plan entered
    // yet is simply unanswered, not a loss — hence the projection check.
    neverBreaksEven =
      breakEvenMonths === null && projectedRevenue !== null && projectedRevenue < allInCost
  }

  const grossProfit = num(input.expectedGrossProfit)
  const initialMarginPercent =
    grossProfit !== null && initialRevenue && initialRevenue > 0
      ? round2((grossProfit / initialRevenue) * 100)
      : null

  return {
    hardwareCost: round2(hardwareCost),
    financingCost: round2(financingCost),
    allInCost: round2(allInCost),
    monthlyRentalCharge: rentalCharge,
    debtServiceCoverage,
    paybackMonths,
    statedPaybackMonths: num(input.estimatedPaybackMonths),
    breakEvenMonths,
    neverBreaksEven,
    projectedRevenue,
    projectedNet,
    initialMarginPercent,
  }
}
