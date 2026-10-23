/**
 * Which addresses may be mailed.
 *
 * A client or contact address is refused until an admin approves it (the
 * checkbox on the client record, or "Enable email" in the Send quote dialog).
 * The restored database holds 49 real client addresses; this is what keeps a
 * click on a half-finished order from mailing one of them. It sits in
 * `sendEmail`, so it holds for every caller, with or without the test redirect.
 *
 * Four kinds of address:
 *   staff       listed in EMAIL_DIRECT_ALLOW (or its @domain): never gated
 *   approved    a client or contact with emailApproved on
 *   unapproved  a client or contact address with it off: always refused
 *   unknown     on no client or contact: refused only when the caller says the
 *               mail is for a client (`audience: 'client'`); notification
 *               recipients such as accounting@ are unknown and pass
 */
export type AddressStatus = 'staff' | 'approved' | 'unapproved' | 'unknown' | 'other-client'

export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase()
}

/**
 * Approval belongs to an address, not a record. Whatever changes a record's
 * email spreads this into the same update, so a staff edit cannot carry an
 * admin's approval over to an address nobody approved.
 */
export function approvalAfterEmailChange(previous: string | null | undefined, next: string | null | undefined) {
  const same = normalizeAddress(previous ?? '') === normalizeAddress(next ?? '')
  return same ? {} : { emailApproved: false, emailApprovedAt: null, emailApprovedById: null }
}

/** EMAIL_DIRECT_ALLOW: the people using this instance. `@domain` allows a domain. */
export function isStaffAddress(address: string): boolean {
  const allow = new Set(
    (process.env.EMAIL_DIRECT_ALLOW ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  )
  const lower = normalizeAddress(address)
  return allow.has(lower) || allow.has(lower.slice(lower.lastIndexOf('@')))
}

/**
 * Pure: classify from what the address book says. An address on both an approved
 * and an unapproved record counts as approved: someone with authority ticked it.
 */
export function classifyAddress(
  address: string,
  book: { approved: Set<string>; known: Set<string>; elsewhere?: Set<string> },
): AddressStatus {
  if (isStaffAddress(address)) return 'staff'
  const lower = normalizeAddress(address)
  if (book.approved.has(lower)) return 'approved'
  if (book.elsewhere?.has(lower) && !book.known.has(lower)) return 'other-client'
  if (book.known.has(lower)) return 'unapproved'
  return 'unknown'
}

/**
 * With `clientId`, the book holds only that client's own addresses (account and
 * contacts); an address that sits on some other client's record, and not on
 * this one, comes back 'other-client'. Without it, every client counts.
 */
export async function loadAddressBook(addresses: string[], clientId?: string) {
  const wanted = [...new Set(addresses.map(normalizeAddress).filter(Boolean))]
  const approved = new Set<string>()
  const known = new Set<string>()
  const elsewhere = new Set<string>()
  if (wanted.length === 0) return { approved, known, elsewhere }

  // Loaded here so the pure classification above can be tested without a database.
  const { prisma } = await import('@/lib/prisma')

  const match = { email: { in: wanted, mode: 'insensitive' as const } }
  const select = { email: true, emailApproved: true }
  const [clients, contacts] = await Promise.all([
    prisma.client.findMany({ where: match, select: { ...select, id: true } }),
    prisma.clientContact.findMany({ where: match, select: { ...select, clientId: true } }),
  ])
  const rows = [
    ...clients.map((row) => ({ ...row, owner: row.id })),
    ...contacts.map((row) => ({ ...row, owner: row.clientId })),
  ]
  for (const row of rows) {
    if (!row.email) continue
    const lower = normalizeAddress(row.email)
    if (clientId && row.owner !== clientId) {
      elsewhere.add(lower)
      continue
    }
    known.add(lower)
    if (row.emailApproved) approved.add(lower)
  }
  return { approved, known, elsewhere }
}

export async function addressStatuses(
  addresses: string[],
  clientId?: string,
): Promise<Record<string, AddressStatus>> {
  const book = await loadAddressBook(addresses, clientId)
  return Object.fromEntries(addresses.map((address) => [address, classifyAddress(address, book)]))
}

/**
 * The refusal for a message, or null to go ahead. Every recipient must pass:
 * one unapproved address on the To: line stops the whole message.
 */
export async function approvalProblem(
  to: string | string[],
  audience?: 'client',
  clientId?: string,
): Promise<string | null> {
  const recipients = Array.isArray(to) ? to : [to]
  // A client-bound message goes to bare addresses only: "Name <a@b.com>" or a
  // comma-joined string would not match the address book and slip past it.
  const malformed = audience === 'client' ? recipients.filter((a) => !/^[^\s<>,;@]+@[^\s<>,;@]+$/.test(a.trim())) : []
  if (malformed.length > 0) return `Not a plain email address: ${malformed.join(', ')}.`
  const statuses = await addressStatuses(recipients, clientId)
  const elsewhere = recipients.filter((address) => statuses[address] === 'other-client')
  if (elsewhere.length > 0) {
    return `${elsewhere.join(', ')} belongs to a different client, not this one. Add it to this client's contacts first.`
  }
  const refused = recipients.filter((address) => {
    const status = statuses[address]
    return status === 'unapproved' || (status === 'unknown' && audience === 'client')
  })
  if (refused.length === 0) return null
  return `Not approved for email: ${refused.join(', ')}. An admin can enable email for the client or contact.`
}
