/**
 * The Flow pricing defaults every order inherits and may override — the
 * `flow_pricing_defaults` settings row merged over the engine's defaults, exactly
 * as v1's getFlowDefaults() merges it (src/lib/actions/flow-settings.ts).
 *
 * Pure and client-safe: the server loaders and the settings action both merge
 * through here, so a stored row means the same thing everywhere.
 */
import { FLOW_CONFIG_DEFAULTS } from '@/lib/pricing/flow-order'
import { flowConfigFromSettings, type FlowOrderSettings } from '@/lib/pricing/flow-lines'
import type { FlowOrderConfig } from '@/lib/pricing/flow-order'

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
 * A knob the order set is never touched; the term is never defaulted, and nor is
 * flowStepPct: a null step is meaningful (the recoverByMonth-shaped schedule).
 *
 * Called ONCE, when an order is born (createReservation), so the order stores
 * concrete knobs. Never call it when pricing an existing order: that would let a
 * Settings change move the money of every order that already exists.
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

/**
 * The pricing config of an order that EXISTS, from its stored knobs alone.
 *
 * The settings row only seeds new orders (applyFlowDefaults at create); it is
 * deliberately not an input here, so no Settings change can ever move an existing
 * order's money. A knob still null — a legacy row, e.g. a v1 Flow order arriving
 * by the data sync — falls back to the engine's FLOW_CONFIG_DEFAULTS, which is
 * exactly how v1's repriceFlowTx priced a null (flowConfigFromSettings(reservation)).
 * Null when the order has no term.
 */
export function storedFlowConfig(order: FlowOrderSettings): FlowOrderConfig | null {
  return flowConfigFromSettings(order)
}
