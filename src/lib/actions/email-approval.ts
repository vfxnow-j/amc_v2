'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin, requireEditor } from '@/lib/auth-utils'
import { addressStatuses, normalizeAddress, type AddressStatus } from '@/lib/email/approval'

/**
 * Who may mail a client. Turning an address on is an admin's call (admin or
 * super admin); staff can see where an address stands but not change it.
 */

function stamp(userId: string | undefined, approved: boolean) {
  return approved
    ? { emailApproved: true, emailApprovedAt: new Date(), emailApprovedById: userId ?? null }
    : { emailApproved: false, emailApprovedAt: null, emailApprovedById: null }
}

export async function setClientEmailApproved(clientId: string, approved: boolean) {
  const auth = await requireAdmin()
  if (!auth.authorized) throw new Error(auth.error)
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { email: true } })
  if (!client) throw new Error('Client not found')
  if (approved && !client.email) throw new Error('This account has no email address to approve.')
  await prisma.client.update({ where: { id: clientId }, data: stamp(auth.userId, approved) })
  revalidatePath(`/dashboard/clients/${clientId}`)
}

export async function setContactEmailApproved(contactId: string, approved: boolean) {
  const auth = await requireAdmin()
  if (!auth.authorized) throw new Error(auth.error)
  const contact = await prisma.clientContact.findUnique({
    where: { id: contactId },
    select: { email: true, clientId: true },
  })
  if (!contact) throw new Error('Contact not found')
  if (approved && !contact.email) throw new Error('This contact has no email address to approve.')
  await prisma.clientContact.update({ where: { id: contactId }, data: stamp(auth.userId, approved) })
  revalidatePath(`/dashboard/clients/${contact.clientId}`)
}

export type RecipientCheck = {
  /** Per address, as typed. */
  statuses: { email: string; status: AddressStatus }[]
  /** Addresses that would be refused for a client-bound message. */
  blocked: string[]
  otherClient: string[]
  canApprove: boolean
}

/** Where each address stands, for the Send quote dialog. */
export async function checkClientRecipients(orderId: string, emails: string[]): Promise<RecipientCheck> {
  const auth = await requireEditor()
  if (!auth.authorized) throw new Error(auth.error)
  const list = emails.flatMap((entry) => entry.split(/[,;\s]+/)).map((e) => e.trim()).filter(Boolean)
  const order = await prisma.reservation.findUnique({ where: { id: orderId }, select: { clientId: true } })
  if (!order) throw new Error('Order not found')
  const found = await addressStatuses(list, order.clientId)
  const statuses = list.map((email) => ({ email, status: found[email] }))
  return {
    statuses,
    blocked: statuses.filter((s) => s.status === 'unapproved' || s.status === 'unknown').map((s) => s.email),
    // On some other client's record: an admin cannot enable these from here.
    otherClient: statuses.filter((s) => s.status === 'other-client').map((s) => s.email),
    canApprove: auth.role === 'ADMIN' || auth.role === 'SUPER_ADMIN',
  }
}

/**
 * Approve addresses for this client. An address on the account or one of its
 * contacts is switched on in place; one typed in fresh becomes a contact, so
 * the approval is visible on the client record and can be switched off there.
 */
export async function approveClientRecipients(clientId: string, emails: string[]) {
  const auth = await requireAdmin()
  if (!auth.authorized) throw new Error(auth.error)

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { email: true, contacts: { select: { id: true, email: true } } },
  })
  if (!client) throw new Error('Client not found')

  const data = stamp(auth.userId, true)
  for (const raw of emails) {
    const email = normalizeAddress(raw)
    if (!email.includes('@')) throw new Error(`"${raw}" is not an email address.`)
    if (client.email && normalizeAddress(client.email) === email) {
      await prisma.client.update({ where: { id: clientId }, data })
      continue
    }
    const contacts = client.contacts.filter((c) => c.email && normalizeAddress(c.email) === email)
    if (contacts.length > 0) {
      await prisma.clientContact.updateMany({ where: { id: { in: contacts.map((c) => c.id) } }, data })
      continue
    }
    await prisma.clientContact.create({
      data: { clientId, name: email, email, role: 'Added when sending', ...data },
    })
  }
  revalidatePath(`/dashboard/clients/${clientId}`)
}

/** The Send quote dialog knows the order, not the client. */
export async function approveOrderRecipients(orderId: string, emails: string[]) {
  const order = await prisma.reservation.findUnique({ where: { id: orderId }, select: { clientId: true } })
  if (!order) throw new Error('Order not found')
  await approveClientRecipients(order.clientId, emails)
}
