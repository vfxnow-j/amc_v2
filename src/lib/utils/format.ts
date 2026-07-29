import { format, formatDistanceToNow, isValid, parseISO } from 'date-fns'

/**
 * Format a number as currency
 */
export function formatCurrency(
  amount: number | string | null | undefined,
  currency = 'USD',
  locale = 'en-US'
): string {
  if (amount === null || amount === undefined) return '-'

  const numericAmount = typeof amount === 'string' ? parseFloat(amount) : amount

  if (isNaN(numericAmount)) return '-'

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numericAmount)
}

/**
 * Pin a calendar date to 12:00 UTC.
 *
 * Date-only values (quote expiry, etc.) are picked in the user's timezone but
 * rendered both server-side (PDFs, in the container's UTC) and client-side (the
 * online quote, in the customer's timezone). Storing local midnight makes the
 * printed day slip by one for anyone more than a few hours off; anchoring at
 * midday leaves ~12 hours of slack in either direction so every viewer sees the
 * same date the user picked.
 */
export function toDateOnlyUtc(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0))
}

/**
 * Format a date in various formats
 */
export function formatDate(
  date: Date | string | null | undefined,
  formatStr = 'MMM d, yyyy'
): string {
  if (!date) return '-'

  const dateObj = typeof date === 'string' ? parseISO(date) : date

  if (!isValid(dateObj)) return '-'

  return format(dateObj, formatStr)
}

/**
 * Format a date with time
 */
export function formatDateTime(
  date: Date | string | null | undefined,
  formatStr = 'MMM d, yyyy h:mm a'
): string {
  return formatDate(date, formatStr)
}

/**
 * Format a date as relative time (e.g., "2 days ago")
 */
export function formatRelativeDate(
  date: Date | string | null | undefined,
  options?: { addSuffix?: boolean }
): string {
  if (!date) return '-'

  const dateObj = typeof date === 'string' ? parseISO(date) : date

  if (!isValid(dateObj)) return '-'

  return formatDistanceToNow(dateObj, { addSuffix: options?.addSuffix ?? true })
}

/**
 * Format a percentage
 */
export function formatPercent(
  value: number | null | undefined,
  decimals = 1
): string {
  if (value === null || value === undefined) return '-'

  return `${value.toFixed(decimals)}%`
}

/**
 * Format a number with thousands separators
 */
export function formatNumber(
  value: number | string | null | undefined,
  locale = 'en-US'
): string {
  if (value === null || value === undefined) return '-'

  const numericValue = typeof value === 'string' ? parseFloat(value) : value

  if (isNaN(numericValue)) return '-'

  return new Intl.NumberFormat(locale).format(numericValue)
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string | null | undefined, length = 50): string {
  if (!text) return ''
  if (text.length <= length) return text
  return `${text.slice(0, length)}...`
}
