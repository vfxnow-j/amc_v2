import { CORE_RULES, GROUP_RULES, NAME_STOPWORDS, PREFIX_RULES, type CoreKind, type LineGroup } from './line-rules'

export type Classified = { group: LineGroup; kind: CoreKind | null; rule: string }

export function classifyLine(line: { name: string; serialisedProduct: boolean; poSubject?: string }): Classified {
  if (/\b(for sale|resale)\b/i.test(line.poSubject ?? '')) return { group: 'non_asset', kind: null, rule: 'PO bought for resale' }
  if (line.serialisedProduct) return { group: 'whole_unit', kind: null, rule: 'serialised product' }
  for (const r of PREFIX_RULES) if (r.re.test(line.name)) return { group: r.group, kind: r.kind, rule: `SKU prefix${r.kind ? ` (${r.kind})` : ''}` }
  for (const r of GROUP_RULES) if (r.re.test(line.name)) return { group: r.group, kind: null, rule: r.label }
  for (const c of CORE_RULES) if (c.re.test(line.name)) return { group: 'core_component', kind: c.kind, rule: c.kind }
  return { group: 'unclassified', kind: null, rule: 'no rule matched' }
}

const MODEL_RE = /(?<!\d)(\d{3,5}(?:WX|X3D|XT|XE|X|KF|KS|K|F|R|Y)?)(?![A-Z0-9])/gi

/** Every CPU/GPU-style model token in a string (upper-cased, in order, unique). */
export function cpuModels(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(MODEL_RE)) {
    const t = m[1].toUpperCase()
    if (/^\d{3}$/.test(t)) continue // bare 3-digit numbers are wattages/sizes, not models
    if (!out.includes(t)) out.push(t)
  }
  return out
}

/** The model a CPU line names: a suffixed token (3960X) wins over a bare number. */
export function cpuModel(text: string): string | null {
  const all = cpuModels(text)
  return all.find((t) => /[A-Z]$/.test(t)) ?? all[0] ?? null
}

function nameTokens(s: string): string[] {
  const t = s.toLowerCase()
    .replace(/(\d{4}) ?ti\b/g, '$1ti') // 3060 Ti / 3060TI → 3060ti
    .split(/[^a-z0-9]+/)
    .flatMap((w) => { const m = w.match(/^[a-z]{2,3}(\d{4})$/); return m ? [w, m[1]] : [w] }) // rtx4090 → + 4090
  return [...new Set(t.filter((w) => w && !NAME_STOPWORDS.has(w) && (/\d/.test(w) || w.length >= 4)))]
}

/** A model-like token: 4+ chars with a digit (a5000, c6520, p620x, 3060ti). */
const isModel = (t: string) => t.length >= 4 && /\d/.test(t) && !/^\d+(gb|tb|g|t)$/.test(t)

/**
 * AMC asset names that best match a PO line. A shared model token (a5000, c6520, p620…) is
 * enough; otherwise it takes a shared token with a digit and ≥2 shared tokens overall.
 */
export function bestAssetMatches(lineName: string, assetNames: string[]): string[] {
  const line = nameTokens(lineName)
  let best = 0
  let hits: string[] = []
  for (const name of assetNames) {
    const a = new Set(nameTokens(name))
    const shared = line.filter((t) => a.has(t))
    if (!shared.some(isModel) && !(shared.some((t) => /\d/.test(t)) && shared.length >= 2)) continue
    if (shared.length > best) { best = shared.length; hits = [name] } else if (shared.length === best) hits.push(name)
  }
  return hits
}

/** Model tokens two names share (a5000, p620, 3080ti, c6520…) — stricter than bestAssetMatches. */
export function modelOverlap(a: string, b: string): string[] {
  const bt = new Set(nameTokens(b))
  return nameTokens(a).filter((t) => isModel(t) && bt.has(t))
}
