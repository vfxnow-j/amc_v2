'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { serialize } from '@/lib/utils'
import { requireAuth, requireEditor, requireAdmin } from '@/lib/auth-utils'

export type ClientFormData = {
  name: string
  companyName?: string
  email?: string
  phone?: string
  address?: string
  billingAddress?: string
  paymentTerms?: number
  taxExempt?: boolean
  notes?: string
  customPricing?: Record<string, unknown>
  marketingTag?: string
  marketingOptIn?: boolean
  skipIdRequirement?: boolean
  skipCoiRequirement?: boolean
}

export type ClientFilters = {
  search?: string
}

export async function getClients(filters: ClientFilters = {}) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const { search } = filters

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {}

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { companyName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ]
  }

  const clients = await prisma.client.findMany({
    where,
    include: {
      _count: {
        select: {
          checkouts: true,
          invoices: true,
          reservations: true,
        },
      },
    },
    orderBy: { name: 'asc' },
  })

  // Batch-compute outstanding balance per client
  const clientIds = clients.map((c) => c.id)
  const outstandingByClient = await prisma.invoice.groupBy({
    by: ['clientId'],
    where: {
      clientId: { in: clientIds },
      status: { in: ['SENT', 'PARTIAL', 'OVERDUE'] },
    },
    _sum: { total: true, amountPaid: true },
  })

  const balanceMap = new Map<string, number>()
  for (const row of outstandingByClient) {
    const balance = Number(row._sum.total || 0) - Number(row._sum.amountPaid || 0)
    balanceMap.set(row.clientId, balance)
  }

  // Batch-compute total reservation value per client
  const revenueByClient = await prisma.reservation.groupBy({
    by: ['clientId'],
    where: {
      clientId: { in: clientIds },
      status: { in: ['APPROVED', 'PREPARING', 'SHIPPED', 'ACTIVE', 'COMPLETED'] },
    },
    _sum: { total: true },
  })

  const resValueMap = new Map<string, number>()
  for (const row of revenueByClient) {
    resValueMap.set(row.clientId, Number(row._sum.total || 0))
  }

  const enriched = clients.map((c) => ({
    ...c,
    outstandingBalance: balanceMap.get(c.id) || 0,
    totalReservationValue: resValueMap.get(c.id) || 0,
  }))

  return serialize(enriched)
}

export async function getClient(id: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      checkouts: {
        include: {
          assetUnit: {
            include: {
              asset: {
                include: {
                  category: true,
                },
              },
            },
          },
        },
        orderBy: { checkoutDate: 'desc' },
        take: 10,
      },
      invoices: {
        orderBy: { issueDate: 'desc' },
        take: 10,
      },
      reservations: {
        include: {
          items: {
            include: { asset: { select: { name: true } } },
          },
          invoices: {
            select: { id: true, total: true, amountPaid: true, status: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
      contacts: {
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
      _count: {
        select: {
          checkouts: true,
          invoices: true,
          reservations: true,
          contacts: true,
        },
      },
    },
  })

  return serialize(client)
}

// ============================================
// CLIENT CONTACTS
// ============================================

export async function addClientContact(clientId: string, data: {
  name: string
  email?: string
  phone?: string
  role?: string
  isPrimary?: boolean
  notes?: string
}) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  // If setting as primary, unset existing primary
  if (data.isPrimary) {
    await prisma.clientContact.updateMany({
      where: { clientId, isPrimary: true },
      data: { isPrimary: false },
    })
  }

  const contact = await prisma.clientContact.create({
    data: {
      clientId,
      name: data.name,
      email: data.email,
      phone: data.phone,
      role: data.role || 'Primary',
      isPrimary: data.isPrimary ?? false,
      notes: data.notes,
    },
  })

  revalidatePath(`/dashboard/clients/${clientId}`)
  return serialize(contact)
}

export async function updateClientContact(id: string, data: {
  name?: string
  email?: string
  phone?: string
  role?: string
  isPrimary?: boolean
  notes?: string
}) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const existing = await prisma.clientContact.findUnique({ where: { id } })
  if (!existing) throw new Error('Contact not found')

  if (data.isPrimary) {
    await prisma.clientContact.updateMany({
      where: { clientId: existing.clientId, isPrimary: true },
      data: { isPrimary: false },
    })
  }

  const contact = await prisma.clientContact.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.email !== undefined && { email: data.email }),
      ...(data.phone !== undefined && { phone: data.phone }),
      ...(data.role !== undefined && { role: data.role }),
      ...(data.isPrimary !== undefined && { isPrimary: data.isPrimary }),
      ...(data.notes !== undefined && { notes: data.notes }),
    },
  })

  revalidatePath(`/dashboard/clients/${existing.clientId}`)
  return serialize(contact)
}

export async function deleteClientContact(id: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const existing = await prisma.clientContact.findUnique({ where: { id } })
  if (!existing) throw new Error('Contact not found')

  await prisma.clientContact.delete({ where: { id } })

  revalidatePath(`/dashboard/clients/${existing.clientId}`)
  return { success: true }
}

export async function createClient(data: ClientFormData) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const client = await prisma.client.create({
    data: {
      name: data.name,
      companyName: data.companyName,
      email: data.email,
      phone: data.phone,
      address: data.address,
      billingAddress: data.billingAddress,
      paymentTerms: data.paymentTerms ?? 30,
      taxExempt: data.taxExempt ?? false,
      notes: data.notes,
      customPricing: data.customPricing as object,
      marketingTag: data.marketingTag,
      marketingOptIn: data.marketingOptIn ?? false,
      skipIdRequirement: data.skipIdRequirement ?? false,
      skipCoiRequirement: data.skipCoiRequirement ?? false,
    },
  })

  revalidatePath('/dashboard/clients')
  revalidatePath('/dashboard')

  return serialize(client)
}

export async function updateClient(id: string, data: Partial<ClientFormData>) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const client = await prisma.client.update({
    where: { id },
    data: {
      name: data.name,
      companyName: data.companyName,
      email: data.email,
      phone: data.phone,
      address: data.address,
      billingAddress: data.billingAddress,
      paymentTerms: data.paymentTerms,
      taxExempt: data.taxExempt,
      notes: data.notes,
      customPricing: data.customPricing as object,
      ...(data.marketingTag !== undefined && { marketingTag: data.marketingTag }),
      ...(data.marketingOptIn !== undefined && { marketingOptIn: data.marketingOptIn }),
      ...(data.skipIdRequirement !== undefined && { skipIdRequirement: data.skipIdRequirement }),
      ...(data.skipCoiRequirement !== undefined && { skipCoiRequirement: data.skipCoiRequirement }),
    },
  })

  revalidatePath('/dashboard/clients')
  revalidatePath(`/dashboard/clients/${id}`)
  revalidatePath('/dashboard')

  return serialize(client)
}

export async function deleteClient(id: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  await prisma.client.delete({
    where: { id },
  })

  revalidatePath('/dashboard/clients')
  revalidatePath('/dashboard')
}

export async function getClientStats() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const [total, withActiveCheckouts] = await Promise.all([
    prisma.client.count(),
    prisma.client.count({
      where: {
        checkouts: {
          some: {
            status: { in: ['ACTIVE', 'APPROVED', 'PENDING_APPROVAL'] },
          },
        },
      },
    }),
  ])

  return {
    total,
    withActiveCheckouts,
  }
}

export async function getClientRevenue(clientId: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const result = await prisma.checkout.aggregate({
    where: {
      clientId,
      totalCharge: { not: null },
    },
    _sum: {
      totalCharge: true,
    },
  })

  return result._sum.totalCharge || 0
}

export async function getClientBalance(clientId: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const invoices = await prisma.invoice.findMany({
    where: {
      clientId,
      status: { in: ['SENT', 'PARTIAL', 'OVERDUE'] },
    },
    select: { total: true, amountPaid: true },
  })

  return invoices.reduce(
    (sum, inv) => sum + (Number(inv.total) - Number(inv.amountPaid)),
    0
  )
}
