import { REQUIRED_CORE, type CoreKind, type LineGroup } from './line-rules'

export type CostLine = { id: number; group: LineGroup; kind: CoreKind | null; model: string | null; qty: number; total: number }
export type BuildResult = { key: string; cpuQty: number; perMachine: number | null; partCount: number; missing: CoreKind[]; mixedModels: boolean; lineIds: number[] }

export const round2 = (n: number) => Math.round(n * 100) / 100

const ASSET_GROUPS: LineGroup[] = ['whole_unit', 'tracked_part', 'core_component']

/** Shipping/tax/fees/discount split across the PO's asset lines by value, the same rule as AMC landed cost. */
export function extrasShare(lines: CostLine[]): Map<number, number> {
  const assets = lines.filter((l) => ASSET_GROUPS.includes(l.group))
  const extras = lines.filter((l) => l.group === 'extra').reduce((s, l) => s + l.total, 0)
  const base = assets.reduce((s, l) => s + l.total, 0)
  const out = new Map<number, number>()
  for (const l of assets) out.set(l.id, base > 0 ? (extras * l.total) / base : 0)
  return out
}

/**
 * One build per CPU model on a PO. Per-machine cost = (that model's CPU lines + its share of
 * the PO's other core parts, by CPU count) ÷ CPU quantity. Extras are included via `share`.
 * Tracked parts (GPUs, capture cards) are never part of a build.
 */
export function buildCosts(lines: CostLine[], share: Map<number, number>): BuildResult[] {
  const core = lines.filter((l) => l.group === 'core_component')
  const cpus = core.filter((l) => l.kind === 'cpu' && l.model && l.qty > 0)
  if (!cpus.length) return []
  const present = new Set(core.map((l) => l.kind))
  const missing = REQUIRED_CORE.filter((k) => !present.has(k))
  const withShare = (l: CostLine) => l.total + (share.get(l.id) ?? 0)
  const totalCpu = cpus.reduce((s, l) => s + l.qty, 0)
  const others = core.filter((l) => !cpus.includes(l))
  const sharedTotal = others.reduce((s, l) => s + withShare(l), 0)

  const byModel = new Map<string, { qty: number; total: number; ids: number[] }>()
  for (const l of cpus) {
    const m = byModel.get(l.model!) ?? { qty: 0, total: 0, ids: [] }
    m.qty += l.qty
    m.total += withShare(l)
    m.ids.push(l.id)
    byModel.set(l.model!, m)
  }
  const mixed = byModel.size > 1
  return [...byModel].map(([key, m]) => {
    const total = m.total + sharedTotal * (m.qty / totalCpu)
    return {
      key, cpuQty: m.qty, perMachine: total > 0 ? round2(total / m.qty) : null,
      partCount: m.ids.length + others.length, missing, mixedModels: mixed,
      lineIds: [...m.ids, ...others.map((l) => l.id)],
    }
  })
}
