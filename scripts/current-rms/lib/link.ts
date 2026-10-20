import { buildCosts, extrasShare, round2, type BuildResult, type CostLine } from './allocate'
import { bestAssetMatches, classifyLine, cpuModel, cpuModels, type Classified } from './classify'
import { worst, type CurrentState, type Grade } from './grade'
import { normalizeBarcode, normalizePoNumber } from './normalize'

export type StockItem = { id: number; itemId: number; itemName: string; assetNumber: string; serial: string; store: string; openingDate: string | null; firstMoveDate: string | null; poNumberRaw: string; state: CurrentState }
export type AmcUnit = { barcode: string; serial: string | null; assetName: string; status: string; purchaseDate: string | null; purchasePrice: number | null; estimated: boolean }
export type PoLine = { id: number; poId: number; poNumber: string; orderedAt: string; supplier: string | null; subject: string; name: string; qty: number; price: number; total: number; serialisedProduct: boolean; itemId: number }
export type Pair = { unit: AmcUnit; stock: StockItem; method: 'barcode' | 'normalized barcode' | 'serial' }
export type LinkKind = 'po_number' | 'serialised_product' | 'build_complete' | 'build_partial' | 'name_match' | 'name_ambiguous'
export type LinkFlags = { countMismatch: boolean; rivals: number; missingParts: number; mixedModels: boolean }
export type UnitLink = { poNumber: string; orderedAt: string; supplier: string | null; cost: number | null; basis: string; grade: Grade; reason: string; kind: LinkKind; flags: LinkFlags }
export type LineLink = { group: Classified['group']; kind: Classified['kind']; buildKey: string | null; barcodes: string[]; grade: Grade; reason: string }

/** Current serialised item ↔ AMC unit: exact barcode, normalised barcode, then serial. First claim wins. */
export function matchIdentity(stock: StockItem[], amc: AmcUnit[]) {
  const byRaw = new Map(amc.map((u) => [u.barcode, u]))
  const uniq = <K>(pairs: [K, AmcUnit][]) => {
    const m = new Map<K, AmcUnit | null>()
    for (const [k, u] of pairs) m.set(k, m.has(k) ? null : u) // null = ambiguous
    return m
  }
  const byNorm = uniq(amc.map((u) => [normalizeBarcode(u.barcode), u] as [string, AmcUnit]))
  const bySerial = uniq(amc.filter((u) => u.serial?.trim()).map((u) => [u.serial!.trim().toUpperCase(), u] as [string, AmcUnit]))

  const pairs = new Map<string, Pair>()
  const currentOnly: { stock: StockItem; note: string }[] = []
  for (const s of stock) {
    const raw = s.assetNumber.trim()
    let unit = byRaw.get(raw) ?? null
    let method: Pair['method'] = 'barcode'
    if (!unit) { unit = byNorm.get(normalizeBarcode(raw)) ?? null; method = 'normalized barcode' }
    if (!unit && s.serial.trim()) { unit = bySerial.get(s.serial.trim().toUpperCase()) ?? null; method = 'serial' }
    if (!unit) { currentOnly.push({ stock: s, note: '' }); continue }
    if (pairs.has(unit.barcode)) { currentOnly.push({ stock: s, note: `AMC ${unit.barcode} already matched to Current #${pairs.get(unit.barcode)!.stock.id}` }); continue }
    pairs.set(unit.barcode, { unit, stock: s, method })
  }
  return { pairs, currentOnly }
}

type Po = { poNumber: string; orderedAt: string; supplier: string | null; lines: (PoLine & Classified & { model: string | null })[]; share: Map<number, number>; builds: BuildResult[] }

const dayDiff = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 864e5

/**
 * Links Current PO lines to matched AMC units. Order: PO # on stock item → serialised-product
 * lines → complete builds → name-matched whole units / tracked parts → partial builds.
 * A unit is claimed once. Window: Current opening date 0..windowDays after the PO order date,
 * and no Current movement before the order date (purchase → delivered → inventoried → rent/sell).
 */
export function linkPos(lines: PoLine[], pairs: Map<string, Pair>, windowDays: number) {
  const pos = new Map<string, Po>()
  for (const l of lines) {
    const po = pos.get(l.poNumber) ?? { poNumber: l.poNumber, orderedAt: l.orderedAt, supplier: l.supplier, lines: [] as Po['lines'], share: new Map(), builds: [] as BuildResult[] }
    const c = classifyLine({ name: l.name, serialisedProduct: l.serialisedProduct, poSubject: l.subject })
    po.lines.push({ ...l, ...c, model: c.kind === 'cpu' ? cpuModel(l.name) : null })
    pos.set(l.poNumber, po)
  }
  for (const po of pos.values()) {
    const cost: CostLine[] = po.lines.map((l) => ({ id: l.id, group: l.group, kind: l.kind, model: l.model, qty: l.qty, total: l.total }))
    po.share = extrasShare(cost)
    po.builds = buildCosts(cost, po.share)
  }
  const ordered = [...pos.values()].sort((a, b) => a.orderedAt.localeCompare(b.orderedAt) || a.poNumber.localeCompare(b.poNumber))
  const paired = [...pairs.values()].sort((a, b) => (a.stock.openingDate ?? '').localeCompare(b.stock.openingDate ?? '') || a.unit.barcode.localeCompare(b.unit.barcode))
  const assetNames = [...new Set(paired.map((p) => p.unit.assetName))]

  const units = new Map<string, UnitLink>()
  const lineLinks = new Map<number, LineLink>()
  const notes = new Map<string, string[]>()
  const note = (bc: string, n: string) => notes.set(bc, [...(notes.get(bc) ?? []), n])
  const inWindow = (p: Pair, orderedAt: string) => {
    if (!p.stock.openingDate) return false
    const d = dayDiff(orderedAt, p.stock.openingDate)
    return d >= 0 && d <= windowDays && !(p.stock.firstMoveDate && p.stock.firstMoveDate < orderedAt)
  }
  /** A $0 line means Current recorded no price — that is no cost, not a $0 cost. */
  const unitCost = (po: Po, l: Po['lines'][number]) => { const c = l.price + (po.share.get(l.id) ?? 0) / (l.qty || 1); return c > 0 ? round2(c) : null }
  const basis = (po: Po, ids: number[], kind: string) => (ids.some((id) => (po.share.get(id) ?? 0) !== 0) ? `${kind} + extras share` : kind)
  const lineBasis = (po: Po, l: Po['lines'][number]) => (unitCost(po, l) == null ? 'line has no price in Current' : basis(po, [l.id], 'line'))
  const setLine = (id: number, patch: Partial<LineLink> & { barcodes: string[] }) => {
    const l = ordered.flatMap((p) => p.lines).find((x) => x.id === id)!
    const prev = lineLinks.get(id)
    lineLinks.set(id, { group: l.group, kind: l.kind, buildKey: patch.buildKey ?? prev?.buildKey ?? null, barcodes: [...(prev?.barcodes ?? []), ...patch.barcodes], grade: worst(prev?.grade ?? 'none', patch.grade ?? 'none'), reason: [prev?.reason, patch.reason].filter(Boolean).join('; ') })
  }

  // Which inferred links could each unit belong to (ignoring claims) → competition flags.
  const buildFits = (po: Po, b: BuildResult) => paired.filter((p) => cpuModels(p.unit.assetName).includes(b.key) && inWindow(p, po.orderedAt))
  const nameLines = (po: Po) => po.lines.filter((l) => (l.group === 'whole_unit' || l.group === 'tracked_part') && !l.serialisedProduct)
  const nameFits = (po: Po, l: Po['lines'][number]) => { const names = bestAssetMatches(l.name, assetNames); return paired.filter((p) => names.includes(p.unit.assetName) && inWindow(p, po.orderedAt)) }
  const fits = new Map<string, Set<string>>()
  for (const po of ordered) {
    const add = (ps: Pair[]) => ps.forEach((p) => fits.set(p.unit.barcode, new Set([...(fits.get(p.unit.barcode) ?? []), po.poNumber])))
    po.builds.forEach((b) => add(buildFits(po, b)))
    nameLines(po).forEach((l) => add(nameFits(po, l)))
  }
  const rivals = (bc: string, poNumber: string) => [...(fits.get(bc) ?? [])].filter((n) => n !== poNumber)

  const NO_FLAGS: LinkFlags = { countMismatch: false, rivals: 0, missingParts: 0, mixedModels: false }
  const claim = (po: Po, p: Pair, cost: number | null, costBasis: string, grade: Grade, reason: string, kind: LinkKind, flags: LinkFlags = NO_FLAGS) => {
    units.set(p.unit.barcode, { poNumber: po.poNumber, orderedAt: po.orderedAt, supplier: po.supplier, cost, basis: costBasis, grade, reason, kind, flags })
  }
  const claimInferred = (po: Po, cands: Pair[], qty: number, lineIds: number[], cost: number | null, costBasis: string, baseGrade: Grade, reasons: string[], buildKey: string | null, kind: LinkKind, build?: BuildResult) => {
    const free = cands.filter((p) => !units.has(p.unit.barcode))
    const take = free.slice(0, Math.max(0, Math.round(qty)))
    const countNote = take.length === qty ? null : `${qty} ordered / ${free.length} unclaimed in window`
    const taken: string[] = []
    for (const p of take) {
      const r = rivals(p.unit.barcode, po.poNumber)
      const rs = [...reasons, countNote, r.length ? `also fits ${r.join(', ')}` : null].filter(Boolean) as string[]
      claim(po, p, cost, costBasis, worst(baseGrade, countNote || r.length ? 'orange' : 'none'), rs.join('; '), kind,
        { countMismatch: !!countNote, rivals: r.length, missingParts: build?.missing.length ?? 0, mixedModels: build?.mixedModels ?? false })
      taken.push(p.unit.barcode)
    }
    for (const id of lineIds) setLine(id, { barcodes: taken, buildKey, grade: take.length ? worst(baseGrade, countNote ? 'orange' : 'none') : 'orange', reason: take.length ? [...reasons, countNote].filter(Boolean).join('; ') : 'no unclaimed AMC unit in window' })
  }

  // 1. PO # recorded on the Current stock item.
  for (const p of paired) {
    const raw = p.stock.poNumberRaw.trim()
    if (!raw) continue
    const n = normalizePoNumber(raw)
    const po = n ? pos.get(n) : undefined
    if (!po) { note(p.unit.barcode, n ? `Current PO # ${raw} not found among Current POs` : `Current PO field says "${raw}"`); continue }
    const line = po.lines.filter((l) => l.group === 'whole_unit' || l.group === 'tracked_part').find((l) => bestAssetMatches(l.name, [p.unit.assetName]).length || l.itemId === p.stock.itemId)
    const build = po.builds.find((b) => cpuModels(p.unit.assetName).includes(b.key))
    const cost = line ? unitCost(po, line) : build?.perMachine ?? null
    const costBasis = line ? lineBasis(po, line) : build ? basis(po, build.lineIds, `build sum (${build.partCount} parts)`) : ''
    claim(po, p, cost, costBasis, 'yellow', 'PO # recorded on Current stock item', 'po_number')
    if (line) setLine(line.id, { barcodes: [p.unit.barcode], grade: 'yellow', reason: 'PO # on stock item' })
  }

  // 2. Serialised-product lines: units of that product in the window.
  for (const po of ordered) for (const l of po.lines.filter((x) => x.serialisedProduct)) {
    const cands = paired.filter((p) => p.stock.itemId === l.itemId && inWindow(p, po.orderedAt))
    claimInferred(po, cands, l.qty, [l.id], unitCost(po, l), lineBasis(po, l), 'yellow', ['serialised product on PO'], null, 'serialised_product')
  }

  // 3. Complete builds.
  for (const po of ordered) for (const b of po.builds.filter((x) => !x.missing.length && !x.mixedModels)) {
    claimInferred(po, buildFits(po, b), b.cpuQty, b.lineIds, b.perMachine, b.perMachine == null ? 'build parts have no price in Current' : basis(po, b.lineIds, `build sum (${b.partCount} parts)`), 'yellow', [`${b.key} build`], b.key, 'build_complete', b)
  }

  // 4. Whole units / tracked parts matched by name.
  for (const po of ordered) for (const l of nameLines(po)) {
    const names = bestAssetMatches(l.name, assetNames)
    if (!names.length) { setLine(l.id, { barcodes: [], grade: 'orange', reason: 'no AMC asset name matches' }); continue }
    claimInferred(po, nameFits(po, l), l.qty, [l.id], unitCost(po, l), lineBasis(po, l), names.length === 1 ? 'yellow' : 'orange', [names.length === 1 ? 'name match' : `name matches ${names.length} assets`], null, names.length === 1 ? 'name_match' : 'name_ambiguous')
  }

  // 5. Partial / mixed builds.
  for (const po of ordered) for (const b of po.builds.filter((x) => x.missing.length || x.mixedModels)) {
    const why = [`${b.key} build`, b.missing.length ? `missing ${b.missing.join(', ')}` : null, b.mixedModels ? 'several CPU models on one PO; parts split by CPU count' : null].filter(Boolean) as string[]
    claimInferred(po, buildFits(po, b), b.cpuQty, b.lineIds, b.perMachine, b.perMachine == null ? 'build parts have no price in Current' : basis(po, b.lineIds, `build sum (${b.partCount} parts)`), 'orange', why, b.key, 'build_partial', b)
  }

  // Every remaining line gets a row too.
  for (const po of ordered) for (const l of po.lines) if (!lineLinks.has(l.id)) {
    const reason = l.group === 'unclassified' ? 'unclassified line; not costed' : l.group === 'extra' ? 'spread across asset lines' : l.group === 'non_asset' ? l.rule : l.group === 'core_component' && !po.builds.length ? 'component with no CPU on this PO' : ''
    lineLinks.set(l.id, { group: l.group, kind: l.kind, buildKey: null, barcodes: [], grade: l.group === 'unclassified' ? 'orange' : 'none', reason })
  }
  return { units, lines: lineLinks, notes }
}
