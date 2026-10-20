import { monthKey, monthStart, type MonthKey } from './schedule'

/** The slices of the forecast the export can be cut to. */
export const PERIODS = ['month', 'next-month', 'quarter', 'next-quarter', 'year', '12m'] as const
export type ExportPeriod = (typeof PERIODS)[number]

export const PERIOD_LABEL: Record<ExportPeriod, string> = {
  month: 'This month',
  'next-month': 'Next month',
  quarter: 'This quarter',
  'next-quarter': 'Next quarter',
  year: 'This calendar year',
  '12m': 'Next 12 months',
}

export function parsePeriod(value: string | null | undefined): ExportPeriod {
  return (PERIODS as readonly string[]).includes(value ?? '') ? (value as ExportPeriod) : '12m'
}

/**
 * The month keys a period covers, whole calendar months. `today` is any day in
 * the current month. A quarter is a calendar quarter and the year a calendar
 * year, so a part-gone period still names its past months — the export marks
 * those as earned history (or "not recorded") rather than forecast.
 */
export function periodMonths(period: ExportPeriod, today: Date): MonthKey[] {
  const thisMonth = monthStart(today)
  const month0 = Number(monthKey(thisMonth).slice(5)) - 1
  const run = (first: Date, count: number) => Array.from({ length: count }, (_, i) => monthKey(monthStart(first, i)))
  switch (period) {
    case 'month':
      return run(thisMonth, 1)
    case 'next-month':
      return run(monthStart(thisMonth, 1), 1)
    case 'quarter':
      return run(monthStart(thisMonth, -(month0 % 3)), 3)
    case 'next-quarter':
      return run(monthStart(thisMonth, 3 - (month0 % 3)), 3)
    case 'year':
      return run(monthStart(thisMonth, -month0), 12)
    case '12m':
      return run(thisMonth, 12)
  }
}
