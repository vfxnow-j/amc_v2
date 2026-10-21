'use server'

/**
 * Deal associations: the owner links orders that are the same job (competing
 * bids, versions across clients) so the Forecast and the BT Report count them
 * as one deal. Which members count is the existing per-order forecast choice;
 * the group adds the link and a Hot/Warm/Cold weight. Admin only.
 */
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-utils'

export type DealOutcome = { ok: boolean; message: string }

const OPEN = ['DRAFT', 'QUOTE_SENT', 'REVISION']

function touch(...ids: string[]) {
  for (const id of ids) revalidatePath(`/dashboard/orders/${id}`)
  revalidatePath('/dashboard/forecast')
  revalidatePath('/dashboard/orders')
  revalidatePath('/dashboard/reports/btr')
}

/** Link this order with another, by the other's order number. */
export async function associateOrder(reservationId: string, otherNumber: string): Promise<DealOutcome> {
  const auth = await requireAdmin()
  if (!auth.authorized) return { ok: false, message: auth.error || 'Unauthorized' }

  const number = otherNumber.trim()
  if (!number) return { ok: false, message: 'Enter the other order\'s number.' }
  const [mine, other] = await Promise.all([
    prisma.reservation.findUnique({ where: { id: reservationId }, select: { id: true, status: true, dealMember: { select: { dealGroupId: true } } } }),
    prisma.reservation.findFirst({
      where: { reservationNumber: { equals: number, mode: 'insensitive' } },
      select: { id: true, reservationNumber: true, status: true, dealMember: { select: { dealGroupId: true } } },
    }),
  ])
  if (!mine) return { ok: false, message: 'Order not found.' }
  if (!other) return { ok: false, message: `No order numbered ${number}.` }
  if (other.id === mine.id) return { ok: false, message: 'That is this order.' }
  if (!OPEN.includes(other.status)) return { ok: false, message: `${other.reservationNumber} is not an open quote, so it is not in play to compete with.` }

  const a = mine.dealMember?.dealGroupId ?? null
  const b = other.dealMember?.dealGroupId ?? null
  if (a && b && a === b) return { ok: true, message: 'Already in the same deal.' }
  if (a && b) return { ok: false, message: `${other.reservationNumber} is already in a different deal. Remove it from that deal first.` }

  const groupId = a ?? b ?? (await prisma.dealGroup.create({ data: {} })).id
  await prisma.$transaction([
    prisma.dealGroupMember.upsert({ where: { reservationId: mine.id }, create: { reservationId: mine.id, dealGroupId: groupId }, update: { dealGroupId: groupId } }),
    prisma.dealGroupMember.upsert({ where: { reservationId: other.id }, create: { reservationId: other.id, dealGroupId: groupId }, update: { dealGroupId: groupId } }),
  ])
  touch(mine.id, other.id)
  return { ok: true, message: `Linked with ${other.reservationNumber}. Choose which of them count.` }
}

/** Take this order out of its deal. A deal left with one order is dissolved. */
export async function leaveDeal(reservationId: string): Promise<DealOutcome> {
  const auth = await requireAdmin()
  if (!auth.authorized) return { ok: false, message: auth.error || 'Unauthorized' }

  const member = await prisma.dealGroupMember.findUnique({ where: { reservationId }, select: { dealGroupId: true } })
  if (!member) return { ok: true, message: 'Not in a deal.' }
  await prisma.dealGroupMember.delete({ where: { reservationId } })
  const rest = await prisma.dealGroupMember.findMany({ where: { dealGroupId: member.dealGroupId }, select: { reservationId: true } })
  if (rest.length <= 1) await prisma.dealGroup.delete({ where: { id: member.dealGroupId } })
  touch(reservationId, ...rest.map((r) => r.reservationId))
  return { ok: true, message: 'Removed from the deal.' }
}

/** Hot / Warm / Cold for the whole deal; null hands the weight back to each order's stage. */
export async function setDealTemperature(reservationId: string, temperature: 'HOT' | 'WARM' | 'COLD' | null): Promise<DealOutcome> {
  const auth = await requireAdmin()
  if (!auth.authorized) return { ok: false, message: auth.error || 'Unauthorized' }
  if (temperature !== null && !['HOT', 'WARM', 'COLD'].includes(temperature)) return { ok: false, message: 'Unknown temperature.' }

  const member = await prisma.dealGroupMember.findUnique({ where: { reservationId }, select: { dealGroupId: true } })
  if (!member) return { ok: false, message: 'This order is not in a deal.' }
  await prisma.dealGroup.update({ where: { id: member.dealGroupId }, data: { temperature } })
  touch(reservationId)
  return { ok: true, message: temperature ? `Marked ${temperature.toLowerCase()}.` : 'Weight back to the stage default.' }
}
