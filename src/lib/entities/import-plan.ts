/** Pure steps between a parsed file and the ledger: resolve location text, build plans, word the preview. */
import type { ImportGroup } from '@/lib/entities/csv'
import type { ImportItemPlan, ImportSummary } from '@/lib/entities/ledger'

export type LocationOption = { id: string; name: string; path: string }

const norm = (s: string) => s.trim().replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ').toLowerCase()

/** Matches typed text to an existing location by name or path. Never creates one. */
export function resolveLocation(text: string, options: LocationOption[]): { ok: true; id: string } | { ok: false; reason: string } {
  const want = norm(text)
  const byPath = options.filter((o) => norm(o.path) === want)
  const hits = byPath.length ? byPath : options.filter((o) => norm(o.name) === want)
  if (hits.length === 1) return { ok: true, id: hits[0].id }
  if (hits.length > 1) return { ok: false, reason: `"${text}" matches more than one location (${hits.map((h) => h.path).join('; ')}); write the full path.` }
  return { ok: false, reason: `"${text}" is not a location. Locations are never created by an import.` }
}

export function buildPlans(groups: ImportGroup[], options: LocationOption[]): { plans: ImportItemPlan[]; errors: string[] } {
  const errors: string[] = []
  const cache = new Map<string, ReturnType<typeof resolveLocation>>()
  const resolve = (text: string) => {
    const k = norm(text)
    let r = cache.get(k)
    if (!r) {
      r = resolveLocation(text, options)
      cache.set(k, r)
      if (!r.ok) errors.push(r.reason)
    }
    return r
  }
  const plans: ImportItemPlan[] = groups.map((g) => ({
    name: g.name, manufacturer: g.manufacturer, model: g.model, category: g.category, trackingMode: g.trackingMode,
    units: g.units.flatMap((u) => { const r = resolve(u.location); return r.ok ? [{ serial: u.serial, ownerTag: u.ownerTag, locationId: r.id }] : [] }),
    stock: g.stock.flatMap((s) => { const r = resolve(s.location); return r.ok ? [{ locationId: r.id, quantity: s.quantity }] : [] }),
  }))
  return errors.length ? { plans: [], errors } : { plans, errors }
}

export function describeImport(items: ImportSummary[]): string[] {
  return items.map((i) => {
    const what = i.units ? `${i.units} unit${i.units === 1 ? '' : 's'}` : `${i.quantity} in stock`
    return `${i.name}: ${what}, ${i.created ? 'new item' : 'existing item'}`
  })
}
