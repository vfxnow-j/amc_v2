import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Recursively serializes Prisma results to plain objects.
 * Converts Decimal objects to numbers and Date objects to ISO strings for JSON compatibility.
 */
export function serialize<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(item => serialize(item)) as T
  }

  if (obj instanceof Date) {
    return obj.toISOString() as T
  }

  // Check for Prisma Decimal (has toNumber method)
  if (typeof obj === 'object' && 'toNumber' in obj && typeof (obj as { toNumber: () => number }).toNumber === 'function') {
    return (obj as { toNumber: () => number }).toNumber() as T
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[key] = serialize((obj as Record<string, unknown>)[key])
      }
    }
    return result as T
  }

  return obj
}
