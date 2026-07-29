import type { CloudProductCategory } from '@/generated/prisma/enums'

export const CLOUD_CATEGORIES: Array<{ value: CloudProductCategory; label: string }> = [
  { value: 'HOST_CPU', label: 'Host · CPU' },
  { value: 'HOST_RAM', label: 'Host · RAM' },
  { value: 'HOST_STORAGE', label: 'Host · Storage' },
  { value: 'HOST_GRAPHICS', label: 'Host · GPU' },
  { value: 'HOST_NETWORKING', label: 'Host · Networking' },
  { value: 'ENV_INTERNET', label: 'Environment · Internet' },
  { value: 'ENV_STORAGE', label: 'Environment · Storage' },
  { value: 'ENV_ADDON', label: 'Environment · Add-on' },
]

export const cloudCategoryLabel = (c: string): string =>
  CLOUD_CATEGORIES.find((x) => x.value === c)?.label ?? c

/**
 * Resolve the sell price for a cloud product at a given pricing period.
 * Uses the override if set, otherwise derives from cost × (1 + marginPercent/100).
 */
export function resolveCloudSellPrice(
  product: {
    costHourly: number | { toString(): string }
    costDaily: number | { toString(): string }
    costWeekly: number | { toString(): string }
    costMonthly: number | { toString(): string }
    sellHourly: number | { toString(): string } | null
    sellDaily: number | { toString(): string } | null
    sellWeekly: number | { toString(): string } | null
    sellMonthly: number | { toString(): string } | null
    marginPercent: number | { toString(): string }
  },
  period: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY'
): number {
  const num = (v: unknown): number => typeof v === 'number' ? v : v == null ? 0 : Number((v as { toString(): string }).toString())
  const margin = num(product.marginPercent) / 100
  const costByPeriod = {
    HOURLY: num(product.costHourly),
    DAILY: num(product.costDaily),
    WEEKLY: num(product.costWeekly),
    MONTHLY: num(product.costMonthly),
  }[period]
  const sellByPeriod = {
    HOURLY: product.sellHourly,
    DAILY: product.sellDaily,
    WEEKLY: product.sellWeekly,
    MONTHLY: product.sellMonthly,
  }[period]
  if (sellByPeriod != null) return num(sellByPeriod)
  return Math.round(costByPeriod * (1 + margin) * 100) / 100
}
