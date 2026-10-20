/**
 * Match percentages for proposed changes. A score is how likely the Current value is the right
 * one for THIS AMC unit — identity (is it the same unit?) × field (is the value right for it?).
 * These are judgement weights, not statistics; they only order proposals for review.
 */
import type { LinkFlags, LinkKind } from './link'

export type Identity = 'barcode' | 'normalized barcode' | 'serial'

export function identityScore(method: Identity, barcodesDisagree: boolean): number {
  if (method === 'barcode') return 100
  if (method === 'normalized barcode') return 95
  return barcodesDisagree ? 70 : 90
}

const LINK_BASE: Record<LinkKind, number> = {
  po_number: 95, // PO # typed on the Current stock item
  serialised_product: 90, // PO line is that exact Current product
  name_match: 80, // one AMC asset name fits the PO line
  build_complete: 75, // full CPU/board/RAM/case/PSU build, one PO
  build_partial: 55, // CPU-only or missing core parts
  name_ambiguous: 50, // line fits several AMC assets
}

/** How far to trust a PO link for this unit. */
export function linkScore(kind: LinkKind, flags: LinkFlags): number {
  let s = LINK_BASE[kind]
  if (flags.countMismatch) s -= 10 // fewer/more units in window than ordered
  if (flags.rivals) s -= 10 // another PO fits the same unit
  if (flags.mixedModels) s -= 5 // parts split across CPU models by count
  return Math.max(5, s)
}

export type DateSource = 'po' | 'opening'

/**
 * Proposed purchase date. `agrees` = already within ±3 days (no change).
 * `amcIsInStockDate` = AMC matches Current's opening-balance date, so AMC's own date is plausible too.
 */
export function dateScore(i: { agrees: boolean; source: DateSource; link: number | null; bulkDay: boolean; amcIsStamp: boolean; amcIsInStockDate: boolean }): number {
  if (i.agrees) return 100
  if (i.source === 'po') {
    const s = i.link ?? 50
    if (i.amcIsStamp) return s
    return Math.max(5, s - (i.amcIsInStockDate ? 10 : 15))
  }
  if (i.bulkDay) return 40 // bulk data-entry day, probably not the purchase date
  if (i.amcIsStamp) return 85 // AMC holds an import stamp; Current's date is the only real one
  return 50 // two real-looking dates disagree
}

/** Proposed purchase cost. */
export function costScore(i: { agrees: boolean; amcBlank: boolean; link: number; amcIsEstimate: boolean }): number {
  if (i.agrees) return 100
  if (i.amcBlank) return i.link
  // Replacing an existing figure needs more: an estimate is easier to displace than an entered cost.
  return Math.max(5, i.link - (i.amcIsEstimate ? 5 : 20))
}

export const combined = (identity: number, field: number) => Math.round((identity * field) / 100)

export type Band = 'high' | 'medium' | 'low'
export const band = (pct: number): Band => (pct >= 85 ? 'high' : pct >= 65 ? 'medium' : 'low')
