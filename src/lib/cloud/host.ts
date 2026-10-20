/**
 * Cloud hosts: the spec-based way to draft a CLOUD order.
 *
 * Ported from v1's cloud-host-configurator (c956e1a). A host is composed from
 * cloud products (CPU, RAM, storage, GPU, networking) and priced per billing
 * period. It is stored as v1 stored it, so billing, the quote and the invoice
 * keep working on rows they already understand:
 *   - the host row: category "Cloud", no cloudProductId, rate = one host's
 *     price, quantity = number of hosts, description = the spec line
 *   - one hidden config row per component: parentId = the host, cloudProductId,
 *     rate 0, quantity = how many of that component each host carries
 * The component rows carry no money (auto-invoice, the quote and the PDF skip
 * them), so the host row is the only thing a client is charged for or reads.
 *
 * The client sends only product ids and counts; every price here is derived on
 * the server from the product catalogue, so a stale or tampered browser price
 * can never be stored.
 *
 * Pure — no prisma, no 'use server', no next/*.
 */

import { resolveCloudSellPrice } from '@/lib/cloud-products'

export type CloudPeriod = 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY'

export const CLOUD_PERIODS: CloudPeriod[] = ['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY']

export const PERIOD_NOUN: Record<CloudPeriod, string> = {
  HOURLY: 'hour',
  DAILY: 'day',
  WEEKLY: 'week',
  MONTHLY: 'month',
}

export const HOST_CATEGORIES = ['HOST_CPU', 'HOST_RAM', 'HOST_STORAGE', 'HOST_GRAPHICS', 'HOST_NETWORKING'] as const
export type HostCategory = (typeof HOST_CATEGORIES)[number]

/** The short label stored on a component row ("CPU: 24C"), as v1 wrote it. */
export const HOST_CATEGORY_LABEL: Record<HostCategory, string> = {
  HOST_CPU: 'CPU',
  HOST_RAM: 'RAM',
  HOST_STORAGE: 'Storage',
  HOST_GRAPHICS: 'GPU',
  HOST_NETWORKING: 'Networking',
}

export const ENV_CATEGORIES = ['ENV_INTERNET', 'ENV_STORAGE', 'ENV_ADDON'] as const
export type EnvCategory = (typeof ENV_CATEGORIES)[number]

/** How an environment product reads on the order, and the category it files under. */
export const ENV_LINE: Record<EnvCategory, { label: string; category: string }> = {
  ENV_INTERNET: { label: 'Internet', category: 'Cloud · Internet' },
  ENV_STORAGE: { label: 'Env Storage', category: 'Cloud · Env Storage' },
  ENV_ADDON: { label: 'Add-on', category: 'Cloud · Add-on' },
}

type Money = number | { toString(): string } | null

export type CloudProductRow = {
  id: string
  category: string
  name: string
  costHourly: number | { toString(): string }
  costDaily: number | { toString(): string }
  costWeekly: number | { toString(): string }
  costMonthly: number | { toString(): string }
  sellHourly: Money
  sellDaily: Money
  sellWeekly: Money
  sellMonthly: Money
  marginPercent: number | { toString(): string }
}

/** What the browser sends for one host: ids and counts, never prices. */
export type CloudHostInput = {
  period: CloudPeriod
  /** Number of hosts (nodes). */
  quantity: number
  /** Optional tag shown as "[HP-VM]" at the front of the spec line. */
  hostName?: string | null
  /** Replace each product's margin: sell = cost × (1 + margin%). Blank = each product's own. */
  marginOverride?: number | null
  rows: Array<{ cloudProductId: string; qtyPerHost: number }>
}

export type CloudEnvInput = { cloudProductId: string; quantity: number }

export type PricedComponent = {
  cloudProductId: string
  category: HostCategory
  productName: string
  categoryLabel: string
  qtyPerHost: number
  /** Per host: sell for qtyPerHost of this component. */
  rate: number
  costBasis: number
  marginPercent: number
}

export type PricedHost = {
  period: CloudPeriod
  quantity: number
  hostName: string | null
  marginOverride: number | null
  components: PricedComponent[]
  /** One host, one period. */
  perHostSell: number
  perHostCost: number
  /** Margin on the whole host as a percentage of sell. */
  marginPercent: number
  /** Hosts × per-host sell, for one period. */
  totalSell: number
  description: string
}

const num = (v: Money | undefined): number => (v == null ? 0 : typeof v === 'number' ? v : Number(v.toString()))
const cents = (n: number) => Math.round(n * 100) / 100

export function isHostCategory(c: string): c is HostCategory {
  return (HOST_CATEGORIES as readonly string[]).includes(c)
}
export function isEnvCategory(c: string): c is EnvCategory {
  return (ENV_CATEGORIES as readonly string[]).includes(c)
}

function costFor(product: CloudProductRow, period: CloudPeriod): number {
  return num({ HOURLY: product.costHourly, DAILY: product.costDaily, WEEKLY: product.costWeekly, MONTHLY: product.costMonthly }[period])
}

/** A margin override is a number ≥ 0; anything else means "use each product's own". */
export function cleanMarginOverride(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value >= 0 && value <= 999 ? value : null
}

const prefixed = (qty: number, text: string) => (qty > 1 ? `${qty}x ${text}` : text)

/**
 * The spec line, in the style Current RMS used for the machines these replace:
 * "32C / 96GB RAM / 512GB SSD / 2x RTX 4090 / 10G NIC". CPU first, then memory,
 * drives, GPUs, network. Several drives read as separate drives, "1TB SSD / 4TB SSD".
 */
export function cloudSpecLine(
  components: Array<{ category: string; productName: string; qtyPerHost: number }>,
): string {
  const order = (c: { category: string }) => HOST_CATEGORIES.indexOf(c.category as HostCategory)
  return [...components]
    .filter((c) => isHostCategory(c.category))
    .sort((a, b) => order(a) - order(b))
    .map((c) => {
      const qty = Math.max(1, c.qtyPerHost || 1)
      switch (c.category as HostCategory) {
        case 'HOST_RAM':
          return prefixed(qty, `${c.productName} RAM`)
        case 'HOST_STORAGE':
          return prefixed(qty, `${c.productName} SSD`)
        case 'HOST_NETWORKING':
          return prefixed(qty, `${c.productName} NIC`)
        default:
          return prefixed(qty, c.productName)
      }
    })
    .join(' / ')
}

/** The host's line description: "[HP-VM] 32C / …" with a name, "Cloud host · 32C / …" without. */
export function cloudHostDescription(
  components: Array<{ category: string; productName: string; qtyPerHost: number }>,
  hostName?: string | null,
): string {
  const spec = cloudSpecLine(components)
  const name = hostName?.trim().replace(/[[\]]/g, '')
  return name ? `[${name}] ${spec}` : `Cloud host · ${spec}`
}

/** The "[name]" at the front of a host description, so editing can put it back. */
export function parseHostName(description: string | null | undefined): string | null {
  const match = /^\[([^\]]+)\]\s/.exec(description ?? '')
  return match ? match[1] : null
}

export function priceCloudHost(products: CloudProductRow[], input: CloudHostInput): PricedHost {
  const byId = new Map(products.map((p) => [p.id, p]))
  const quantity = Math.floor(Number(input.quantity))
  if (!Number.isFinite(quantity) || quantity < 1) throw new Error('A cloud host order is for at least one host.')
  if (!CLOUD_PERIODS.includes(input.period)) throw new Error('Choose a billing period for the host.')
  const override = cleanMarginOverride(input.marginOverride)

  const components: PricedComponent[] = []
  for (const row of input.rows) {
    const product = byId.get(row.cloudProductId)
    if (!product || !isHostCategory(product.category)) {
      throw new Error('A part of that host is no longer in the cloud catalogue. Re-pick it.')
    }
    const qty = Math.max(1, Math.floor(Number(row.qtyPerHost)) || 1)
    const baseCost = costFor(product, input.period)
    const baseSell = override != null ? cents(baseCost * (1 + override / 100)) : resolveCloudSellPrice(product, input.period)
    const rate = cents(baseSell * qty)
    const costBasis = cents(baseCost * qty)
    components.push({
      cloudProductId: product.id,
      category: product.category,
      productName: product.name,
      categoryLabel: HOST_CATEGORY_LABEL[product.category],
      qtyPerHost: qty,
      rate,
      costBasis,
      marginPercent: rate > 0 ? cents(((rate - costBasis) / rate) * 100) : 0,
    })
  }
  components.sort((a, b) => HOST_CATEGORIES.indexOf(a.category) - HOST_CATEGORIES.indexOf(b.category))

  if (!components.some((c) => c.category === 'HOST_CPU')) throw new Error('A host needs a CPU.')
  if (!components.some((c) => c.category === 'HOST_RAM')) throw new Error('A host needs RAM.')

  const perHostSell = cents(components.reduce((s, c) => s + c.rate, 0))
  const perHostCost = cents(components.reduce((s, c) => s + c.costBasis, 0))
  const hostName = input.hostName?.trim().replace(/[[\]]/g, '') || null
  return {
    period: input.period,
    quantity,
    hostName,
    marginOverride: override,
    components,
    perHostSell,
    perHostCost,
    marginPercent: perHostSell > 0 ? cents(((perHostSell - perHostCost) / perHostSell) * 100) : 0,
    totalSell: cents(perHostSell * quantity),
    description: cloudHostDescription(components, hostName),
  }
}

export type PricedEnvLine = {
  cloudProductId: string
  description: string
  category: string
  quantity: number
  rate: number
  costBasis: number
  marginPercent: number
}

/** An environment product (internet, shared storage, add-on) is a plain monthly line. */
export function priceCloudEnv(products: CloudProductRow[], input: CloudEnvInput): PricedEnvLine {
  const product = products.find((p) => p.id === input.cloudProductId)
  if (!product || !isEnvCategory(product.category)) {
    throw new Error('That environment item is no longer in the cloud catalogue.')
  }
  const quantity = Math.floor(Number(input.quantity))
  if (!Number.isFinite(quantity) || quantity < 1) throw new Error('An environment item is for at least one.')
  const line = ENV_LINE[product.category]
  return {
    cloudProductId: product.id,
    description: `${line.label}: ${product.name}`,
    category: line.category,
    quantity,
    rate: resolveCloudSellPrice(product, 'MONTHLY'),
    costBasis: cents(costFor(product, 'MONTHLY')),
    marginPercent: num(product.marginPercent),
  }
}

/** What a host and its parts look like as rows to create (the builder and the portal share this shape). */
export type CloudItemRow = {
  uid: string
  parentUid: string | null
  cloudProductId: string | null
  description: string
  category: string
  pricingType: CloudPeriod
  rate: number
  quantity: number
  isOneTime: false
  costBasis: number | null
  marginPercent: number | null
}

/** The rows for a new CLOUD order: each host and its hidden parts, then the environment lines. */
export function buildCloudOrderItems(
  products: CloudProductRow[],
  hosts: CloudHostInput[],
  env: CloudEnvInput[],
): CloudItemRow[] {
  const rows: CloudItemRow[] = []
  hosts.forEach((input, h) => {
    const host = priceCloudHost(products, input)
    const uid = `cloud-host-${h}`
    rows.push({
      uid,
      parentUid: null,
      cloudProductId: null,
      description: host.description,
      category: 'Cloud',
      pricingType: host.period,
      rate: host.perHostSell,
      quantity: host.quantity,
      isOneTime: false,
      costBasis: host.perHostCost > 0 ? host.perHostCost : null,
      marginPercent: host.perHostSell > 0 ? host.marginPercent : null,
    })
    host.components.forEach((c, i) => {
      rows.push({
        uid: `${uid}-${i}`,
        parentUid: uid,
        cloudProductId: c.cloudProductId,
        description: `${c.categoryLabel}: ${c.productName}`,
        category: 'Cloud',
        pricingType: host.period,
        rate: 0,
        quantity: c.qtyPerHost,
        isOneTime: false,
        costBasis: null,
        marginPercent: null,
      })
    })
  })
  env.forEach((input, e) => {
    const line = priceCloudEnv(products, input)
    rows.push({
      uid: `cloud-env-${e}`,
      parentUid: null,
      cloudProductId: line.cloudProductId,
      description: line.description,
      category: line.category,
      pricingType: 'MONTHLY',
      rate: line.rate,
      quantity: line.quantity,
      isOneTime: false,
      costBasis: line.costBasis,
      marginPercent: line.marginPercent,
    })
  })
  return rows
}

/** "$1,200/mo + $300/day" — a draft's total grouped by billing period. */
export function totalsByPeriod(
  lines: Array<{ period: CloudPeriod; amount: number }>,
): Array<{ period: CloudPeriod; amount: number }> {
  const sums = new Map<CloudPeriod, number>()
  for (const l of lines) sums.set(l.period, cents((sums.get(l.period) ?? 0) + l.amount))
  return CLOUD_PERIODS.filter((p) => sums.has(p)).map((period) => ({ period, amount: sums.get(period)! }))
}

/**
 * A draft's money, for the builder's total: every host and environment line
 * priced the way the server will price it. `problem` is set instead when a part
 * is missing or a host is incomplete, so the total never shows a half-answer.
 */
export function cloudDraftTotals(
  products: CloudProductRow[],
  hosts: CloudHostInput[],
  env: CloudEnvInput[],
): { byPeriod: Array<{ period: CloudPeriod; amount: number }>; problem: string | null; hosts: PricedHost[]; env: PricedEnvLine[] } {
  try {
    const pricedHosts = hosts.map((h) => priceCloudHost(products, h))
    const pricedEnv = env.map((e) => priceCloudEnv(products, e))
    return {
      byPeriod: totalsByPeriod([
        ...pricedHosts.map((h) => ({ period: h.period, amount: h.totalSell })),
        ...pricedEnv.map((e) => ({ period: 'MONTHLY' as CloudPeriod, amount: cents(e.rate * e.quantity) })),
      ]),
      problem: null,
      hosts: pricedHosts,
      env: pricedEnv,
    }
  } catch (error) {
    return { byPeriod: [], problem: error instanceof Error ? error.message : 'That could not be priced.', hosts: [], env: [] }
  }
}
