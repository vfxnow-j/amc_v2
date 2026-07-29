'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { requireEditor } from '@/lib/auth-utils'
import { serialize } from '@/lib/utils'
import { parseExcelBuffer, getCellString, getCellNumber, getCellDate, type ExcelRow } from '@/lib/excel'
import { generateBarcode } from '@/lib/utils/barcode'
import { addYears } from 'date-fns'

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024 // 10MB

// ============================================
// TYPES
// ============================================

export type ParsedAsset = {
  rowNumber: number
  barcode: string
  assetNumber?: string
  name: string
  description?: string
  categoryName?: string
  subCategory?: string
  status: 'AVAILABLE' | 'CHECKED_OUT' | 'MAINTENANCE' | 'RETIRED'
  locationName?: string
  vendorName?: string
  purchasePrice?: number
  purchaseDate?: Date
  custodyName?: string
  errors: { field: string; message: string }[]
  isValid: boolean
}

export type ImportPreview = {
  totalRows: number
  validRows: number
  invalidRows: number
  errors: { row: number; field: string; message: string }[]
  categories: string[]
  locations: string[]
  vendors: string[]
  clients: string[]
  assets: ParsedAsset[]
}

export type ImportOptions = {
  createMissingCategories: boolean
  createMissingLocations: boolean
  createMissingVendors: boolean
  createMissingClients: boolean
  createReservationsFromCustody: boolean
  updateExisting: boolean
  defaultDailyRate?: number
  defaultWeeklyRate?: number
  defaultMonthlyRate?: number
}

export type ImportResult = {
  success: boolean
  assetsCreated: number
  assetsUpdated: number
  assetsSkipped: number
  categoriesCreated: number
  locationsCreated: number
  vendorsCreated: number
  clientsCreated: number
  reservationsCreated: number
  errors: { row: number; field: string; message: string }[]
}

// ============================================
// EXCEL COLUMN MAPPING
// ============================================

// Pad numeric-only values to 6 digits to preserve leading zeros from asset tags
// e.g. Excel reads "006634" as number 6634, this restores it to "006634"
function padAssetId(value: unknown): string {
  const str = String(value || '').trim()
  if (!str) return ''
  // If purely numeric (possibly stripped of leading zeros), pad to 6 digits
  if (/^\d+$/.test(str) && str.length < 6) {
    return str.padStart(6, '0')
  }
  return str
}

const COLUMN_MAP = {
  barcode: 'Asset - Asset Identification Number',
  assetNumber: 'Asset - Asset#',
  name: 'Asset - Name',
  description: 'Asset - Description',
  category: 'Asset - Group',
  subCategory: 'Asset - Subgroup',
  status: 'Asset - State',
  location: 'Asset - Location',
  vendor: 'Asset - Vendor',
  purchasePrice: 'Asset - Cost Price ($)',
  purchaseDate: 'Asset - Purchased On',
  custody: 'Asset - Custody (Full Name)',
}

const STATUS_MAP: Record<string, 'AVAILABLE' | 'CHECKED_OUT' | 'MAINTENANCE' | 'RETIRED'> = {
  'Available': 'AVAILABLE',
  'Rented Out': 'CHECKED_OUT',
  'Under Maintenance': 'MAINTENANCE',
  'Retired': 'RETIRED',
  'In Storage': 'AVAILABLE',
  'available': 'AVAILABLE',
  'rented out': 'CHECKED_OUT',
  'under maintenance': 'MAINTENANCE',
  'retired': 'RETIRED',
  'in storage': 'AVAILABLE',
}

// ============================================
// PARSE EXCEL FILE
// ============================================

export async function parseExcelFile(formData: FormData): Promise<ImportPreview> {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  const file = formData.get('file') as File
  if (!file) {
    throw new Error('No file uploaded')
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new Error('File too large. Maximum size is 10MB.')
  }

  const bytes = await file.arrayBuffer()
  const rawData = await parseExcelBuffer(bytes)

  const assets: ParsedAsset[] = []
  const errors: { row: number; field: string; message: string }[] = []
  const categories = new Set<string>()
  const locations = new Set<string>()
  const vendors = new Set<string>()
  const clients = new Set<string>()

  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i]
    const rowNumber = i + 2 // Excel rows start at 1, plus header row
    const assetErrors: { field: string; message: string }[] = []

    // Extract barcode (required) - pad numeric IDs to 6 digits to preserve leading zeros
    const barcode = padAssetId(row[COLUMN_MAP.barcode])
    if (!barcode) {
      assetErrors.push({ field: 'barcode', message: 'Asset Identification Number is required' })
    }

    // Extract name (required)
    const name = String(row[COLUMN_MAP.name] || '').trim()
    if (!name) {
      assetErrors.push({ field: 'name', message: 'Name is required' })
    }

    // Extract other fields
    const assetNumber = padAssetId(row[COLUMN_MAP.assetNumber]) || undefined
    const description = String(row[COLUMN_MAP.description] || '').trim() || undefined
    const categoryName = String(row[COLUMN_MAP.category] || '').trim() || undefined
    const subCategory = String(row[COLUMN_MAP.subCategory] || '').trim() || undefined
    const locationName = String(row[COLUMN_MAP.location] || '').trim() || undefined
    const vendorName = String(row[COLUMN_MAP.vendor] || '').trim() || undefined
    const custodyName = String(row[COLUMN_MAP.custody] || '').trim() || undefined

    // Parse status
    const statusRaw = String(row[COLUMN_MAP.status] || '').trim()
    let status: 'AVAILABLE' | 'CHECKED_OUT' | 'MAINTENANCE' | 'RETIRED' = 'AVAILABLE'
    if (statusRaw) {
      const mappedStatus = STATUS_MAP[statusRaw]
      if (mappedStatus) {
        status = mappedStatus
      } else {
        assetErrors.push({ field: 'status', message: `Unknown status: ${statusRaw}` })
      }
    }

    // Parse purchase price
    let purchasePrice: number | undefined
    const priceRaw = row[COLUMN_MAP.purchasePrice]
    if (priceRaw !== '' && priceRaw !== null && priceRaw !== undefined) {
      const parsed = parseFloat(String(priceRaw).replace(/[$,]/g, ''))
      if (!isNaN(parsed)) {
        purchasePrice = parsed
      }
    }

    // Parse purchase date
    let purchaseDate: Date | undefined
    const dateRaw = row[COLUMN_MAP.purchaseDate]
    if (dateRaw) {
      if (dateRaw instanceof Date) {
        purchaseDate = dateRaw
      } else {
        const parsed = new Date(String(dateRaw))
        if (!isNaN(parsed.getTime())) {
          purchaseDate = parsed
        }
      }
    }

    // Collect unique values for entity creation
    if (categoryName) categories.add(categoryName)
    if (locationName) locations.add(locationName)
    if (vendorName) vendors.add(vendorName)
    if (custodyName) clients.add(custodyName)

    const isValid = assetErrors.length === 0

    // Add errors to global list
    assetErrors.forEach((err) => {
      errors.push({ row: rowNumber, ...err })
    })

    assets.push({
      rowNumber,
      barcode,
      assetNumber,
      name,
      description,
      categoryName,
      subCategory,
      status,
      locationName,
      vendorName,
      purchasePrice,
      purchaseDate,
      custodyName,
      errors: assetErrors,
      isValid,
    })
  }

  return {
    totalRows: assets.length,
    validRows: assets.filter((a) => a.isValid).length,
    invalidRows: assets.filter((a) => !a.isValid).length,
    errors,
    categories: Array.from(categories).sort(),
    locations: Array.from(locations).sort(),
    vendors: Array.from(vendors).sort(),
    clients: Array.from(clients).sort(),
    assets,
  }
}

// ============================================
// EXECUTE IMPORT (Two-Tier: Asset + AssetUnit)
// ============================================

export async function executeImport(
  assets: ParsedAsset[],
  options: ImportOptions
): Promise<ImportResult> {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  const result: ImportResult = {
    success: false,
    assetsCreated: 0,
    assetsUpdated: 0,
    assetsSkipped: 0,
    categoriesCreated: 0,
    locationsCreated: 0,
    vendorsCreated: 0,
    clientsCreated: 0,
    reservationsCreated: 0,
    errors: [],
  }

  // Filter to valid assets only
  const validAssets = assets.filter((a) => a.isValid)

  // Collect unique entities to create
  const categoryNames = [...new Set(validAssets.map((a) => a.categoryName).filter(Boolean) as string[])]
  const locationNames = [...new Set(validAssets.map((a) => a.locationName).filter(Boolean) as string[])]
  const vendorNames = [...new Set(validAssets.map((a) => a.vendorName).filter(Boolean) as string[])]
  const clientNames = [...new Set(validAssets.map((a) => a.custodyName).filter(Boolean) as string[])]

  try {
    await prisma.$transaction(async (tx) => {
      // ============================================
      // 1. CREATE/FIND CATEGORIES
      // ============================================
      const categoryMap = new Map<string, string>() // name -> id

      if (categoryNames.length > 0) {
        // Find existing categories
        const existingCategories = await tx.assetCategory.findMany({
          where: { name: { in: categoryNames } },
        })
        existingCategories.forEach((cat) => categoryMap.set(cat.name, cat.id))

        // Create missing categories if option enabled
        if (options.createMissingCategories) {
          const missingCategoryNames = categoryNames.filter((name) => !categoryMap.has(name))
          for (const name of missingCategoryNames) {
            const newCat = await tx.assetCategory.create({
              data: { name },
            })
            categoryMap.set(name, newCat.id)
            result.categoriesCreated++
          }
        }
      }

      // ============================================
      // 2. CREATE/FIND LOCATIONS
      // ============================================
      const locationMap = new Map<string, string>() // name -> id

      if (locationNames.length > 0) {
        const existingLocations = await tx.location.findMany({
          where: { name: { in: locationNames } },
        })
        existingLocations.forEach((loc) => locationMap.set(loc.name, loc.id))

        if (options.createMissingLocations) {
          const missingLocationNames = locationNames.filter((name) => !locationMap.has(name))
          for (const name of missingLocationNames) {
            const newLoc = await tx.location.create({
              data: { name },
            })
            locationMap.set(name, newLoc.id)
            result.locationsCreated++
          }
        }
      }

      // ============================================
      // 3. CREATE/FIND VENDORS
      // ============================================
      const vendorMap = new Map<string, string>() // name -> id

      if (vendorNames.length > 0) {
        const existingVendors = await tx.vendor.findMany({
          where: { name: { in: vendorNames } },
        })
        existingVendors.forEach((ven) => vendorMap.set(ven.name, ven.id))

        if (options.createMissingVendors) {
          const missingVendorNames = vendorNames.filter((name) => !vendorMap.has(name))
          for (const name of missingVendorNames) {
            const newVen = await tx.vendor.create({
              data: { name },
            })
            vendorMap.set(name, newVen.id)
            result.vendorsCreated++
          }
        }
      }

      // ============================================
      // 4. CREATE/FIND CLIENTS (for custody)
      // ============================================
      const clientMap = new Map<string, string>() // name -> id

      if (clientNames.length > 0) {
        const existingClients = await tx.client.findMany({
          where: { name: { in: clientNames } },
        })
        existingClients.forEach((cli) => clientMap.set(cli.name, cli.id))

        if (options.createMissingClients) {
          const missingClientNames = clientNames.filter((name) => !clientMap.has(name))
          for (const name of missingClientNames) {
            const newCli = await tx.client.create({
              data: { name },
            })
            clientMap.set(name, newCli.id)
            result.clientsCreated++
          }
        }
      }

      // ============================================
      // 5. CREATE/UPDATE ASSETS + ASSET UNITS
      // ============================================
      // In the two-tier model:
      //   Asset = product type (grouped by name + category)
      //   AssetUnit = physical instance (has barcode, serial, status, location)
      //
      // Each imported row is a physical unit. We group rows by name
      // to find or create the parent Asset (product type), then create
      // or update the AssetUnit for each row.

      // Track asset units by custody for reservation creation
      const unitsByCustody = new Map<string, { assetUnitId: string; assetId: string; clientId: string }[]>()

      // Find existing AssetUnits by barcode to detect updates vs creates
      const existingBarcodes = validAssets.map((a) => a.barcode)
      const existingUnits = await tx.assetUnit.findMany({
        where: { barcode: { in: existingBarcodes } },
        include: { asset: true },
      })
      const existingUnitMap = new Map(existingUnits.map((u) => [u.barcode, u]))

      // Cache for product-type Assets keyed by "name|categoryId"
      // so we find-or-create one Asset per unique product type
      const productTypeCache = new Map<string, string>() // "name|categoryId" -> assetId

      // Pre-load existing Assets by name to speed up matching
      const uniqueNames = [...new Set(validAssets.map((a) => a.name))]
      const existingAssets = await tx.asset.findMany({
        where: { name: { in: uniqueNames } },
        select: { id: true, name: true, categoryId: true, totalQuantity: true },
      })
      for (const a of existingAssets) {
        productTypeCache.set(`${a.name}|${a.categoryId}`, a.id)
      }

      // Helper: resolve or create the "Uncategorized" category
      async function getUncategorizedId(): Promise<string> {
        if (categoryMap.has('Uncategorized')) {
          return categoryMap.get('Uncategorized')!
        }
        let uncategorized = await tx.assetCategory.findFirst({
          where: { name: 'Uncategorized' },
        })
        if (!uncategorized) {
          uncategorized = await tx.assetCategory.create({
            data: { name: 'Uncategorized' },
          })
          result.categoriesCreated++
        }
        categoryMap.set('Uncategorized', uncategorized.id)
        return uncategorized.id
      }

      // Helper: find or create a product-type Asset for a given name + categoryId
      async function findOrCreateProductType(
        name: string,
        resolvedCategoryId: string,
        description: string | undefined,
        assetNumber: string | undefined,
        subCategory: string | undefined,
        vendorId: string | undefined,
      ): Promise<string> {
        const cacheKey = `${name}|${resolvedCategoryId}`
        const cached = productTypeCache.get(cacheKey)
        if (cached) return cached

        // Also try matching by name alone (any category) to avoid duplicates
        // when category might differ slightly between rows
        const existingByName = await tx.asset.findFirst({
          where: { name },
          select: { id: true, categoryId: true },
        })

        if (existingByName) {
          productTypeCache.set(cacheKey, existingByName.id)
          // Also cache by the existing category in case future rows match
          productTypeCache.set(`${name}|${existingByName.categoryId}`, existingByName.id)
          return existingByName.id
        }

        // Create new product-type Asset
        const newAsset = await tx.asset.create({
          data: {
            name,
            description,
            assetNumber,
            subCategory,
            categoryId: resolvedCategoryId,
            vendorId,
            dailyRate: options.defaultDailyRate,
            weeklyRate: options.defaultWeeklyRate,
            monthlyRate: options.defaultMonthlyRate,
            totalQuantity: 0, // Will be incremented when units are added
          },
        })

        productTypeCache.set(cacheKey, newAsset.id)
        return newAsset.id
      }

      // Track which Asset IDs had units added so we can update totalQuantity
      const assetUnitsAdded = new Map<string, number>() // assetId -> count of new units

      for (const asset of validAssets) {
        const categoryId = asset.categoryName ? categoryMap.get(asset.categoryName) : undefined
        const locationId = asset.locationName ? locationMap.get(asset.locationName) : undefined
        const vendorId = asset.vendorName ? vendorMap.get(asset.vendorName) : undefined

        // Skip if category is required but not found
        if (asset.categoryName && !categoryId) {
          result.errors.push({
            row: asset.rowNumber,
            field: 'category',
            message: `Category "${asset.categoryName}" not found and auto-create is disabled`,
          })
          result.assetsSkipped++
          continue
        }

        const existingUnit = existingUnitMap.get(asset.barcode)

        if (existingUnit) {
          // ---- UPDATE EXISTING UNIT ----
          if (options.updateExisting) {
            // Update the AssetUnit (physical instance)
            await tx.assetUnit.update({
              where: { id: existingUnit.id },
              data: {
                status: asset.status,
                locationId: locationId ?? existingUnit.locationId,
                purchasePrice: asset.purchasePrice,
                purchaseDate: asset.purchaseDate,
              },
            })

            // Update the parent Asset (product type) with latest info
            const resolvedCategoryId = categoryId || existingUnit.asset.categoryId
            await tx.asset.update({
              where: { id: existingUnit.assetId },
              data: {
                name: asset.name,
                description: asset.description,
                assetNumber: asset.assetNumber,
                subCategory: asset.subCategory,
                categoryId: resolvedCategoryId,
                vendorId: vendorId ?? existingUnit.asset.vendorId,
                // Apply default rates only if not already set
                dailyRate: existingUnit.asset.dailyRate ?? options.defaultDailyRate,
                weeklyRate: existingUnit.asset.weeklyRate ?? options.defaultWeeklyRate,
                monthlyRate: existingUnit.asset.monthlyRate ?? options.defaultMonthlyRate,
              },
            })
            result.assetsUpdated++

            // Track for custody reservation
            if (asset.custodyName && clientMap.has(asset.custodyName)) {
              const entries = unitsByCustody.get(asset.custodyName) || []
              entries.push({
                assetUnitId: existingUnit.id,
                assetId: existingUnit.assetId,
                clientId: clientMap.get(asset.custodyName)!,
              })
              unitsByCustody.set(asset.custodyName, entries)
            }
          } else {
            result.assetsSkipped++
          }
        } else {
          // ---- CREATE NEW UNIT ----
          // Resolve the category for the product type
          const resolvedCategoryId = categoryId || await getUncategorizedId()

          // Find or create the parent Asset (product type)
          const parentAssetId = await findOrCreateProductType(
            asset.name,
            resolvedCategoryId,
            asset.description,
            asset.assetNumber,
            asset.subCategory,
            vendorId,
          )

          // Create the AssetUnit (physical instance)
          const newUnit = await tx.assetUnit.create({
            data: {
              assetId: parentAssetId,
              barcode: asset.barcode,
              status: asset.status,
              locationId,
              purchasePrice: asset.purchasePrice,
              purchaseDate: asset.purchaseDate || new Date(),
            },
          })

          // Track units added per asset for totalQuantity update
          assetUnitsAdded.set(parentAssetId, (assetUnitsAdded.get(parentAssetId) || 0) + 1)

          result.assetsCreated++

          // Track for custody reservation
          if (asset.custodyName && clientMap.has(asset.custodyName)) {
            const entries = unitsByCustody.get(asset.custodyName) || []
            entries.push({
              assetUnitId: newUnit.id,
              assetId: parentAssetId,
              clientId: clientMap.get(asset.custodyName)!,
            })
            unitsByCustody.set(asset.custodyName, entries)
          }
        }
      }

      // Update totalQuantity on each Asset that had new units added
      for (const [assetId, count] of assetUnitsAdded) {
        await tx.asset.update({
          where: { id: assetId },
          data: {
            totalQuantity: { increment: count },
          },
        })
      }

      // ============================================
      // 6. CREATE RESERVATIONS FROM CUSTODY
      // ============================================
      if (options.createReservationsFromCustody && unitsByCustody.size > 0) {
        // Generate reservation numbers
        const year = new Date().getFullYear()
        const lastRes = await tx.reservation.findFirst({
          where: { reservationNumber: { startsWith: `RES-${year}-` } },
          orderBy: { reservationNumber: 'desc' },
        })
        let resSequence = 1
        if (lastRes?.reservationNumber) {
          const match = lastRes.reservationNumber.match(/RES-\d{4}-(\d+)/)
          if (match) {
            resSequence = parseInt(match[1], 10) + 1
          }
        }

        const now = new Date()
        const endDate = addYears(now, 1)

        for (const [clientName, unitEntries] of unitsByCustody) {
          const clientId = unitEntries[0].clientId

          const reservationNumber = `RES-${year}-${String(resSequence++).padStart(5, '0')}`

          // Create reservation
          const reservation = await tx.reservation.create({
            data: {
              reservationNumber,
              clientId,
              startDate: now,
              endDate,
              status: 'ACTIVE',
              confirmedAt: now,
              projectName: `Imported custody for ${clientName}`,
              internalNotes: 'Auto-created from custody import',
              billingCycleType: 'MONTHLY',
              billingCycleDay: 1,
              createdById: session.user.id,
            },
          })

          // Group unit entries by assetId to create one ReservationItem per product type
          const entriesByAssetId = new Map<string, typeof unitEntries>()
          for (const entry of unitEntries) {
            const existing = entriesByAssetId.get(entry.assetId) || []
            existing.push(entry)
            entriesByAssetId.set(entry.assetId, existing)
          }

          for (const [assetId, entries] of entriesByAssetId) {
            // Create reservation item (one per product type in the reservation)
            const reservationItem = await tx.reservationItem.create({
              data: {
                reservationId: reservation.id,
                assetId,
                pricingType: 'MONTHLY',
                rate: options.defaultMonthlyRate || 0,
                quantity: entries.length,
                subtotal: (options.defaultMonthlyRate || 0) * entries.length,
                checkedOutCount: entries.length,
                checkedInCount: 0,
              },
            })

            // Create checkout records and reservation-item-unit links for each physical unit
            for (const entry of entries) {
              // Create checkout record referencing the AssetUnit
              await tx.checkout.create({
                data: {
                  assetUnitId: entry.assetUnitId,
                  clientId,
                  reservationId: reservation.id,
                  workflowType: 'RESERVATION',
                  status: 'ACTIVE',
                  checkoutDate: now,
                  expectedReturn: endDate,
                  pricingType: 'MONTHLY',
                  rate: options.defaultMonthlyRate,
                  createdById: session.user.id,
                  notes: 'Auto-created from custody import',
                },
              })

              // Link the specific unit to the reservation item
              await tx.reservationItemUnit.create({
                data: {
                  reservationItemId: reservationItem.id,
                  assetUnitId: entry.assetUnitId,
                  checkedOutAt: now,
                },
              })

              // Update asset unit status to CHECKED_OUT
              await tx.assetUnit.update({
                where: { id: entry.assetUnitId },
                data: { status: 'CHECKED_OUT' },
              })
            }
          }

          result.reservationsCreated++
        }
      }
    }, { timeout: 120000 }) // 2 minute timeout for large imports

    result.success = true
  } catch (error) {
    result.errors.push({
      row: 0,
      field: 'system',
      message: error instanceof Error ? error.message : 'Unknown error during import',
    })
  }

  revalidatePath('/dashboard/assets')
  revalidatePath('/dashboard/reservations')
  revalidatePath('/dashboard/clients')
  revalidatePath('/dashboard')

  return result
}

// ============================================
// BULK UPDATE ASSET RATES
// ============================================

export type BulkRateUpdateFilters = {
  categoryId?: string
  assetIds?: string[]
}

export type BulkRateUpdateData = {
  dailyRate?: number | null
  weeklyRate?: number | null
  monthlyRate?: number | null
}

export async function bulkUpdateAssetRates(
  filters: BulkRateUpdateFilters,
  data: BulkRateUpdateData
): Promise<{ success: boolean; updated: number; error?: string }> {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  try {
    // Build where clause - rates live on Asset (product type)
    // No status or locationId filters (those are on AssetUnit)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {}

    if (filters.assetIds && filters.assetIds.length > 0) {
      where.id = { in: filters.assetIds }
    }

    if (filters.categoryId) {
      where.categoryId = filters.categoryId
    }

    // Build update data (only include fields that are explicitly set)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {}

    if (data.dailyRate !== undefined) {
      updateData.dailyRate = data.dailyRate
    }
    if (data.weeklyRate !== undefined) {
      updateData.weeklyRate = data.weeklyRate
    }
    if (data.monthlyRate !== undefined) {
      updateData.monthlyRate = data.monthlyRate
    }

    const result = await prisma.asset.updateMany({
      where,
      data: updateData,
    })

    revalidatePath('/dashboard/assets')

    return { success: true, updated: result.count }
  } catch (error) {
    return {
      success: false,
      updated: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// ============================================
// GET ASSETS FOR BULK UPDATE (with filters)
// ============================================

export async function getAssetsForBulkUpdate(filters: BulkRateUpdateFilters = {}) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {}

  if (filters.categoryId) {
    where.categoryId = filters.categoryId
  }

  if (filters.assetIds && filters.assetIds.length > 0) {
    where.id = { in: filters.assetIds }
  }

  const assets = await prisma.asset.findMany({
    where,
    include: {
      category: true,
    },
    orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
  })

  return serialize(assets)
}

// ============================================
// RATE CARD IMPORT
// ============================================

export type RateCardRow = {
  name: string
  description?: string
  category?: string
  monthlyRate?: number
  salePrice?: number
}

export type RateCardPreview = {
  totalRows: number
  matchedAssets: number
  unmatchedNames: string[]
  updates: {
    assetId: string
    assetName: string
    currentMonthlyRate: number | null
    newMonthlyRate: number | null
    currentSalePrice: number | null
    newSalePrice: number | null
  }[]
}

export type RateCardResult = {
  success: boolean
  updated: number
  skipped: number
  errors: string[]
}

export async function parseRateCardFile(formData: FormData): Promise<RateCardPreview> {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const file = formData.get('file') as File
  if (!file) {
    throw new Error('No file provided')
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new Error('File too large. Maximum size is 10MB.')
  }

  const buffer = await file.arrayBuffer()
  const rawData = await parseExcelBuffer(buffer)

  // Parse rate card rows
  const rateCardRows: RateCardRow[] = []
  for (const row of rawData as Record<string, unknown>[]) {
    const name = String(row['Asset - Name'] || '').trim()

    // Skip empty rows or summary rows (e.g., "Name: xxx(1)")
    if (!name || name.startsWith('Name:') || name.includes('(1)')) {
      continue
    }

    // Parse monthly rate - handle currency format
    let monthlyRate: number | undefined
    const monthlyRaw = row['Rental Price - Monthly Rent']
    if (monthlyRaw !== undefined && monthlyRaw !== '') {
      const monthlyStr = String(monthlyRaw).replace(/[$,]/g, '')
      monthlyRate = parseFloat(monthlyStr)
      if (isNaN(monthlyRate)) monthlyRate = undefined
    }

    // Parse sale price - handle currency format
    let salePrice: number | undefined
    const saleRaw = row['Asset - Sale Price']
    if (saleRaw !== undefined && saleRaw !== '') {
      const saleStr = String(saleRaw).replace(/[$,]/g, '')
      salePrice = parseFloat(saleStr)
      if (isNaN(salePrice)) salePrice = undefined
    }

    rateCardRows.push({
      name,
      description: String(row['Asset - Description'] || '').trim() || undefined,
      category: String(row['Group - Name'] || '').trim() || undefined,
      monthlyRate,
      salePrice,
    })
  }

  // Match with existing Assets (product types) by name
  const allAssets = await prisma.asset.findMany({
    select: {
      id: true,
      name: true,
      monthlyRate: true,
      salePrice: true,
    },
  })

  // Create a map of asset names to assets (case-insensitive)
  const assetsByName = new Map<string, typeof allAssets[0][]>()
  for (const asset of allAssets) {
    const key = asset.name.toLowerCase().trim()
    if (!assetsByName.has(key)) {
      assetsByName.set(key, [])
    }
    assetsByName.get(key)!.push(asset)
  }

  const updates: RateCardPreview['updates'] = []
  const unmatchedNames: string[] = []
  const matchedAssetIds = new Set<string>()

  for (const row of rateCardRows) {
    const key = row.name.toLowerCase().trim()
    const matchingAssets = assetsByName.get(key)

    if (matchingAssets && matchingAssets.length > 0) {
      for (const asset of matchingAssets) {
        // Skip if already processed (dedupe)
        if (matchedAssetIds.has(asset.id)) continue
        matchedAssetIds.add(asset.id)

        // Only add if there's actually something to update
        const hasRateUpdate = row.monthlyRate !== undefined &&
          Number(asset.monthlyRate || 0) !== row.monthlyRate
        const hasSaleUpdate = row.salePrice !== undefined &&
          Number(asset.salePrice || 0) !== row.salePrice

        if (hasRateUpdate || hasSaleUpdate) {
          updates.push({
            assetId: asset.id,
            assetName: asset.name,
            currentMonthlyRate: asset.monthlyRate ? Number(asset.monthlyRate) : null,
            newMonthlyRate: row.monthlyRate ?? null,
            currentSalePrice: asset.salePrice ? Number(asset.salePrice) : null,
            newSalePrice: row.salePrice ?? null,
          })
        }
      }
    } else {
      if (!unmatchedNames.includes(row.name)) {
        unmatchedNames.push(row.name)
      }
    }
  }

  return {
    totalRows: rateCardRows.length,
    matchedAssets: matchedAssetIds.size,
    unmatchedNames: unmatchedNames.slice(0, 50), // Limit to first 50
    updates,
  }
}

export async function executeRateCardImport(
  updates: RateCardPreview['updates']
): Promise<RateCardResult> {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  const errors: string[] = []
  let updated = 0
  let skipped = 0

  for (const update of updates) {
    try {
      const updateData: { monthlyRate?: number; salePrice?: number } = {}

      if (update.newMonthlyRate !== null) {
        updateData.monthlyRate = update.newMonthlyRate
      }
      if (update.newSalePrice !== null) {
        updateData.salePrice = update.newSalePrice
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.asset.update({
          where: { id: update.assetId },
          data: updateData,
        })
        updated++
      } else {
        skipped++
      }
    } catch (error) {
      errors.push(`Failed to update ${update.assetName}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      skipped++
    }
  }

  revalidatePath('/dashboard/assets')

  return {
    success: errors.length === 0,
    updated,
    skipped,
    errors,
  }
}

// ============================================
// RETIRED ASSETS IMPORT
// ============================================

export type RetiredAssetRow = {
  rowNumber: number
  barcode: string
  assetNumber?: string
  name: string
  model?: string
  description?: string
  serialNumber?: string
  category?: string
  subCategory?: string
  location?: string
  vendor?: string
  purchasePrice?: number
  purchaseDate?: Date
  salvageValue?: number
  usefulLifeMonths?: number
  retiredOn?: Date
  retirementReason?: string
  comments?: string
}

export type RetiredAssetsPreview = {
  totalRows: number
  matchedAssets: number
  newAssets: number
  updates: {
    assetUnitId: string | null
    barcode: string
    name: string
    isNew: boolean
    retiredOn: Date | null
    retirementReason: string | null
  }[]
  errors: { row: number; message: string }[]
}

export type RetiredAssetsResult = {
  success: boolean
  updated: number
  created: number
  skipped: number
  errors: string[]
}

export async function parseRetiredAssetsFile(formData: FormData): Promise<RetiredAssetsPreview> {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const file = formData.get('file') as File
  if (!file) {
    throw new Error('No file provided')
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new Error('File too large. Maximum size is 10MB.')
  }

  const buffer = await file.arrayBuffer()
  const rawData = await parseExcelBuffer(buffer)

  const rows: RetiredAssetRow[] = []
  const errors: { row: number; message: string }[] = []

  let rowNum = 1
  for (const row of rawData as Record<string, unknown>[]) {
    rowNum++

    const barcode = padAssetId(row['Asset Identification Number'])
    const name = String(row['Name'] || '').trim()

    // Skip empty rows
    if (!barcode && !name) continue

    if (!barcode) {
      errors.push({ row: rowNum, message: 'Missing Asset Identification Number' })
      continue
    }

    // Parse dates
    let retiredOn: Date | undefined
    const retiredRaw = row['Retired On']
    if (retiredRaw) {
      if (typeof retiredRaw === 'number') {
        // Excel serial date
        retiredOn = new Date((retiredRaw - 25569) * 86400 * 1000)
      } else {
        const parsed = new Date(String(retiredRaw))
        if (!isNaN(parsed.getTime())) {
          retiredOn = parsed
        }
      }
    }

    let purchaseDate: Date | undefined
    const purchaseRaw = row['Purchased On']
    if (purchaseRaw) {
      if (typeof purchaseRaw === 'number') {
        purchaseDate = new Date((purchaseRaw - 25569) * 86400 * 1000)
      } else {
        const parsed = new Date(String(purchaseRaw))
        if (!isNaN(parsed.getTime())) {
          purchaseDate = parsed
        }
      }
    }

    // Parse numbers
    const parseNumber = (val: unknown): number | undefined => {
      if (val === undefined || val === '') return undefined
      const num = parseFloat(String(val).replace(/[$,]/g, ''))
      return isNaN(num) ? undefined : num
    }

    rows.push({
      rowNumber: rowNum,
      barcode,
      assetNumber: padAssetId(row['Asset#']) || undefined,
      name,
      model: String(row['Model'] || '').trim() || undefined,
      description: String(row['Description'] || '').trim() || undefined,
      serialNumber: String(row['Serial Number'] || '').trim() || undefined,
      category: String(row['Group'] || '').trim() || undefined,
      subCategory: String(row['Sub Group'] || '').trim() || undefined,
      location: String(row['Location'] || '').trim() || undefined,
      vendor: String(row['Vendor'] || '').trim() || undefined,
      purchasePrice: parseNumber(row['Cost Price ($)']),
      purchaseDate,
      salvageValue: parseNumber(row['Salvage Value ($)']),
      usefulLifeMonths: parseNumber(row['Straight Line Depreciation Useful Life (Months)']),
      retiredOn,
      retirementReason: String(row['Reason'] || '').trim() || undefined,
      comments: String(row['Comments'] || '').trim() || undefined,
    })
  }

  // Match with existing AssetUnits by barcode
  const barcodes = rows.map(r => r.barcode)
  const existingUnits = await prisma.assetUnit.findMany({
    where: { barcode: { in: barcodes } },
    select: {
      id: true,
      barcode: true,
      asset: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  })

  // Create lookup map by barcode
  const unitByBarcode = new Map<string, typeof existingUnits[0]>()
  for (const unit of existingUnits) {
    unitByBarcode.set(unit.barcode, unit)
  }

  const updates: RetiredAssetsPreview['updates'] = []
  let matchedCount = 0
  let newCount = 0

  for (const row of rows) {
    const existingUnit = unitByBarcode.get(row.barcode)

    if (existingUnit) {
      matchedCount++
      updates.push({
        assetUnitId: existingUnit.id,
        barcode: row.barcode,
        name: existingUnit.asset.name,
        isNew: false,
        retiredOn: row.retiredOn || null,
        retirementReason: row.retirementReason || null,
      })
    } else {
      newCount++
      updates.push({
        assetUnitId: null,
        barcode: row.barcode,
        name: row.name,
        isNew: true,
        retiredOn: row.retiredOn || null,
        retirementReason: row.retirementReason || null,
      })
    }
  }

  return {
    totalRows: rows.length,
    matchedAssets: matchedCount,
    newAssets: newCount,
    updates,
    errors,
  }
}

export async function executeRetiredAssetsImport(
  formData: FormData,
  options: { createNew: boolean }
): Promise<RetiredAssetsResult> {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  // Re-parse the file to get full row data
  const file = formData.get('file') as File
  if (!file) {
    throw new Error('No file provided')
  }

  const buffer = await file.arrayBuffer()
  const rawData = await parseExcelBuffer(buffer)

  const errors: string[] = []
  let updated = 0
  let created = 0
  let skipped = 0

  // Get or create default category for retired assets
  let defaultCategory = await prisma.assetCategory.findFirst({
    where: { name: 'Retired' },
  })
  if (!defaultCategory) {
    defaultCategory = await prisma.assetCategory.create({
      data: { name: 'Retired', description: 'Retired assets' },
    })
  }

  for (const row of rawData as Record<string, unknown>[]) {
    const barcode = padAssetId(row['Asset Identification Number'])
    const name = String(row['Name'] || '').trim()

    if (!barcode) continue

    // Parse dates and numbers
    let retiredOn: Date | undefined
    const retiredRaw = row['Retired On']
    if (retiredRaw) {
      if (typeof retiredRaw === 'number') {
        retiredOn = new Date((retiredRaw - 25569) * 86400 * 1000)
      } else {
        const parsed = new Date(String(retiredRaw))
        if (!isNaN(parsed.getTime())) retiredOn = parsed
      }
    }

    let purchaseDate: Date | undefined
    const purchaseRaw = row['Purchased On']
    if (purchaseRaw) {
      if (typeof purchaseRaw === 'number') {
        purchaseDate = new Date((purchaseRaw - 25569) * 86400 * 1000)
      } else {
        const parsed = new Date(String(purchaseRaw))
        if (!isNaN(parsed.getTime())) purchaseDate = parsed
      }
    }

    const parseNumber = (val: unknown): number | undefined => {
      if (val === undefined || val === '') return undefined
      const num = parseFloat(String(val).replace(/[$,]/g, ''))
      return isNaN(num) ? undefined : num
    }

    const retirementReason = String(row['Reason'] || '').trim() || undefined
    const comments = String(row['Comments'] || '').trim() || undefined
    const serialNumber = String(row['Serial Number'] || '').trim() || undefined
    const model = String(row['Model'] || '').trim() || undefined

    try {
      // Check if AssetUnit exists by barcode
      const existingUnit = await prisma.assetUnit.findUnique({
        where: { barcode },
        include: { asset: true },
      })

      if (existingUnit) {
        // Update existing AssetUnit to RETIRED status
        await prisma.assetUnit.update({
          where: { id: existingUnit.id },
          data: {
            status: 'RETIRED',
          },
        })

        // Update parent Asset retirement info
        await prisma.asset.update({
          where: { id: existingUnit.assetId },
          data: {
            retiredAt: retiredOn || new Date(),
            retirementReason,
            retirementNotes: comments,
          },
        })
        updated++
      } else if (options.createNew) {
        // Get or create category
        const categoryName = String(row['Group'] || '').trim() || 'Retired'
        let category = await prisma.assetCategory.findFirst({
          where: { name: categoryName },
        })
        if (!category) {
          category = await prisma.assetCategory.create({
            data: { name: categoryName },
          })
        }

        // Find or create the parent Asset (product type) by name
        let parentAsset = await prisma.asset.findFirst({
          where: { name },
        })

        if (!parentAsset) {
          // Create new product-type Asset
          parentAsset = await prisma.asset.create({
            data: {
              name,
              description: String(row['Description'] || '').trim() || undefined,
              model,
              assetNumber: padAssetId(row['Asset#']) || undefined,
              subCategory: String(row['Sub Group'] || '').trim() || undefined,
              categoryId: category.id,
              salvageValue: parseNumber(row['Salvage Value ($)']),
              usefulLifeMonths: parseNumber(row['Straight Line Depreciation Useful Life (Months)']) || 36,
              retiredAt: retiredOn || new Date(),
              retirementReason,
              retirementNotes: comments,
              totalQuantity: 0, // Will be incremented below
            },
          })
        } else {
          // Update existing product-type Asset with retirement info
          await prisma.asset.update({
            where: { id: parentAsset.id },
            data: {
              retiredAt: retiredOn || new Date(),
              retirementReason,
              retirementNotes: comments,
            },
          })
        }

        // Create new AssetUnit with RETIRED status
        await prisma.assetUnit.create({
          data: {
            assetId: parentAsset.id,
            barcode,
            serialNumber,
            status: 'RETIRED',
            purchasePrice: parseNumber(row['Cost Price ($)']),
            purchaseDate: purchaseDate || new Date(),
          },
        })

        // Increment totalQuantity on parent Asset
        await prisma.asset.update({
          where: { id: parentAsset.id },
          data: {
            totalQuantity: { increment: 1 },
          },
        })

        created++
      } else {
        skipped++
      }
    } catch (error) {
      errors.push(`Row ${barcode}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      skipped++
    }
  }

  revalidatePath('/dashboard/assets')

  return {
    success: errors.length === 0,
    updated,
    created,
    skipped,
    errors,
  }
}
