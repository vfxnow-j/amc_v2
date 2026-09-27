/**
 * Portal offers: the curated, opt-in catalog (owner, 2026-09-26). Nothing shows
 * until staff publish an offer (isVisible); only offers also marked isPublic reach
 * the public price ranges.
 *
 * Loading reads the offer and its target through `select` allowlists. The target's
 * landed-cost basis is read (loadFlowBases) only to price Flow — it never leaves
 * this module except inside a quote snapshot, and never reaches a DTO. Lease
 * funding is never loaded.
 *
 * Server-only (takes a Prisma client), NOT a 'use server' module.
 */
import type { Prisma, PrismaClient } from '@/generated/prisma/client'
import { loadFlowBases } from '@/lib/flow/load-bases'
import type { FlowPricingDefaults } from '@/lib/flow/defaults'
import { publicRange } from './price-ranges'
import { allowedSolutions, allowedTerms, priceQuote, type OfferComponent, type OfferPricing, type QuoteRequestLine } from './quote'
import { PORTAL_SOLUTIONS, type CreditTier, type PortalSolution } from './tiers'

type Db = Pick<PrismaClient, 'portalOffer' | 'assetUnit'>

export const OFFER_KINDS = ['ASSET', 'PACKAGE', 'POOL'] as const

const RATE_SELECT = { dailyRate: true, weeklyRate: true, monthlyRate: true, salePrice: true } as const

export const OFFER_SELECT = {
  id: true,
  images: {
    orderBy: { sortOrder: 'asc' },
    select: { id: true, version: true, alt: true, width: true, height: true },
  },
  slug: true,
  kind: true,
  title: true,
  blurb: true,
  solutions: true,
  termsBySolution: true,
  software: true,
  specs: true,
  isPublic: true,
  isVisible: true,
  sortOrder: true,
  assetId: true,
  asset: {
    select: {
      id: true,
      name: true,
      manufacturer: true,
      model: true,
      retiredAt: true,
      category: { select: { id: true, name: true } },
      ...RATE_SELECT,
    },
  },
  packageTemplate: {
    select: {
      id: true,
      name: true,
      isActive: true,
      items: {
        orderBy: { sortOrder: 'asc' as const },
        select: {
          assetId: true,
          serviceId: true,
          description: true,
          quantity: true,
          rate: true,
          pricingType: true,
          isOneTime: true,
          asset: { select: { name: true, category: { select: { id: true, name: true } }, ...RATE_SELECT } },
          service: { select: { name: true, defaultRate: true } },
        },
      },
    },
  },
  pool: { select: { slug: true, name: true, unitLabel: true } },
} as const

type OfferRow = Awaited<ReturnType<typeof loadOfferRows>>[number]

export type OfferFilters = { solution?: string | null; category?: string | null; software?: string | null }

async function loadOfferRows(db: Db, where: Prisma.PortalOfferWhereInput) {
  return db.portalOffer.findMany({ where, select: OFFER_SELECT, orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }] })
}

/** The offer's category: the asset's, or a package's when all its gear shares one. */
function offerCategory(row: OfferRow): { id: string; name: string } | null {
  if (row.asset?.category) return row.asset.category
  const cats = new Map<string, { id: string; name: string }>()
  for (const i of row.packageTemplate?.items ?? []) if (i.asset?.category) cats.set(i.asset.category.id, i.asset.category)
  return cats.size === 1 ? [...cats.values()][0] : null
}

function termsBySolution(v: unknown): Partial<Record<string, number[]>> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const out: Partial<Record<string, number[]>> = {}
  for (const [k, list] of Object.entries(v as Record<string, unknown>)) {
    if (Array.isArray(list)) out[k] = list.filter((t): t is number => typeof t === 'number' && Number.isInteger(t))
  }
  return out
}

export type TemplateItemRow = NonNullable<OfferRow['packageTemplate']>['items'][number]

/** A package template's lines as quote components, priced as loadTemplateIntoOrder adds them. */
export function packageComponents(items: TemplateItemRow[], bases: Record<string, { basis: number; incomplete: boolean }>): OfferComponent[] {
  return items.map((i) => {
    const b = i.assetId ? bases[i.assetId] : undefined
    return {
      assetId: i.assetId,
      name: i.description || i.asset?.name || i.service?.name || 'Item',
      quantity: Math.max(1, i.quantity),
      assetRates: i.asset ? { dailyRate: i.asset.dailyRate, weeklyRate: i.asset.weeklyRate, monthlyRate: i.asset.monthlyRate } : null,
      salePrice: i.asset?.salePrice ?? null,
      overrideRate: i.rate == null ? null : Number(i.rate),
      overridePricingType: i.pricingType,
      isOneTime: i.isOneTime,
      flowBasis: b ? { basis: b.basis, incomplete: b.incomplete } : null,
      // Priced as loadTemplateIntoOrder would add the line (quote.ts resolveComponent).
      templateLine: true,
      serviceId: i.serviceId,
      serviceDefaultRate: i.service ? Number(i.service.defaultRate) : null,
    }
  })
}

/** Turn loaded rows into the quote core's input, reading Flow bases for their assets. */
async function toPricing(db: Db, rows: OfferRow[], asOf: Date): Promise<Map<string, OfferPricing>> {
  const assetIds = new Set<string>()
  for (const r of rows) {
    if (r.asset) assetIds.add(r.asset.id)
    for (const i of r.packageTemplate?.items ?? []) if (i.assetId) assetIds.add(i.assetId)
  }
  const needsFlow = rows.some((r) => r.solutions.includes('flow'))
  const bases = needsFlow ? await loadFlowBases(db, [...assetIds], asOf) : {}

  const map = new Map<string, OfferPricing>()
  for (const r of rows) {
    let components: OfferComponent[] = []
    let live = r.isVisible
    if (r.kind === 'ASSET' && r.asset) {
      if (r.asset.retiredAt) live = false
      const b = bases[r.asset.id]
      components = [{
        assetId: r.asset.id,
        name: r.asset.name,
        quantity: 1,
        assetRates: { dailyRate: r.asset.dailyRate, weeklyRate: r.asset.weeklyRate, monthlyRate: r.asset.monthlyRate },
        salePrice: r.asset.salePrice,
        overrideRate: null,
        overridePricingType: null,
        isOneTime: false,
        flowBasis: b ? { basis: b.basis, incomplete: b.incomplete } : null,
      }]
    } else if (r.kind === 'PACKAGE' && r.packageTemplate) {
      if (!r.packageTemplate.isActive) live = false
      components = packageComponents(r.packageTemplate.items, bases)
    }
    map.set(r.id, { id: r.id, visible: live, solutions: r.solutions, termsBySolution: termsBySolution(r.termsBySolution), components })
  }
  return map
}

export type OfferPart = { assetId: string; quantity: number }

/** The physical assets behind one offer, per offer unit. Empty = nothing to count stock of. */
export function offerParts(r: OfferRow): OfferPart[] {
  if (r.asset) return [{ assetId: r.asset.id, quantity: 1 }]
  if (r.packageTemplate) {
    return r.packageTemplate.items.filter((i) => i.assetId).map((i) => ({ assetId: i.assetId!, quantity: Math.max(1, i.quantity) }))
  }
  return []
}

/** The offers a quote names, for pricing. Unknown ids are simply absent (offer_not_visible). */
export async function loadOfferPricing(db: Db, offerIds: string[], asOf: Date = new Date()): Promise<{ pricing: Map<string, OfferPricing>; assetsByOffer: Map<string, OfferPart[]> }> {
  const rows = await loadOfferRows(db, { id: { in: [...new Set(offerIds)] } })
  const assetsByOffer = new Map<string, OfferPart[]>()
  for (const r of rows) if (r.asset || r.packageTemplate) assetsByOffer.set(r.id, offerParts(r))
  return { pricing: await toPricing(db, rows, asOf), assetsByOffer }
}

export type RangeContext = { tier: CreditTier; flowDefaults: FlowPricingDefaults; today: Date }

export type OfferRangeDto = { solution: PortalSolution; term_months: number[] | null; per: 'month' | 'one_time'; currency: 'USD'; low: number; high: number }

/**
 * Price bands per solution at the default tier, from the same quote core the
 * quote endpoint uses: one unit, a one-month rental window, every allowed term.
 * A band is never an exact price (publicRange). RTO never has a band: it is not a
 * quotable solution (tiers.ts QUOTABLE_SOLUTIONS).
 */
export function offerRanges(offer: OfferPricing, ctx: RangeContext): OfferRangeDto[] {
  const start = new Date(Date.UTC(ctx.today.getUTCFullYear(), ctx.today.getUTCMonth(), ctx.today.getUTCDate(), 12))
  const end = new Date(start)
  end.setUTCMonth(end.getUTCMonth() + 1)
  end.setUTCDate(end.getUTCDate() - 1)
  const out: OfferRangeDto[] = []
  for (const solution of allowedSolutions(offer, ctx.tier)) {
    const terms = solution === 'rental' || solution === 'sale' ? [null] : allowedTerms(offer, ctx.tier, solution)
    const req: QuoteRequestLine[] = terms.map((term) => ({ offerId: offer.id, qty: 1, solution, term }))
    if (!req.length) continue
    const q = priceQuote(req, {
      offers: new Map([[offer.id, offer]]),
      tier: ctx.tier,
      // Bands describe price, not eligibility: verification does not hide them.
      verificationLevel: 'agreement_and_coi',
      flowDefaults: ctx.flowDefaults,
      window: { start, end },
      // Bands describe price, not stock: capacity never hides them.
      capacity: () => ({ available: Number.POSITIVE_INFINITY, demand: 'normal' }),
    })
    const range = publicRange(q.lines.map((l) => l.unit_price ?? 0))
    if (!range) continue
    out.push({
      solution,
      term_months: solution === 'flow' ? (terms.filter((t, i) => q.lines[i].unit_price != null) as number[]) : null,
      // A sale band is the one-time price per unit; the rest are per month.
      per: solution === 'sale' ? 'one_time' : 'month',
      currency: 'USD',
      ...range,
    })
  }
  return out
}

/** Curated specs as ordered key/value pairs, strings only. */
export function specsDto(v: unknown): { key: string; value: string }[] {
  if (Array.isArray(v)) {
    return v
      .filter((r): r is { key: unknown; value: unknown } => !!r && typeof r === 'object')
      .map((r) => ({ key: String(r.key ?? '').trim(), value: String(r.value ?? '').trim() }))
      .filter((r) => r.key)
  }
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>).map(([key, value]) => ({ key, value: String(value ?? '') }))
  }
  return []
}

export type OfferDto = {
  id: string
  slug: string
  kind: string
  title: string
  blurb: string | null
  category: { id: string; name: string } | null
  product: { name: string; manufacturer: string | null; model: string | null } | null
  items: { name: string; quantity: number }[]
  pool: { slug: string; name: string; unit_label: string } | null
  specs: { key: string; value: string }[]
  software: string[]
  solutions: { solution: PortalSolution; term_months: number[] | null }[]
  price_ranges: OfferRangeDto[]
  /** In display order. Fetch GET /v1/images/{id}?v={version}; (id, version) never changes content. */
  images: { id: string; version: string; alt: string | null; width: number; height: number }[]
}

/** The client's view of an offer. Explicit fields only: no rate, cost or basis. */
export function offerDto(row: OfferRow, pricing: OfferPricing, ctx: RangeContext): OfferDto {
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    title: row.title,
    blurb: row.blurb ?? null,
    category: offerCategory(row),
    product: row.asset ? { name: row.asset.name, manufacturer: row.asset.manufacturer ?? null, model: row.asset.model ?? null } : null,
    items: (row.packageTemplate?.items ?? []).map((i) => ({
      name: i.description || i.asset?.name || i.service?.name || 'Item',
      quantity: Math.max(1, i.quantity),
    })),
    pool: row.pool ? { slug: row.pool.slug, name: row.pool.name, unit_label: row.pool.unitLabel } : null,
    specs: specsDto(row.specs),
    software: row.software,
    solutions: allowedSolutions(pricing, ctx.tier).map((solution) => ({
      solution,
      term_months: solution === 'rental' || solution === 'sale' ? null : allowedTerms(pricing, ctx.tier, solution),
    })),
    price_ranges: offerRanges(pricing, ctx),
    images: row.images.map((i) => ({ id: i.id, version: i.version, alt: i.alt, width: i.width, height: i.height })),
  }
}

const norm = (s: string) => s.trim().toLowerCase()

/** Validate the catalog filters from a query string. Unknown solution → error message. */
export function parseOfferFilters(params: URLSearchParams): { ok: true; value: OfferFilters } | { ok: false; message: string } {
  const pick = (k: string) => {
    const v = params.get(k)
    return v && v.trim() ? v.trim().slice(0, 80) : null
  }
  const solution = pick('solution')
  if (solution && !(PORTAL_SOLUTIONS as readonly string[]).includes(solution)) {
    return { ok: false, message: `solution must be one of ${PORTAL_SOLUTIONS.join(', ')}.` }
  }
  return { ok: true, value: { solution, category: pick('category'), software: pick('software') } }
}

/** Published offers, filtered, as DTOs. `publicOnly` narrows to isPublic ones. */
export async function listOffers(db: Db, filters: OfferFilters, ctx: RangeContext, publicOnly = false): Promise<OfferDto[]> {
  return (await listOfferEntries(db, filters, ctx, publicOnly)).map((e) => e.dto)
}

/** listOffers, keeping each offer's physical parts beside its DTO (for availability). */
export async function listOfferEntries(
  db: Db,
  filters: OfferFilters,
  ctx: RangeContext,
  publicOnly = false,
): Promise<{ dto: OfferDto; parts: OfferPart[] }[]> {
  const rows = await loadOfferRows(db, { isVisible: true, ...(publicOnly ? { isPublic: true } : {}) })
  const pricing = await toPricing(db, rows, ctx.today)
  const out: { dto: OfferDto; parts: OfferPart[] }[] = []
  for (const row of rows) {
    const p = pricing.get(row.id)!
    if (!p.visible) continue
    if (filters.software && !row.software.some((s) => norm(s) === norm(filters.software!))) continue
    if (filters.category) {
      const cat = offerCategory(row)
      if (!cat || (cat.id !== filters.category && norm(cat.name) !== norm(filters.category))) continue
    }
    const dto = offerDto(row, p, ctx)
    if (filters.solution && !dto.solutions.some((s) => s.solution === filters.solution)) continue
    out.push({ dto, parts: offerParts(row) })
  }
  return out
}

/** GET /public/price-ranges: public offers' bands only — no specs, no exact figure. */
export async function listPublicRanges(db: Db, ctx: RangeContext) {
  const offers = await listOffers(db, {}, ctx, true)
  return offers.map((o) => ({ offer_id: o.id, slug: o.slug, title: o.title, category: o.category, price_ranges: o.price_ranges }))
}
