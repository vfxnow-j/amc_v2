/**
 * The Flow pricing defaults every order inherits and may override — the
 * `flow_pricing_defaults` settings row merged over the engine's defaults, exactly
 * as v1's getFlowDefaults() merges it (src/lib/actions/flow-settings.ts).
 *
 * Pure and client-safe: the server loaders and the settings action both merge
 * through here, so a stored row means the same thing everywhere.
 */
import { FLOW_CONFIG_DEFAULTS } from '@/lib/pricing/flow-order'
import type { FlowOrderSettings } from '@/lib/pricing/flow-lines'

export const FLOW_DEFAULTS_KEY = 'flow_pricing_defaults'

/**
 * Deliberately excludes termMonths, monthsInService, funding and currentMonth —
 * those are properties of an order, not defaults.
 */
export type FlowPricingDefaults = {
  marginPct: number
  financePct: number
  purchaseTaxPct: number
  taxExempt: boolean
  recoverByMonth: number
  deprPct: number
  lifeMonths: number
  assumedAprPct: number
}

/** 8% is the engine's DEFAULT_APR.loan and the rate its pinned figures were built on. */
export const FLOW_DEFAULTS_FALLBACK: FlowPricingDefaults = {
  marginPct: FLOW_CONFIG_DEFAULTS.marginPct,
  financePct: FLOW_CONFIG_DEFAULTS.financePct,
  purchaseTaxPct: FLOW_CONFIG_DEFAULTS.purchaseTaxPct,
  taxExempt: FLOW_CONFIG_DEFAULTS.taxExempt,
  recoverByMonth: FLOW_CONFIG_DEFAULTS.recoverByMonth,
  deprPct: FLOW_CONFIG_DEFAULTS.deprPct,
  lifeMonths: FLOW_CONFIG_DEFAULTS.lifeMonths,
  assumedAprPct: 8,
}

/** A settings row's value merged over the fallback — never replaced by it. */
export function mergeFlowDefaults(value: unknown): FlowPricingDefaults {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...FLOW_DEFAULTS_FALLBACK }
  return { ...FLOW_DEFAULTS_FALLBACK, ...(value as Partial<FlowPricingDefaults>) }
}

/**
 * Fill the pricing knobs an order left blank from the defaults, so
 * flowConfigFromSettings() sees the house position rather than the engine's.
 * A knob the order set is never touched; the term is never defaulted.
 */
export function applyFlowDefaults<T extends FlowOrderSettings>(order: T, d: FlowPricingDefaults): T {
  const blank = (v: unknown) => v == null || v === ''
  return {
    ...order,
    flowMarginPct: blank(order.flowMarginPct) ? d.marginPct : order.flowMarginPct,
    flowFinancePct: blank(order.flowFinancePct) ? d.financePct : order.flowFinancePct,
    flowPurchaseTaxPct: blank(order.flowPurchaseTaxPct) ? d.purchaseTaxPct : order.flowPurchaseTaxPct,
    flowTaxExempt: order.flowTaxExempt ?? d.taxExempt,
    flowRecoverByMonth: order.flowRecoverByMonth ?? d.recoverByMonth,
    flowDeprPct: blank(order.flowDeprPct) ? d.deprPct : order.flowDeprPct,
    flowLifeMonths: order.flowLifeMonths ?? d.lifeMonths,
  }
}
