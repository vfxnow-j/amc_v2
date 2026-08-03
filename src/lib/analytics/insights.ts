'use server'

import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth-utils'
import { linearTrend, percentChange, zScores } from './statistics'
import { getUnitCountDrift, getInventoryStateDrift } from './data-integrity'

export type InsightType =
  | 'inventory'
  | 'revenue'
  | 'client'
  | 'utilization'
  | 'maintenance'
  | 'overdue'
  | 'seasonal'
  | 'roi'
  | 'pricing'
  | 'market_shift'
  | 'system'

export type InsightPriority = 'high' | 'medium' | 'low'

export type InsightCategory = 'system' | 'business' | 'asset'

export type Insight = {
  id: string
  type: InsightType
  category: InsightCategory
  priority: InsightPriority
  title: string
  description: string
  link?: string
}

const MAX_INSIGHTS = 8

/**
 * Generate insights without auth check — for internal/cron use.
 */
export async function getInsightsInternal(): Promise<Insight[]> {
  return generateInsights()
}

/**
 * Generate data-driven insights from business data.
 * All computation happens server-side — returns pre-computed insight objects.
 */
export async function getInsights(): Promise<Insight[]> {
  const authResult = await requireAuth()
  if (!authResult.authorized) return []

  return generateInsights()
}

/**
 * Every insight, in a stable order — the Insights screen's read.
 *
 * The capped variants above are built for the Overview's two-slot "Needs a
 * decision" card: eight at most, shuffled inside each priority tier so the same
 * two don't sit there for a week. Both of those are wrong for a screen whose
 * whole job is to be the full list. A cap silently hides work, and a shuffle
 * means the page reorders itself under somebody halfway down it — so this
 * returns all of them, sorted and never shuffled.
 *
 * Auth-checked, like `getInsights`. There is one unchecked path in this module
 * and it exists for cron; a second one reachable from a route would undo the
 * gate.
 */
export async function getAllInsights(): Promise<Insight[]> {
  const authResult = await requireAuth()
  if (!authResult.authorized) return []

  return generateInsights({ limit: null, shuffle: false })
}

async function generateInsights(
  options: { limit: number | null; shuffle: boolean } = {
    limit: MAX_INSIGHTS,
    shuffle: true,
  }
): Promise<Insight[]> {
  const now = new Date()
  const threeMonthsAgo = new Date(now)
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
  const sixMonthsAgo = new Date(now)
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
  const oneYearAgo = new Date(now)
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)

  try {
    const [
      inventoryPressureData,
      monthlyRevenueData,
      clientRevenueData,
      categoryUtilizationData,
      maintenanceCostData,
      overduePatternData,
      seasonalData,
      assetRoiData,
      marketPriceData,
      marginReservationData,
      activeLeaseData,
    ] = await Promise.all([
      // 1. Inventory pressure: assets with high checkout counts + low availability
      prisma.checkout.groupBy({
        by: ['assetUnitId'],
        where: {
          checkoutDate: { gte: threeMonthsAgo },
          status: { in: ['ACTIVE', 'RETURNED', 'OVERDUE'] },
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 20,
      }),

      // 2. Monthly revenue: last 6 months of paid invoices
      prisma.invoice.findMany({
        where: {
          status: 'PAID',
          createdAt: { gte: sixMonthsAgo },
        },
        select: { total: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),

      // 3. Client revenue concentration: paid invoices last 6 months
      prisma.invoice.findMany({
        where: {
          status: 'PAID',
          createdAt: { gte: sixMonthsAgo },
        },
        select: { total: true, clientId: true, client: { select: { name: true } } },
      }),

      // 4. Category utilization: units per category + checkouts per category
      prisma.assetUnit.findMany({
        where: { status: { not: 'RETIRED' } },
        select: {
          id: true,
          status: true,
          asset: { select: { category: { select: { id: true, name: true } } } },
          _count: {
            select: {
              checkouts: {
                where: { checkoutDate: { gte: threeMonthsAgo } },
              },
            },
          },
        },
      }),

      // 5. Maintenance costs per asset (last year)
      prisma.maintenanceRecord.findMany({
        where: {
          createdAt: { gte: oneYearAgo },
          status: 'COMPLETED',
        },
        select: {
          totalCost: true,
          assetUnit: {
            select: {
              id: true,
              barcode: true,
              asset: { select: { id: true, name: true } },
            },
          },
        },
      }),

      // 6. Overdue patterns per client (last 3 months)
      prisma.checkout.findMany({
        where: {
          status: 'OVERDUE',
          checkoutDate: { gte: threeMonthsAgo },
        },
        select: {
          clientId: true,
          client: { select: { name: true } },
        },
      }),

      // 7. Seasonal: checkout counts this month vs same month last year
      Promise.all([
        prisma.checkout.count({
          where: {
            checkoutDate: {
              gte: new Date(now.getFullYear(), now.getMonth(), 1),
              lte: now,
            },
          },
        }),
        prisma.checkout.count({
          where: {
            checkoutDate: {
              gte: new Date(now.getFullYear() - 1, now.getMonth(), 1),
              lt: new Date(now.getFullYear() - 1, now.getMonth() + 1, 1),
            },
          },
        }),
      ]),

      // 8. Asset ROI: units with revenue > purchase cost
      prisma.assetUnit.findMany({
        where: {
          status: { not: 'RETIRED' },
          purchasePrice: { gt: 0 },
          totalRevenue: { gt: 0 },
        },
        select: {
          id: true,
          purchasePrice: true,
          totalRevenue: true,
          asset: { select: { id: true, name: true } },
        },
        orderBy: { totalRevenue: 'desc' },
        take: 20,
      }),

      // 9. Market price data for shift detection and staleness
      prisma.asset.findMany({
        where: {
          totalQuantity: { gt: 0 },
          units: { some: { status: { not: 'RETIRED' } } },
        },
        select: {
          id: true,
          name: true,
          marketPrice: true,
          marketPriceUpdatedAt: true,
          monthlyRate: true,
          units: {
            where: { status: { not: 'RETIRED' } },
            select: { purchasePrice: true },
          },
        },
      }),

      // 10. Margin tracking: active/approved reservations with totalMargin set
      prisma.reservation.findMany({
        where: {
          status: { in: ['ACTIVE', 'APPROVED', 'PREPARING', 'SHIPPED'] },
          totalMargin: { not: null },
        },
        select: {
          id: true,
          totalMargin: true,
          subtotal: true,
        },
      }),

      // 11. Active leases with unit revenue for coverage analysis
      prisma.lease.findMany({
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          monthlyPayment: true,
          startDate: true,
          leaseName: true,
          assetUnits: {
            select: { totalRevenue: true },
          },
        },
      }),
    ])

    const insights: Insight[] = []

    // --- 1. Inventory Pressure ---
    if (inventoryPressureData.length > 0) {
      const topUnitIds = inventoryPressureData
        .filter((d) => d._count.id >= 3)
        .map((d) => d.assetUnitId)

      if (topUnitIds.length > 0) {
        const units = await prisma.assetUnit.findMany({
          where: { id: { in: topUnitIds } },
          select: {
            id: true,
            assetId: true,
            asset: {
              select: {
                id: true,
                name: true,
                _count: {
                  select: {
                    units: { where: { status: 'AVAILABLE' } },
                  },
                },
              },
            },
          },
        })

        // Group by asset product type
        const assetMap = new Map<string, { name: string; id: string; available: number; checkouts: number }>()
        for (const unit of units) {
          const checkoutInfo = inventoryPressureData.find((d) => d.assetUnitId === unit.id)
          const existing = assetMap.get(unit.assetId)
          if (!existing) {
            assetMap.set(unit.assetId, {
              name: unit.asset.name,
              id: unit.asset.id,
              available: unit.asset._count.units,
              checkouts: checkoutInfo?._count.id || 0,
            })
          } else {
            existing.checkouts += checkoutInfo?._count.id || 0
          }
        }

        for (const [, asset] of assetMap) {
          if (asset.available <= 2 && asset.checkouts >= 4) {
            insights.push({
              id: `inv-${asset.id}`,
              type: 'inventory',
              category: 'asset',
              priority: asset.available === 0 ? 'high' : 'medium',
              title: 'High Demand, Low Stock',
              description: `${asset.name} was rented ${asset.checkouts} times in 3 months with only ${asset.available} unit${asset.available !== 1 ? 's' : ''} available. Consider expanding inventory.`,
              link: `/dashboard/assets/${asset.id}`,
            })
          }
        }
      }
    }

    // --- 2. Revenue Trend ---
    if (monthlyRevenueData.length > 0) {
      const monthlyMap = new Map<string, number>()
      for (const inv of monthlyRevenueData) {
        const key = `${inv.createdAt.getFullYear()}-${String(inv.createdAt.getMonth() + 1).padStart(2, '0')}`
        monthlyMap.set(key, (monthlyMap.get(key) || 0) + Number(inv.total))
      }

      const sortedMonths = Array.from(monthlyMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      const values = sortedMonths.map(([, v]) => v)

      const trend = linearTrend(values)
      if (trend && trend.direction !== 'flat') {
        const totalPct = Math.abs(trend.percentChangePerPeriod * values.length)
        insights.push({
          id: 'rev-trend',
          type: 'revenue',
          category: 'business',
          priority: totalPct > 15 ? 'high' : 'medium',
          title: trend.direction === 'up' ? 'Revenue Trending Up' : 'Revenue Declining',
          description: trend.direction === 'up'
            ? `Revenue is trending up ~${Math.abs(trend.percentChangePerPeriod)}% per month over the past ${values.length} months. Consider capacity planning for continued growth.`
            : `Revenue has declined ~${Math.abs(trend.percentChangePerPeriod)}% per month over the past ${values.length} months. Review pricing or client outreach strategy.`,
          link: '/dashboard/reports',
        })
      }
    }

    // --- 3. Client Concentration Risk ---
    if (clientRevenueData.length > 0) {
      const totalRev = clientRevenueData.reduce((s, i) => s + Number(i.total), 0)
      if (totalRev > 0) {
        const clientTotals = new Map<string, { name: string; total: number }>()
        for (const inv of clientRevenueData) {
          const existing = clientTotals.get(inv.clientId) || { name: inv.client.name, total: 0 }
          existing.total += Number(inv.total)
          clientTotals.set(inv.clientId, existing)
        }

        const sorted = Array.from(clientTotals.entries()).sort((a, b) => b[1].total - a[1].total)
        const [topClientId, topClient] = sorted[0]
        const share = Math.round((topClient.total / totalRev) * 100)

        if (share >= 40) {
          insights.push({
            id: `client-conc-${topClientId}`,
            type: 'client',
            category: 'business',
            priority: share >= 60 ? 'high' : 'medium',
            title: 'Client Concentration Risk',
            description: `${topClient.name} accounts for ${share}% of your revenue. Consider diversifying your client base to reduce dependency.`,
            link: `/dashboard/clients/${topClientId}`,
          })
        }
      }
    }

    // --- 4. Underutilized Categories ---
    {
      const categoryMap = new Map<string, { name: string; totalUnits: number; totalCheckouts: number }>()
      for (const unit of categoryUtilizationData) {
        const cat = unit.asset.category
        if (!cat) continue
        const existing = categoryMap.get(cat.id) || { name: cat.name, totalUnits: 0, totalCheckouts: 0 }
        existing.totalUnits++
        existing.totalCheckouts += unit._count.checkouts
        categoryMap.set(cat.id, existing)
      }

      for (const [catId, cat] of categoryMap) {
        if (cat.totalUnits >= 5) {
          const utilRate = Math.round((cat.totalCheckouts / cat.totalUnits) * 100) / 100
          if (utilRate < 0.2) {
            insights.push({
              id: `util-${catId}`,
              type: 'utilization',
              category: 'asset',
              priority: 'low',
              title: 'Underutilized Category',
              description: `${cat.name} has ${cat.totalUnits} units but only ${cat.totalCheckouts} checkout${cat.totalCheckouts !== 1 ? 's' : ''} in 3 months. Review pricing or marketing for this category.`,
              link: '/dashboard/assets',
            })
          }
        }
      }
    }

    // --- 5. Maintenance Cost Spikes ---
    if (maintenanceCostData.length >= 3) {
      const assetCosts = new Map<string, { name: string; id: string; total: number }>()
      for (const record of maintenanceCostData) {
        const key = record.assetUnit.asset.id
        const existing = assetCosts.get(key) || { name: record.assetUnit.asset.name, id: key, total: 0 }
        existing.total += Number(record.totalCost || 0)
        assetCosts.set(key, existing)
      }

      const costValues = Array.from(assetCosts.values())
      if (costValues.length >= 3) {
        const scores = zScores(costValues.map((c) => c.total))
        for (let i = 0; i < scores.length; i++) {
          if (scores[i].isAnomaly && scores[i].zScore > 0) {
            const asset = costValues[i]
            insights.push({
              id: `maint-${asset.id}`,
              type: 'maintenance',
              category: 'asset',
              priority: 'high',
              title: 'Maintenance Cost Spike',
              description: `Maintenance costs for ${asset.name} ($${Math.round(asset.total).toLocaleString()}) are significantly above average. Evaluate repair vs. replacement.`,
              link: `/dashboard/assets/${asset.id}`,
            })
          }
        }
      }
    }

    // --- 6. Overdue Patterns ---
    if (overduePatternData.length > 0) {
      const clientOverdues = new Map<string, { name: string; count: number }>()
      for (const checkout of overduePatternData) {
        const existing = clientOverdues.get(checkout.clientId) || { name: checkout.client.name, count: 0 }
        existing.count++
        clientOverdues.set(checkout.clientId, existing)
      }

      for (const [clientId, client] of clientOverdues) {
        if (client.count >= 3) {
          insights.push({
            id: `overdue-${clientId}`,
            type: 'overdue',
            category: 'business',
            priority: 'high',
            title: 'Repeat Overdue Returns',
            description: `${client.name} has had ${client.count} overdue returns in the past 3 months. Consider adjusted terms or requiring deposits.`,
            link: `/dashboard/clients/${clientId}`,
          })
        }
      }
    }

    // --- 7. Seasonal Demand Signal ---
    {
      const [currentMonthCount, lastYearSameMonthCount] = seasonalData
      if (lastYearSameMonthCount > 0) {
        const pctDiff = percentChange(lastYearSameMonthCount, currentMonthCount)
        if (Math.abs(pctDiff) > 20) {
          insights.push({
            id: 'seasonal',
            type: 'seasonal',
            category: 'business',
            priority: 'medium',
            title: pctDiff > 0 ? 'Demand Surge' : 'Demand Slowdown',
            description: pctDiff > 0
              ? `Checkout volume is ${Math.round(pctDiff)}% higher than the same month last year. Peak season may be ahead — ensure inventory is ready.`
              : `Checkout volume is ${Math.round(Math.abs(pctDiff))}% lower than the same month last year. Consider promotions or outreach to boost activity.`,
            link: '/dashboard/reports/traffic',
          })
        }
      }
    }

    // --- 8. Asset ROI Leaders ---
    if (assetRoiData.length > 0) {
      const roiAssets = assetRoiData
        .map((unit) => ({
          name: unit.asset.name,
          id: unit.asset.id,
          roi: Number(unit.totalRevenue) / Number(unit.purchasePrice),
        }))
        .filter((a) => a.roi >= 1.5)
        .sort((a, b) => b.roi - a.roi)

      if (roiAssets.length > 0) {
        const top = roiAssets[0]
        insights.push({
          id: `roi-${top.id}`,
          type: 'roi',
          category: 'business',
          priority: 'low',
          title: 'Top Performing Asset',
          description: `${top.name} has earned ${top.roi.toFixed(1)}x its purchase cost in revenue — your top ROI performer.`,
          link: `/dashboard/assets/${top.id}`,
        })
      }
    }

    // --- 9. Pricing Insights ---
    {
      // Underpriced assets: payback > 10 months
      const underpricedAssets = await prisma.asset.findMany({
        where: {
          monthlyRate: { gt: 0 },
          totalQuantity: { gt: 0 },
          units: { some: { status: { not: 'RETIRED' }, purchasePrice: { gt: 0 } } },
        },
        select: {
          id: true,
          name: true,
          monthlyRate: true,
          units: {
            where: { status: { not: 'RETIRED' }, purchasePrice: { gt: 0 } },
            select: { purchasePrice: true },
          },
        },
        take: 20,
      })

      for (const asset of underpricedAssets) {
        const avgPurchase =
          asset.units.reduce((s, u) => s + Number(u.purchasePrice || 0), 0) / asset.units.length
        const monthlyRate = Number(asset.monthlyRate || 0)
        if (monthlyRate > 0 && avgPurchase > 0) {
          const paybackMonths = avgPurchase / monthlyRate
          if (paybackMonths > 10) {
            insights.push({
              id: `pricing-under-${asset.id}`,
              type: 'pricing',
              category: 'asset',
              priority: 'high',
              title: 'Underpriced Asset',
              description: `${asset.name} takes ~${Math.round(paybackMonths)} months to pay back at current rates. Consider raising rental rates.`,
              link: `/dashboard/assets/${asset.id}`,
            })
          }
        }
      }

      // Missing market data
      const missingMarketData = await prisma.asset.count({
        where: {
          marketPrice: null,
          totalQuantity: { gt: 0 },
          units: { some: { totalRevenue: { gt: 0 } } },
        },
      })

      if (missingMarketData > 5) {
        insights.push({
          id: 'pricing-missing',
          type: 'pricing',
          category: 'asset',
          priority: 'medium',
          title: 'Missing Market Data',
          // v1 read "Enable NowBot Market Insights" here. NowBot is dropped in
          // v2, so that sentence pointed at a feature that no longer exists —
          // and a flag whose next action doesn't exist is worse than no flag.
          description: `${missingMarketData} revenue-generating assets have no market reference price, so neither their ROI position nor a suggested rate can be worked out. Set one on the asset, or from the pricing report.`,
          link: '/dashboard/reports/pricing',
        })
      }
    }

    // --- 10a. Stale Market Prices ---
    {
      const thirtyDaysAgoMs = now.getTime() - 30 * 24 * 60 * 60 * 1000
      const staleAssets = marketPriceData.filter(
        (a) =>
          a.marketPrice &&
          a.marketPriceUpdatedAt &&
          new Date(a.marketPriceUpdatedAt).getTime() < thirtyDaysAgoMs
      )

      if (staleAssets.length >= 3) {
        insights.push({
          id: 'market-stale',
          type: 'market_shift',
          category: 'asset',
          priority: staleAssets.length >= 10 ? 'high' : 'medium',
          title: 'Stale Market Data',
          description: `${staleAssets.length} assets have market prices older than 30 days. Run a market price refresh to keep rental rates competitive.`,
          link: '/dashboard/reports/pricing',
        })
      }
    }

    // --- 10b. Market Price Shifts ---
    {
      for (const asset of marketPriceData) {
        if (!asset.marketPrice || !asset.monthlyRate) continue
        const marketPrice = Number(asset.marketPrice)
        const monthlyRate = Number(asset.monthlyRate)
        if (marketPrice <= 0 || monthlyRate <= 0) continue

        const avgPurchase =
          asset.units.length > 0
            ? asset.units.reduce((s, u) => s + Number(u.purchasePrice || 0), 0) /
              asset.units.length
            : 0

        if (avgPurchase <= 0) continue

        const marketVsPurchase = (marketPrice - avgPurchase) / avgPurchase

        // Market price dropped significantly below purchase price
        if (marketVsPurchase < -0.3) {
          insights.push({
            id: `mkt-drop-${asset.id}`,
            type: 'market_shift',
            category: 'asset',
            priority: 'high',
            title: 'Market Value Drop',
            description: `${asset.name} market price is ${Math.abs(Math.round(marketVsPurchase * 100))}% below purchase price. Review rental rates and consider depreciation impact.`,
            link: `/dashboard/assets/${asset.id}`,
          })
        }

        // Market price significantly above purchase price — opportunity
        if (marketVsPurchase > 0.2) {
          insights.push({
            id: `mkt-rise-${asset.id}`,
            type: 'market_shift',
            category: 'asset',
            priority: 'medium',
            title: 'Market Value Increase',
            description: `${asset.name} market price is ${Math.round(marketVsPurchase * 100)}% above purchase price. Your asset is appreciating — consider raising rental rates.`,
            link: `/dashboard/assets/${asset.id}`,
          })
        }
      }
    }

    // --- 10c. Rate Adjustment Recommendations ---
    {
      const TARGET_PAYBACK_MONTHS = 7
      for (const asset of marketPriceData) {
        if (!asset.marketPrice || !asset.monthlyRate) continue
        const marketPrice = Number(asset.marketPrice)
        const monthlyRate = Number(asset.monthlyRate)
        if (marketPrice <= 0 || monthlyRate <= 0) continue

        const suggestedMonthly = marketPrice / TARGET_PAYBACK_MONTHS
        const rateGap = (suggestedMonthly - monthlyRate) / monthlyRate

        // Suggested rate is >25% higher than current — revenue opportunity
        if (rateGap > 0.25) {
          insights.push({
            id: `rate-adj-${asset.id}`,
            type: 'market_shift',
            category: 'asset',
            priority: 'high',
            title: 'Rate Increase Opportunity',
            description: `${asset.name} could yield $${Math.round(suggestedMonthly)}/mo based on market value (vs current $${Math.round(monthlyRate)}/mo). Potential ${Math.round(rateGap * 100)}% rate increase.`,
            link: `/dashboard/assets/${asset.id}`,
          })
        }
      }
    }

    // --- 11. Negative-Margin Orders ---
    {
      const negativeMarginOrders = marginReservationData.filter(
        (r) => Number(r.totalMargin) < 0
      )

      if (negativeMarginOrders.length > 0) {
        insights.push({
          id: 'margin-negative',
          type: 'pricing',
          category: 'business',
          priority: 'high',
          title: `${negativeMarginOrders.length} order${negativeMarginOrders.length !== 1 ? 's' : ''} ha${negativeMarginOrders.length !== 1 ? 've' : 's'} negative margins`,
          description: `${negativeMarginOrders.length} active order${negativeMarginOrders.length !== 1 ? 's are' : ' is'} losing money. Review pricing and internal costs.`,
          link: '/dashboard/reservations',
        })
      }
    }

    // --- 12. Low-Margin Orders (below 10%) ---
    {
      const lowMarginOrders = marginReservationData.filter((r) => {
        const margin = Number(r.totalMargin)
        const subtotal = Number(r.subtotal)
        return margin > 0 && subtotal > 0 && margin / subtotal < 0.1
      })

      if (lowMarginOrders.length > 0) {
        insights.push({
          id: 'margin-low',
          type: 'pricing',
          category: 'business',
          priority: 'medium',
          title: `${lowMarginOrders.length} order${lowMarginOrders.length !== 1 ? 's' : ''} ha${lowMarginOrders.length !== 1 ? 've' : 's'} margins below 10%`,
          description: `${lowMarginOrders.length} active order${lowMarginOrders.length !== 1 ? 's have' : ' has'} thin profit margins under 10%. Consider adjusting rates.`,
          link: '/dashboard/reservations',
        })
      }
    }

    // --- 13. Under-Performing Leases ---
    {
      const underperformingLeases: { id: string; name: string; coverage: number }[] = []

      for (const lease of activeLeaseData) {
        const monthlyPayment = Number(lease.monthlyPayment)
        if (monthlyPayment <= 0) continue

        const monthsElapsed = Math.max(
          1,
          (now.getTime() - new Date(lease.startDate).getTime()) / (30.44 * 24 * 60 * 60 * 1000)
        )
        const totalPayments = monthlyPayment * monthsElapsed
        const totalRevenue = (lease.assetUnits || []).reduce(
          (sum: number, u: { totalRevenue: any }) => sum + Number(u.totalRevenue),
          0
        )
        const coverage = totalRevenue / totalPayments

        if (coverage < 0.7) {
          underperformingLeases.push({
            id: lease.id,
            name: lease.leaseName,
            coverage,
          })
        }
      }

      if (underperformingLeases.length > 0) {
        const worstCoverage = Math.min(...underperformingLeases.map((l) => l.coverage))
        insights.push({
          id: 'lease-coverage',
          type: 'roi',
          category: 'asset',
          priority: worstCoverage < 0.4 ? 'high' : 'medium',
          title: `${underperformingLeases.length} lease${underperformingLeases.length !== 1 ? 's have' : ' has'} low revenue coverage`,
          description: `${underperformingLeases.length} active lease${underperformingLeases.length !== 1 ? 's are' : ' is'} generating less revenue than their payments. Worst coverage ratio is ${Math.round(worstCoverage * 100)}%.`,
          link: '/dashboard/leases',
        })
      }
    }

    // Group by priority, then order within each tier. The capped read shuffles
    // so the Overview's two slots rotate; the full read sorts by type and id so
    // the same list comes back twice running.
    const high = insights.filter((i) => i.priority === 'high')
    const medium = insights.filter((i) => i.priority === 'medium')
    const low = insights.filter((i) => i.priority === 'low')

    // Fisher-Yates shuffle
    const shuffle = <T>(arr: T[]): T[] => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[arr[i], arr[j]] = [arr[j], arr[i]]
      }
      return arr
    }

    const settle = (tier: Insight[]) =>
      options.shuffle
        ? shuffle(tier)
        : tier.sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id))

    const sorted = [...settle(high), ...settle(medium), ...settle(low)]

    return options.limit === null ? sorted : sorted.slice(0, options.limit)
  } catch (error) {
    console.error('Failed to generate insights:', error)
    return []
  }
}

/**
 * Generate system flags — data quality / completeness warnings.
 * These are not capped like business insights; return all issues found.
 *
 * v2 addition: consistency checks that report rather than repair live in
 * `./data-integrity`, and are folded in below. They never write — where the
 * data disagrees with itself, a backfill picked by guesswork would bury the
 * evidence and make the wrong number permanent.
 */
export async function getSystemFlags(): Promise<Insight[]> {
  const board = await getSystemFlagBoard()
  return [...board.consistency, ...board.completeness]
}

/**
 * The same flags, split the way the Insights screen shows them.
 *
 * Completeness and consistency are different problems and want different
 * answers. "This asset has no rate" is a gap somebody fills in a minute.
 * "This order says six of a thing and has three attached" is a disagreement
 * between two records, and the fix needs whoever knows what happened in the
 * warehouse — which is why `./data-integrity` reports it and never repairs it.
 *
 * Flattening them into one priority-sorted list buries the second kind: the
 * import-doubling flags are deliberately `low` (nothing is broken for anyone
 * standing at a shelf), so they sink under every missing rate on the screen
 * that is supposed to be reporting them.
 */
export async function getSystemFlagBoard(): Promise<{
  consistency: Insight[]
  completeness: Insight[]
}> {
  const authResult = await requireAuth()
  if (!authResult.authorized) return { consistency: [], completeness: [] }

  try {
    const now = new Date()
    const threeMonthsAgo = new Date(now)
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

    const [
      assetsNoRates,
      unitsNoPurchasePrice,
      lowStockAssets,
      unitCountDrift,
      inventoryStateDrift,
    ] = await Promise.all([
      // Assets with active units but no rental rates at all
      prisma.asset.findMany({
        where: {
          dailyRate: null,
          weeklyRate: null,
          monthlyRate: null,
          units: { some: { status: { notIn: ['RETIRED', 'SOLD'] } } },
        },
        select: {
          id: true,
          name: true,
          _count: { select: { units: { where: { status: { notIn: ['RETIRED', 'SOLD'] } } } } },
        },
        orderBy: { name: 'asc' },
      }),

      // Active units with no purchase price
      prisma.assetUnit.findMany({
        where: {
          purchasePrice: null,
          status: { notIn: ['RETIRED', 'SOLD'] },
        },
        select: {
          id: true,
          barcode: true,
          asset: { select: { id: true, name: true } },
        },
        orderBy: { asset: { name: 'asc' } },
      }),

      // Assets with 0-1 available units that have had recent checkout activity
      prisma.asset.findMany({
        where: {
          totalQuantity: { gt: 0 },
          units: { some: { status: { notIn: ['RETIRED', 'SOLD'] } } },
        },
        select: {
          id: true,
          name: true,
          units: {
            where: { status: { notIn: ['RETIRED', 'SOLD'] } },
            select: {
              status: true,
              _count: {
                select: {
                  checkouts: { where: { checkoutDate: { gte: threeMonthsAgo } } },
                },
              },
            },
          },
        },
      }),

      // Consistency, not completeness: reports, never repairs.
      getUnitCountDrift(),
      getInventoryStateDrift(),
    ])

    const consistency: Insight[] = [...inventoryStateDrift, ...unitCountDrift]
    const flags: Insight[] = []

    // --- No rental rates ---
    for (const asset of assetsNoRates) {
      flags.push({
        id: `sys-no-rate-${asset.id}`,
        type: 'system',
        category: 'system',
        priority: 'high',
        title: 'No Rental Rates Set',
        description: `${asset.name} (${asset._count.units} unit${asset._count.units !== 1 ? 's' : ''}) has no daily, weekly, or monthly rate configured.`,
        link: `/dashboard/assets/${asset.id}`,
      })
    }

    // --- No purchase price — group by asset ---
    const noPriceByAsset = new Map<string, { name: string; id: string; count: number }>()
    for (const unit of unitsNoPurchasePrice) {
      const existing = noPriceByAsset.get(unit.asset.id)
      if (existing) {
        existing.count++
      } else {
        noPriceByAsset.set(unit.asset.id, { name: unit.asset.name, id: unit.asset.id, count: 1 })
      }
    }
    for (const [, asset] of noPriceByAsset) {
      flags.push({
        id: `sys-no-price-${asset.id}`,
        type: 'system',
        category: 'system',
        priority: 'medium',
        title: 'Missing Purchase Price',
        description: `${asset.name} has ${asset.count} unit${asset.count !== 1 ? 's' : ''} with no purchase price recorded. This affects ROI and depreciation tracking.`,
        link: `/dashboard/assets/${asset.id}`,
      })
    }

    // --- Low stock with recent activity ---
    for (const asset of lowStockAssets) {
      const availableCount = asset.units.filter((u) => u.status === 'AVAILABLE').length
      const totalCheckouts = asset.units.reduce((sum, u) => sum + u._count.checkouts, 0)

      if (availableCount <= 1 && totalCheckouts >= 3) {
        flags.push({
          id: `sys-low-stock-${asset.id}`,
          type: 'inventory',
          category: 'asset',
          priority: availableCount === 0 ? 'high' : 'medium',
          title: 'Low Stock — Consider Buying More',
          description: `${asset.name} has ${availableCount === 0 ? 'no' : 'only 1'} available unit${availableCount !== 1 ? 's' : ''} with ${totalCheckouts} checkout${totalCheckouts !== 1 ? 's' : ''} in the last 3 months.`,
          link: `/dashboard/assets/${asset.id}`,
        })
      }
    }

    // Sort: high first, then medium, then low
    const priorityOrder: Record<InsightPriority, number> = { high: 0, medium: 1, low: 2 }
    const byPriority = (a: Insight, b: Insight) =>
      priorityOrder[a.priority] - priorityOrder[b.priority] || a.id.localeCompare(b.id)
    flags.sort(byPriority)
    consistency.sort(byPriority)

    return { consistency, completeness: flags }
  } catch (error) {
    console.error('Failed to generate system flags:', error)
    return { consistency: [], completeness: [] }
  }
}
