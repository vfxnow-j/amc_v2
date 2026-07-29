'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { serialize } from '@/lib/utils'
import { requireAuth, requireEditor } from '@/lib/auth-utils'

export type LeaseStatus = 'ACTIVE' | 'PAID_OFF' | 'DEFAULTED' | 'TRANSFERRED'

export type LeaseFormData = {
  assetUnitIds: string[]
  leaseName: string
  leaseNumber: string
  lender: string
  monthlyPayment: number
  interestRate: number
  totalAmount: number
  payoffAmount?: number | null
  startDate: Date
  endDate: Date
  termMonths: number
  status?: LeaseStatus
  paidOffDate?: Date | null
  notes?: string | null
}

export type LeaseFilters = {
  search?: string
  status?: LeaseStatus
}

export type AmortizationEntry = {
  month: number
  payment: number
  principal: number
  interest: number
  balance: number
}

// ---------------------------------------------------------------------------
// READ
// ---------------------------------------------------------------------------

export async function getLeases(filters: LeaseFilters = {}) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const { search, status } = filters

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {}

  if (search) {
    where.OR = [
      { leaseName: { contains: search, mode: 'insensitive' } },
      { leaseNumber: { contains: search, mode: 'insensitive' } },
      { lender: { contains: search, mode: 'insensitive' } },
      { assetUnits: { some: { asset: { name: { contains: search, mode: 'insensitive' } } } } },
    ]
  }

  if (status) {
    where.status = status
  }

  const leases = await prisma.lease.findMany({
    where,
    include: {
      assetUnits: {
        select: {
          id: true,
          barcode: true,
          totalRevenue: true,
          asset: {
            select: {
              id: true,
              name: true,
              category: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return serialize(leases)
}

export async function getLease(id: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const lease = await prisma.lease.findUnique({
    where: { id },
    include: {
      assetUnits: {
        include: {
          asset: {
            include: {
              category: true,
            },
          },
          location: true,
        },
      },
    },
  })

  return serialize(lease)
}

// ---------------------------------------------------------------------------
// CREATE / UPDATE / DELETE
// ---------------------------------------------------------------------------

export async function createLease(data: LeaseFormData) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const lease = await prisma.$transaction(async (tx) => {
    const created = await tx.lease.create({
      data: {
        leaseName: data.leaseName,
        leaseNumber: data.leaseNumber,
        lender: data.lender,
        monthlyPayment: data.monthlyPayment,
        interestRate: data.interestRate,
        totalAmount: data.totalAmount,
        payoffAmount: data.payoffAmount ?? null,
        startDate: data.startDate,
        endDate: data.endDate,
        termMonths: data.termMonths,
        status: data.status ?? 'ACTIVE',
        paidOffDate: data.paidOffDate ?? null,
        notes: data.notes ?? null,
      },
    })

    if (data.assetUnitIds.length > 0) {
      await tx.assetUnit.updateMany({
        where: { id: { in: data.assetUnitIds } },
        data: {
          leaseId: created.id,
          ownershipType: 'LOAN',
          loanName: data.leaseName,
          fundingBusiness: data.lender,
          loanAmount: data.totalAmount,
          amortizationEndDate: data.endDate,
        },
      })
    }

    return tx.lease.findUnique({
      where: { id: created.id },
      include: { assetUnits: { include: { asset: true } } },
    })
  })

  revalidatePath('/dashboard/leases')
  revalidatePath('/dashboard/assets')
  revalidatePath('/dashboard')

  return serialize(lease)
}

export async function updateLease(id: string, data: Partial<LeaseFormData>) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const lease = await prisma.$transaction(async (tx) => {
    // Update lease fields
    const { assetUnitIds, ...leaseFields } = data
    await tx.lease.update({
      where: { id },
      data: {
        leaseName: leaseFields.leaseName,
        leaseNumber: leaseFields.leaseNumber,
        lender: leaseFields.lender,
        monthlyPayment: leaseFields.monthlyPayment,
        interestRate: leaseFields.interestRate,
        totalAmount: leaseFields.totalAmount,
        payoffAmount: leaseFields.payoffAmount,
        startDate: leaseFields.startDate,
        endDate: leaseFields.endDate,
        termMonths: leaseFields.termMonths,
        status: leaseFields.status,
        paidOffDate: leaseFields.paidOffDate,
        notes: leaseFields.notes,
      },
    })

    // Fetch current lease data for syncing to units
    const current = await tx.lease.findUnique({
      where: { id },
      select: { leaseName: true, lender: true, totalAmount: true, endDate: true },
    })

    // Update linked units if provided
    if (assetUnitIds !== undefined) {
      // Clear existing links — reset detached units back to CASH
      await tx.assetUnit.updateMany({
        where: { leaseId: id },
        data: {
          leaseId: null,
          ownershipType: 'CASH',
          loanName: null,
          fundingBusiness: null,
          loanAmount: null,
          amortizationEndDate: null,
        },
      })
      // Set new links with lease details
      if (assetUnitIds.length > 0) {
        await tx.assetUnit.updateMany({
          where: { id: { in: assetUnitIds } },
          data: {
            leaseId: id,
            ownershipType: 'LOAN',
            loanName: leaseFields.leaseName ?? current?.leaseName,
            fundingBusiness: leaseFields.lender ?? current?.lender,
            loanAmount: leaseFields.totalAmount ?? (current ? Number(current.totalAmount) : undefined),
            amortizationEndDate: leaseFields.endDate ?? current?.endDate,
          },
        })
      }
    } else if (current) {
      // No unit changes, but lease details may have changed — sync to existing units
      const hasFieldChanges = leaseFields.leaseName !== undefined ||
        leaseFields.lender !== undefined ||
        leaseFields.totalAmount !== undefined ||
        leaseFields.endDate !== undefined
      if (hasFieldChanges) {
        await tx.assetUnit.updateMany({
          where: { leaseId: id },
          data: {
            loanName: leaseFields.leaseName ?? current.leaseName,
            fundingBusiness: leaseFields.lender ?? current.lender,
            loanAmount: leaseFields.totalAmount ?? Number(current.totalAmount),
            amortizationEndDate: leaseFields.endDate ?? current.endDate,
          },
        })
      }
    }

    return tx.lease.findUnique({
      where: { id },
      include: { assetUnits: { include: { asset: true } } },
    })
  })

  revalidatePath('/dashboard/leases')
  revalidatePath(`/dashboard/leases/${id}`)
  revalidatePath('/dashboard/assets')

  return serialize(lease)
}

export async function deleteLease(id: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  await prisma.$transaction(async (tx) => {
    // Clear leaseId and reset ownership on all linked units
    await tx.assetUnit.updateMany({
      where: { leaseId: id },
      data: {
        leaseId: null,
        ownershipType: 'CASH',
        loanName: null,
        fundingBusiness: null,
        loanAmount: null,
        amortizationEndDate: null,
      },
    })
    await tx.lease.delete({ where: { id } })
  })

  revalidatePath('/dashboard/leases')
  revalidatePath('/dashboard/assets')
  revalidatePath('/dashboard')

  return { success: true }
}

// ---------------------------------------------------------------------------
// STATS
// ---------------------------------------------------------------------------

export async function getLeaseStats() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const [activeCount, paidOffCount, totalMonthly, totalOutstanding] = await Promise.all([
    prisma.lease.count({ where: { status: 'ACTIVE' } }),
    prisma.lease.count({ where: { status: 'PAID_OFF' } }),
    prisma.lease.aggregate({
      where: { status: 'ACTIVE' },
      _sum: { monthlyPayment: true },
    }),
    prisma.lease.aggregate({
      where: { status: 'ACTIVE' },
      _sum: { payoffAmount: true },
    }),
  ])

  return serialize({
    activeCount,
    paidOffCount,
    totalMonthlyObligation: Number(totalMonthly._sum.monthlyPayment || 0),
    totalOutstanding: Number(totalOutstanding._sum.payoffAmount || 0),
  })
}

// ---------------------------------------------------------------------------
// AMORTIZATION SCHEDULE
// ---------------------------------------------------------------------------

export async function getAmortizationSchedule(leaseId: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    select: {
      totalAmount: true,
      monthlyPayment: true,
      interestRate: true,
      termMonths: true,
    },
  })

  if (!lease) throw new Error('Lease not found')

  const principal = Number(lease.totalAmount)
  const monthlyPayment = Number(lease.monthlyPayment)
  const annualRate = Number(lease.interestRate)
  const termMonths = lease.termMonths

  // Monthly interest rate (interestRate is stored as decimal, e.g. 0.0650 = 6.50%)
  const monthlyRate = annualRate / 12

  const schedule: AmortizationEntry[] = []
  let balance = principal

  for (let month = 1; month <= termMonths; month++) {
    const interestCharge = balance * monthlyRate
    let principalCharge = monthlyPayment - interestCharge

    // Last payment: adjust if remaining balance is less than standard principal
    if (principalCharge > balance) {
      principalCharge = balance
    }

    balance = Math.max(0, balance - principalCharge)

    schedule.push({
      month,
      payment: Math.round((interestCharge + principalCharge) * 100) / 100,
      principal: Math.round(principalCharge * 100) / 100,
      interest: Math.round(interestCharge * 100) / 100,
      balance: Math.round(balance * 100) / 100,
    })

    if (balance <= 0) break
  }

  return serialize(schedule)
}

// ---------------------------------------------------------------------------
// REVENUE ANALYSIS
// ---------------------------------------------------------------------------

export async function getRevenueAnalysis(leaseId: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    include: {
      assetUnits: {
        select: { totalRevenue: true },
      },
    },
  })

  if (!lease) throw new Error('Lease not found')

  // Sum revenue across ALL linked units
  const totalRevenue = lease.assetUnits.reduce(
    (sum, u) => sum + Number(u.totalRevenue),
    0
  )
  const monthlyPayment = Number(lease.monthlyPayment)
  const totalAmount = Number(lease.totalAmount)
  const payoffAmount = lease.payoffAmount ? Number(lease.payoffAmount) : null

  // Calculate months elapsed since start
  const now = new Date()
  const startDate = new Date(lease.startDate)
  const monthsElapsed = Math.max(
    0,
    (now.getFullYear() - startDate.getFullYear()) * 12 +
      (now.getMonth() - startDate.getMonth())
  )

  // Total payments made (monthlyPayment * months elapsed, capped at term)
  const effectiveMonths = Math.min(monthsElapsed, lease.termMonths)
  const totalPaymentsMade = monthlyPayment * effectiveMonths

  // Coverage ratio: how much revenue covers payments
  const coverageRatio = totalPaymentsMade > 0
    ? Math.round((totalRevenue / totalPaymentsMade) * 100) / 100
    : totalRevenue > 0 ? Infinity : 0

  // Projected payoff date based on monthly revenue rate
  let projectedPayoffDate: string | null = null
  if (totalRevenue > 0 && monthsElapsed > 0) {
    const monthlyRevenueRate = totalRevenue / monthsElapsed
    const remainingBalance = payoffAmount ?? (totalAmount - totalPaymentsMade)
    if (remainingBalance > 0 && monthlyRevenueRate > 0) {
      const monthsToPayoff = Math.ceil(remainingBalance / monthlyRevenueRate)
      const projected = new Date()
      projected.setMonth(projected.getMonth() + monthsToPayoff)
      projectedPayoffDate = projected.toISOString()
    } else if (remainingBalance <= 0) {
      projectedPayoffDate = new Date().toISOString()
    }
  }

  return serialize({
    totalRevenue,
    totalPaymentsMade,
    monthsElapsed: effectiveMonths,
    monthlyPayment,
    totalAmount,
    payoffAmount,
    coverageRatio,
    projectedPayoffDate,
    netPosition: totalRevenue - totalPaymentsMade,
    unitCount: lease.assetUnits.length,
  })
}

// ---------------------------------------------------------------------------
// ASSET UNITS FOR LEASE FORM
// ---------------------------------------------------------------------------

export async function getAssetUnitsForLeaseForm() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const units = await prisma.assetUnit.findMany({
    select: {
      id: true,
      barcode: true,
      leaseId: true,
      asset: {
        select: { name: true },
      },
    },
    orderBy: { asset: { name: 'asc' } },
  })

  return serialize(units)
}

// ---------------------------------------------------------------------------
// SEED LEASES FROM NOT-OWNED ASSETS
// ---------------------------------------------------------------------------

export async function seedLeasesFromNotOwned() {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  // Find all NOT-OWNED units that don't already have a lease
  const units = await prisma.assetUnit.findMany({
    where: {
      ownershipType: { not: 'CASH' },
      leaseId: null,
    },
    select: {
      id: true,
      ownershipType: true,
      loanName: true,
      fundingBusiness: true,
      purchaseDate: true,
    },
  })

  if (units.length === 0) {
    return serialize({ created: 0, linked: 0, leases: [] })
  }

  // Group by loanName (or fallback label)
  const groups = new Map<string, typeof units>()
  for (const unit of units) {
    let key = unit.loanName?.trim() || ''
    if (!key) {
      // Fallback for units with no loanName
      key = unit.ownershipType === 'CREDIT' ? 'Credit Line' : `${unit.ownershipType} - Uncategorized`
    }
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(unit)
  }

  // Determine next sequential lease number
  const lastLease = await prisma.lease.findFirst({
    where: { leaseNumber: { startsWith: 'LSE-' } },
    orderBy: { leaseNumber: 'desc' },
    select: { leaseNumber: true },
  })

  let nextSeq = 1
  if (lastLease) {
    const match = lastLease.leaseNumber.match(/^LSE-(\d+)$/)
    if (match) {
      nextSeq = parseInt(match[1], 10) + 1
    }
  }

  const createdLeases = await prisma.$transaction(async (tx) => {
    const results = []

    for (const [loanName, groupUnits] of groups) {
      const leaseNumber = `LSE-${String(nextSeq).padStart(4, '0')}`
      nextSeq++

      // Use earliest purchase date as start, default 5-year term
      const dates = groupUnits
        .map((u) => u.purchaseDate)
        .filter(Boolean)
        .sort((a, b) => a.getTime() - b.getTime())
      const startDate = dates[0] || new Date()
      const endDate = new Date(startDate.getFullYear() + 5, startDate.getMonth(), startDate.getDate())

      const lender = groupUnits.find((u) => u.fundingBusiness)?.fundingBusiness || 'Unknown'

      const lease = await tx.lease.create({
        data: {
          leaseName: loanName,
          leaseNumber,
          lender,
          monthlyPayment: 0,
          interestRate: 0,
          totalAmount: 0,
          payoffAmount: 0,
          startDate,
          endDate,
          termMonths: 60,
          status: 'ACTIVE',
          notes: `Auto-created from ${groupUnits.length} ${groupUnits[0].ownershipType} asset unit(s). Review and fill in financial details (monthly payment, total amount, interest rate, lender).`,
        },
      })

      // Link all units in this group to the lease
      await tx.assetUnit.updateMany({
        where: { id: { in: groupUnits.map((u) => u.id) } },
        data: { leaseId: lease.id },
      })

      results.push({ ...lease, unitCount: groupUnits.length })
    }

    return results
  })

  revalidatePath('/dashboard/leases')
  revalidatePath('/dashboard/assets')
  revalidatePath('/dashboard')

  return serialize({ created: createdLeases.length, linked: units.length, leases: createdLeases })
}
