'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireEditor, requireAdmin } from '@/lib/auth-utils'
import { serialize } from '@/lib/utils'
import { logAudit } from './audit'

// ============================================
// CATEGORIES
// ============================================

export type CategoryFormData = {
  name: string
  description?: string
  isConfigurable?: boolean
  isComponent?: boolean
}

export async function getCategories(search?: string) {
  const categories = await prisma.assetCategory.findMany({
    where: search
      ? { name: { contains: search, mode: 'insensitive' } }
      : undefined,
    include: {
      _count: {
        select: { assets: true },
      },
    },
    orderBy: { name: 'asc' },
  })

  return serialize(categories)
}

export async function getCategory(id: string) {
  const category = await prisma.assetCategory.findUnique({
    where: { id },
    include: {
      _count: {
        select: { assets: true },
      },
    },
  })

  if (!category) {
    throw new Error('Category not found')
  }

  return serialize(category)
}

export async function createCategory(data: CategoryFormData) {
  const authResult = await requireEditor()
  if (!authResult.authorized) {
    throw new Error(authResult.error)
  }

  // Check for duplicate name
  const existing = await prisma.assetCategory.findFirst({
    where: { name: { equals: data.name, mode: 'insensitive' } },
  })

  if (existing) {
    throw new Error('Category with this name already exists')
  }

  const category = await prisma.assetCategory.create({
    data: {
      name: data.name,
      description: data.description,
      isConfigurable: data.isConfigurable ?? false,
      isComponent: data.isComponent ?? false,
    },
  })

  await logAudit({
    action: 'CREATE',
    entityType: 'Category',
    entityId: category.id,
    newValues: {
      name: category.name,
      description: category.description,
      isConfigurable: category.isConfigurable,
      isComponent: category.isComponent,
    },
  })

  revalidatePath('/dashboard/settings/categories')
  revalidatePath('/dashboard/assets')

  return serialize(category)
}

export async function updateCategory(id: string, data: CategoryFormData) {
  const authResult = await requireEditor()
  if (!authResult.authorized) {
    throw new Error(authResult.error)
  }

  // Check for duplicate name (excluding current)
  const existing = await prisma.assetCategory.findFirst({
    where: {
      name: { equals: data.name, mode: 'insensitive' },
      NOT: { id },
    },
  })

  if (existing) {
    throw new Error('Category with this name already exists')
  }

  // Get old values for audit
  const oldCategory = await prisma.assetCategory.findUnique({ where: { id } })

  const category = await prisma.assetCategory.update({
    where: { id },
    data: {
      name: data.name,
      description: data.description,
      ...(data.isConfigurable !== undefined ? { isConfigurable: data.isConfigurable } : {}),
      ...(data.isComponent !== undefined ? { isComponent: data.isComponent } : {}),
    },
  })

  await logAudit({
    action: 'UPDATE',
    entityType: 'Category',
    entityId: category.id,
    oldValues: oldCategory ? {
      name: oldCategory.name,
      description: oldCategory.description,
      isConfigurable: oldCategory.isConfigurable,
      isComponent: oldCategory.isComponent,
    } : undefined,
    newValues: {
      name: category.name,
      description: category.description,
      isConfigurable: category.isConfigurable,
      isComponent: category.isComponent,
    },
  })

  revalidatePath('/dashboard/settings/categories')
  revalidatePath('/dashboard/assets')

  return serialize(category)
}

export async function deleteCategory(id: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) {
    throw new Error(authResult.error)
  }

  // Check if category has assets
  const category = await prisma.assetCategory.findUnique({
    where: { id },
    include: { _count: { select: { assets: true } } },
  })

  if (!category) {
    throw new Error('Category not found')
  }

  if (category._count.assets > 0) {
    throw new Error(`Cannot delete category with ${category._count.assets} assets. Reassign assets first.`)
  }

  await prisma.assetCategory.delete({ where: { id } })

  await logAudit({
    action: 'DELETE',
    entityType: 'Category',
    entityId: id,
    oldValues: { name: category.name, description: category.description },
  })

  revalidatePath('/dashboard/settings/categories')

  return { success: true }
}

// ============================================
// LOCATIONS
// ============================================

export type LocationFormData = {
  name: string
  address?: string
  description?: string
  taxRate?: number
  taxLabel?: string
}

export async function getLocations(search?: string) {
  const locations = await prisma.location.findMany({
    where: search
      ? { name: { contains: search, mode: 'insensitive' } }
      : undefined,
    include: {
      _count: {
        select: { assetUnits: true },
      },
    },
    orderBy: { name: 'asc' },
  })

  return serialize(locations)
}

export async function getLocation(id: string) {
  const location = await prisma.location.findUnique({
    where: { id },
    include: {
      _count: {
        select: { assetUnits: true },
      },
    },
  })

  if (!location) {
    throw new Error('Location not found')
  }

  return serialize(location)
}

export async function createLocation(data: LocationFormData) {
  const authResult = await requireEditor()
  if (!authResult.authorized) {
    throw new Error(authResult.error)
  }

  // Check for duplicate name
  const existing = await prisma.location.findFirst({
    where: { name: { equals: data.name, mode: 'insensitive' } },
  })

  if (existing) {
    throw new Error('Location with this name already exists')
  }

  const location = await prisma.location.create({
    data: {
      name: data.name,
      address: data.address,
      description: data.description,
      taxRate: data.taxRate ?? null,
      taxLabel: data.taxLabel || null,
    },
  })

  await logAudit({
    action: 'CREATE',
    entityType: 'Location',
    entityId: location.id,
    newValues: { name: location.name, address: location.address, description: location.description, taxRate: location.taxRate, taxLabel: location.taxLabel },
  })

  revalidatePath('/dashboard/settings/locations')
  revalidatePath('/dashboard/assets')

  return serialize(location)
}

export async function updateLocation(id: string, data: LocationFormData) {
  const authResult = await requireEditor()
  if (!authResult.authorized) {
    throw new Error(authResult.error)
  }

  // Check for duplicate name (excluding current)
  const existing = await prisma.location.findFirst({
    where: {
      name: { equals: data.name, mode: 'insensitive' },
      NOT: { id },
    },
  })

  if (existing) {
    throw new Error('Location with this name already exists')
  }

  // Get old values for audit
  const oldLocation = await prisma.location.findUnique({ where: { id } })

  const location = await prisma.location.update({
    where: { id },
    data: {
      name: data.name,
      address: data.address,
      description: data.description,
      taxRate: data.taxRate ?? null,
      taxLabel: data.taxLabel || null,
    },
  })

  await logAudit({
    action: 'UPDATE',
    entityType: 'Location',
    entityId: location.id,
    oldValues: oldLocation ? { name: oldLocation.name, address: oldLocation.address, description: oldLocation.description } : undefined,
    newValues: { name: location.name, address: location.address, description: location.description, taxRate: location.taxRate, taxLabel: location.taxLabel },
  })

  revalidatePath('/dashboard/settings/locations')
  revalidatePath('/dashboard/assets')

  return serialize(location)
}

export async function deleteLocation(id: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) {
    throw new Error(authResult.error)
  }

  // Check if location has assets
  const location = await prisma.location.findUnique({
    where: { id },
    include: { _count: { select: { assetUnits: true } } },
  })

  if (!location) {
    throw new Error('Location not found')
  }

  if (location._count.assetUnits > 0) {
    throw new Error(`Cannot delete location with ${location._count.assetUnits} assets. Reassign assets first.`)
  }

  await prisma.location.delete({ where: { id } })

  await logAudit({
    action: 'DELETE',
    entityType: 'Location',
    entityId: id,
    oldValues: { name: location.name, address: location.address, description: location.description },
  })

  revalidatePath('/dashboard/settings/locations')

  return { success: true }
}

// ============================================
// VENDORS
// ============================================

export type VendorFormData = {
  name: string
  contactName?: string
  contactEmail?: string
  contactPhone?: string
  address?: string
  notes?: string
}

export async function getVendors(search?: string) {
  const vendors = await prisma.vendor.findMany({
    where: search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { contactName: { contains: search, mode: 'insensitive' } },
          ],
        }
      : undefined,
    include: {
      _count: {
        select: { assets: true },
      },
    },
    orderBy: { name: 'asc' },
  })

  return serialize(vendors)
}

export async function getVendor(id: string) {
  const vendor = await prisma.vendor.findUnique({
    where: { id },
    include: {
      _count: {
        select: { assets: true },
      },
    },
  })

  if (!vendor) {
    throw new Error('Vendor not found')
  }

  return serialize(vendor)
}

export async function createVendor(data: VendorFormData) {
  const authResult = await requireEditor()
  if (!authResult.authorized) {
    throw new Error(authResult.error)
  }

  // Check for duplicate name
  const existing = await prisma.vendor.findFirst({
    where: { name: { equals: data.name, mode: 'insensitive' } },
  })

  if (existing) {
    throw new Error('Vendor with this name already exists')
  }

  const vendor = await prisma.vendor.create({
    data: {
      name: data.name,
      contactName: data.contactName,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone,
      address: data.address,
      notes: data.notes,
    },
  })

  await logAudit({
    action: 'CREATE',
    entityType: 'Vendor',
    entityId: vendor.id,
    newValues: { name: vendor.name, contactName: vendor.contactName, contactEmail: vendor.contactEmail },
  })

  revalidatePath('/dashboard/settings/vendors')
  revalidatePath('/dashboard/assets')

  return serialize(vendor)
}

export async function updateVendor(id: string, data: VendorFormData) {
  const authResult = await requireEditor()
  if (!authResult.authorized) {
    throw new Error(authResult.error)
  }

  // Check for duplicate name (excluding current)
  const existing = await prisma.vendor.findFirst({
    where: {
      name: { equals: data.name, mode: 'insensitive' },
      NOT: { id },
    },
  })

  if (existing) {
    throw new Error('Vendor with this name already exists')
  }

  // Get old values for audit
  const oldVendor = await prisma.vendor.findUnique({ where: { id } })

  const vendor = await prisma.vendor.update({
    where: { id },
    data: {
      name: data.name,
      contactName: data.contactName,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone,
      address: data.address,
      notes: data.notes,
    },
  })

  await logAudit({
    action: 'UPDATE',
    entityType: 'Vendor',
    entityId: vendor.id,
    oldValues: oldVendor ? { name: oldVendor.name, contactName: oldVendor.contactName, contactEmail: oldVendor.contactEmail } : undefined,
    newValues: { name: vendor.name, contactName: vendor.contactName, contactEmail: vendor.contactEmail },
  })

  revalidatePath('/dashboard/settings/vendors')
  revalidatePath('/dashboard/assets')

  return serialize(vendor)
}

export async function deleteVendor(id: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) {
    throw new Error(authResult.error)
  }

  // Check if vendor has assets
  const vendor = await prisma.vendor.findUnique({
    where: { id },
    include: { _count: { select: { assets: true } } },
  })

  if (!vendor) {
    throw new Error('Vendor not found')
  }

  if (vendor._count.assets > 0) {
    throw new Error(`Cannot delete vendor with ${vendor._count.assets} assets. Reassign assets first.`)
  }

  await prisma.vendor.delete({ where: { id } })

  await logAudit({
    action: 'DELETE',
    entityType: 'Vendor',
    entityId: id,
    oldValues: { name: vendor.name, contactName: vendor.contactName, contactEmail: vendor.contactEmail },
  })

  revalidatePath('/dashboard/settings/vendors')

  return { success: true }
}
