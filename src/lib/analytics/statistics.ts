import {
  linearRegression,
  linearRegressionLine,
  rSquared,
  mean,
  standardDeviation,
} from 'simple-statistics'

export type TrendResult = {
  slope: number
  intercept: number
  rSquared: number
  direction: 'up' | 'down' | 'flat'
  percentChangePerPeriod: number
}

/**
 * Compute linear trend over a series of values (assumed equally spaced).
 * Returns slope, R², direction, and percent change per period.
 */
export function linearTrend(values: number[]): TrendResult | null {
  if (values.length < 3) return null

  const points: [number, number][] = values.map((v, i) => [i, v])
  const regression = linearRegression(points)
  const line = linearRegressionLine(regression)
  const r2 = rSquared(points, line)
  const avg = mean(values)

  // Percent change per period relative to average
  const pctPerPeriod = avg !== 0 ? (regression.m / avg) * 100 : 0

  let direction: 'up' | 'down' | 'flat' = 'flat'
  if (r2 > 0.3) {
    direction = regression.m > 0 ? 'up' : 'down'
  }

  return {
    slope: regression.m,
    intercept: regression.b,
    rSquared: r2,
    direction,
    percentChangePerPeriod: Math.round(pctPerPeriod * 10) / 10,
  }
}

/**
 * Percent change between two values.
 */
export function percentChange(oldVal: number, newVal: number): number {
  if (oldVal === 0) return newVal > 0 ? 100 : 0
  return Math.round(((newVal - oldVal) / Math.abs(oldVal)) * 1000) / 10
}

export type ZScoreResult = {
  value: number
  zScore: number
  isAnomaly: boolean
}

/**
 * Compute z-scores for each value. Marks anomalies above threshold (default 2.0).
 */
export function zScores(values: number[], threshold = 2.0): ZScoreResult[] {
  if (values.length < 3) return values.map((v) => ({ value: v, zScore: 0, isAnomaly: false }))

  const avg = mean(values)
  const sd = standardDeviation(values)

  if (sd === 0) return values.map((v) => ({ value: v, zScore: 0, isAnomaly: false }))

  return values.map((v) => {
    const z = (v - avg) / sd
    return { value: v, zScore: Math.round(z * 100) / 100, isAnomaly: Math.abs(z) > threshold }
  })
}

/**
 * Simple moving average over a window.
 */
export function movingAverage(values: number[], window: number): number[] {
  if (values.length < window) return []
  const result: number[] = []
  for (let i = 0; i <= values.length - window; i++) {
    const slice = values.slice(i, i + window)
    result.push(mean(slice))
  }
  return result
}
