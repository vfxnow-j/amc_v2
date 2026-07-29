/**
 * Groups reservation items for printable documents.
 *
 * A "breakdown" child is a component row that exists only as a descriptive
 * sub-line (rate = 0): it should not appear as its own table row. Instead
 * each printable renders the parent row plus an indented list of breakdown
 * descriptions underneath.
 *
 * Non-zero components (e.g. a real rental camera body + lens) remain as their
 * own rows.
 */
export type RowItem = {
  isComponent?: boolean
  rate: number | { toString(): string }
  description: string
}

export type GroupedRow<T extends RowItem> = {
  item: T
  breakdown: T[]
}

function toNumber(v: number | { toString(): string }): number {
  if (typeof v === 'number') return v
  return Number(v.toString()) || 0
}

export function groupRowsWithBreakdown<T extends RowItem>(items: T[]): GroupedRow<T>[] {
  const out: GroupedRow<T>[] = []
  for (const it of items) {
    if (it.isComponent && toNumber(it.rate) === 0 && out.length > 0) {
      out[out.length - 1].breakdown.push(it)
    } else {
      out.push({ item: it, breakdown: [] })
    }
  }
  return out
}
